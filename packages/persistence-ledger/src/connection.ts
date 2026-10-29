/**
 * T005 ledger connection — fail-closed open and the single authoritative
 * writer registry.
 *
 * Opening a database is an authoritative boundary: the schema family marker
 * and version marker are both checked before any reinterpretation can
 * happen, unsupported versions are rejected with the original file preserved
 * for diagnostics, and only ONE writable ledger handle may exist per database
 * file per process (frozen L2 §10: no second writable path). Read-only
 * handles are unlimited — surfaces/adapters are readers/submitters.
 *
 * SQLite configuration (F1 choice): WAL journal + `synchronous=FULL`. This
 * configuration supports the claimed process-death/reopen tuple only; it is
 * never a host-power-loss durability guarantee (frozen L2 §6.2).
 */

import { DatabaseSync } from 'node:sqlite';
import { PersistenceError } from './errors.ts';
import { migrationStepFor, type MigrationOutcome } from './migrations.ts';
import {
  CURRENT_SCHEMA_VERSION,
  PERSISTENCE_SCHEMA_FAMILY_ID,
  SUPPORTED_SCHEMA_VERSIONS,
} from './version.ts';

export type SqlParam = string | number | bigint | Uint8Array | null;
export type Row = Record<string, SqlParam>;

export interface LedgerDatabaseOptions {
  readonly readOnly?: boolean;
}

/**
 * Thin auditable wrapper around one SQLite connection. Raw access is
 * intentionally narrow: positional-parameter statements through
 * `queryAll`/`queryGet`/`runStmt`, transactions through `transaction`. There
 * is no escape hatch that bypasses the single-writer registry.
 */
export class LedgerDatabase {
  readonly path: string;
  readonly readOnly: boolean;
  private readonly db: DatabaseSync;
  private closed = false;
  private transactionDepth = 0;

  constructor(path: string, readOnly: boolean, db: DatabaseSync) {
    this.path = path;
    this.readOnly = readOnly;
    this.db = db;
  }

  queryAll(sql: string, ...params: SqlParam[]): Row[] {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    return statement.all(...params) as Row[];
  }

  queryGet(sql: string, ...params: SqlParam[]): Row | undefined {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    return statement.get(...params) as Row | undefined;
  }

  runStmt(sql: string, ...params: SqlParam[]): { changes: number | bigint } {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    const result = statement.run(...params);
    return { changes: result.changes };
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /** Durable schema-version marker (`PRAGMA user_version`). */
  schemaVersion(): number {
    const row = this.queryGet('PRAGMA user_version');
    if (row === undefined) {
      throw new PersistenceError('MALFORMED_LEDGER_ROW', 'PRAGMA user_version returned no row', {
        path: 'user_version',
      });
    }
    const value = row['user_version'];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new PersistenceError(
        'MALFORMED_LEDGER_ROW',
        `PRAGMA user_version is not a non-negative integer: ${String(value)}`,
        { path: 'user_version' },
      );
    }
    return value;
  }

