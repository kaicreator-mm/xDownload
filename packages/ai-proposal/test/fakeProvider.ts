/**
 * T012 deterministic fake provider — an offline, injectable
 * `ModelProviderPort` double. No network, no model, no SDK: the fake
 * returns a configured outcome (legal proposal bytes, typed unavailability,
 * hostile payload) or throws, and records every redacted request it
 * receives so tests can audit the provider-input boundary.
 */

import type {
  ModelProviderPort,
  ProviderIdentity,
  ProviderProposalOutcome,
  ProviderProposalRequest,
  ProviderUnavailabilityReason,
} from '../src/providerPort.ts';
import type { RedactedModelInput } from '../src/modelInput.ts';
import { FAKE_PROVIDER_IDENTITY, legalProposalBytes } from './fixtures.ts';

export interface FakeProviderOptions {
  /** Resolve with these proposal bytes (default: the legal proposal). */
  readonly payload?: unknown;
  /** Resolve with typed unavailability instead of a proposal. */
  readonly unavailable?: { readonly reason: ProviderUnavailabilityReason; readonly detail: string };
  /** Reject the call (transport/hostile failure mapped to OUTAGE by the adapter). */
  readonly throwWith?: Error;
}

export interface DeterministicFakeProvider extends ModelProviderPort {
  /** Every redacted model input the provider received, in call order. */
  readonly requests: readonly RedactedModelInput[];
}

export function deterministicFakeProvider(
  options: FakeProviderOptions = {},
): DeterministicFakeProvider {
  const requests: RedactedModelInput[] = [];
  const identity: ProviderIdentity = FAKE_PROVIDER_IDENTITY;
  return {
    identity: identity,
    requests: requests,
    async propose(request: ProviderProposalRequest): Promise<ProviderProposalOutcome> {
      requests.push(request.input);
      if (options.throwWith !== undefined) {
        throw options.throwWith;
      }
      if (options.unavailable !== undefined) {
        return {
          kind: 'UNAVAILABLE',
          reason: options.unavailable.reason,
          detail: options.unavailable.detail,
        };
      }
      return { kind: 'PROPOSAL', payload: options.payload ?? legalProposalBytes() };
    },
  };
}
