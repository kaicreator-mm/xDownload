/**
 * v0.2 T09 — durable CAS store behind the lineage authority ledger.
 *
 * Physical storage contract for the migration lane (write set
 * `packages/download-domain-app/src/migration/**` only):
 *
 * REAL SQLITE CAS SUB-LEG: NOT_PROVEN in this lane. The frozen Task Pack
 * requires "real SQLite/Host CAS"; the honest attempt and its real results:
 *
 *   1. `@kaicreator/domain-harness-host-node` (which exports
 *      `openSqliteCasStore`) is NOT resolvable from this package — it is
 *      installed only under `packages/download-domain-host/node_modules`
 *      (probe: `MODULE_NOT_FOUND` from `packages/download-domain-app`).
 *   2. Probing it from its install site with the vendored 0.10.2-rc.0 SDK
 *      fails typed at runtime: `HOST_STORE_DRIVER_UNAVAILABLE — the physical
 *      SQLite CAS store requires better-sqlite3 (^12), which is not
 *      resolvable from this installation`. No `better-sqlite3` exists
 *      anywhere in this workspace.
 *
 * Adding the driver is a manifest/lockfile change, which belongs to the T13
 * final packaging writer (L2 A01: sequential writers, never simultaneous);
 * this lane is forbidden from touching the lock. Until then the ledger runs
 * on the atomic plain-file CAS below and the SQLite leg stays honestly
 * NOT_PROVEN — no mock admission is passed off as the real SQLite authority.
 *
 * Durability boundary of the plain-file CAS: whole-document JSON persisted
 * with temp+rename on every mutation, revision-checked against the bytes on
 * disk before each save. This is single-process-safe by construction (the
 * read-check-write+rename boundary is exactly the one the SDK's own
 * sqlite-adapter doc calls "single-process-safe only"); it is the proven
 * #183 PoC pattern (PlainFileDocStore, N04b restart evidence). Cross-process
 * concurrent writers are NOT proven by this store — the one-writer-per-
 * lineage guarantee this lane ships is enforced by the LEDGER semantics on
 * top (one authority decision per lineage, durable before the call returns),
 * not by multi-process file locking.
 *
 * The `LineageStore` seam is deliberately tiny (load / revision-checked
 * save) so a real `openSqliteCasStore`-backed adapter can be swapped in at
 * T13 time without touching the ledger logic.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LineageClaimRecord, LineageHistoryEvent, UnknownEffectRecord } from './lineage-ledger.ts';

/** Root shape of the durable ledger document (schema 1; fail-closed on drift). */
export interface LineageLedgerDoc {
  readonly schemaVersion: 1;
  /** Monotonic CAS revision; 0 means "never persisted". */
  readonly revision: number;
  /** Active ownership records by lineageId (released records are kept, not deleted). */
  readonly claims: Readonly<Record<string, LineageClaimRecord>>;
  /** UNKNOWN reconciliation book — records are immutable once appended. */
  readonly unknownEffects: readonly UnknownEffectRecord[];
  /** Append-only audit history (registrations, claims, releases, UNKNOWN bookkeeping). */
  readonly history: readonly LineageHistoryEvent[];
}

export type LineageStoreErrorCode = 'LINEAGE_CAS_CONFLICT' | 'MALFORMED_LEDGER_DOC';

/** Typed store failure — callers classify by code, never by message matching. */
export class LineageStoreError extends Error {
  readonly code: LineageStoreErrorCode;

  constructor(code: LineageStoreErrorCode, message: string) {
    super(message);
    this.name = 'LineageStoreError';
    this.code = code;
  }
}

/**
 * The physical CAS seam: load the durable document (null = no ledger yet) and
 * save a new revision under a compare-and-swap condition. Implementations must
 * persist atomically (readers never observe a torn document) and must refuse a
 * save whose expected revision does not match the durable bytes.
 */
export interface LineageStore {
  load(): LineageLedgerDoc | null;
  /** Persist `next`; returns the durably stored document (revision advanced). */
  save(next: LineageLedgerDoc): LineageLedgerDoc;
}

function parseLedgerDoc(raw: string, path: string): LineageLedgerDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LineageStoreError('MALFORMED_LEDGER_DOC', `lineage ledger at ${path} is not valid JSON; failing closed`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (parsed as { revision?: unknown }).revision !== 'number' ||
    typeof (parsed as { claims?: unknown }).claims !== 'object' ||
    (parsed as { claims?: unknown }).claims === null ||
    !Array.isArray((parsed as { unknownEffects?: unknown }).unknownEffects) ||
    !Array.isArray((parsed as { history?: unknown }).history)
  ) {
    throw new LineageStoreError(
      'MALFORMED_LEDGER_DOC',
      `lineage ledger at ${path} does not match schema version 1; failing closed`,
    );
  }
  return parsed as LineageLedgerDoc;
}

/**
 * Atomic plain-file CAS store: one JSON file, `tmp + rename` persistence,
 * revision compared against the on-disk bytes on every save (create only
 * accepted at revision 0 against a missing file). Reopening the file after a
 * real process boundary observes exactly the durable bytes — this is what the
 * kill-simulation tests rely on.
 */
export class PlainFileLineageStore implements LineageStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): LineageLedgerDoc | null {
    if (!existsSync(this.path)) return null;
    return parseLedgerDoc(readFileSync(this.path, 'utf8'), this.path);
  }

  save(next: LineageLedgerDoc): LineageLedgerDoc {
    const onDisk = this.load();
    if (onDisk === null) {
      if (next.revision !== 0) {
        throw new LineageStoreError(
          'LINEAGE_CAS_CONFLICT',
          `create refused: ledger file absent but incoming revision is ${next.revision} (expected 0)`,
        );
      }
    } else if (onDisk.revision !== next.revision) {
      throw new LineageStoreError(
        'LINEAGE_CAS_CONFLICT',
        `CAS conflict on ${this.path}: durable revision ${onDisk.revision}, incoming revision ${next.revision}`,
      );
    }
    const persisted: LineageLedgerDoc = { ...next, revision: next.revision + 1 };
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(persisted, null, 2));
    renameSync(temporary, this.path);
    return persisted;
  }
}