  userTables(): readonly string[] {
    return this.queryAll(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row) => {
      const name = row['name'];
      if (typeof name !== 'string') {
        throw new PersistenceError(
          'MALFORMED_LEDGER_ROW',
          'sqlite_master returned a non-string table name',
          { path: 'sqlite_master.name' },
        );
      }
      return name;
    });
  }

  /**
   * Run `fn` inside one `BEGIN IMMEDIATE` transaction. All lifecycle
   * mutations commit through this discipline: state change + budget delta +
   * transition-order fact in one atomic durable step (frozen L2 §6.3).
   */
  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.readOnly) {
      throw new PersistenceError(
        'AUTHORITATIVE_WRITER_VIOLATION',
        'read-only ledger connections cannot run write transactions',
      );
    }
    if (this.transactionDepth > 0) {
      throw new PersistenceError(
        'AUTHORITATIVE_WRITER_VIOLATION',
        'nested write transactions are not permitted on the authoritative writer',
      );
    }
    this.transactionDepth = 1;
    this.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.exec('COMMIT');
      this.transactionDepth = 0;
      return value;
    } catch (error) {
      this.exec('ROLLBACK');
      this.transactionDepth = 0;
      throw error;
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
      if (!this.readOnly) {
        releaseWriterRegistration(this.path);
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new PersistenceError('AUTHORITATIVE_WRITER_VIOLATION', 'ledger connection is closed', {
        path: this.path,
      });
    }
  }

  /** Migrate forward through explicit supported steps only. */
  migrateForwardTo(targetVersion: number): MigrationOutcome {
    this.assertOpen();
    if (this.readOnly) {
      throw new PersistenceError('SCHEMA_VERSION_REJECTED', 'read-only connections never migrate');
    }
    const from = this.schemaVersion();
    if (from > targetVersion) {
      throw new PersistenceError(
        'SCHEMA_VERSION_REJECTED',
        `cannot forward-migrate from ${from} to ${targetVersion}`,
        { invariant: 'schema-versioning' },
      );
    }
    const applied: number[] = [];
    for (let version = from + 1; version <= targetVersion; version += 1) {
      const step = migrationStepFor(version);
      this.transaction(() => {
        for (const statement of step.forwardStatements) {
          this.exec(statement);
        }
        this.exec(`PRAGMA user_version = ${version}`);
      });
      applied.push(version);
    }
    return { from, to: targetVersion, appliedVersions: applied };
  }

  /**
   * Explicit designed rollback to an earlier supported version. This is the
   * only downgrade entry point; it runs the version's designed backward
   * statements and never improvises (FAILURE_MATRIX `unsafe-migration`).
   */
  rollbackTo(targetVersion: number): MigrationOutcome {
    this.assertOpen();
    if (this.readOnly) {
      throw new PersistenceError('SCHEMA_VERSION_REJECTED', 'read-only connections never migrate');
    }
    const from = this.schemaVersion();
    if (targetVersion >= from) {
      throw new PersistenceError(
        'SCHEMA_VERSION_REJECTED',
        `rollback requires a lower target version (from ${from} to ${targetVersion})`,
        { invariant: 'schema-versioning' },
      );
    }
    if (!isSupportedVersion(targetVersion) || !isSupportedVersion(from)) {
      throw new PersistenceError(
        'UNSUPPORTED_SCHEMA_VERSION',
        `rollback between unsupported versions ${from} -> ${targetVersion} is refused`,
        { invariant: 'schema-versioning' },
      );
    }
    const applied: number[] = [];
    for (let version = from; version > targetVersion; version -= 1) {
      const step = migrationStepFor(version);
      if (step.backwardStatements.length === 0) {
        throw new PersistenceError(
          'SCHEMA_VERSION_REJECTED',
          `schema version ${version} has no designed backward path`,
          { invariant: 'schema-versioning' },
        );
      }
      this.transaction(() => {
        for (const statement of step.backwardStatements) {
          this.exec(statement);
        }
        this.exec(`PRAGMA user_version = ${version - 1}`);
      });
      applied.push(version - 1);
    }
    return { from, to: targetVersion, appliedVersions: applied };
  }

  /** Create the current schema on a brand-new database file. */
  initializeFresh(): MigrationOutcome {
    const applied = this.transaction(() => {
      const appliedVersions: number[] = [];
      for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
        const step = migrationStepFor(version);
        for (const statement of step.forwardStatements) {
          this.exec(statement);
        }
        this.exec(`PRAGMA user_version = ${version}`);
        appliedVersions.push(version);
      }
      return appliedVersions;
    });
    return { from: 0, to: CURRENT_SCHEMA_VERSION, appliedVersions: applied };
  }
}

function isSupportedVersion(version: number): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}

