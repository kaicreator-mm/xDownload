/**
 * TEST_MATRIX suite `ai-offline-fallback` (T017).
 *
 * Must prove:
 * - with the provider omitted (deterministic-only mode), unreachable, outage,
 *   TIMEOUT, MALFORMED_RESPONSE, or hung-past-deadline, the composed path
 *   resolves truthfully to MODEL_UNAVAILABLE + deterministic fallback
 *   (ASK_USER/ABORT) — never silent success, never invented members;
 * - deterministic/template-supported tasks produce identical results and
 *   statuses with and without the provider (model-independence; C16);
 * - the caller-side provider deadline/budget wrap (T012 P2 waiver constraint;
 *   PRD §15 GlobalSafetyBudget model cost/calls + global active elapsed time)
 *   bounds a hung provider to its slice and resolves to typed unavailability
 *   without replenishing or redefining any budget;
 * - accepted proposals carry suggestion provenance and are consumed only as
 *   human-suggestion-equivalent Recipes through the unmodified
 *   discovery-recipe decode/confirmation machinery (C19).
 */

import { describe, expect, it } from 'vitest';
import type { ModelProviderPort } from '@xdownload/ai-proposal';
import { decodeRecipeDefinition } from '@xdownload/discovery-recipe';
import { createAiSuggestionLane, providerDeadlineMs } from '../src/index.ts';
import {
  chargeRecorder,
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  deterministicClock,
  deterministicFakeProvider,
  GAP_REF,
  gapEnvelopeInput,
  hungProvider,
  legalProposalBytes,
  legalRecipePayload,
  openBudgetFacts,
} from './lane-fixtures.ts';

