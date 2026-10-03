/**
 * TEST_MATRIX suite `budgets` — distinct budget domains, inherited remaining
 * budgets without replenishment, and budget/scope separation.
 */
import { describe, expect, it } from 'vitest';
import {
  assertNoDuplicateAllocation,
  budgetRemaining,
  canStartNewDiscoveryWork,
  canTransferAfterDiscoveryExhaustion,
  decodeBudgetProfile,
  decodeLifecycleBudget,
  makeEffectId,
  validateTerminalResult,
} from '../src/index.ts';
import { BUDGET_PROFILE, decodeOk, decodedTerminalResult, expectCode, mid } from './helpers.ts';

describe('budgets: three distinct lifecycle domains', () => {
  it('decodes DiscoveryBudget, TransferBudget and GlobalSafetyBudget as distinct domains', () => {
    const discovery = decodeOk(
      decodeLifecycleBudget({ domain: 'discovery', maxGeneratedRequests: 10 }),
    );
    const transfer = decodeOk(decodeLifecycleBudget({ domain: 'transfer', maxBytes: 1000 }));
    const safety = decodeOk(
      decodeLifecycleBudget({ domain: 'global_safety', maxActiveElapsedMs: 60 }),
    );
    expect(discovery.domain).toBe('discovery');
    expect(transfer.domain).toBe('transfer');
    expect(safety.domain).toBe('global_safety');
    expect(Object.isFrozen(discovery)).toBe(true);
  });

  it('fails closed on unknown budget domains and on scope-shaped budget input', () => {
    expectCode(
      decodeLifecycleBudget({ domain: 'exploration_credits', maxCredits: 10 }),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(
      decodeLifecycleBudget({ kind: 'single_resource', targetId: 'target-file-001' }),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('a budget profile requires all three domains', () => {
    expectCode(
      decodeBudgetProfile({
        discovery: { domain: 'discovery' },
        transfer: { domain: 'transfer' },
      }),
      'MISSING_REQUIRED_FIELD',
    );
    const profile = decodeOk(decodeBudgetProfile(BUDGET_PROFILE));
    expect(profile.discovery.domain).toBe('discovery');
    expect(profile.transfer.domain).toBe('transfer');
    expect(profile.globalSafety.domain).toBe('global_safety');
  });

  it('fails closed on slot/domain discriminant mismatch inside a budget profile (PRD-§15)', () => {
    // a transfer-typed budget in the discovery slot is never recast as a DiscoveryBudget
    expectCode(
      decodeBudgetProfile({
        discovery: { domain: 'transfer', maxBytes: 1 },
        transfer: { domain: 'transfer', maxBytes: 10 },
        globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 100 },
      }),
      'MALFORMED_REQUIRED_FIELD',
      'PRD-§15',
    );
    // a discovery-typed budget in the transfer slot is rejected as well
    expectCode(
      decodeBudgetProfile({
        discovery: { domain: 'discovery', maxGeneratedRequests: 1 },
        transfer: { domain: 'discovery' },
        globalSafety: { domain: 'global_safety' },
      }),
      'MALFORMED_REQUIRED_FIELD',
      'PRD-§15',
    );
    // a contradictory declared domain in the globalSafety slot is rejected,
    // never silently overwritten to global_safety
    expectCode(
      decodeBudgetProfile({
        discovery: { domain: 'discovery' },
        transfer: { domain: 'transfer' },
        globalSafety: { domain: 'transfer', maxBytes: 1 },
      }),
      'MALFORMED_REQUIRED_FIELD',
      'PRD-§15',
    );
    // matching discriminants decode with each slot's declared domain left truthful
    const profile = decodeOk(
      decodeBudgetProfile({
        discovery: { domain: 'discovery', maxGeneratedRequests: 1 },
        transfer: { domain: 'transfer', maxBytes: 10 },
        globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 100 },
      }),
    );
    expect(profile.discovery.domain).toBe('discovery');
    expect(profile.transfer.domain).toBe('transfer');
    expect(profile.globalSafety.domain).toBe('global_safety');
  });
});

describe('budgets: retry/restart inherits remaining budget, never replenishes (C13)', () => {
  it('remaining is bounded by original limits and floors at zero', () => {
    const profile = decodeOk(decodeBudgetProfile(BUDGET_PROFILE));
    const partial = budgetRemaining(profile, {
      discovery: { generatedRequests: 10, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
    });
    expect(partial.discovery.perLimit['generatedRequests']).toBe(40);
    expect(partial.discovery.exhausted).toBe(false);
    const over = budgetRemaining(profile, {
      discovery: { generatedRequests: 1_000_000, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
    });
    expect(over.discovery.perLimit['generatedRequests']).toBe(0);
    expect(over.discovery.exhausted).toBe(true);
  });

  it('duplicate effect allocation is rejected', () => {
    const effect = decodeOk(makeEffectId('effect-001'));
    expect(
      decodeOk(assertNoDuplicateAllocation([decodeOk(makeEffectId('effect-000'))], effect)),
    ).toBeUndefined();
    expectCode(assertNoDuplicateAllocation([effect], effect), 'DUPLICATE_ALLOCATION', 'C13');
  });
});

describe('budgets: exhaustion precedence and scope invariance (C02/C28)', () => {
  it('discovery exhaustion stops discovery but frozen-target transfer continues while transfer+safety remain', () => {
    const profile = decodeOk(decodeBudgetProfile(BUDGET_PROFILE));
    const afterDiscoveryExhaustion = budgetRemaining(profile, {
      discovery: { generatedRequests: 50, navigationActions: 20, modelCalls: 5 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 10, modelCostUnits: 0, activeElapsedMs: 1000 },
    });
    expect(canStartNewDiscoveryWork(afterDiscoveryExhaustion)).toBe(false);
    expect(canTransferAfterDiscoveryExhaustion(afterDiscoveryExhaustion)).toBe(true);
  });

  it('global safety exhaustion stops all generated work (highest precedence)', () => {
    const profile = decodeOk(decodeBudgetProfile(BUDGET_PROFILE));
    const exhausted = budgetRemaining(profile, {
      discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 500, modelCostUnits: 0, activeElapsedMs: 7_200_000 },
    });
    expect(canStartNewDiscoveryWork(exhausted)).toBe(false);
    expect(canTransferAfterDiscoveryExhaustion(exhausted)).toBe(false);
  });

  it('budget exhaustion can stop work but never completes user scope (C02)', () => {
    const hundredPassed = Array.from({ length: 100 }, (_, i) => ({
      memberId: mid(`member-${String(i + 1).padStart(3, '0')}`),
      requiredValidationPassed: true,
    }));
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'GLOBAL_SAFETY_LIMIT',
    });
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 100,
          selectedValidationOutcomes: hundredPassed,
        }),
      ),
    ).toBeUndefined();
    const fakeComplete = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'COMPLETE',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'GLOBAL_SAFETY_LIMIT',
    });
    expectCode(
      validateTerminalResult(fakeComplete, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 100,
        selectedValidationOutcomes: hundredPassed,
      }),
      'INVALID_RESULT_COMBINATION',
    );
  });
});
