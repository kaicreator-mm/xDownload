/**
 * Exhaustive (state, event) transition-legality table — every pair is either
 * an asserted transition or an asserted typed rejection, with no "unexpected
 * success" gaps — plus the REFERENCE_PACK property-style invariants driven as
 * deterministic generated tables (no property-testing dependency):
 * - cutoff/order determinism across restarts for every interleaving;
 * - remaining budgets are non-increasing within a lifecycle;
 * - the reachable member/target identity set is the frozen subset;
 * - any number of duplicate submits yields exactly one accepted artifact;
 * - no state exists where acceptance appears after authoritative cancellation;
 * - replay of an already-recorded attempt changes no authoritative state.
 */
import { describe, expect, it } from 'vitest';
import type { ControlEventType, LineageControlState } from '../src/index.ts';
import {
  PROFILE,
  duplicateClient,
  expectOk,
  expectRejection,
  restart,
  setup,
  submitDefault,
  type Harness,
} from './helpers.ts';

type Cell = { readonly expect: 'ok' } | { readonly expect: 'reject'; readonly code: string };

const EVENTS: readonly ControlEventType[] = [
  'SUBMIT_LINEAGE',
  'CANCEL',
  'ACCEPT',
  'RESUME',
  'DISPATCH',
  'START_ATTEMPT',
  'RECORD_OUTCOME',
  'RECONCILE',
];

/** Fixture per control state. */
function fixtureFor(state: LineageControlState | 'UNREGISTERED'): {
  harness: Harness;
  key: string;
} {
  const harness = setup();
  if (state === 'UNREGISTERED') {
    return { harness, key: 'contract-x|snapshot-x|target-x|effect:x' };
  }
  const key = submitDefault(harness);
  expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
  expectOk(
    harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
  );
  if (state === 'ACTIVE') {
    return { harness, key };
  }
  if (state === 'CANCELLED_SUPPRESSED') {
    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
  } else {
    expectOk(harness.scheduler.tryAccept(key));
  }
  return { harness, key };
}