/**
 * Single-writer registry: at most one writable ledger handle per database
 * file per process. A second writable path is a typed violation (frozen L2
 * §10; TEST_MATRIX `durable-ledger-lineage` single-writer bullet).
 */
const writerRegistry = new Map<string, symbol>();

function writerKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function releaseWriterRegistration(path: string): void {
  writerRegistry.delete(writerKey(path));
}

export class LedgerConnection {
  readonly database: LedgerDatabase;

  private constructor(database: LedgerDatabase) {
    this.database = database;
  }

  static open(path: string, options: LedgerDatabaseOptions = {}): LedgerConnection {
    const readOnly = options.readOnly ?? false;
    const db = new DatabaseSync(path, { readOnly });
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    const ledger = new LedgerConnection(new LedgerDatabase(path, readOnly, db));
    try {
      // Fail-closed compatibility check BEFORE any file-mutating pragma: a
      // rejected database is preserved byte-for-byte for diagnostics (R12).
      assertCompatibleLedgerFile(ledger.database, readOnly);
      if (!readOnly) {
        // F1 durability configuration choice (see module doc): WAL journal
        // with synchronous=FULL. Bounded to the process-death/reopen tuple;
        // never cited as a host-power-loss guarantee (frozen L2 §6.2).
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = FULL');
        const version = ledger.database.schemaVersion();
        if (version < CURRENT_SCHEMA_VERSION) {
          ledger.database.migrateForwardTo(CURRENT_SCHEMA_VERSION);
        }
      }
    } catch (error) {
      db.close();
      throw error;
    }
    return ledger;
  }

  static openWriter(path: string): LedgerConnection {
    const key = writerKey(path);
    if (writerRegistry.has(key)) {
      throw new PersistenceError(
        'AUTHORITATIVE_WRITER_VIOLATION',
        `a second writable ledger path for '${path}' is rejected; exactly one authoritative writer exists per database file`,
        { invariant: 'L2-§10-single-writer' },
      );
    }
    const connection = LedgerConnection.open(path, { readOnly: false });
    writerRegistry.set(key, Symbol('authoritative-writer'));
    return connection;
  }

  close(): void {
    this.database.close();
  }
}

function assertCompatibleLedgerFile(db: LedgerDatabase, readOnly: boolean): void {
  const version = db.schemaVersion();
  const tables = db.userTables();
  if (version === 0) {
    if (tables.length === 0) {
      if (readOnly) {
        throw new PersistenceError(
          'INCOMPATIBLE_SCHEMA_FAMILY',
          'read-only open of an uninitialized ledger file is refused',
          { path: 'user_version' },
        );
      }
      db.initializeFresh();
      return;
    }
    throw new PersistenceError(
      'INCOMPATIBLE_SCHEMA_FAMILY',
      'file has tables but declares schema version 0; this is not an xDownload persistence ledger and is never coerced into one',
      { path: 'user_version', invariant: 'fail-closed-open' },
    );
  }
  if (!isSupportedVersion(version)) {
    throw new PersistenceError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `ledger declares unsupported schema version ${version} (supported: ${JSON.stringify(
        SUPPORTED_SCHEMA_VERSIONS,
      )}); file preserved for diagnostics`,
      { path: 'user_version', invariant: 'fail-closed-open' },
    );
  }
  const familyRow = (() => {
    try {
      return db.queryGet("SELECT value FROM ledger_meta WHERE key = 'schema_family'");
    } catch {
      return undefined;
    }
  })();
  const family = familyRow?.['value'];
  if (family !== PERSISTENCE_SCHEMA_FAMILY_ID) {
    throw new PersistenceError(
      'INCOMPATIBLE_SCHEMA_FAMILY',
      `ledger schema family marker '${String(family)}' does not match '${PERSISTENCE_SCHEMA_FAMILY_ID}'`,
      { path: 'ledger_meta.schema_family', invariant: 'fail-closed-open' },
    );
  }
}
