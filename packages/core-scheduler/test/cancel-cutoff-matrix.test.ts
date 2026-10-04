/**
 * TEST_MATRIX suite `cancel-timing-matrix` — the durable
 * cancellation-vs-acceptance cutoff (L2 invariant 20 / ADR-013) as a pure
 * ordering predicate and as a machine-level matrix over every interleaving,
 * including across process death/reopen. Oracle cells T006-O04, T006-O05,
 * T006-O06, T006-O08; bounded reconciliation on both sides of the cutoff.
 */
import { describe, expect, it } from 'vitest';
import { acceptanceCutoff, type CutoffDecision } from '../src/index.ts';
import {
  duplicateClient,
  expectOk,
  expectRejection,
  restart,
  setup,
  succeededLineage,
  type Harness,
} from './helpers.ts';

describe('cutoff pure predicate', () => {
  it('is a deterministic function of the two commit sequences (fail closed on malformed equality)', () => {
    const cells: readonly {
      cancel: number | undefined;
      accept: number | undefined;
      expected: CutoffDecision;
    }[] = [
      { cancel: undefined, accept: undefined, expected: 'ACCEPTANCE_OPEN' },
      { cancel: undefined, accept: 4, expected: 'ACCEPTANCE_OPEN' },
      { cancel: 3, accept: undefined, expected: 'ACCEPTANCE_BLOCKED' },
      { cancel: 3, accept: 4, expected: 'ACCEPTANCE_BLOCKED' },
      { cancel: 5, accept: 4, expected: 'ACCEPTANCE_STANDS' },
      { cancel: 3, accept: 3, expected: 'ACCEPTANCE_BLOCKED' },
    ];
    for (const cell of cells) {
      expect(acceptanceCutoff(cell.cancel, cell.accept)).toBe(cell.expected);
    }
  });
});

describe('cancel-timing-matrix (machine level)', () => {
  it('T006-O04: cancel committed before acceptance blocks automatic acceptance of materialized bytes', () => {
    const harness = setup();
    const key = succeededLineage(harness); // bytes staged and durably succeeded

    expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
    // The externally successful-but-unaccepted bytes can never be auto-accepted.
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');

    // Bounded reconciliation may establish truthful bytes and classify them —
    // without creating an accepted identity.
    const reconciliation = expectOk(
      harness.scheduler.reconcile(key, 'STAGED_BYTES_PRESENT', 'bytes present on disk'),
    );
    expect(reconciliation.stateAfter).toBe('CANCELLED_SUPPRESSED');
    expect(reconciliation.cutoff).toBe('ACCEPTANCE_BLOCKED');
    expect(harness.scheduler.lineageView(key)?.acceptedAt).toBeUndefined();
    // Still blocked after reconciliation: reconciliation never promotes.
    expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
    // No accepted identity appears in the durable log.
    expect(harness.log.readAll().some((fact) => fact.kind === 'acceptanceCommitted')).toBe(false);
  });

  it('T006-O05: acceptance committed before cancellation is not retroactively revoked', () => {
    const harness = setup();
    const key = succeededLineage(harness);

    const acceptance = expectOk(harness.scheduler.tryAccept(key));
    expect(acceptance.previouslyAccepted).toBe(false);
    const viewAfterAccept = harness.scheduler.lineageView(key);
    expect(viewAfterAccept?.state).toBe('ACCEPTED');

    const outcome = expectOk(harness.scheduler.cancel(key, 'CLI'));
    expect(outcome.resultingState).toBe('ACCEPTED');

    // The accepted identity stands with its original commit sequence.
    const view = harness.scheduler.lineageView(key);
    expect(view?.state).toBe('ACCEPTED');
    expect(view?.acceptedAt).toBe(acceptance.sequence);
    // Bounded materialization/finalization truth reconciliation remains available.
    const reconciliation = expectOk(
      harness.scheduler.reconcile(key, 'MATERIALIZATION_ESTABLISHED'),
    );
    expect(reconciliation.stateAfter).toBe('ACCEPTED');
    expect(reconciliation.cutoff).toBe('ACCEPTANCE_STANDS');
    // And there is no transition that revokes the accepted identity.
    const facts = harness.log.readAll();
    expect(facts.filter((fact) => fact.kind === 'acceptanceCommitted')).toHaveLength(1);
  });

  it('T006-O06: the cutoff outcome is deterministic for both commit orders, including across restart', () => {
    const cancelFirst = (): { state: string; accepted: boolean } => {
      const harness = setup();
      const key = succeededLineage(harness);
      expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
      expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };

    const acceptFirst = (): { state: string; accepted: boolean } => {
      const harness = setup();
      const key = succeededLineage(harness);
      expectOk(harness.scheduler.tryAccept(key));
      expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };

    const cancelFirstRestarted = (): { state: string; accepted: boolean } => {
      let harness: Harness = setup();
      const key = succeededLineage(harness);
      harness = restart(harness);
      expectOk(harness.scheduler.cancel(key, 'BROWSER_EXTENSION'));
      harness = restart(harness);
      expectRejection(harness.scheduler.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };

    const acceptFirstRestarted = (): { state: string; accepted: boolean } => {
      let harness: Harness = setup();
      const key = succeededLineage(harness);
      expectOk(harness.scheduler.tryAccept(key));
      harness = restart(harness);
      expectOk(harness.scheduler.cancel(key, 'CORE_POLICY'));
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };

    expect(cancelFirst()).toEqual({ state: 'CANCELLED_SUPPRESSED', accepted: false });
    expect(cancelFirstRestarted()).toEqual(cancelFirst());
    expect(acceptFirst()).toEqual({ state: 'ACCEPTED', accepted: true });
    expect(acceptFirstRestarted()).toEqual(acceptFirst());
  });

  it('T006-O08a: repeated cancels from duplicate clients commit one authority', () => {
    const harness = setup();
    const key = succeededLineage(harness);
    const first = expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
    const second = expectOk(harness.scheduler.cancel(key, 'CLI'));
    expect(second.alreadyAuthoritative).toBe(true);
    expect(second.sequence).toBe(first.sequence);
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'cancelAuthorityCommitted'),
    ).toHaveLength(1);
  });

  it('T006-O08b: repeated accepts from duplicate clients converge to one accepted identity', () => {
    const harness = setup();
    const key = succeededLineage(harness);
    const first = expectOk(harness.scheduler.tryAccept(key));
    const second = expectOk(harness.scheduler.tryAccept(key));
    expect(second.previouslyAccepted).toBe(true);
    expect(second.sequence).toBe(first.sequence);
    expect(
      harness.log.readAll().filter((fact) => fact.kind === 'acceptanceCommitted'),
    ).toHaveLength(1);
  });

  it('T006-O08c: cancel/accept interleavings across duplicate clients resolve like one serial ordering', () => {
    // Two independent clients race: one cancels while the other accepts.
    // Whatever the interleaving, the outcome equals the serial order result.
    const run = (
      interleaving: 'cancel-wins' | 'accept-wins',
    ): { state: string; accepted: boolean } => {
      const harness: Harness = setup();
      const key = succeededLineage(harness);
      const clientB = duplicateClient(harness);
      if (interleaving === 'cancel-wins') {
        expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
        expectRejection(clientB.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
      } else {
        expectOk(clientB.tryAccept(key));
        expectOk(harness.scheduler.cancel(key, 'DESKTOP_UI'));
      }
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };
    expect(run('cancel-wins')).toEqual({ state: 'CANCELLED_SUPPRESSED', accepted: false });
    expect(run('accept-wins')).toEqual({ state: 'ACCEPTED', accepted: true });
  });
});
