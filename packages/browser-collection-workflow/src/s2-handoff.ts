/**
 * T016 S2 explicit-attachment handoff lane (PRD §28 S2, §29; frozen L2 §6.4).
 *
 * ONE composed flow carries an explicit current-page attachment from the
 * untrusted browser boundary to an authoritative Core acquisition:
 *
 *   untrusted message → message gate → provenance-bound ObservationRecord
 *   (EVIDENCE_INPUT_ONLY) → exit-sink-redacted handoff envelope → scoped
 *   broker capability bound to the exact (origin, target, contract, snapshot,
 *   provenance, partition, scope) tuple → exact-binding `use` → authoritative
 *   Core direct acquisition through the canonical budget ports → terminal
 *   truth only via the T007 projector.
 *
 * Composition order is the only decision made here. Every gate, handoff,
 * authorization and acquisition verdict is the verbatim upstream outcome and
 * propagates fail-closed without normalization. The browser lane contributes
 * evidence and intent only: it never owns transfer lifecycle, progress
 * authority or terminal truth, and observation records can never self-certify
 * validation claims.
 */

import {
  buildObservationHandoff,
  decodeUntrustedContentMessage,
  recordObservation,
  type BrowserDiagnostic,
  type ObservationHandoff,
  type ObservationRecord,
} from '@xdownload/browser-observation';
import type { AuthBroker, BrokerDiagnostic } from '@xdownload/browser-auth-broker';
import {
  bindLocator,
  makeEffectId,
  makeMemberId,
  unwrapOrThrow,
  type AcquisitionContract,
  type DomainValidationResult,
  type LocatorProvenance,
  type ProjectedTerminalResult,
  type ResourceLocator,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import type { DirectTransferRequest } from '@xdownload/direct-acquisition';
import {
  CoreRuntimeFlowError,
  executeDirectAcquisition,
  projectLineageResult,
  type CoreRuntime,
  type DirectFlowOutcome,
} from '@xdownload/core-runtime';
import {
  capabilityBindingFor,
  issueScopedCapability,
  useScopedCapability,
} from './auth-lifecycle.ts';

/** Observation-gate + record + handoff composition shared by every lane. */
export type ObservationLaneOutcome =
  | {
      readonly ok: true;
      readonly record: ObservationRecord;
      readonly handoff: ObservationHandoff;
    }
  | {
      readonly ok: false;
      readonly stage: 'OBSERVATION_GATE' | 'OBSERVATION_HANDOFF';
      readonly diagnostics: readonly BrowserDiagnostic[];
    };

/**
 * Gate one untrusted browser message, turn it into a provenance-bound
 * observation record and build the exit-sink-redacted handoff envelope. The
 * record and envelope remain EVIDENCE_INPUT_ONLY at every point — this
 * composition never promotes them to authority.
 */
export function composeObservationHandoff(input: {
  readonly raw: unknown;
  readonly observationId: string;
  readonly capturedAtMs: number;
}): ObservationLaneOutcome {
  const gated = decodeUntrustedContentMessage(input.raw);
  if (!gated.ok) {
    return { ok: false, stage: 'OBSERVATION_GATE', diagnostics: gated.diagnostics };
  }
  const recorded = recordObservation(gated.value, {
    observationId: input.observationId,
    capturedAtMs: input.capturedAtMs,
  });
  if (!recorded.ok) {
    return { ok: false, stage: 'OBSERVATION_GATE', diagnostics: recorded.diagnostics };
  }
  const handoff = buildObservationHandoff(recorded.value);
  if (!handoff.ok) {
    return { ok: false, stage: 'OBSERVATION_HANDOFF', diagnostics: handoff.diagnostics };
  }
  return { ok: true, record: recorded.value, handoff: handoff.value };
}

/**
 * Explicit issue decision for the S2 lane (least-authority TTL is mandatory).
 * No caller-asserted origin exists: the binding derives its origin from the
 * gated observation's handoff (`lane.handoff.origin`) — the only origin
 * authority in this lane.
 */
export interface S2AuthorizationInput {
  readonly partition?: string;
  readonly ttlMs: number;
  readonly issueDecisionToken: string;
}

export interface S2AttachmentFlowInput {
  readonly runtime: CoreRuntime;
  readonly broker: AuthBroker;
  /** The confirmed S2 contract (SINGLE_RESOURCE / single_resource scope). */
  readonly contract: AcquisitionContract;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly commandId: string;
  readonly observation: {
    readonly raw: unknown;
    readonly observationId: string;
    readonly capturedAtMs: number;
  };
  readonly authorization: S2AuthorizationInput;
  readonly delivery: {
    readonly locator: ResourceLocator;
    readonly provenance: LocatorProvenance;
    /** The only hosts a provenance-bound redirect/CDN hop may bind to (C29). */
    readonly declaredRedirectHosts: readonly string[];
    readonly expectedSha256: string;
    readonly expectedContentTypePrefix?: string;
  };
  readonly slice?: 'S1' | 'S3';
}

/** Typed, stage-labelled rejection; every diagnostic is the verbatim upstream one. */
export type S2HandoffRejection =
  | { readonly stage: 'OBSERVATION_GATE'; readonly diagnostics: readonly BrowserDiagnostic[] }
  | { readonly stage: 'OBSERVATION_HANDOFF'; readonly diagnostics: readonly BrowserDiagnostic[] }
  | { readonly stage: 'AUTHORIZATION_ISSUE'; readonly diagnostics: readonly BrokerDiagnostic[] }
  | {
      readonly stage: 'AUTHORIZATION_USE';
      readonly outcome: 'AUTH_REQUIRED' | 'AUTH_FAILED';
      readonly reasons: readonly BrokerDiagnostic[];
    }
  | {
      readonly stage: 'DELIVERY_LOCATOR';
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | { readonly stage: 'CORE_ACQUISITION'; readonly error: CoreRuntimeFlowError };

export type S2HandoffOutcome =
  | {
      readonly ok: true;
      readonly observation: ObservationRecord;
      readonly handoff: ObservationHandoff;
      /** Opaque AuthorizationContextRef — the only capability identity that crossed. */
      readonly authorizationContextRef: string;
      readonly capabilityStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
      readonly flow: DirectFlowOutcome;
    }
  | { readonly ok: false; readonly rejection: S2HandoffRejection };

/**
 * Run the composed S2 explicit-attachment flow. Fails closed at every stage:
 * gate → record → handoff → capability issue → exact-binding use →
 * delivery-locator binding → Core acquisition. An authorization rejection
 * never runs an acquisition and is never absorbed into a partial success.
 */
export async function runS2AttachmentFlow(input: S2AttachmentFlowInput): Promise<S2HandoffOutcome> {
  // 1–3. Untrusted gate → provenance-bound record → redacted handoff envelope.
  const lane = composeObservationHandoff(input.observation);
  if (!lane.ok) {
    return { ok: false, rejection: { stage: lane.stage, diagnostics: lane.diagnostics } };
  }
  // 4. Scoped capability bound to the exact tuple; only the opaque ref proceeds.
  const binding = capabilityBindingFor({
    authorization: {
      origin: lane.handoff.origin,
      target: input.contract.requestedTarget,
      provenanceChain: lane.handoff.provenanceKey,
      ...(input.authorization.partition === undefined
        ? {}
        : { partition: input.authorization.partition }),
    },
    contract: input.contract,
    snapshotId: input.snapshotId,
  });
  const issued = issueScopedCapability(
    input.broker,
    binding,
    input.authorization.ttlMs,
    input.authorization.issueDecisionToken,
  );
  if (!issued.ok) {
    return {
      ok: false,
      rejection: { stage: 'AUTHORIZATION_ISSUE', diagnostics: issued.diagnostics },
    };
  }
  // 5. Exact-binding use before any privilege (never nearest-match, never re-issue).
  const use = useScopedCapability(input.broker, issued.value.ref, binding);
  if (use.outcome !== 'AUTH_GRANTED') {
    return {
      ok: false,
      rejection: {
        stage: 'AUTHORIZATION_USE',
        outcome: use.outcome,
        reasons: use.reasons,
      },
    };
  }
  // 6. Delivery locator bound to the frozen identity with its provenance
  //    fact; a rejection is a typed lane failure, never an untyped throw.
  const locator = bindLocator(input.delivery.locator, input.contract.requestedTarget, {
    binding: input.delivery.provenance.binding,
    originLocatorUri: input.delivery.provenance.originLocatorUri,
  });
  if (!locator.ok) {
    return {
      ok: false,
      rejection: { stage: 'DELIVERY_LOCATOR', diagnostics: locator.diagnostics },
    };
  }
  // 7. Authoritative Core acquisition through the canonical budget ports.
  const transfer: DirectTransferRequest = {
    effectId: unwrapOrThrow(
      makeEffectId(
        `effect:${input.contract.contractId}:${input.snapshotId}:${input.contract.requestedTarget}`,
      ),
    ),
    contractId: input.contract.contractId,
    slice: input.slice ?? 'S1',
    selectedMemberId: unwrapOrThrow(makeMemberId(input.memberId)),
    binding: locator.value,
    expectedSha256: input.delivery.expectedSha256,
    ...(input.delivery.expectedContentTypePrefix === undefined
      ? {}
      : { expectedContentTypePrefix: input.delivery.expectedContentTypePrefix }),
    allowedRedirectHosts: input.delivery.declaredRedirectHosts,
    attempt: 0,
  };
  let flow: DirectFlowOutcome;
  try {
    flow = await executeDirectAcquisition(input.runtime, {
      contractId: input.contract.contractId,
      snapshotId: input.snapshotId,
      targetId: input.contract.requestedTarget,
      authorizationContextRef: issued.value.ref,
      budgetProfile: input.contract.budgetProfile,
      frozenMemberIds: [input.memberId],
      commandId: input.commandId,
      memberId: input.memberId,
      artifactId: input.artifactId,
      transfer,
    });
  } catch (error) {
    if (error instanceof CoreRuntimeFlowError) {
      return { ok: false, rejection: { stage: 'CORE_ACQUISITION', error } };
    }
    throw error;
  }
  return {
    ok: true,
    observation: lane.record,
    handoff: lane.handoff,
    authorizationContextRef: issued.value.ref,
    capabilityStatus: issued.value.status,
    flow,
  };
}

/** Provenance facts for the locator hops a composed flow actually took (C29/C07). */
export interface LocatorProvenanceFacts {
  readonly hops: readonly {
    readonly uri: string;
    readonly kind: string;
    readonly binding: string;
  }[];
  /** True when every recorded hop kept the same frozen logical target identity. */
  readonly identityPreservedAcrossHops: boolean;
}

/**
 * Record the flow's locator hops as provenance facts. This reads the
 * adapter's verbatim `locatorChain` output — it never rewrites locators,
 * identity or contract/snapshot identity.
 */
export function locatorProvenanceFacts(
  flow: DirectFlowOutcome,
): LocatorProvenanceFacts | undefined {
  const chain = flow.transfer?.locatorChain;
  if (chain === undefined || chain.length === 0) {
    return undefined;
  }
  const identity = chain[0]!.identity;
  return {
    hops: chain.map((hop) => ({
      uri: hop.locator.uri,
      kind: hop.locator.kind,
      binding: hop.provenance.binding,
    })),
    identityPreservedAcrossHops: chain.every((hop) => hop.identity === identity),
  };
}

/** Canonical projection inputs for one composed S2 flow (single-resource). */
export function projectS2Flow(input: {
  readonly runtime: CoreRuntime;
  readonly flow: DirectFlowOutcome;
  readonly contract: AcquisitionContract;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly recordedAt: string;
}): DomainValidationResult<ProjectedTerminalResult> {
  return projectLineageResult(input.runtime, {
    lineageKey: input.flow.lineageKey,
    contractId: input.contract.contractId,
    snapshotId: input.snapshotId,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [input.memberId],
    recordedAt: input.recordedAt,
    enumeration: { kind: 'NOT_APPLICABLE' },
  });
}
