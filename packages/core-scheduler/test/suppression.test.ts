/**
 * TEST_MATRIX suite `dispatch-suppression-after-cancellation` — once durable
 * cancellation is authoritative for a still-unaccepted lineage, no new
 * discovery/transfer/retry dispatch is emitted; bounded reconciliation stays
 * permitted; suppression persists across process death/reopen and is only
 * lifted by the explicit authorized retry/resume transition. Oracle cell
 * T006-O14 (plus the dispatch legs of O04/O09).
 */
import { describe, expect, it } from 'vitest';
import { PROFILE, expectOk, expectRejection, restart, setup, submitDefault } from './helpers.ts';

describe('dispatch-suppression-after-cancellation', () => {
  it('no new discovery/transfer/retry dispatch after durable cancellation for a still-unaccepted lineage', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));

    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'GENERATED_REQUEST', count: 1 }),
      'DISPATCH_SUPPRESSED',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 10 }),
      'DISPATCH_SUPPRESSED',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'RETRY_TRANSFER_REQUEST', count: 1 }),
      'DISPATCH_SUPPRESSED',
    );
    expectRejection(harness.scheduler.startEffectAttempt(key, 'attempt-1'), 'DISPATCH_SUPPRESSED');

    // Suppression is derived from durable facts: no dispatch fact exists.
    expect(
      harness.log
        .readAll()
        .some((fact) => fact.kind === 'budgetReserved' || fact.kind === 'effectAttemptStarted'),
    ).toBe(false);
  });

  it('bounded reconciliation needed for truthful facts remains permitted during suppression', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'CLI'));

    for (const observation of [
      'STAGED_BYTES_PRESENT',
      'NO_STAGED_BYTES',
      'MATERIALIZATION_ESTABLISHED',
      'MATERIALIZATION_NOT_ESTABLISHED',
    ] as const) {
      const outcome = expectOk(harness.scheduler.reconcile(key, observation));
      expect(outcome.stateAfter).toBe('CANCELLED_SUPPRESSED');
      expect(outcome.cutoff).toBe('ACCEPTANCE_BLOCKED');
    }
    expect(harness.scheduler.lineageView(key)?.reconciliationCount).toBe(4);
  });

  it('T006-O14: a suppressed lineage does not resurrect by restart; no automatic acceptance appears', () => {
    let harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'BROWSER_EXTENSION'));

    harness = restart(harness);
    // Cancellation authority survived reopen: dispatch stays suppressed.
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 10 }),
      'DISPATCH_SUPPRESSED',
    );
    // ...and no automatic acceptance appears after restart.
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
    // A fresh reconcile/restart cycle does not lift suppression either.
    harness = restart(harness);
    expect(harness.scheduler.lineageView(key)?.state).toBe('CANCELLED_SUPPRESSED');
    expect(harness.log.readAll().some((fact) => fact.kind === 'resumeAuthorized')).toBe(false);
  });

  it('only the explicit authorized retry/resume transition lifts suppression (with remaining budgets)', () => {
    let harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 250 }),
    );
    expectOk(harness.scheduler.consume(grant));
    const remainingBeforeCancel = expectOk(harness.scheduler.remainingBudgets(key));

    expectOk(harness.scheduler.cancel(key, 'CORE_POLICY'));
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 10 }),
      'DISPATCH_SUPPRESSED',
    );

    harness = restart(harness);
    const resumed = expectOk(
      harness.scheduler.resumeLineage(key, { authorizedBy: 'operator-001', reason: 'RESUME' }),
    );
    // Budgets are inherited untouched — never reset or replenished.
    expect(resumed.inheritedRemaining).toEqual(remainingBeforeCancel);
    expect(harness.scheduler.lineageView(key)?.state).toBe('ACTIVE');

    // Dispatch works again under the inherited budget truth.
    const after = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 250 }),
    );
    expectOk(harness.scheduler.consume(after));
    const remaining = expectOk(harness.scheduler.remainingBudgets(key));
    expect(remaining.transfer.perLimit['bytes']).toBe(PROFILE.transfer.maxBytes - 500);
  });

  it('a re-cancel after resume suppresses again (latest authority wins)', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'CLI'));
    expectOk(
      harness.scheduler.resumeLineage(key, { authorizedBy: 'operator-001', reason: 'RETRY' }),
    );
    expect(harness.scheduler.lineageView(key)?.state).toBe('ACTIVE');

    const second = expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
    expect(second.alreadyAuthoritative).toBe(false);
    expect(harness.scheduler.lineageView(key)?.state).toBe('CANCELLED_SUPPRESSED');
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'GENERATED_REQUEST', count: 1 }),
      'DISPATCH_SUPPRESSED',
    );
  });
});
