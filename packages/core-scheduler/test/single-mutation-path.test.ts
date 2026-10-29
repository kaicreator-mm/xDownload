/**
 * TEST_MATRIX suites `single-budget-mutation-path` and crash-adjacent budget
 * accounting — one authoritative ledger, serialized duplicate clients, no
 * private counters, no double counting, no replenishment across restart.
 * Oracle cells T006-O11, T006-O12.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryControlFactLog,
  decodeFactLog,
  serializeFacts,
  type ConsumptionToken,
} from '../src/index.ts';
import type { ContractId } from '@xdownload/domain-contracts';

const forgedContractId = 'contract-collection-001' as ContractId;
import {
  duplicateClient,
  expectOk,
  expectRejection,
  PROFILE,
  restart,
  setup,
  submitDefault,
  submitInput,
} from './helpers.ts';

describe('single-budget-mutation-path', () => {
  it('discovery, transfer, retry and model actions consume only through the one authoritative path', () => {
    const harness = setup();
    const key = submitDefault(harness);
    // MODEL_CALL consumes the last global-safety cost unit (max 1), so it
    // runs last: after it the safety ceiling stops all generated work.
    const actions = [
      { kind: 'GENERATED_REQUEST', count: 1 },
      { kind: 'NAVIGATION', count: 1 },
      { kind: 'TRANSFER_BYTES', bytes: 100 },
      { kind: 'TRANSFER_SEGMENT', count: 1 },
      { kind: 'TRANSFER_TIME', ms: 500 },
      { kind: 'RETRY_TRANSFER_REQUEST', count: 1 },
      { kind: 'ACTIVE_ELAPSED', ms: 1000 },
      { kind: 'MODEL_CALL', count: 1, costUnits: 1 },
    ] as const;
    for (const action of actions) {
      const grant = expectOk(harness.scheduler.requestDispatch(key, { ...action }));
      expectOk(harness.scheduler.consume(grant));
    }
    // Every consumption fact was written by the ledger through the same log.
    const consumed = harness.log.readAll().filter((fact) => fact.kind === 'budgetConsumed');
    expect(consumed).toHaveLength(actions.length);
    const remaining = expectOk(harness.scheduler.remainingBudgets(key));
    expect(remaining.discovery.perLimit['generatedRequests']).toBe(
      PROFILE.discovery.maxGeneratedRequests - 1,
    );
    expect(remaining.transfer.perLimit['bytes']).toBe(PROFILE.transfer.maxBytes - 100);
    expect(remaining.globalSafety.perLimit['activeElapsedMs']).toBe(
      PROFILE.globalSafety.maxActiveElapsedMs - 1000,
    );
  });

  it('T006-O12: restart/repair/UI/CLI-style duplicate clients observe one serialized ledger view', () => {
    const harness = setup();
    const key = submitDefault(harness);
    // Three independent scheduler instances (UI, CLI, repair-style) over one
    // durable total order — no client owns private budget truth.
    const ui = harness.scheduler;
    const cli = duplicateClient(harness);
    const repair = duplicateClient(harness);

    const first = expectOk(ui.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 300 }));
    expectOk(ui.consume(first));
    const second = expectOk(cli.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 300 }));
    expectOk(cli.consume(second));
    const third = expectOk(repair.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 399 }));
    expectOk(repair.consume(third));
    // The fourth reservation (300 bytes vs 1 remaining) is impossible in every
    // client's view: one authoritative ledger, no duplicate allocation.
    for (const client of [ui, cli, repair]) {
      expectRejection(
        client.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 300 }),
        'BUDGET_EXHAUSTED',
        'TRANSFER_BUDGET_EXHAUSTED',
      );
      const remaining = expectOk(client.remainingBudgets(key));
      expect(remaining.transfer.perLimit['bytes']).toBe(1);
    }
    // Reservation ids stay monotonic and unique across clients.
    const reservations = harness.log
      .readAll()
      .filter((fact) => fact.kind === 'budgetReserved')
      .map((fact) => (fact.kind === 'budgetReserved' ? fact.reservationId : ''));
    expect(new Set(reservations).size).toBe(3);
    // A genuinely restarted client (fresh in-memory log rebuilt from facts)
    // rejoins the same serialized ledger view.
    const reopened = restart(harness).scheduler;
    const remaining = expectOk(reopened.remainingBudgets(key));
    expect(remaining.transfer.perLimit['bytes']).toBe(1);
  });

  it('negative: a second private/per-worker/per-surface counter path is rejected, not representable', () => {
    const harness = setup();
    const key = submitDefault(harness);
    // Direct consumption-record construction without the ledger token is
    // rejected by the durable log itself.
    expectRejection(
      harness.log.append({
        kind: 'budgetConsumed',
        lineageKey: key,
        contractId: forgedContractId,
        reservationId: 'forged#res-1',
        amounts: { bytes: 5 },
      }),
      'BUDGET_AUTHORITY_VIOLATION',
    );
    // A forged token object is unrepresentable: the authorization symbol is
    // not constructible outside the authoritative ledger.
    const forged = {} as ConsumptionToken;
    expectRejection(
      harness.log.append(
        {
          kind: 'budgetConsumed',
          lineageKey: key,
          contractId: forgedContractId,
          reservationId: 'forged#res-1',
          amounts: { bytes: 5 },
        },
        forged,
      ),
      'BUDGET_AUTHORITY_VIOLATION',
    );
    // Nothing was recorded: no private counter state exists to reconcile later.
    expect(harness.log.readAll().some((fact) => fact.kind === 'budgetConsumed')).toBe(false);
  });

  it('T006-O11: restart after consumption keeps remaining budgets; no loss, no double count, no replenishment', () => {
    const harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 400 }),
    );
    expectOk(harness.scheduler.consume(grant));
    const before = expectOk(harness.scheduler.remainingBudgets(key));

    const after = restart(harness);
    const reopened = expectOk(after.scheduler.remainingBudgets(key));
    expect(reopened).toEqual(before);
    expect(reopened.transfer.perLimit['bytes']).toBe(PROFILE.transfer.maxBytes - 400);

    // Consuming the pre-restart grant again double-counts and is rejected.
    expectRejection(after.scheduler.consume(grant), 'BUDGET_AUTHORITY_VIOLATION');

    // The reopened ledger continues from durable facts: 400 of 1000 bytes left.
    const next = expectOk(
      after.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 400 }),
    );
    expectOk(after.scheduler.consume(next));
    const final = expectOk(after.scheduler.remainingBudgets(key));
    expect(final.transfer.perLimit['bytes']).toBe(PROFILE.transfer.maxBytes - 800);
  });

  it('negative: opening with a divergent (larger/reset) budget profile is replenishment and is rejected', () => {
    const harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 800 }),
    );
    expectOk(harness.scheduler.consume(grant));

    const inflated = {
      discovery: PROFILE.discovery,
      transfer: { ...PROFILE.transfer, maxBytes: 10_000_000 },
      globalSafety: PROFILE.globalSafety,
    };
    expectRejection(
      harness.scheduler.assertCompatibleBudgetProfile(key, inflated),
      'BUDGET_REPLENISHMENT_REJECTED',
    );
    // The durable profile still governs: only 200 bytes remain.
    const remaining = expectOk(harness.scheduler.remainingBudgets(key));
    expect(remaining.transfer.perLimit['bytes']).toBe(200);
  });

  it('negative: consumption outside the reservation ordering is a budget-authority violation', () => {
    const harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 100 }),
    );
    expectRejection(harness.scheduler.consume(grant, { bytes: 101 }), 'BUDGET_AUTHORITY_VIOLATION');
    // The grant is single-use; a second consumption double-counts.
    expectOk(harness.scheduler.consume(grant));
    expectRejection(harness.scheduler.consume(grant), 'BUDGET_AUTHORITY_VIOLATION');
    expect(harness.log.readAll().filter((fact) => fact.kind === 'budgetConsumed')).toHaveLength(1);
  });

  it('negative: control transitions consuming unvalidated canonical identities fail closed', () => {
    const harness = setup();
    expectRejection(
      harness.scheduler.submitLineage(submitInput({ contractId: 'not a valid id!' })),
      'MALFORMED_CONTROL_FACT',
    );
    expectRejection(
      harness.scheduler.submitLineage(submitInput({ targetId: '' })),
      'MALFORMED_CONTROL_FACT',
    );
    expectRejection(
      harness.scheduler.submitLineage(submitInput({ authorizationContextRef: '../../etc/passwd' })),
      'MALFORMED_CONTROL_FACT',
    );
    expectRejection(
      harness.scheduler.submitLineage(
        submitInput({ frozenMemberIds: ['member-001', 'member-001'] }),
      ),
      'MALFORMED_CONTROL_FACT',
    );
    // Nothing was committed.
    expect(harness.log.readAll()).toHaveLength(0);
  });

  it('the durable fact log is a single total order; stale sequence claims are rejected (no distributed claims)', () => {
    const harness = setup();
    submitDefault(harness);
    const facts = harness.log.readAll();
    // Reopening rejects a fabricated history with a non-increasing order.
    const tampered = [{ ...facts[facts.length - 1]!, sequence: 0 }, ...facts];
    const decoded = decodeFactLog(JSON.parse(serializeFacts(tampered)));
    expect(decoded.ok).toBe(false);
    // A gap-free strict order reopens deterministically.
    const decodedOk = decodeFactLog(JSON.parse(serializeFacts(facts)));
    expect(decodedOk.ok).toBe(true);
    const reopened = InMemoryControlFactLog.reopen(decodedOk.ok ? decodedOk.value : []);
    expect(reopened.readAll()).toEqual(facts);
  });
});
