/**
 * TEST_MATRIX suite `recovery-reconciliation-db-first-fs-first`.
 *
 * Proves DB-first recovery (accepted DB truth with missing/unmaterialized
 * bytes never projects success — R02), FS-first recovery (finalized bytes
 * without durable acceptance never auto-promote — R03), truthful
 * IN_FLIGHT_UNKNOWN reconciliation (R09), retry/resume on the same frozen
 * lineage with valid byte reuse (R06), and output that distinguishes
 * transactional DB state from filesystem state.
 */

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { PersistenceError, fileSafeName } from '../src/index.ts';
import {
  FIXTURE_BYTES,
  driveToFinalized,
  makeTempDir,
  openScenario,
  removeTempDir,
  reopenScenario,
  submitFixture,
  VALIDATION_OK,
  type Scenario,
} from './helpers.ts';

const dirs: string[] = [];
function freshScenario(): Scenario {
  const scenario = openScenario(makeTempDir('t005-recovery'));
  dirs.push(scenario.dir);
  return scenario;
}

afterAll(() => {
  for (const dir of dirs) {
    removeTempDir(dir);
  }
});

describe('recovery-reconciliation-db-first-fs-first', () => {
  it('R02: a durable accepted DB state with deleted bytes never projects final success', () => {
    let scenario = freshScenario();
    const ids = driveToFinalized(scenario);
    scenario.writer.acceptArtifact({
      workItemId: ids.workItemId,
      artifactId: ids.artifactId,
      validation: VALIDATION_OK,
    });
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      // DB says accepted; the filesystem bytes are gone (one-side mutation).
      rmSync(`${scenario.storeRoot}/final/${fileSafeName(ids.artifactId)}.bin`);
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.dbState).toBe('ACCEPTED');
      expect(classification.fsState).toBe('ABSENT');
      expect(classification.bytesVerified).toBe(false);
      expect(classification.successClaimable).toBe(false);

      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.accepted).toBe(true);
      expect(projection.successClaimable).toBe(false);
      expect(projection.bytesVerified).toBe(false);
    } finally {
      scenario.connection.close();
    }
  });

  it('an accepted row without a digest-bound artifact record fails closed instead of projecting', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      const raw = new DatabaseSync(scenario.dbPath);
      raw
        .prepare('UPDATE artifacts SET digest_sha256 = NULL WHERE artifact_id = ?')
        .run(ids.artifactId);
      raw
        .prepare('UPDATE work_items SET lifecycle_state = ? WHERE work_item_id = ?')
        .run('ACCEPTED', ids.workItemId);
      raw.close();
      try {
        scenario.recovery.classify(ids.workItemId);
        throw new Error('expected INCONSISTENT_LEDGER');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('INCONSISTENT_LEDGER');
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('R03: finalized bytes without durable acceptance never become accepted through automatic recovery', () => {
    let scenario = freshScenario();
    driveToFinalized(scenario);
    scenario.connection.close();

    // Repeated automatic recovery (reopen + classify) never promotes.
    for (let round = 0; round < 3; round += 1) {
      scenario = reopenScenario(scenario);
      try {
        const classification = scenario.recovery.classify('work:w1');
        expect(classification.lifecycleClass).toBe('SUCCEEDED_UNACCEPTED');
        expect(classification.dbState).toBe('FINALIZED');
        expect(classification.bytesVerified).toBe(true);
        expect(classification.successClaimable).toBe(false);
        expect(classification.acceptanceAllowed).toBe(true);
        const projection = scenario.recovery.project('work:w1');
        expect(projection.accepted).toBe(false);
        expect(projection.selectionAcquisitionStatus).toBe('NOT_STARTED');
      } finally {
        scenario.connection.close();
      }
    }
  });

  it('R09: an in-flight external effect at crash time is reconciled, never silently succeeded, never duplicated', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.lifecycleClass).toBe('IN_FLIGHT_UNKNOWN');
      expect(classification.successClaimable).toBe(false);

      // Restart/recovery must not create a duplicate effect or lineage.
      const effects = scenario.connection.database.queryAll(
        'SELECT effect_id FROM effects WHERE work_item_id = ?',
        ids.workItemId,
      );
      expect(effects).toHaveLength(1);

      // The uncertain effect cannot be accepted from durable facts alone.
      expect(() =>
        scenario.writer.acceptArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          validation: VALIDATION_OK,
        }),
      ).toThrow(PersistenceError);
    } finally {
      scenario.connection.close();
    }
  });

  it('R06: retry/resume continues the same lineage and reuses valid staged bytes without a duplicate external effect', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
    scenario.writer.recordExternalEffectObserved(ids.workItemId);
    scenario.writer.stageArtifact({
      workItemId: ids.workItemId,
      artifactId: ids.artifactId,
      bytes: FIXTURE_BYTES,
      provenance: { sourceRef: 'https://fixture.invalid/source' },
    });
    const remainingBefore = scenario.writer.reader.budgetRemaining(ids.workItemId);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const partial = scenario.recovery.classify(ids.workItemId);
      expect(partial.lifecycleClass).toBe('PARTIAL_RECOVERABLE');
      expect(partial.fsState).toBe('STAGED');

      // Explicit retry/resume (never automatic) reopens processing.
      scenario.writer.explicitRetryResume(ids.workItemId, 'cmd:resume-1');
      const stage = scenario.writer.stageArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        bytes: FIXTURE_BYTES,
        provenance: { sourceRef: 'https://fixture.invalid/source' },
      });
      expect(stage.reused).toBe(true);

      // Same lineage, inherited budgets, no duplicate effect.
      expect(scenario.writer.reader.workItem(ids.workItemId)?.workItemId).toBe(ids.workItemId);
      expect(scenario.writer.reader.budgetRemaining(ids.workItemId)).toEqual(remainingBefore);
      const effects = scenario.connection.database.queryAll(
        'SELECT effect_id FROM effects WHERE work_item_id = ?',
        ids.workItemId,
      );
      expect(effects).toHaveLength(1);

      scenario.writer.materializeArtifact(ids.workItemId, ids.artifactId);
      scenario.writer.finalizeArtifact(ids.workItemId, ids.artifactId);
      scenario.writer.acceptArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        validation: VALIDATION_OK,
      });
      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.accepted).toBe(true);
      expect(projection.successClaimable).toBe(true);
    } finally {
      scenario.connection.close();
    }
  });

  it('recovery records distinguish transactional DB state from filesystem lifecycle', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      scenario.writer.acceptArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        validation: VALIDATION_OK,
      });
      const consistent = scenario.recovery.classify(ids.workItemId);
      expect(consistent.dbState).toBe('ACCEPTED');
      expect(consistent.fsState).toBe('FINALIZED');

      rmSync(`${scenario.storeRoot}/final/${fileSafeName(ids.artifactId)}.bin`);
      const divergent = scenario.recovery.classify(ids.workItemId);
      expect(divergent.dbState).toBe('ACCEPTED');
      expect(divergent.fsState).toBe('ABSENT');
    } finally {
      scenario.connection.close();
    }
  });
});
