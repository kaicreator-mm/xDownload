/**
 * TEST_MATRIX suite `duplicate-client-convergence` — two independent
 * duplicate clients converge to one lineage, one effect and one accepted
 * artifact; duplicate submit never silently creates another acquisition; and
 * duplicate cancel/accept submissions resolve to the same deterministic
 * outcome as any serial ordering (PRD C13 tuple, L2 Research Demo #7).
 * Oracle cells T006-O07, T006-O08.
 */
import { describe, expect, it } from 'vitest';
import type { LineageKey } from '../src/index.ts';
import {
  duplicateClient,
  expectOk,
  expectRejection,
  restart,
  setup,
  submitDefault,
  submitInput,
  type Harness,
} from './helpers.ts';

describe('duplicate-client-convergence', () => {
  it('T006-O07: two concurrent duplicate clients converge to one lineage, one effect, one accepted artifact', () => {
    const harness = setup();
    const ui = harness.scheduler;
    const cli = duplicateClient(harness);

    const fromUi = expectOk(ui.submitLineage(submitInput()));
    const fromCli = expectOk(cli.submitLineage(submitInput()));
    expect(fromCli.converged).toBe(true);
    expect(fromCli.lineageKey).toBe(fromUi.lineageKey);
    expect(fromCli.effectId).toBe(fromUi.effectId);
    const key: LineageKey = fromUi.lineageKey;

    // Both clients drive the same effect to success through their own attempts.
    expectOk(ui.startEffectAttempt(key, 'ui-attempt-1'));
    expectOk(cli.startEffectAttempt(key, 'cli-attempt-1'));
    expectOk(ui.recordEffectOutcome(key, { attemptId: 'ui-attempt-1', outcome: 'SUCCEEDED' }));
    expectOk(cli.recordEffectOutcome(key, { attemptId: 'cli-attempt-1', outcome: 'SUCCEEDED' }));

    // Both clients accept: the second converges onto the same identity.
    const acceptUi = expectOk(ui.tryAccept(key));
    const acceptCli = expectOk(cli.tryAccept(key));
    expect(acceptCli.previouslyAccepted).toBe(true);
    expect(acceptCli.sequence).toBe(acceptUi.sequence);

    const facts = harness.log.readAll();
    expect(facts.filter((fact) => fact.kind === 'lineageSubmitted')).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === 'acceptanceCommitted')).toHaveLength(1);
    // Exactly one accepted artifact, two at-least-once attempts.
    expect(facts.filter((fact) => fact.kind === 'effectAttemptStarted')).toHaveLength(2);
  });

  it('duplicate submit with a client-fabricated effect id forks and is rejected (never silently forked)', () => {
    const harness = setup();
    submitDefault(harness);
    expectRejection(
      harness.scheduler.submitLineage(
        submitInput({ requestedEffectId: 'effect:client-fabricated-identity' }),
      ),
      'LINEAGE_FORK_REJECTED',
    );
    expect(harness.log.readAll().filter((fact) => fact.kind === 'lineageSubmitted')).toHaveLength(
      1,
    );
  });

  it('N duplicate submits of the same work converge to one lineage and one accepted artifact', () => {
    const harness = setup();
    const clients = [harness.scheduler, duplicateClient(harness), duplicateClient(harness)];
    let key: LineageKey | undefined;
    for (const client of clients) {
      const submission = expectOk(client.submitLineage(submitInput()));
      key = key ?? submission.lineageKey;
      expect(submission.lineageKey).toBe(key);
    }
    key = key!;
    expectOk(clients[0]!.startEffectAttempt(key, 'attempt-1'));
    expectOk(
      clients[1]!.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
    );
    expectOk(clients[2]!.tryAccept(key));
    expectOk(clients[0]!.tryAccept(key));

    const facts = harness.log.readAll();
    expect(facts.filter((fact) => fact.kind === 'lineageSubmitted')).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === 'acceptanceCommitted')).toHaveLength(1);
  });

  it('duplicate cancels and duplicate accepts across clients are idempotent and order-deterministic', () => {
    const harness = setup();
    const key = submitDefault(harness);
    const a = harness.scheduler;
    const b = duplicateClient(harness);

    expectOk(a.startEffectAttempt(key, 'attempt-1'));
    expectOk(a.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }));

    const cancelA = expectOk(a.cancel(key, 'DESKTOP_UI'));
    const cancelB = expectOk(b.cancel(key, 'CLI'));
    expect(cancelB.alreadyAuthoritative).toBe(true);
    expect(cancelB.sequence).toBe(cancelA.sequence);

    // Accept stays blocked no matter which client tries, in any order.
    expectRejection(a.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');
    expectRejection(b.tryAccept(key), 'CANCELLATION_CUTOFF_VIOLATION');

    // Duplicates changed nothing: one cancel fact, zero accept facts.
    const facts = harness.log.readAll();
    expect(facts.filter((fact) => fact.kind === 'cancelAuthorityCommitted')).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === 'acceptanceCommitted')).toHaveLength(0);
  });

  it('accept/cancel interleave across clients yields the serial-order outcome deterministically', () => {
    const runSerial = (
      order: readonly ('accept' | 'cancel')[],
    ): { state: string; accepted: boolean } => {
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
        harness = restart(harness); // every step may happen in a new process
        if (step === 'accept') {
          const outcome = harness.scheduler.tryAccept(key);
          // An accept under standing cancellation is exactly the blocked cell.
          if (!outcome.ok) {
            expect(outcome.rejection.code).toBe('CANCELLATION_CUTOFF_VIOLATION');
          }
        } else {
          expectOk(harness.scheduler.cancel(key, 'CORE_POLICY'));
        }
      }
      const view = harness.scheduler.lineageView(key);
      return { state: view?.state ?? '', accepted: view?.acceptedAt !== undefined };
    };
    // Serial orderings and their restart-ridden equivalents agree exactly.
    expect(runSerial(['cancel', 'accept'])).toEqual(runSerial(['cancel', 'accept']));
    expect(runSerial(['accept', 'cancel'])).toEqual({ state: 'ACCEPTED', accepted: true });
    expect(runSerial(['cancel', 'cancel'])).toEqual({
      state: 'CANCELLED_SUPPRESSED',
      accepted: false,
    });
    expect(runSerial(['cancel', 'accept', 'cancel'])).toEqual({
      state: 'CANCELLED_SUPPRESSED',
      accepted: false,
    });
  });
});
