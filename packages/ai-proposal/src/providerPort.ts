/**
 * T012 provider-agnostic model port (frozen L2 ADR-008: AI is proposal-only
 * and cannot grant authority; PRD §5.1: LLM is not the default executor).
 *
 * The provider is a strictly optional proposal source behind an injectable
 * port. No provider SDK is a required capability, no network call is a
 * required runtime path, and the deterministic product path is complete and
 * correct with the provider absent, unreachable or misbehaving. Provider
 * implementations receive only `RedactedModelInput` — the adapter boundary
 * never hands raw secrets, unredacted observations or unbounded context to
 * this port (PRD §29; L2 §6.4 model-boundary redaction).
 */

import type { RedactedModelInput } from './modelInput.ts';

/** Identity of an optional model provider; recorded wherever proposals are traced. */
export interface ProviderIdentity {
  readonly providerId: string;
  readonly modelId: string;
}

/** The only request shape a provider port may receive: redacted bounded model input. */
export interface ProviderProposalRequest {
  readonly input: RedactedModelInput;
}

/** Typed unavailability reasons a provider port may surface (never silently skipped). */
export type ProviderUnavailabilityReason = 'OUTAGE' | 'TIMEOUT' | 'MALFORMED_RESPONSE';

/**
 * A provider port resolves to exactly one outcome: raw proposal data (never
 * authority — the deterministic policy owns acceptance) or typed
 * unavailability. Thrown errors, hung calls and garbage responses must be
 * mapped by the implementation to `UNAVAILABLE`; an implementation must
 * never present unavailability as an empty or partial success.
 */
export type ProviderProposalOutcome =
  | { readonly kind: 'PROPOSAL'; readonly payload: unknown }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly reason: ProviderUnavailabilityReason;
      readonly detail: string;
    };

export interface ModelProviderPort {
  readonly identity: ProviderIdentity;
  propose(request: ProviderProposalRequest): Promise<ProviderProposalOutcome>;
}
