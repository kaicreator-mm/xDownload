/**
 * TEST_MATRIX suite `budget-exhaustion-precedence` — PRD §15/§15.4 domains
 * and exhaustion precedence, budget-truthful stop reasons and pause-time
 * exclusion. Oracle cells T006-O01, T006-O02, T006-O03, T006-O13, T006-O16.
 */
import { describe, expect, it } from 'vitest';
import {
  billableActiveMs,
  type BudgetAction,
  type DispatchGrant,
  type LineageKey,
} from '../src/index.ts';
import { decodeTerminalResult, validateTerminalResult } from '@xdownload/domain-contracts';
import {
  CONTRACT,
  expectOk,
  expectRejection,
  PROFILE,
  setup,
  submitDefault,
  submitInput,
  type Harness,
} from './helpers.ts';

/** Reserve+consume helper: one action through the single mutation path. */
function consumeAction(
  harness: Harness,
  key: LineageKey,
  action: BudgetAction,
  actual?: Record<string, number>,
): DispatchGrant {
  const grant = expectOk(harness.scheduler.requestDispatch(key, action));
  expectOk(harness.scheduler.consume(grant, actual));
  return grant;
}

describe('budget-exhaustion-precedence', () => {
  it('T006-O01: discovery exhaustion stops new discovery but frozen-target transfer continues (C28)', () => {
    const harness = setup();
    const key = submitDefault(harness);

    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });
    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });
    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });

    // discovery.maxGeneratedRequests = 3 is exhausted; global safety (4) remains.
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'GENERATED_REQUEST', count: 1 }),
      'BUDGET_EXHAUSTED',
      'DISCOVERY_BUDGET_EXHAUSTED',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'NAVIGATION', count: 1 }),
      'BUDGET_EXHAUSTED',
      'DISCOVERY_BUDGET_EXHAUSTED',
    );

    // Already-frozen target transfer continues while transfer+safety remain.
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 400 }),
    );
    expectOk(harness.scheduler.consume(grant));
    const stop = expectOk(harness.scheduler.projectBudgetStop(key));
    expect(stop.stopped).toBe(true);
    expect(stop.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
    expect(stop.exhaustedDomains).toEqual(['discovery']);
  });

  it('T006-O02: global-safety cap stops all generated work with highest precedence; scope unchanged (C23/C28)', () => {
    const harness = setup();
    const key = submitDefault(harness);

    // maxModelCostUnits = 1: one model call exhausts the global safety domain.
    consumeAction(harness, key, { kind: 'MODEL_CALL', count: 1, costUnits: 1 });

    // Every further generated action — including actions whose own domain has
    // room — stops with global-safety precedence.
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'GENERATED_REQUEST', count: 1 }),
      'BUDGET_EXHAUSTED',
      'GLOBAL_SAFETY_LIMIT',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'NAVIGATION', count: 1 }),
      'BUDGET_EXHAUSTED',
      'GLOBAL_SAFETY_LIMIT',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'MODEL_CALL', count: 1, costUnits: 1 }),
      'BUDGET_EXHAUSTED',
      'GLOBAL_SAFETY_LIMIT',
    );

    const stop = expectOk(harness.scheduler.projectBudgetStop(key));
    expect(stop.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
    // No dispatch happened, so a later authorized transition is required to
    // continue; the requested scope was never mutated by the budget stop.
    const submission = expectOk(harness.scheduler.submitLineage(submitInput()));
    expect(submission.converged).toBe(true);
  });

  it('T006-O03: transfer exhaustion stops acquisition bytes and blocks completion claims', () => {
    const harness = setup();
    const key = submitDefault(harness);

    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 1000 }),
    );
    expectOk(harness.scheduler.consume(grant));

    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 1 }),
      'BUDGET_EXHAUSTED',
      'TRANSFER_BUDGET_EXHAUSTED',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_SEGMENT', count: 1 }),
      'BUDGET_EXHAUSTED',
      'TRANSFER_BUDGET_EXHAUSTED',
    );

    // The staged bytes alone can never be projected as acquisition completion:
    // the budget-truthful stop reason feeds T002 result validation, which
    // rejects a fabricated COMPLETE claim (PRD §15.4, C02).
    const stop = expectOk(harness.scheduler.projectBudgetStop(key));
    expect(stop.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    const fabricated = decodeTerminalResult({
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId: CONTRACT,
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'NOT_APPLICABLE',
      stopReason: stop.stopReason,
      validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(fabricated.ok).toBe(true);
    if (fabricated.ok) {
      const verdict = validateTerminalResult(fabricated.value, {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
      });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.diagnostics.some((d) => d.code === 'INVALID_RESULT_COMBINATION')).toBe(true);
      }
    }
  });

  it('T006-O13: budget exhaustion is projected budget-truthful, never as scope/coverage completion', () => {
    const harness = setup();
    const key = submitDefault(harness);
    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });
    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });
    consumeAction(harness, key, { kind: 'GENERATED_REQUEST', count: 1 });

    const projection = expectOk(harness.scheduler.projectBudgetStop(key));
    expect(projection.stopped).toBe(true);
    const budgetTruthful = new Set([
      'DISCOVERY_BUDGET_EXHAUSTED',
      'TRANSFER_BUDGET_EXHAUSTED',
      'GLOBAL_SAFETY_LIMIT',
    ]);
    expect(budgetTruthful.has(projection.stopReason!)).toBe(true);
    expect(projection.stopReason).not.toBe('USER_SCOPE_REACHED');
    expect(projection.stopReason).not.toBe('NATURAL_COLLECTION_END');

    // The single mutation path records exactly the three consumptions — the
    // stop is derived from durable budget facts, not from a scope judgement.
    const consumptions = harness.log.readAll().filter((fact) => fact.kind === 'budgetConsumed');
    expect(consumptions).toHaveLength(3);
  });

  it('T006-O16: user pause time is excluded from active elapsed-time counters', () => {
    // Pause time is structurally unrepresentable in consumption: only active
    // time is billable, and a zero-billable observation cannot even reserve.
    expect(billableActiveMs({ activeMs: 100, pausedMs: 5000 })).toBe(100);
    expect(billableActiveMs({ activeMs: 0, pausedMs: 5000 })).toBe(0);

    const harness = setup();
    const key = submitDefault(harness);
    const grant = expectOk(
      harness.scheduler.requestDispatch(key, { kind: 'ACTIVE_ELAPSED', ms: 100 }),
    );
    expectOk(harness.scheduler.consume(grant));

    const remaining = expectOk(harness.scheduler.remainingBudgets(key));
    expect(remaining.globalSafety.perLimit['activeElapsedMs']).toBe(
      PROFILE.globalSafety.maxActiveElapsedMs - 100,
    );

    // The 5000 ms pause cannot enter the ledger: there is no pause action and
    // a zero-amount elapsed reservation is rejected outright.
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'ACTIVE_ELAPSED', ms: 0 }),
      'MALFORMED_CONTROL_FACT',
    );
  });

  it('malformed budget actions and profiles reject through T002 decode at the seam', () => {
    const harness = setup();
    const key = submitDefault(harness);
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: -5 }),
      'MALFORMED_CONTROL_FACT',
    );
    expectRejection(
      harness.scheduler.requestDispatch(key, { kind: 'TRANSFER_BYTES', bytes: 0 }),
      'MALFORMED_CONTROL_FACT',
    );

    const badProfile = setup();
    expectRejection(
      badProfile.scheduler.submitLineage(
        submitInput({ budgetProfile: { discovery: { domain: 'discovery' }, transfer: {} } }),
      ),
      'MALFORMED_CONTROL_FACT',
    );
  });
});