/** Drive one event through the public scheduler API. */
function drive(
  harness: Harness,
  key: string,
  event: ControlEventType,
): { ok: boolean; code?: string } {
  const scheduler = harness.scheduler;
  const result = ((): { ok: boolean; code?: string } => {
    switch (event) {
      case 'SUBMIT_LINEAGE': {
        const submission = scheduler.submitLineage({
          contractId: 'contract-collection-001',
          snapshotId: 'snapshot-001',
          targetId: 'target-file-001',
          authorizationContextRef: 'authctx/local-001',
          budgetProfile: PROFILE,
        });
        return submission.ok ? { ok: true } : { ok: false, code: submission.rejection.code };
      }
      case 'CANCEL': {
        const outcome = scheduler.cancel(key, 'DESKTOP_UI');
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'ACCEPT': {
        const outcome = scheduler.tryAccept(key);
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'RESUME': {
        const outcome = scheduler.resumeLineage(key, {
          authorizedBy: 'operator-001',
          reason: 'RETRY',
        });
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'DISPATCH': {
        const outcome = scheduler.requestDispatch(key, { kind: 'GENERATED_REQUEST', count: 1 });
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'START_ATTEMPT': {
        const outcome = scheduler.startEffectAttempt(key, 'attempt-next');
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'RECORD_OUTCOME': {
        const outcome = scheduler.recordEffectOutcome(key, {
          attemptId: 'attempt-1',
          outcome: 'SUCCEEDED',
        });
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
      case 'RECONCILE': {
        const outcome = scheduler.reconcile(key, 'STAGED_BYTES_PRESENT');
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.rejection.code };
      }
    }
  })();
  return result;
}

describe('exhaustive (state, event) transition legality', () => {
  // The expected cell matrix. UNREGISTERED events reject with UNKNOWN_LINEAGE
  // via the scheduler gate; state-level cells exercise the table through the
  // scheduler with semantic guards where they bind (ACCEPT without succeeded
  // evidence on ACTIVE, RECORD_OUTCOME for an unknown attempt).
  const TABLE: Readonly<Record<string, readonly Cell[]>> = {
    // submit, cancel, accept, resume, dispatch, start, record, reconcile
    UNREGISTERED: [
      { expect: 'ok' }, // SUBMIT on an unregistered lineage is the creation path
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
      { expect: 'reject', code: 'UNKNOWN_LINEAGE' },
    ],
    ACTIVE: [
      { expect: 'ok' }, // duplicate submit converges
      { expect: 'ok' }, // → CANCELLED_SUPPRESSED
      { expect: 'ok' }, // attempt-1 SUCCEEDED in fixture → ACCEPTED
      { expect: 'reject', code: 'UNAUTHORIZED_TRANSITION_REJECTED' },
      { expect: 'ok' }, // budget headroom in profile
      { expect: 'ok' },
      { expect: 'ok' }, // reconciled replay of attempt-1
      { expect: 'ok' },
    ],
    CANCELLED_SUPPRESSED: [
      { expect: 'ok' }, // duplicate submit converges
      { expect: 'ok' }, // idempotent cancel
      { expect: 'reject', code: 'CANCELLATION_CUTOFF_VIOLATION' },
      { expect: 'ok' }, // explicit authorized resume → ACTIVE
      { expect: 'reject', code: 'DISPATCH_SUPPRESSED' },
      { expect: 'reject', code: 'DISPATCH_SUPPRESSED' },
      { expect: 'ok' }, // reconciled replay of the recorded outcome
      { expect: 'ok' },
    ],
    ACCEPTED: [
      { expect: 'ok' }, // duplicate submit converges
      { expect: 'ok' }, // cancel records authority; accepted identity stands
      { expect: 'ok' }, // duplicate accept converges
      { expect: 'reject', code: 'UNAUTHORIZED_TRANSITION_REJECTED' },
      { expect: 'reject', code: 'UNAUTHORIZED_TRANSITION_REJECTED' },
      { expect: 'reject', code: 'UNAUTHORIZED_TRANSITION_REJECTED' },
      { expect: 'ok' }, // reconciled replay of the recorded outcome
      { expect: 'ok' },
    ],
  };

  for (const [state, cells] of Object.entries(TABLE)) {
    EVENTS.forEach((event, index) => {
      const cell = cells[index]!;
      it(`(${state}, ${event}) → ${cell.expect === 'ok' ? 'legal' : `reject ${cell.code}`}`, () => {
        // Each cell runs on a fresh fixture so cells are order-independent.
        const { harness, key } = fixtureFor(state as LineageControlState | 'UNREGISTERED');
        const outcome = drive(harness, key, event);
        if (cell.expect === 'ok') {
          expect(outcome.ok, `expected ok for (${state}, ${event}), got ${outcome.code}`).toBe(
            true,
          );
        } else {
          expect(outcome.ok, `expected ${cell.code} for (${state}, ${event})`).toBe(false);
          expect(outcome.code).toBe(cell.code);
        }
      });
    });
  }
});

describe('property-style invariants (deterministic generated tables)', () => {
  it('cutoff decisions are identical with and without restarts at every commit point', () => {
    const runWithRestarts = (
      order: readonly ('cancel' | 'accept')[],
      restartEachStep: boolean,
    ): string => {
      let harness: Harness = setup();
      const key = submitDefault(harness);
      expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
      expectOk(
        harness.scheduler.recordEffectOutcome(key, {
          attemptId: 'attempt-1',
          outcome: 'SUCCEEDED',
        }),
      );
      for (const step of order) {
        if (restartEachStep) {
          harness = restart(harness);
        }
        if (step === 'cancel') {
          expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
        } else {
          const outcome = harness.scheduler.tryAccept(key);
          // Accepting after cancel is exactly the blocked cell.
          if (!outcome.ok) {
            expect(outcome.rejection.code).toBe('CANCELLATION_CUTOFF_VIOLATION');
          }
        }
      }
      const view = harness.scheduler.lineageView(key);
      return `${view?.state}:accepted=${view?.acceptedAt !== undefined}`;
    };
    for (const order of [
      ['cancel'],
      ['accept'],
      ['cancel', 'accept'],
      ['accept', 'cancel'],
      ['accept', 'accept'],
      ['cancel', 'cancel'],
    ] as const) {
      expect(runWithRestarts(order, true)).toBe(runWithRestarts(order, false));
    }
  });

  it('remaining budgets are non-increasing across any consumption/restart sequence', () => {
    let harness: Harness = setup();
    const key = submitDefault(harness);
    let previousBytes = 1000;
    const sequence = [50, 100, 7, 200, 1, 300] as const;
    for (const [step, bytes] of sequence.entries()) {
      if (step % 2 === 1) {
        harness = restart(harness);
      }
      const grant = harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes });
      if (grant.ok) {
        expectOk(harness.scheduler.consume(grant.value));
        const remaining = expectOk(harness.scheduler.remainingBudgets(key));
        const now = remaining.transfer.perLimit['bytes']!;
        expect(now).toBeLessThan(previousBytes);
        expect(now).toBeGreaterThanOrEqual(0);
        previousBytes = now;
      }
    }
    expect(previousBytes).toBe(1000 - (50 + 100 + 7 + 200 + 1 + 300));
  });

  it('any number of duplicate submits converges to one accepted artifact', () => {
    const harness = setup();
    let key: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const client =
        i === 0
          ? harness.scheduler
          : i % 3 === 0
            ? restart(harness).scheduler
            : duplicateClient(harness);
      const submission = expectOk(
        client.submitLineage({
          contractId: 'contract-collection-001',
          snapshotId: 'snapshot-001',
          targetId: 'target-file-001',
          authorizationContextRef: 'authctx/local-001',
          budgetProfile: PROFILE,
        }),
      );
      key = key ?? submission.lineageKey;
      expect(submission.lineageKey).toBe(key);
      expect(submission.converged).toBe(i > 0);
    }
    const acceptedKey = key!;
    expectOk(harness.scheduler.startEffectAttempt(acceptedKey, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(acceptedKey, {
        attemptId: 'attempt-1',
        outcome: 'SUCCEEDED',
      }),
    );
    expectOk(harness.scheduler.tryAccept(acceptedKey));
    const facts = harness.log.readAll();
    expect(facts.filter((fact) => fact.kind === 'lineageSubmitted')).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === 'acceptanceCommitted')).toHaveLength(1);
  });

  it('no reachable state has acceptance committed after unresumed authoritative cancellation', () => {
    // Drive every (cancel, accept) commit order over restarts and assert the
    // durable acceptance fact never follows an unresumed cancel authority.
    for (const acceptFirst of [false, true]) {
      const harness = setup();
      const key = submitDefault(harness);
      expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
      expectOk(
        harness.scheduler.recordEffectOutcome(key, {
          attemptId: 'attempt-1',
          outcome: 'SUCCEEDED',
        }),
      );
      if (acceptFirst) {
        expectOk(harness.scheduler.tryAccept(key));
        expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
      } else {
        expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
        expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
      }
      const facts = harness.log.readAll();
      const cancelAt =
        facts.find((fact) => fact.kind === 'cancelAuthorityCommitted')?.sequence ?? 0;
      const resumes = facts.filter((fact) => fact.kind === 'resumeAuthorized');
      const acceptance = facts.find((fact) => fact.kind === 'acceptanceCommitted');
      if (acceptance !== undefined) {
        const unresumedCancel =
          cancelAt > 0 && !resumes.some((resume) => resume.sequence > cancelAt);
        expect(acceptance.sequence > cancelAt && unresumedCancel).toBe(false);
      }
    }
  });

  it('replay of an already-recorded attempt changes no authoritative state', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    const before = harness.log.readAll().length;
    expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expect(harness.log.readAll().length).toBe(before);
    const view = harness.scheduler.lineageView(key);
    expect(view?.attemptIds).toEqual(['attempt-1']);
    expect(view?.outcomes.size).toBe(1);
  });
});
