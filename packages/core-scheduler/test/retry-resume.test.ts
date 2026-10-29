/**
 * TEST_MATRIX suites `retry-resume-frozen-lineage` — explicit authorized
 * retry/resume on the same frozen Contract/SelectionSnapshot/target/effect
 * lineage (CJ-06): original targets only, remaining budgets inherited, no
 * duplicate acceptance, staged-byte reuse gated by validation evidence, and
 * reconciliation alone never reopens processing. Oracle cells T006-O09,
 * T006-O10.
 */
import { describe, expect, it } from 'vitest';
import { expectOk, expectRejection, restart, setup, submitDefault } from './helpers.ts';

describe('retry-resume-frozen-lineage', () => {
  it('T006-O09: only the explicit authorized retry/resume reopens processing on the same frozen lineage', () => {
    let harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');

    // Reconciliation alone (even discovering valid staged bytes) never reopens.
    harness = restart(harness);
    expectOk(harness.scheduler.reconcile(key, 'STAGED_BYTES_PRESENT', 'valid staged bytes'));
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
    expectRejection(harness.scheduler.startEffectAttempt(key, 'attempt-2'), 'DISPATCH_SUPPRESSED');

    // The explicit authorized transition reopens the SAME frozen lineage.
    const resumed = expectOk(
      harness.scheduler.resumeLineage(key, { authorizedBy: 'operator-001', reason: 'RETRY' }),
    );
    expect(harness.scheduler.lineageView(key)?.state).toBe('ACTIVE');

    // Ordinary rules apply again under the same effect identity.
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-2'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-2', outcome: 'SUCCEEDED' }),
    );
    const acceptance = expectOk(harness.scheduler.tryAccept(key));
    // No duplicate accepted effect was created by resuming.
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'acceptanceCommitted'),
    ).toHaveLength(1);
    expect(acceptance.effectId).toBe(resumed.lineageKey.split('|')[3]);
  });

  it('negative: resume without an explicit authorized control transition is rejected', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'CLI'));
    expectRejection(
      harness.scheduler.resumeLineage(key, { authorizedBy: '', reason: 'RESUME' }),
      'UNAUTHORIZED_TRANSITION_REJECTED',
    );
    expectRejection(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: '  ',
        reason: 'RESUME',
      }),
      'UNAUTHORIZED_TRANSITION_REJECTED',
    );
    // The lineage stays suppressed.
    expect(harness.scheduler.lineageView(key)?.state).toBe('CANCELLED_SUPPRESSED');
  });

  it('negative: resume of an already-active or already-accepted lineage is rejected (no duplicate acceptance)', () => {
    const harness = setup();
    const activeKey = submitDefault(harness);
    expectRejection(
      harness.scheduler.resumeLineage(activeKey, {
        authorizedBy: 'operator-001',
        reason: 'RESUME',
      }),
      'UNAUTHORIZED_TRANSITION_REJECTED',
    );

    const acceptedKey = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(acceptedKey, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(acceptedKey, {
        attemptId: 'attempt-1',
        outcome: 'SUCCEEDED',
      }),
    );
    expectOk(harness.scheduler.tryAccept(acceptedKey));
    expectRejection(
      harness.scheduler.resumeLineage(acceptedKey, {
        authorizedBy: 'operator-001',
        reason: 'RETRY',
      }),
      'UNAUTHORIZED_TRANSITION_REJECTED',
    );
  });

  it('T006-O10: retry attempting a new member or target is rejected — original frozen identities only (CJ-06/C12)', () => {
    const harness = setup();
    const key = submitDefault(harness); // frozen members: member-001, member-002
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));

    expectRejection(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RETRY',
        memberScope: ['member-001', 'member-003'],
      }),
      'SNAPSHOT_DRIFT_REJECTED',
    );
    expectRejection(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RETRY',
        memberScope: ['member-replacement-001'],
      }),
      'SNAPSHOT_DRIFT_REJECTED',
    );
    expectRejection(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RETRY',
        memberScope: ['not a member id!'],
      }),
      'MALFORMED_CONTROL_FACT',
    );

    // A subset of the frozen identities is the retry domain.
    expectOk(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RETRY',
        memberScope: ['member-002'],
      }),
    );
  });

  it('retry cannot bind a different Contract/Snapshot identity: the key is structural', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.cancel(key, 'CLI'));
    // A different contract produces a different lineage key: no resume exists
    // for it (UNKNOWN_LINEAGE), so drift to another contract is unrepresentable.
    expectRejection(
      harness.scheduler.resumeLineage(
        `${key.replace('contract-collection-001', 'contract-other-001')}`,
        { authorizedBy: 'operator-001', reason: 'RETRY' },
      ),
      'UNKNOWN_LINEAGE',
    );
  });

  it('staged bytes are reusable only after ordinary validation evidence succeeds', () => {
    let harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));

    // Reuse without validation evidence is rejected.
    expectRejection(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RESUME',
        reuseStagedBytes: {
          stagedByteRef: 'bytes/staged-001',
          validationEvidenceId: 'invalid evidence id!',
        },
      }),
      'STAGED_REUSE_VALIDATION_REQUIRED',
    );

    harness = restart(harness);
    const resumed = expectOk(
      harness.scheduler.resumeLineage(key, {
        authorizedBy: 'operator-001',
        reason: 'RESUME',
        reuseStagedBytes: {
          stagedByteRef: 'bytes/staged-001',
          validationEvidenceId: 'evidence-validation-001',
        },
      }),
    );
    expect(resumed.reusedStagedBytes).toBe(true);

    // Resume without any reuse request simply re-executes: nothing reused.
    const otherKey = submitDefault(harness);
    expectOk(harness.scheduler.cancel(otherKey, 'CLI'));
    const plain = expectOk(
      harness.scheduler.resumeLineage(otherKey, { authorizedBy: 'operator-001', reason: 'RETRY' }),
    );
    expect(plain.reusedStagedBytes).toBe(false);
  });

  it('retry/resume inherits remaining budgets and never resets or replenishes them', () => {
    let harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 600 }),
    );
    expectOk(harness.scheduler.consume(grant));
    const before = expectOk(harness.scheduler.remainingBudgets(key));

    expectOk(harness.scheduler.cancel(key, 'CORE_POLICY'));
    harness = restart(harness);
    expectOk(
      harness.scheduler.resumeLineage(key, { authorizedBy: 'operator-001', reason: 'RETRY' }),
    );
    const after = expectOk(harness.scheduler.remainingBudgets(key));
    expect(after).toEqual(before);
    expect(after.transfer.perLimit['bytes']).toBe(400);

    // A candidate inflated profile at resume time is replenishment: rejected.
    const inflatedProfile = {
      discovery: { domain: 'discovery', maxGeneratedRequests: 99 },
      transfer: { domain: 'transfer', maxBytes: 99 },
      globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 99 },
    };
    expectRejection(
      harness.scheduler.assertCompatibleBudgetProfile(key, inflatedProfile),
      'BUDGET_REPLENISHMENT_REJECTED',
    );
    // ...and the ledger still only allows the inherited 400 bytes.
    const over = expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 401 }),
      'BUDGET_EXHAUSTED',
      'TRANSFER_BUDGET_EXHAUSTED',
    );
    expect(over.code).toBe('BUDGET_EXHAUSTED');
  });
});
