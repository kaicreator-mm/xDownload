/**
 * T012 bounded AI proposal adapter — composition of the redaction boundary,
 * the optional provider port, the deterministic policy and the no-model
 * fallback (frozen L2 ADR-008; PRD §5.1, §29, §30).
 *
 * Pipeline, in order:
 *
 *   raw bounded gap → redact/contain → bound/audit (model input)
 *   → optional provider port (injectable; fake/offline in tests)
 *   → response containment audit (before any durable use)
 *   → deterministic policy: envelope bound → unmodified Recipe decode
 *     → suggestion ceiling → credential containment → capability admission
 *   → accepted proposal (data only) | typed rejection | typed unavailability
 *     + deterministic fallback (ASK_USER/ABORT)
 *
 * The adapter grants nothing: an accepted proposal is data with suggestion
 * provenance; turning it into behavior requires the exact same
 * deterministic machinery as any human-suggested Recipe. The model is never
 * a required dependency: with the provider absent, unreachable or hostile,
 * the adapter resolves truthfully to the deterministic path with
 * `ASK_USER`/`ABORT` — never silently as success.
 */

import { buildModelInput, auditSecretMaterial } from './modelInput.ts';
import type {
  ModelProviderPort,
  ProviderIdentity,
  ProviderProposalOutcome,
} from './providerPort.ts';
import {
  evaluateProposal,
  type ContractAuthorityFacts,
  type ProposalEvaluationContext,
} from './proposalPolicy.ts';
import {
  resolveDeterministicFallback,
  type DeterministicFallback,
  type ProposalRequestPath,
  type ProposalUnavailabilityReason,
} from './fallback.ts';

/** One proposal request, bound to an exact gap/contract context. */
export interface ProposalRequest {
  /** Raw (untrusted) bounded gap envelope; redacted and bounded by the adapter. */
  readonly gap: unknown;
  /** The gap reference the request is answering; proposals must bind to it exactly. */
  readonly expectedGapRef: string;
  /** The contract context the request belongs to; proposals must bind to it exactly. */
  readonly expectedContractRef: string;
  /** The confirmed-contract authority facts the policy admits capabilities against. */
  readonly contract: ContractAuthorityFacts;
}

export interface AiProposalAdapter {
  /** Provider identity when a provider is configured; `undefined` is the deterministic-only mode. */
  readonly provider: ProviderIdentity | undefined;
  proposeRecipe(request: ProposalRequest): Promise<ProposalRequestPath>;
}

export interface AiProposalAdapterOptions {
  /** Strictly optional; omit for deterministic-only operation (no model anywhere). */
  readonly provider?: ModelProviderPort;
}

function unavailable(
  reason: ProposalUnavailabilityReason,
  detail: string,
  fallback: DeterministicFallback,
): ProposalRequestPath {
  return { kind: 'MODEL_UNAVAILABLE', reason: reason, detail: detail, fallback: fallback };
}

function mapProviderOutcome(
  outcome: ProviderProposalOutcome,
):
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: ProposalUnavailabilityReason; readonly detail: string } {
  if (outcome.kind === 'PROPOSAL') {
    return { ok: true, payload: outcome.payload };
  }
  return { ok: false, reason: outcome.reason, detail: outcome.detail };
}

/**
 * Create the bounded AI proposal adapter. The provider is optional and
 * injectable; product tests use a deterministic fake or no provider at all.
 */
export function createAiProposalAdapter(options: AiProposalAdapterOptions = {}): AiProposalAdapter {
  const provider = options.provider;
  return {
    provider: provider?.identity,
    async proposeRecipe(request: ProposalRequest): Promise<ProposalRequestPath> {
      // 1. Redaction boundary: contain secrets, bound the size, audit — before anything else.
      const input = buildModelInput(request.gap);
      if (!input.ok) {
        return { kind: 'MODEL_INPUT_REJECTED', diagnostics: input.diagnostics };
      }
      const fallbackFor = (
        reason: ProposalUnavailabilityReason,
        detail: string,
      ): ProposalRequestPath =>
        unavailable(
          reason,
          detail,
          resolveDeterministicFallback(input.value.gap, reason, detail).fallback,
        );
      // 2. Model absence is a truthful typed outcome, not an error and never a silent skip.
      if (provider === undefined) {
        return fallbackFor('PROVIDER_ABSENT', 'no model provider is configured for this adapter');
      }
      // 3. Provider call; thrown failures degrade truthfully to OUTAGE (never partial success).
      let outcome: ProviderProposalOutcome;
      try {
        outcome = await provider.propose({ input: input.value });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'provider call failed';
        return fallbackFor('OUTAGE', detail);
      }
      const mapped = mapProviderOutcome(outcome);
      if (!mapped.ok) {
        return fallbackFor(mapped.reason, mapped.detail);
      }
      // 4. Response containment audit before any decode or durable use (C21).
      const leakage = auditSecretMaterial(mapped.payload);
      if (leakage.length > 0) {
        return fallbackFor(
          'PROVIDER_RESPONSE_REJECTED',
          `provider response failed the secret-material containment audit at: ${leakage
            .map((violation) => `${violation.kind}@${violation.path}`)
            .join(', ')}`,
        );
      }
      // 5. Deterministic policy — the same pure policy that runs without any model (C19).
      const context: ProposalEvaluationContext = {
        expectedGapRef: request.expectedGapRef,
        expectedContractRef: request.expectedContractRef,
        expectedProvider: provider.identity,
      };
      const decision = evaluateProposal(mapped.payload, context, request.contract);
      if (!decision.ok) {
        return { kind: 'PROPOSAL_REJECTED', diagnostics: decision.diagnostics };
      }
      return { kind: 'PROPOSAL_ACCEPTED', proposal: decision.value };
    },
  };
}
