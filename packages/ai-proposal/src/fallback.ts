/**
 * T012 truthful degradation and deterministic fallback (frozen Task Pack:
 * "Model unreliability must degrade truthfully, not widen behavior"; PRD
 * §30: failure categories must not be silently rewritten to success by
 * retries or AI explanation; PRD §5.1/CJ-07: direct/template-supported paths
 * continue when the model is unavailable).
 *
 * Provider outage, timeout, unusable or hostile responses resolve to typed
 * unavailability plus the gap's declared deterministic fallback
 * (`ASK_USER` or `ABORT`) — never to success, never to invented members,
 * never to widened behavior. The fallback itself needs no model round-trip
 * and works with the provider absent.
 */

import type { BoundedKnowledgeGap } from './modelInput.ts';
import type { AcceptedProposal } from './proposalPolicy.ts';
import type { ProposalDiagnostic } from './diagnostics.ts';
import type { ProviderUnavailabilityReason } from './providerPort.ts';

/** All typed reasons a proposal request can end without a model proposal. */
export type ProposalUnavailabilityReason =
  ProviderUnavailabilityReason | 'PROVIDER_ABSENT' | 'PROVIDER_RESPONSE_REJECTED';

/** The deterministic fallback the caller follows when no proposal is available. */
export interface DeterministicFallback {
  readonly kind: 'ASK_USER' | 'ABORT';
  readonly via: 'DETERMINISTIC_PATH';
  readonly description: string;
}

/** The complete, typed outcome space of an adapter proposal request. */
export type ProposalRequestPath =
  | { readonly kind: 'PROPOSAL_ACCEPTED'; readonly proposal: AcceptedProposal }
  | { readonly kind: 'PROPOSAL_REJECTED'; readonly diagnostics: readonly ProposalDiagnostic[] }
  | { readonly kind: 'MODEL_INPUT_REJECTED'; readonly diagnostics: readonly ProposalDiagnostic[] }
  | {
      readonly kind: 'MODEL_UNAVAILABLE';
      readonly reason: ProposalUnavailabilityReason;
      readonly detail: string;
      readonly fallback: DeterministicFallback;
    };

/**
 * Resolve the deterministic fallback for an unavailable model. Pure and
 * model-free: the fallback kind is exactly the gap's declared preference
 * (bounded to `ASK_USER`/`ABORT` at the gap decode), the via is always the
 * deterministic path, and the unavailability reason is carried verbatim.
 */
export function resolveDeterministicFallback(
  gap: BoundedKnowledgeGap,
  reason: ProposalUnavailabilityReason,
  detail: string,
): {
  readonly fallback: DeterministicFallback;
  readonly reason: ProposalUnavailabilityReason;
  readonly detail: string;
} {
  return {
    fallback: {
      kind: gap.fallbackPreference,
      via: 'DETERMINISTIC_PATH',
      description:
        gap.fallbackPreference === 'ASK_USER'
          ? 'model unavailable: ask the user to resolve the gap on the deterministic path'
          : 'model unavailable: abort this gap on the deterministic path',
    },
    reason: reason,
    detail: detail,
  };
}