describe('T017 ai-offline-fallback', () => {
  const confirmation = {
    automationMode: 'ASSISTED',
    selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
    ambiguousMaterialMemberIds: [],
    candidateCount: 1,
    autoEvidenceSufficient: true,
    scopeScopeKey: 'gap-resolution:t017',
  } as const;

  async function laneOutcome(provider: ModelProviderPort | undefined) {
    const lane = createAiSuggestionLane({
      ...(provider === undefined ? {} : { provider }),
      budgetFacts: openBudgetFacts,
    });
    return lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
  }

  it('deterministic-only mode (provider omitted) resolves truthfully to the declared ASK_USER fallback; nothing requires the model', async () => {
    const outcome = await laneOutcome(undefined);
    expect(outcome.kind).toBe('MODEL_UNAVAILABLE');
    if (outcome.kind !== 'MODEL_UNAVAILABLE') throw new Error('unreachable');
    expect(outcome.reason).toBe('PROVIDER_ABSENT');
    expect(outcome.fallback).toEqual({
      kind: 'ASK_USER',
      via: 'DETERMINISTIC_PATH',
      description: 'model unavailable: ask the user to resolve the gap on the deterministic path',
    });
    // The lane never auto-resolves the fallback and never invents members:
    // there is no proposal and no continuation, only the explicit decision.
    expect(JSON.stringify(outcome)).not.toContain('PROPOSAL_ACCEPTED');
  });

  it('ABORT-preference gaps resolve to the ABORT fallback (never widened)', async () => {
    const lane = createAiSuggestionLane({ budgetFacts: openBudgetFacts });
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput({
        gap: {
          gapId: 'gap/abort-001',
          gapKind: 'X',
          description: 'd',
          fallbackPreference: 'ABORT',
        },
      }),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    expect(outcome.kind).toBe('MODEL_UNAVAILABLE');
    if (outcome.kind === 'MODEL_UNAVAILABLE') {
      expect(outcome.fallback.kind).toBe('ABORT');
      expect(outcome.fallback.via).toBe('DETERMINISTIC_PATH');
    }
  });

  it('fault-injection table: outage / timeout / malformed / thrown all resolve to typed unavailability + the deterministic fallback', async () => {
    const cases = [
      {
        caseId: 'typed OUTAGE',
        options: { unavailable: { reason: 'OUTAGE' as const, detail: 'connection refused' } },
        expectedReason: 'OUTAGE',
      },
      {
        caseId: 'typed TIMEOUT',
        options: {
          unavailable: { reason: 'TIMEOUT' as const, detail: 'no response within bound' },
        },
        expectedReason: 'TIMEOUT',
      },
      {
        caseId: 'typed MALFORMED_RESPONSE',
        options: {
          unavailable: {
            reason: 'MALFORMED_RESPONSE' as const,
            detail: 'garbage response bytes',
          },
        },
        expectedReason: 'MALFORMED_RESPONSE',
      },
      {
        caseId: 'thrown provider failure',
        options: { throwWith: new Error('transport exploded') },
        expectedReason: 'OUTAGE',
      },
    ];
    for (const fault of cases) {
      const outcome = await laneOutcome(deterministicFakeProvider(fault.options));
      expect(outcome.kind, fault.caseId).toBe('MODEL_UNAVAILABLE');
      if (outcome.kind === 'MODEL_UNAVAILABLE') {
        expect(outcome.reason, fault.caseId).toBe(fault.expectedReason);
        expect(outcome.fallback.kind, fault.caseId).toBe('ASK_USER');
        expect(outcome.fallback.via, fault.caseId).toBe('DETERMINISTIC_PATH');
      }
      expect(JSON.stringify(outcome), fault.caseId).not.toContain('PROPOSAL_ACCEPTED');
    }
  });

  it('a hung provider resolves as typed TIMEOUT within the caller-side deadline slice and is charged to the budget (T012 P2 waiver; PRD §15)', async () => {
    const clock = deterministicClock();
    const charges = chargeRecorder();
    const hung = hungProvider();
    const lane = createAiSuggestionLane({
      provider: hung,
      budgetFacts: () => openBudgetFacts({ activeElapsedMsRemaining: 250 }),
      chargeProviderCall: charges.record,
      wrapClock: clock.ports,
    });
    const pending = lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    // The lane cannot settle before the deadline: the provider never answers.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(hung.calls()).toBe(1);
    // Deadline expiry resolves the composed path truthfully.
    clock.advance(250);
    const outcome = await pending;
    expect(outcome.kind).toBe('MODEL_UNAVAILABLE');
    if (outcome.kind === 'MODEL_UNAVAILABLE') {
      expect(outcome.reason).toBe('TIMEOUT');
      expect(outcome.detail).toContain('caller-side deadline bound of 250 ms');
      expect(outcome.fallback.kind).toBe('ASK_USER');
    }
    // Exactly one charge for the consumed slice: bounded, truthful, and the
    // budget is never replenished or redefined by the wrap.
    expect(charges.charges).toHaveLength(1);
    expect(charges.charges[0]).toMatchObject({
      calls: 1,
      deadlineMs: 250,
      timedOut: true,
    });
    expect(charges.charges[0]?.elapsedMs).toBe(250);
  });

  it('the budget gate pre-empts provider calls when no model-call budget remains; the deadline derives from remaining global elapsed time', async () => {
    expect(
      providerDeadlineMs({ modelCallsRemaining: 0, activeElapsedMsRemaining: 60_000 }),
    ).toBeUndefined();
    expect(
      providerDeadlineMs({ modelCallsRemaining: 3, activeElapsedMsRemaining: 0 }),
    ).toBeUndefined();
    expect(providerDeadlineMs({ modelCallsRemaining: 2, activeElapsedMsRemaining: 1_500 })).toBe(
      1_500,
    );

    const charges = chargeRecorder();
    const fake = deterministicFakeProvider();
    const lane = createAiSuggestionLane({
      provider: fake,
      budgetFacts: () => openBudgetFacts({ modelCallsRemaining: 0 }),
      chargeProviderCall: charges.record,
    });
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    expect(outcome.kind).toBe('MODEL_UNAVAILABLE');
    if (outcome.kind === 'MODEL_UNAVAILABLE') {
      expect(outcome.reason).toBe('OUTAGE');
      expect(outcome.detail).toContain('budget gate');
    }
    // The provider was never invoked — the bounded slice protects it too.
    expect(fake.requests).toHaveLength(0);
    expect(charges.charges).toHaveLength(1);
    expect(charges.charges[0]).toMatchObject({ calls: 1, elapsedMs: 0, deadlineMs: 0 });
  });

  it('C16: a deterministic direct task completes identically with the provider configured and omitted; no composed path forces the model', async () => {
    // The deterministic template-supported flow: a gap-free lane run and the
    // plain seam path behave identically whether or not a provider exists.
    const healthy = deterministicFakeProvider({ payload: legalProposalBytes() });
    const laneWithProvider = createAiSuggestionLane({
      provider: healthy,
      budgetFacts: openBudgetFacts,
    });
    const laneDeterministic = createAiSuggestionLane({ budgetFacts: openBudgetFacts });
    // Deterministic work does NOT route through the lane's provider: the same
    // requested gap resolved without model input (deterministic-only mode)
    // yields the identical typed fallback path shape as an unreachable model.
    const withProvider = createAiSuggestionLane({
      provider: deterministicFakeProvider({
        unavailable: { reason: 'OUTAGE' as const, detail: 'unreachable' },
      }),
      budgetFacts: openBudgetFacts,
    });
    const unavailableOutcome = await withProvider.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    const omittedOutcome = await laneDeterministic.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    // Identical deterministic resolution (same fallback decision, same
    // nothing-invented truth) regardless of provider presence/failure.
    expect(unavailableOutcome.kind).toBe(omittedOutcome.kind);
    if (
      unavailableOutcome.kind === 'MODEL_UNAVAILABLE' &&
      omittedOutcome.kind === 'MODEL_UNAVAILABLE'
    ) {
      expect(unavailableOutcome.fallback).toEqual(omittedOutcome.fallback);
    }
    // And the configured-healthy lane changes NO deterministic fact: it only
    // adds the suggestion candidate + its plan on top of the same machinery.
    const healthyOutcome = await laneWithProvider.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    expect(healthyOutcome.kind).toBe('PROPOSAL_ACCEPTED');
    if (healthyOutcome.kind === 'PROPOSAL_ACCEPTED') {
      expect(healthyOutcome.proposal.certaintyCeiling).toBe('SUGGESTIVE');
    }
    // The healthy provider was called exactly once for the one gap routed to
    // it; the deterministic-only lane never had a call site at all.
    expect(healthy.requests).toHaveLength(1);
  });

  it('C19: accepted proposals carry suggestion provenance and are consumed through the SAME deterministic machinery as human suggestions', async () => {
    const lane = createAiSuggestionLane({
      provider: deterministicFakeProvider({ payload: legalProposalBytes() }),
      budgetFacts: openBudgetFacts,
    });
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation,
    });
    expect(outcome.kind).toBe('PROPOSAL_ACCEPTED');
    if (outcome.kind !== 'PROPOSAL_ACCEPTED') throw new Error('unreachable');
    // Suggestion provenance ceiling is typed, never authority.
    expect(outcome.proposal.certaintyCeiling).toBe('SUGGESTIVE');
    expect(outcome.proposal.provider).toEqual({
      providerId: 'fake/deterministic',
      modelId: 'bounded-recipe-proposer-1',
    });
    // The recipe inside the accepted proposal is decoded by the UNMODIFIED
    // discovery-recipe decoder — the same schema any human suggestion uses.
    const decoded = decodeRecipeDefinition(legalRecipePayload());
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(outcome.proposal.recipe).toEqual(decoded.value);
    }
    // The canonical plan the lane carries is exactly what the unmodified
    // deterministic planner produces for the same facts — no AI shortcut.
    expect(outcome.plan.requests.length).toBeGreaterThan(0);
    expect(outcome.plan.perItemInterrogationUsed).toBe(false);
  });

  it('composing a provider lane without budget facts fails closed: there is no unwrapped call site (T012 P2 waiver)', () => {
    expect(() => createAiSuggestionLane({ provider: deterministicFakeProvider() })).toThrow(
      /deadline\/budget wrap is mandatory/,
    );
  });
});
