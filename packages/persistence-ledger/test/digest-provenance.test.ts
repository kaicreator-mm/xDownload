/**
 * TEST_MATRIX suite `digest-provenance-binding`.
 *
 * Proves: artifact bytes bind to durable effect/artifact identity via
 * digest/provenance before acceptance; missing bytes never become success
 * regardless of DB state; digest-mismatched/corrupt bytes classify
 * truthfully and never become success (R07) and are never silently
 * re-staged; acceptance always requires passing validation (transfer alone
 * never suffices); and identical bytes under different logical identities
 * remain distinct records (R10).
 */

import { appendFileSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { PersistenceError, fileSafeName, sha256Hex } from '../src/index.ts';
import {
  FIXTURE_BYTES,
  driveToFinalized,
  makeTempDir,
  openScenario,
  removeTempDir,
  submitFixture,
  VALIDATION_OK,
  type Scenario,
} from './helpers.ts';

const dirs: string[] = [];
function freshScenario(): Scenario {
  const scenario = openScenario(makeTempDir('t005-digest'));
  dirs.push(scenario.dir);
  return scenario;
}

afterAll(() => {
  for (const dir of dirs) {
    removeTempDir(dir);
  }
});

describe('digest-provenance-binding', () => {
  it('artifact records bind bytes to durable identity via digest before acceptance', () => {
    const scenario = freshScenario();
    try {
      const ids = submitFixture(scenario);
      scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
      scenario.writer.stageArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        bytes: FIXTURE_BYTES,
        provenance: { sourceRef: 'https://fixture.invalid/source' },
      });
      const artifact = scenario.writer.reader.artifact(ids.workItemId, ids.artifactId);
      expect(artifact?.digestSha256).toBe(sha256Hex(FIXTURE_BYTES));
      expect(artifact?.byteSize).toBe(FIXTURE_BYTES.length);
      expect(artifact?.provenanceJson).toContain('https://fixture.invalid/source');
    } finally {
      scenario.connection.close();
    }
  });

  it('missing bytes never become success regardless of DB state', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      rmSync(`${scenario.storeRoot}/final/${fileSafeName(ids.artifactId)}.bin`);
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
      const state = scenario.writer.reader.workItem(ids.workItemId)?.lifecycleState;
      expect(state).toBe('FINALIZED');
    } finally {
      scenario.connection.close();
    }
  });

  it('R07: corrupt bytes never become success and are never silently re-staged over the record', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      // Tamper after finalization, before acceptance.
      appendFileSync(`${scenario.storeRoot}/final/${fileSafeName(ids.artifactId)}.bin`, 'tamper');

      try {
        scenario.writer.acceptArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          validation: VALIDATION_OK,
        });
        throw new Error('expected PROVENANCE_DIGEST_MISMATCH');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('PROVENANCE_DIGEST_MISMATCH');
      }
      expect(scenario.writer.reader.workItem(ids.workItemId)?.lifecycleState).toBe('FINALIZED');

      // Truthful classification: failed/uncertain, never success.
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.lifecycleClass).toBe('TERMINAL_FAILED');
      expect(classification.fsState).toBe('DIGEST_MISMATCH');
      expect(classification.successClaimable).toBe(false);
      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.selectionAcquisitionStatus).toBe('FAILED');
      expect(projection.successClaimable).toBe(false);

      // Conflicting bytes at staging are a typed rejection, never a re-stage.
      expect(() =>
        scenario.writer.stageArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          bytes: Buffer.from('different bytes entirely', 'utf8'),
          provenance: { sourceRef: 'https://fixture.invalid/source' },
        }),
      ).toThrow(PersistenceError);
    } finally {
      scenario.connection.close();
    }
  });

  it('accepted artifacts always require validation-passing bytes; transfer alone never suffices', () => {
    const scenario = freshScenario();
    try {
      const ids = driveToFinalized(scenario);
      try {
        scenario.writer.acceptArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          validation: { passed: false, passedCount: 0, failedCount: 1 },
        });
        throw new Error('expected ACCEPTANCE_INVALID');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('ACCEPTANCE_INVALID');
      }
      expect(scenario.writer.reader.workItem(ids.workItemId)?.lifecycleState).toBe('FINALIZED');
    } finally {
      scenario.connection.close();
    }
  });

  it('unmaterialized staged bytes are never accepted', () => {
    const scenario = freshScenario();
    try {
      const ids = submitFixture(scenario);
      scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:1' });
      scenario.writer.recordExternalEffectObserved(ids.workItemId);
      scenario.writer.stageArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        bytes: FIXTURE_BYTES,
        provenance: { sourceRef: 'https://fixture.invalid/source' },
      });
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
    } finally {
      scenario.connection.close();
    }
  });

  it('R10: identical bytes under different logical member/effect identities remain distinct records', () => {
    const scenario = freshScenario();
    try {
      const idsA = driveToFinalized(scenario, {
        workItemId: 'work:ma',
        commandId: 'cmd:ma',
        snapshotId: 'snapshot:s1',
        memberId: 'member:ma',
        effectId: 'effect:ea',
        artifactId: 'artifact:ma',
      });
      const idsB = driveToFinalized(scenario, {
        workItemId: 'work:mb',
        commandId: 'cmd:mb',
        snapshotId: 'snapshot:s1',
        memberId: 'member:mb',
        effectId: 'effect:eb',
        artifactId: 'artifact:mb',
      });
      const artifactA = scenario.writer.reader.artifact(idsA.workItemId, idsA.artifactId);
      const artifactB = scenario.writer.reader.artifact(idsB.workItemId, idsB.artifactId);
      // Content identity (digest) matches; logical identity does not collapse.
      expect(artifactA?.digestSha256).toBe(artifactB?.digestSha256);
      expect(artifactA?.artifactId).not.toBe(artifactB?.artifactId);
      expect(idsA.memberId).not.toBe(idsB.memberId);
      const artifacts = scenario.connection.database.queryAll('SELECT artifact_id FROM artifacts');
      expect(artifacts).toHaveLength(2);
      const workItems = scenario.connection.database.queryAll(
        'SELECT member_id FROM work_items ORDER BY member_id',
      );
      expect(workItems.map((row) => String(row['member_id']))).toEqual(['member:ma', 'member:mb']);
    } finally {
      scenario.connection.close();
    }
  });
});
