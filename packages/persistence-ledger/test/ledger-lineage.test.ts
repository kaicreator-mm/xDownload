/**
 * TEST_MATRIX suite `durable-ledger-lineage`.
 *
 * Proves: durable identities across restart, retry reconciling by lineage,
 * staged/materialized/finalized/accepted as distinct durable states,
 * transactional budget facts surviving restart, duplicate-client convergence
 * (oracle R04), exactly one authoritative writer path, and opaque
 * authorization references with raw secrets rejected as ordinary state.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { LedgerConnection, PersistenceError } from '../src/index.ts';
import {
  BUDGET_PROFILE,
  FIXTURE_BYTES,
  driveToFinalized,
  fixtureIds,
  makeTempDir,
  openScenario,
  removeTempDir,
  reopenScenario,
  submitFixture,
  VALIDATION_OK,
  type Scenario,
} from './helpers.ts';

const dirs: string[] = [];
function freshDir(): string {
  const dir = makeTempDir('t005-lineage');
  dirs.push(dir);
  return dir;
}
function freshScenario(): Scenario {
  const scenario = openScenario(freshDir());
  dirs.push(scenario.dir);
  return scenario;
}

afterAll(() => {
  for (const dir of dirs) {
    removeTempDir(dir);
  }
});

describe('durable-ledger-lineage', () => {
  it('command/work/effect/attempt identities are durable across restart; retry reconciles by lineage', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:one' });
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const workItem = scenario.writer.reader.workItem(ids.workItemId);
      expect(workItem?.workItemId).toBe(ids.workItemId);
      expect(workItem?.effectId).toBe(ids.effectId);
      expect(workItem?.lifecycleState).toBe('REGISTERED');

      // A retry (new command) reconciles onto the SAME frozen lineage.
      const retry = scenario.writer.submitAcquisition({
        commandId: 'cmd:retry-1',
        commandKind: 'RETRY',
        workItemId: 'work:retry-attempt',
        contractId: 'contract:c1',
        snapshotId: ids.snapshotId,
        memberId: ids.memberId,
        effectId: ids.effectId,
        authorizationContextRef: 'authref:test-context',
        budgetProfile: BUDGET_PROFILE,
        artifactProvenance: { sourceRef: 'https://fixture.invalid/source' },
      });
      expect(retry.converged).toBe(true);
      expect(retry.created).toBe(false);
      expect(retry.workItemId).toBe(ids.workItemId);
      expect(retry.effectId).toBe(ids.effectId);
      // Still exactly one effect row for the lineage: no blind replay.
      const effects = scenario.connection.database.queryAll(
        'SELECT effect_id FROM effects WHERE work_item_id = ?',
        ids.workItemId,
      );
      expect(effects).toHaveLength(1);
    } finally {
      scenario.connection.close();
    }
  });

  it('staged/materialized/finalized/accepted stay distinct and no transition collapses them silently', () => {
    const scenario = freshScenario();
    try {
      const ids = submitFixture(scenario);
      scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
      const stateOf = () => scenario.writer.reader.workItem(ids.workItemId)?.lifecycleState;
      expect(stateOf()).toBe('REGISTERED');

      scenario.writer.stageArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        bytes: FIXTURE_BYTES,
        provenance: { sourceRef: 'https://fixture.invalid/source' },
      });
      expect(stateOf()).toBe('STAGED');

      // Skipping ahead is refused: acceptance before finalize is invalid.
      try {
        scenario.writer.acceptArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          validation: VALIDATION_OK,
        });
        throw new Error('expected ACCEPTANCE_INVALID');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('ACCEPTANCE_INVALID');
      }
      expect(stateOf()).toBe('STAGED');

      scenario.writer.materializeArtifact(ids.workItemId, ids.artifactId);
      expect(stateOf()).toBe('MATERIALIZED');
      scenario.writer.finalizeArtifact(ids.workItemId, ids.artifactId);
      expect(stateOf()).toBe('FINALIZED');
      scenario.writer.acceptArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        validation: VALIDATION_OK,
      });
      expect(stateOf()).toBe('ACCEPTED');

      // Non-advancing transitions are refused (no silent collapse).
      expect(() =>
        scenario.writer.stageArtifact({
          workItemId: ids.workItemId,
          artifactId: 'artifact:later',
          bytes: FIXTURE_BYTES,
          provenance: { sourceRef: 'https://fixture.invalid/source' },
        }),
      ).toThrow(PersistenceError);
      expect(stateOf()).toBe('ACCEPTED');
    } finally {
      scenario.connection.close();
    }
  });

  it('budget reservation/consumption facts are transactional, survive restart, never replenish or double-consume', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({
      workItemId: ids.workItemId,
      attemptId: 'attempt:1',
      reservations: [
        {
          domain: 'transfer',
          limitKey: 'bytes',
          amount: 40_000,
          convergenceKey: 'plan:w1',
        },
      ],
    });
    scenario.writer.stageArtifact({
      workItemId: ids.workItemId,
      artifactId: ids.artifactId,
      bytes: FIXTURE_BYTES,
      provenance: { sourceRef: 'https://fixture.invalid/source' },
      consumption: {
        domain: 'transfer',
        limitKey: 'bytes',
        amount: FIXTURE_BYTES.length,
        convergenceKey: 'consumed:a1',
      },
    });
    const expectedRemaining = 100_000 - 40_000 - FIXTURE_BYTES.length;
    const beforeRestart = scenario.writer.reader.budgetRemaining(ids.workItemId);
    expect(beforeRestart.transfer.perLimit['bytes']).toBe(expectedRemaining);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      // Inherited exactly: no replenishment, no double consumption (R05).
      const afterRestart = scenario.writer.reader.budgetRemaining(ids.workItemId);
      expect(afterRestart).toEqual(beforeRestart);

      // Replaying the same consumption convergence key never double-charges.
      const replay = scenario.writer.consumeBudget({
        workItemId: ids.workItemId,
        domain: 'transfer',
        limitKey: 'bytes',
        amount: FIXTURE_BYTES.length,
        convergenceKey: 'consumed:a1',
      });
      expect(replay.alreadyConsumed).toBe(true);
      expect(scenario.writer.reader.budgetRemaining(ids.workItemId)).toEqual(beforeRestart);

      // Consumption beyond durable remaining is refused with no charge.
      expect(() =>
        scenario.writer.consumeBudget({
          workItemId: ids.workItemId,
          domain: 'transfer',
          limitKey: 'bytes',
          amount: expectedRemaining + 1,
          convergenceKey: 'consumed:over-limit',
        }),
      ).toThrow(PersistenceError);
      expect(scenario.writer.reader.budgetRemaining(ids.workItemId)).toEqual(beforeRestart);
    } finally {
      scenario.connection.close();
    }
  });

  it('R04: independent duplicate clients converge to one lineage, one effect, one accepted artifact', () => {
    const scenario = freshScenario();
    try {
      const first = submitFixture(scenario, { commandId: 'cmd:client-a' });
      const second = submitFixture(scenario, { commandId: 'cmd:client-b' });
      expect(second.outcome.converged).toBe(true);
      expect(second.outcome.workItemId).toBe(first.workItemId);
      expect(second.outcome.effectId).toBe(first.effectId);

      scenario.writer.dispatch({ workItemId: first.workItemId, attemptId: 'attempt:1' });
      scenario.writer.recordExternalEffectObserved(first.workItemId);
      scenario.writer.stageArtifact({
        workItemId: first.workItemId,
        artifactId: first.artifactId,
        bytes: FIXTURE_BYTES,
        provenance: { sourceRef: 'https://fixture.invalid/source' },
      });
      scenario.writer.materializeArtifact(first.workItemId, first.artifactId);
      scenario.writer.finalizeArtifact(first.workItemId, first.artifactId);

      const accepted = scenario.writer.acceptArtifact({
        workItemId: first.workItemId,
        artifactId: first.artifactId,
        validation: VALIDATION_OK,
      });
      expect(accepted.alreadyAccepted).toBe(false);
      // Duplicate acceptance (restart/retry/second client) converges.
      const replay = scenario.writer.acceptArtifact({
        workItemId: first.workItemId,
        artifactId: first.artifactId,
        validation: VALIDATION_OK,
      });
      expect(replay.alreadyAccepted).toBe(true);

      const artifacts = scenario.connection.database.queryAll('SELECT artifact_id FROM artifacts');
      expect(artifacts).toHaveLength(1);
      const acceptedFacts = scenario.connection.database.queryAll(
        "SELECT fact_seq FROM transition_facts WHERE fact_kind = 'ACCEPTED'",
      );
      expect(acceptedFacts).toHaveLength(1);
    } finally {
      scenario.connection.close();
    }
  });

  it('exactly one authoritative writer path exists; a second writable path is rejected', () => {
    const scenario = freshScenario();
    try {
      expect(() => openScenario(scenario.dir)).toThrow(PersistenceError);
      try {
        openScenario(scenario.dir);
        throw new Error('expected AUTHORITATIVE_WRITER_VIOLATION');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('AUTHORITATIVE_WRITER_VIOLATION');
      }
      // Readers/submitters are unlimited: a read-only path works.
      const reader = LedgerConnection.open(scenario.dbPath, { readOnly: true });
      reader.close();
    } finally {
      scenario.connection.close();
    }
    // After the writer closes, a new writer may be admitted (fresh process
    // generation), and history remains intact.
    const reopened = openScenario(scenario.dir);
    try {
      expect(reopened.writer.reader.workItems()).toHaveLength(0);
    } finally {
      reopened.connection.close();
    }
  });

  it('stored authorization context stays opaque; raw reusable secret material is never ordinary state', () => {
    const scenario = freshScenario();
    const secret = 'SUPER-SECRET-COOKIE-VALUE-9f2';
    try {
      const ids = submitFixture(scenario, {
        authorizationContextRef: 'authref:opaque-reference-1',
      });
      const workItem = scenario.writer.reader.workItem(ids.workItemId);
      expect(workItem?.authorizationContextRef).toBe('authref:opaque-reference-1');

      // Raw secret material in any persisted payload is rejected up front.
      expect(() =>
        scenario.writer.stageArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          bytes: FIXTURE_BYTES,
          provenance: { cookie: secret, sourceRef: 'https://fixture.invalid/source' },
        }),
      ).toThrow(PersistenceError);
      try {
        scenario.writer.stageArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          bytes: FIXTURE_BYTES,
          provenance: { cookie: secret },
        });
        throw new Error('expected RAW_SECRET_REJECTED');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('RAW_SECRET_REJECTED');
      }

      // The raw secret appears nowhere in durable state.
      const raw = new DatabaseSync(scenario.dbPath, { readOnly: true });
      try {
        const tables = raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[];
        for (const table of tables) {
          const rows = raw.prepare(`SELECT * FROM ${table.name}`).all() as Record<
            string,
            unknown
          >[];
          for (const row of rows) {
            for (const value of Object.values(row)) {
              expect(String(value)).not.toContain(secret);
            }
          }
        }
      } finally {
        raw.close();
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('attempt identities are durable and monotonic across restart and explicit retry', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:one' });
    scenario.connection.close();
    scenario = reopenScenario(scenario);
    try {
      scenario.writer.explicitRetryResume(ids.workItemId, 'cmd:retry');
      const attempts = scenario.connection.database.queryAll(
        'SELECT attempt_id, attempt_no FROM attempts ORDER BY attempt_no',
      );
      expect(attempts.map((row) => String(row['attempt_id']))).toEqual([
        'attempt:one',
        'retry:cmd:retry',
      ]);
      expect(attempts.map((row) => row['attempt_no'])).toEqual([1, 2]);
    } finally {
      scenario.connection.close();
    }
  });

  it('fixture helper drives to a finalized state deterministically', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      const workItem = scenario.writer.reader.workItem(ids.workItemId);
      expect(workItem?.lifecycleState).toBe('FINALIZED');
      expect(fixtureIds().workItemId).toBe('work:w1');
    } finally {
      scenario.connection.close();
    }
  });
});
