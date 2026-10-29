/**
 * TEST_MATRIX suite `schema-and-migrations` (+ oracle R12).
 *
 * Proves: explicit durable version identity, deterministic fresh install,
 * forward migration preserving authoritative rows/identities/state
 * distinctions, the designed backward path never mutating history, and
 * fail-closed reopening on unsupported/incompatible versions or malformed
 * ledger rows (negative decode cases).
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  LedgerConnection,
  MIGRATION_STEPS,
  PERSISTENCE_SCHEMA_FAMILY_ID,
  PersistenceError,
} from '../src/index.ts';
import { decodeLifecycleState } from '../src/rows.ts';
import {
  BUDGET_PROFILE,
  makeTempDir,
  openScenario,
  removeTempDir,
  submitFixture,
} from './helpers.ts';

const dirs: string[] = [];
function freshDir(): string {
  const dir = makeTempDir('t005-schema');
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) {
    removeTempDir(dir);
  }
});

function migrationStep(version: number) {
  const step = MIGRATION_STEPS.find((candidate) => candidate.version === version);
  if (step === undefined) {
    throw new Error(`missing migration step ${version}`);
  }
  return step;
}

/** Build a real v1 database with authoritative v1-era rows, via raw DDL. */
function createVersion1Database(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    for (const statement of migrationStep(1).forwardStatements) {
      db.exec(statement);
    }
    db.exec('PRAGMA user_version = 1');
    const profile = JSON.stringify({
      discovery: { domain: 'discovery', maxGeneratedRequests: 5 },
      transfer: { domain: 'transfer', maxBytes: 100_000, maxSegments: 10 },
      globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 100 },
    });
    db.prepare(
      `INSERT INTO work_items
        (work_item_id, contract_id, snapshot_id, member_id, effect_id, lifecycle_state,
         authorization_context_ref, budget_profile_json, created_at)
      VALUES ('work:v1', 'contract:c1', 'snapshot:s1', 'member:m1', 'effect:v1e1',
              'STAGED', 'authref:v1', ?, '2026-01-01T00:00:00.000Z')`,
    ).run(profile);
    db.prepare(
      "INSERT INTO commands (command_id, work_item_id, command_kind, recorded_at) VALUES ('cmd:v1', 'work:v1', 'ACQUIRE', '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO effects (effect_id, work_item_id, intent_recorded_at) VALUES ('effect:v1e1', 'work:v1', '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO attempts (attempt_id, work_item_id, attempt_no, started_at) VALUES ('attempt:v1', 'work:v1', 1, '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO transition_facts (work_item_id, fact_seq, fact_kind, fact_payload_json, recorded_at) VALUES ('work:v1', 1, 'FS_STAGED', NULL, '2026-01-01T00:00:00.000Z')",
    ).run();
  } finally {
    db.close();
  }
}

