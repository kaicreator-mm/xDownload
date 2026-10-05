/**
 * T016 authorization-lifecycle composition adapter.
 *
 * The broker (@xdownload/browser-auth-broker) is the ONLY authorization
 * authority. This adapter composes its public issue/use/revoke/inspect API
 * into the workflow lanes and translates the broker's TYPED outcomes into
 * canonical StopFacts fields — a factual translation of upstream facts, never
 * a decision: every verdict (AUTH_GRANTED / AUTH_REQUIRED / AUTH_FAILED) is
 * the verbatim broker outcome, and no glue path re-issues, extends, widens or
 * silently re-authorizes a capability (frozen L2 invariants 12–14, PRD §17).
 *
 * Only the opaque AuthorizationContextRef ever leaves the broker toward Core;
 * the exact (origin, target, contract, snapshot, provenance, partition,
 * scope) binding tuple is built from canonical contract/snapshot identity
 * (`scopeIdentityKey` — the confirmed requested-scope identity key, never
 * rewritten by glue).
 */

import {
  scopeIdentityKey,
  type AcquisitionContract,
  type StopFacts,
} from '@xdownload/domain-contracts';
import type {
  AuthBroker,
  AuthUseOutcome,
  BrokerResult,
  CapabilityBinding,
  CapabilityView,
} from '@xdownload/browser-auth-broker';

/** Canonical facts one scoped capability binds to (exact tuple, PRD §17/§29). */
export interface ScopedAuthorizationFacts {
  /** Exact observed origin the capability is bound to. */
  readonly origin: string;
  /** Exact logical target identity (branded or raw canonical id string). */
  readonly target: string;
  /** Exact observation provenance chain identity (e.g. the handoff provenance key). */
  readonly provenanceChain: string;
  /** Partition context when the browser state is partition-aware. */
  readonly partition?: string;
}

/**
 * Build the exact capability binding tuple for one authorization use, from
 * canonical identity inputs only. `requestedScopeKey` is the canonical
 * `scopeIdentityKey` of the confirmed contract's requested scope — the
 * confirmed scope recorded at issue time is never redefined here.
 */
export function capabilityBindingFor(input: {
  readonly authorization: ScopedAuthorizationFacts;
  readonly contract: AcquisitionContract;
  readonly snapshotId: string;
}): CapabilityBinding {
  return Object.freeze({
    origin: input.authorization.origin,
    target: input.authorization.target,
    contract: input.contract.contractId,
    snapshot: input.snapshotId,
    provenanceChain: input.authorization.provenanceChain,
    partition: input.authorization.partition,
    requestedScopeKey: scopeIdentityKey(input.contract.requestedScope),
  });
}

/** Issue one expiring scoped capability from an explicit issue decision. */
export function issueScopedCapability(
  broker: AuthBroker,
  binding: CapabilityBinding,
  ttlMs: number,
  issueDecisionToken: string,
): BrokerResult<CapabilityView> {
  return broker.issue({ binding, ttlMs, issueDecisionToken });
}

/** Attempt a privileged authorization use against the exact current tuple. */
export function useScopedCapability(
  broker: AuthBroker,
  ref: string,
  binding: CapabilityBinding,
): AuthUseOutcome {
  return broker.use({ ref, binding });
}

/** Revoke a capability; later uses fail while recorded history stays intact. */
export function revokeScopedCapability(broker: AuthBroker, ref: string): BrokerResult<'REVOKED'> {
  return broker.revoke(ref);
}

/** Truthful point-in-time capability status (expiry is surfaced, never hidden). */
export function inspectCapability(broker: AuthBroker, ref: string): BrokerResult<CapabilityView> {
  return broker.inspect(ref);
}

/**
 * Factual translation of the broker's typed use outcome into canonical
 * StopFacts fields. AUTH_REQUIRED and AUTH_FAILED surface truthfully; a
 * grant contributes no stop fact. This never normalizes a denial into
 * success — the composed flow turns these facts into AUTH-influenced partials
 * through the canonical projector only.
 */
export function authStopFactsFromUse(outcome: AuthUseOutcome): StopFacts {
  if (outcome.outcome === 'AUTH_FAILED') {
    return { authFailed: true };
  }
  if (outcome.outcome === 'AUTH_REQUIRED') {
    return { authRequired: true };
  }
  return {};
}
