/**
 * TEST_MATRIX suite `cancellation-acceptance-cutoff` (ADR-013 / L2 §11.1 /
 * Invariant 20; oracles R01, R08, R11).
 *
 * Proves: durable cancel-before-accept blocks automatic later acceptance
 * across restarts and byte discovery; cancelled-but-byted lineages project
 * CANCELLED/USER_CANCELLED and never COMPLETE from byte existence;
 * accept-before-cancel survives without retroactive revocation; unaccepted
 * post-cancel bytes remain cleanup-eligible and never accepted; automatic
 * dispatch is suppressed until an explicit retry/resume reopens the same
 * frozen lineage with inherited budgets.
 */

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
  const scenario = openScenario(makeTempDir('t005-cutoff'));
  dirs.push(scenario.dir);
  return scenario;
}

afterAll(() => {
  for (const dir of dirs) {
    removeTempDir(dir);
  }
});

describe('cancellation-acceptance-cutoff', () => {
  it('R01: staged-then-cancelled-while-down blocks automatic acceptance and projects CANCELLED, never COMPLETE', () => {
    let scenario = freshScenario();
    const ids = driveToFinalized(scenario);
    scenario.writer.cancel(ids.workItemId);
    scenario.connection.close();

    // Restart discovers finalized, digest-valid bytes — acceptance is still
    // forbidden by the durable order.
    scenario = reopenScenario(scenario);
    try {
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.cancellationAuthoritative).toBe(true);
      expect(classification.acceptanceAllowed).toBe(false);
      expect(classification.automaticDispatchSuppressed).toBe(true);
      expect(classification.bytesVerified).toBe(true);
      expect(classification.cleanupEligibleBytes).toBe(true);
      // Byte truth is classified, but no new accepted artifact exists.
      expect(classification.dbState).toBe('FINALIZED');

      try {
        scenario.writer.acceptArtifact({
          workItemId: ids.workItemId,
          artifactId: ids.artifactId,
          validation: VALIDATION_OK,
        });
        throw new Error('expected CANCELLATION_CUTOFF_BLOCKED');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('CANCELLATION_CUTOFF_BLOCKED');
      }

      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.selectionAcquisitionStatus).toBe('CANCELLED');
      expect(projection.stopReason).toBe('USER_CANCELLED');
      expect(projection.accepted).toBe(false);
      expect(projection.successClaimable).toBe(false);
    } finally {
      scenario.connection.close();
    }
  });

  it('R08: acceptance committed before cancellation survives; cancellation never revokes it', () => {
    let scenario = freshScenario();
    const ids = driveToFinalized(scenario);
    scenario.writer.acceptArtifact({
      workItemId: ids.workItemId,
      artifactId: ids.artifactId,
      validation: VALIDATION_OK,
    });
    scenario.writer.cancel(ids.workItemId);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.dbState).toBe('ACCEPTED');
      expect(classification.bytesVerified).toBe(true);
      expect(classification.successClaimable).toBe(true);
      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.selectionAcquisitionStatus).toBe('COMPLETE');
      expect(projection.accepted).toBe(true);

      // Bounded reconciliation may still establish materialization truth.
      const observation = scenario.store.observe(ids.artifactId);
      expect(observation.phase).toBe('FINALIZED');

      // R08 corollary: accepted identity with absent bytes still cannot
      // claim success from acceptance alone.
      const second = freshScenario();
      try {
        const ids2 = driveToFinalized(second);
        second.writer.acceptArtifact({
          workItemId: ids2.workItemId,
          artifactId: ids2.artifactId,
          validation: VALIDATION_OK,
        });
        second.writer.cancel(ids2.workItemId);
        rmSync(`${second.storeRoot}/final/${fileSafeName(ids2.artifactId)}.bin`);
        const classification2 = second.recovery.classify(ids2.workItemId);
        expect(classification2.dbState).toBe('ACCEPTED');
        expect(classification2.successClaimable).toBe(false);
      } finally {
        second.connection.close();
      }
    } finally {
      scenario.connection.close();
    }
  });

  it('unaccepted staged bytes after cancellation stay unaccepted and cleanup-eligible', () => {
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
    scenario.writer.cancel(ids.workItemId);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.dbState).toBe('STAGED');
      expect(classification.cancellationAuthoritative).toBe(true);
      expect(classification.cleanupEligibleBytes).toBe(true);
      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.selectionAcquisitionStatus).toBe('CANCELLED');
      expect(projection.accepted).toBe(false);
    } finally {
      scenario.connection.close();
    }
  });

  it('only explicit retry/resume reopens a cancellation-authoritative lineage, on the same lineage and budgets', () => {
    let scenario = freshScenario();
    const ids = driveToFinalized(scenario);
    scenario.writer.cancel(ids.workItemId);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      const remainingBefore = scenario.writer.reader.budgetRemaining(ids.workItemId);
      scenario.writer.explicitRetryResume(ids.workItemId, 'cmd:explicit-resume');

      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.cancellationAuthoritative).toBe(false);
      expect(classification.acceptanceAllowed).toBe(true);
      expect(classification.automaticDispatchSuppressed).toBe(false);

      // Budgets inherited unchanged — no reset, no replenishment.
      expect(scenario.writer.reader.budgetRemaining(ids.workItemId)).toEqual(remainingBefore);

      // Acceptance may now proceed under ordinary rules, on the SAME lineage.
      scenario.writer.acceptArtifact({
        workItemId: ids.workItemId,
        artifactId: ids.artifactId,
        validation: VALIDATION_OK,
      });
      expect(scenario.writer.reader.workItem(ids.workItemId)?.lifecycleState).toBe('ACCEPTED');
    } finally {
      scenario.connection.close();
    }
  });

  it('R11: cancel before dispatch records the stop, releases the reservation, and never accepts', () => {
    let scenario = freshScenario();
    const ids = submitFixture(scenario);
    scenario.writer.reserveBudget({
      workItemId: ids.workItemId,
      domain: 'transfer',
      limitKey: 'bytes',
      amount: 40_000,
      convergenceKey: 'plan:r11',
    });
    const afterReserve = scenario.writer.reader.budgetRemaining(ids.workItemId);
    expect(afterReserve.transfer.perLimit['bytes']).toBe(60_000);

    scenario.writer.cancel(ids.workItemId);
    scenario.connection.close();

    scenario = reopenScenario(scenario);
    try {
      // Reservation reconciled per durable dispatch facts: released, not
      // replenished — no dispatch intent ever existed.
      const remaining = scenario.writer.reader.budgetRemaining(ids.workItemId);
      expect(remaining.transfer.perLimit['bytes']).toBe(100_000);

      const classification = scenario.recovery.classify(ids.workItemId);
      expect(classification.lifecycleClass).toBe('NOT_DISPATCHED');
      expect(classification.cancellationAuthoritative).toBe(true);
      expect(classification.automaticDispatchSuppressed).toBe(true);

      const projection = scenario.recovery.project(ids.workItemId);
      expect(projection.selectionAcquisitionStatus).toBe('CANCELLED');
      expect(projection.stopReason).toBe('USER_CANCELLED');

      // No artifact was ever accepted from that cancelled execution.
      const acceptedFacts = scenario.connection.database.queryAll(
        "SELECT fact_seq FROM transition_facts WHERE fact_kind = 'ACCEPTED'",
      );
      expect(acceptedFacts).toHaveLength(0);

      // New dispatch is suppressed while cancellation is authoritative;
      // only an explicit retry/resume may reopen it.
      expect(() =>
        scenario.writer.dispatch({
          workItemId: ids.workItemId,
          attemptId: 'attempt:late',
          reservations: [
            {
              domain: 'transfer',
              limitKey: 'bytes',
              amount: 10_000,
              convergenceKey: 'plan:late',
            },
          ],
        }),
      ).toThrow(PersistenceError);
      try {
        scenario.writer.dispatch({ workItemId: ids.workItemId, attemptId: 'attempt:late' });
        throw new Error('expected CANCELLATION_CUTOFF_BLOCKED');
      } catch (error) {
        expect((error as PersistenceError).code).toBe('CANCELLATION_CUTOFF_BLOCKED');
      }
    } finally {
      scenario.connection.close();
    }
  });
});
