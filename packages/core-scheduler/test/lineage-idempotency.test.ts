/**
 * TEST_MATRIX suites `effect-lineage-idempotency` and `crash-adjacent-durable-facts`
 * — durable identities that survive process death/reopen, at-least-once
 * effects converging through idempotent acceptance (ADR-010, L2 invariant 8),
 * and truthful state that restart/retry/reconciliation can never rewrite into
 * success (L2 D9, PRD §30). Oracle cell T006-O15.
 */
import { describe, expect, it } from 'vitest';
import type { DurableControlFact } from '../src/index.ts';
import {
  PROFILE,
  expectOk,
  expectRejection,
  restart,
  setup,
  submitDefault,
  type Harness,
} from './helpers.ts';

describe('effect-lineage-idempotency', () => {
  it('commands/work/effects/attempts carry durable identities that survive process death/reopen', () => {
    let harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));

    harness = restart(harness);
    const view = harness.scheduler.lineageView(key);
    expect(view?.attemptIds).toEqual(['attempt-1']);
    // Replaying the same attempt id reconciles by identity: no new fact.
    const replay = expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expect(replay.replayed).toBe(true);
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'effectAttemptStarted'),
    ).toHaveLength(1);
  });

  it('T006-O15: crash between effect execution and acceptance — replay reconciles, no duplicate accepted effect', () => {
    let harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    // Process dies after the external effect ran but before outcome/acceptance.

    harness = restart(harness);
    // The at-least-once effect completes on replay; the outcome reconciles
    // against the durable attempt identity.
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    // A second replay of the same outcome is idempotent.
    const again = expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expect(again.reconciled).toBe(true);

    // A duplicate execution (second attempt, at-least-once — no exactly-once
    // claim) still converges through idempotent acceptance.
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-2'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-2', outcome: 'SUCCEEDED' }),
    );
    expectOk(harness.scheduler.tryAccept(key));
    const duplicate = expectOk(harness.scheduler.tryAccept(key));
    expect(duplicate.previouslyAccepted).toBe(true);
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'acceptanceCommitted'),
    ).toHaveLength(1);
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'effectAttemptStarted'),
    ).toHaveLength(2);
  });

  it('negative: replayed attempts cannot fork a second lineage or effect', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    // A duplicate submit after work started still converges to the lineage.
    const duplicate = expectOk(
      harness.scheduler.submitLineage({
        contractId: 'contract-collection-001',
        snapshotId: 'snapshot-001',
        targetId: 'target-file-001',
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: PROFILE,
      }),
    );
    expect(duplicate.converged).toBe(true);
    expect(duplicate.lineageKey).toBe(key);
  });

  it('negative: a recorded outcome is durable truth and cannot be rewritten', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expectRejection(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'FAILED' }),
      'RESULT_FALSIFICATION_REJECTED',
    );
    expectRejection(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'UNCERTAIN' }),
      'RESULT_FALSIFICATION_REJECTED',
    );
    const view = harness.scheduler.lineageView(key);
    expect(view?.outcomes.get('attempt-1')?.outcome).toBe('SUCCEEDED');
  });

  it('negative: outcomes reference durably started attempts only', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectRejection(
      harness.scheduler.recordEffectOutcome(key, {
        attemptId: 'ghost-attempt',
        outcome: 'SUCCEEDED',
      }),
      'MALFORMED_CONTROL_FACT',
    );
  });
});

describe('crash-adjacent-durable-facts', () => {
  it('committed cancellation, acceptance and consumption survive death/reopen and keep deciding the cutoff', () => {
    let harness: Harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 100 }),
    );
    expectOk(harness.scheduler.consume(grant));
    // An in-flight attempt is running when cancellation commits.
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));

    harness = restart(harness);
    // Consumption truth survived.
    const remaining = expectOk(harness.scheduler.remainingBudgets(key));
    expect(remaining.transfer.perLimit['bytes']).toBe(900);
    // Suppression survived reopen: no new attempts appear.
    expectRejection(harness.scheduler.startEffectAttempt(key, 'attempt-2'), 'DISPATCH_SUPPRESSED');
    // The in-flight attempt's truthful outcome can still be established...
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    // ...but the durable cancellation authority survived and keeps deciding
    // the cutoff: no automatic acceptance appears.
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
    expect(harness.log.readAll().some((fact) => fact.kind === 'acceptanceCommitted')).toBe(false);

    const facts: readonly DurableControlFact[] = harness.log.readAll();
    expect(facts.length).toBeGreaterThan(4);
  });

  it('uncertain and failed work is never rewritten into success by restart, retry or reconciliation', () => {
    const uncertain: Harness = setup();
    const uncertainKey = submitDefault(uncertain);
    expectOk(uncertain.scheduler.startEffectAttempt(uncertainKey, 'attempt-1'));
    expectOk(
      uncertain.scheduler.recordEffectOutcome(uncertainKey, {
        attemptId: 'attempt-1',
        outcome: 'UNCERTAIN',
        failureCategory: 'UNKNOWN_AFTER_CRASH',
      }),
    );
    // Restart + reconciliation observe the uncertainty truthfully...
    const afterUncertain = restart(uncertain);
    expectOk(afterUncertain.scheduler.reconcile(uncertainKey, 'NO_STAGED_BYTES'));
    // ...but acceptance still cannot claim success from uncertainty.
    expectRejection(
      afterUncertain.scheduler.tryAccept(uncertainKey),
      'RESULT_FALSIFICATION_REJECTED',
    );

    const failed: Harness = setup();
    const failedKey = submitDefault(failed);
    expectOk(failed.scheduler.startEffectAttempt(failedKey, 'attempt-1'));
    expectOk(
      failed.scheduler.recordEffectOutcome(failedKey, {
        attemptId: 'attempt-1',
        outcome: 'FAILED',
        failureCategory: 'VALIDATION_FAILED',
      }),
    );
    expectRejection(failed.scheduler.tryAccept(failedKey), 'RESULT_FALSIFICATION_REJECTED');
    // The failure category survives restart unchanged — no silent conversion.
    const afterFailed = restart(failed);
    const view = afterFailed.scheduler.lineageView(failedKey);
    expect(view?.outcomes.get('attempt-1')?.outcome).toBe('FAILED');
    expectRejection(afterFailed.scheduler.tryAccept(failedKey), 'RESULT_FALSIFICATION_REJECTED');
  });

  it('failure categories are preserved as durable facts (PRD §30 vocabulary intact)', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, {
        attemptId: 'attempt-1',
        outcome: 'FAILED',
        failureCategory: 'AUTH_FAILED',
      }),
    );
    const recorded = harness.log
      .readAll()
      .find(
        (fact): fact is Extract<DurableControlFact, { kind: 'effectOutcomeRecorded' }> =>
          fact.kind === 'effectOutcomeRecorded',
      );
    expect(recorded?.failureCategory).toBe('AUTH_FAILED');
    expect(recorded?.outcome).toBe('FAILED');
  });
});