describe('schema-and-migrations', () => {
  it('the production schema carries an explicit durable version identity', () => {
    const scenario = openScenario(freshDir());
    try {
      expect(scenario.connection.database.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
      const family = scenario.connection.database.queryGet(
        "SELECT value FROM ledger_meta WHERE key = 'schema_family'",
      )?.['value'];
      expect(family).toBe(PERSISTENCE_SCHEMA_FAMILY_ID);
    } finally {
      scenario.connection.close();
    }
  });

  it('a fresh install creates the current schema deterministically', () => {
    const scenarioA = openScenario(freshDir());
    const scenarioB = openScenario(freshDir());
    try {
      const schemaOf = (scenario: typeof scenarioA) =>
        scenario.connection.database
          .queryAll('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
          .map((row) => `${String(row['type'])}|${String(row['name'])}|${String(row['sql'])}`);
      expect(schemaOf(scenarioB)).toEqual(schemaOf(scenarioA));
    } finally {
      scenarioA.connection.close();
      scenarioB.connection.close();
    }
  });

  it('forward migration from the supported prior version preserves rows, identities and state distinctions', () => {
    const dir = freshDir();
    const dbPath = join(dir, 'migrate.sqlite');
    createVersion1Database(dbPath);
    // The supported 1 -> 2 forward step runs during the real open path.
    const scenario = openScenario(dir, 'migrate.sqlite');
    try {
      expect(scenario.connection.database.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
      const workItem = scenario.writer.reader.workItem('work:v1');
      expect(workItem).toBeDefined();
      expect(workItem?.lifecycleState).toBe('STAGED');
      expect(workItem?.effectId).toBe('effect:v1e1');
      const facts = scenario.writer.reader.facts('work:v1');
      expect(facts.map((fact) => fact.kind)).toEqual(['FS_STAGED']);
      // v2-era writes work after the forward migration.
      const submitted = scenario.writer.submitAcquisition({
        commandId: 'cmd:v2',
        commandKind: 'ACQUIRE',
        workItemId: 'work:v2',
        contractId: 'contract:c2',
        snapshotId: 'snapshot:s2',
        memberId: 'member:m2',
        effectId: 'effect:v2e1',
        authorizationContextRef: 'authref:v2',
        budgetProfile: BUDGET_PROFILE,
        artifactProvenance: { sourceRef: 'https://fixture.invalid/v2' },
      });
      expect(submitted.created).toBe(true);
    } finally {
      scenario.connection.close();
    }
  });

  it('the designed backward path drops only v2 additions and never mutates v1 history', () => {
    const dir = freshDir();
    const scenario = openScenario(dir);
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
    scenario.writer.cancel(ids.workItemId);
    const beforeRows = scenario.connection.database
      .queryAll(
        'SELECT work_item_id, lifecycle_state, effect_id FROM work_items ORDER BY work_item_id',
      )
      .map((row) => JSON.stringify(row));
    scenario.connection.database.rollbackTo(1);
    try {
      expect(scenario.connection.database.schemaVersion()).toBe(1);
      const tables = scenario.connection.database.userTables();
      expect(tables).not.toContain('artifacts');
      expect(tables).not.toContain('budget_entries');
      const afterRows = scenario.connection.database
        .queryAll(
          'SELECT work_item_id, lifecycle_state, effect_id FROM work_items ORDER BY work_item_id',
        )
        .map((row) => JSON.stringify(row));
      // History/identity untouched by migration.
      expect(afterRows).toEqual(beforeRows);
    } finally {
      scenario.connection.close();
    }
    // Forward again: rows still intact.
    const reopened = openScenario(dir);
    try {
      expect(reopened.connection.database.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
      expect(reopened.writer.reader.workItem(ids.workItemId)?.lifecycleState).toBe('REGISTERED');
    } finally {
      reopened.connection.close();
    }
  });

  it('rollback without a designed path or to unsupported targets is refused', () => {
    const scenario = openScenario(freshDir());
    try {
      expect(() => scenario.connection.database.rollbackTo(0)).toThrow(PersistenceError);
      expect(() => scenario.connection.database.migrateForwardTo(99)).toThrow(PersistenceError);
    } finally {
      scenario.connection.close();
    }
  });

  it('R12: reopening an unsupported schema version fails closed and preserves the file', () => {
    const dir = freshDir();
    const dbPath = join(dir, 'future.sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE TABLE ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    raw.exec(`INSERT INTO ledger_meta VALUES ('schema_family', '${PERSISTENCE_SCHEMA_FAMILY_ID}')`);
    raw.exec('CREATE TABLE work_items (work_item_id TEXT PRIMARY KEY)');
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    try {
      LedgerConnection.open(dbPath);
      throw new Error('expected UNSUPPORTED_SCHEMA_VERSION');
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      expect((error as PersistenceError).code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
    const after = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    expect(after).toBe(before);
  });

  it('a foreign database with a matching version still fails closed on family', () => {
    const dir = freshDir();
    const dbPath = join(dir, 'foreign.sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE TABLE ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    raw.exec("INSERT INTO ledger_meta VALUES ('schema_family', 'some-other-tool')");
    raw.exec('PRAGMA user_version = 2');
    raw.close();
    try {
      LedgerConnection.open(dbPath);
      throw new Error('expected INCOMPATIBLE_SCHEMA_FAMILY');
    } catch (error) {
      expect((error as PersistenceError).code).toBe('INCOMPATIBLE_SCHEMA_FAMILY');
    }
  });

  it('a version-0 file with foreign tables fails closed instead of being coerced', () => {
    const dir = freshDir();
    const dbPath = join(dir, 'alien.sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE TABLE shopper_notes (id TEXT PRIMARY KEY)');
    raw.close();
    try {
      LedgerConnection.open(dbPath);
      throw new Error('expected INCOMPATIBLE_SCHEMA_FAMILY');
    } catch (error) {
      expect((error as PersistenceError).code).toBe('INCOMPATIBLE_SCHEMA_FAMILY');
    }
  });

  it('negative decode: unknown authoritative lifecycle state enum fails closed', () => {
    const scenario = openScenario(freshDir());
    try {
      // Schema backstop: the durable CHECK constraint refuses the write.
      const ids = submitFixture(scenario);
      const raw = new DatabaseSync(scenario.dbPath);
      expect(() =>
        raw
          .prepare('UPDATE work_items SET lifecycle_state = ? WHERE work_item_id = ?')
          .run('TELEPORTED', ids.workItemId),
      ).toThrow(/CHECK constraint/);
      raw.close();
      // Reader backstop (defense in depth for migration-era rows): the
      // decode layer rejects unknown enum values before projection.
      expect(() => decodeLifecycleState('TELEPORTED', 'work_items')).toThrow(PersistenceError);
      try {
        decodeLifecycleState('TELEPORTED', 'work_items');
        throw new Error('expected UNKNOWN_LEDGER_STATE');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('UNKNOWN_LEDGER_STATE');
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('negative decode: malformed required ledger field fails closed on read', () => {
    const scenario = openScenario(freshDir());
    try {
      const ids = submitFixture(scenario);
      const raw = new DatabaseSync(scenario.dbPath);
      raw
        .prepare('UPDATE work_items SET contract_id = ? WHERE work_item_id = ?')
        .run('', ids.workItemId);
      raw.close();
      try {
        scenario.writer.reader.workItem(ids.workItemId);
        throw new Error('expected MALFORMED_LEDGER_ROW');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('MALFORMED_LEDGER_ROW');
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('negative decode: a non-monotonic transition-order fact stream fails closed', () => {
    const scenario = openScenario(freshDir());
    try {
      const ids = submitFixture(scenario);
      const raw = new DatabaseSync(scenario.dbPath);
      raw
        .prepare(
          "INSERT INTO transition_facts (work_item_id, fact_seq, fact_kind, fact_payload_json, recorded_at) VALUES (?, 7, 'DISPATCH_INTENT', NULL, '2026-01-01T00:00:00.000Z')",
        )
        .run(ids.workItemId);
      raw.close();
      try {
        scenario.writer.reader.facts(ids.workItemId);
        throw new Error('expected NON_MONOTONIC_FACT_ORDER');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('NON_MONOTONIC_FACT_ORDER');
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('negative decode: duplicate effect identity with conflicting payload is rejected', () => {
    const scenario = openScenario(freshDir());
    try {
      submitFixture(scenario);
      try {
        scenario.writer.submitAcquisition({
          commandId: 'cmd:conflict',
          commandKind: 'ACQUIRE',
          workItemId: 'work:conflict',
          contractId: 'contract:c1',
          snapshotId: 'snapshot:other',
          memberId: 'member:other',
          effectId: 'effect:e1',
          authorizationContextRef: 'authref:test-context',
          budgetProfile: BUDGET_PROFILE,
          artifactProvenance: { sourceRef: 'https://fixture.invalid/other' },
        });
        throw new Error('expected DUPLICATE_IDENTITY_CONFLICT');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('DUPLICATE_IDENTITY_CONFLICT');
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('a read-only open observes durable truth and can never run write transactions', () => {
    const dir = freshDir();
    const scenario = openScenario(dir);
    scenario.writer.dispatch({ workItemId: submitFixture(scenario).workItemId, attemptId: 'a1' });
    scenario.connection.close();
    const reader = LedgerConnection.open(scenario.dbPath, { readOnly: true });
    try {
      expect(reader.database.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
      expect(() => reader.database.transaction(() => 1)).toThrow(PersistenceError);
    } finally {
      reader.close();
    }
  });
});
