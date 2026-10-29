/**
 * v0.2 T12 — shared mechanics of the S2/S5/S6 semantic slice journeys
 * (integration-other lane; write set
 * packages/download-domain-app/src/integrations/** only).
 *
 * The non-direct slices converge on K through ONE deterministic chain:
 *
 *   finite declared members + declared facts → T05 deterministic evaluation
 *   (any ambiguity ⇒ confirmation plan, zero effects) → explicit caller
 *   confirmation facts binding EXACTLY the deterministic outcome → per-member
 *   T01 confirmed intents submitted through the T11 direct journey.
 *
 * This module owns the shared vocabulary of that chain:
 *
 *   - the confirmation-plan constructor for a DECIDED outcome (the T05
 *     SemanticConfirmationRequest levels reused verbatim: a single selected
 *     member is one MATERIAL_ITEM request; a selected/declared member set is
 *     one BATCH_GROUP request — never per-item interrogation);
 *   - the closed confirmation-facts → T01 intent-candidate constructor (the
 *     T08 payload-construction discipline: a closed input interface with no
 *     browser-context field, explicit per-field copying — no spread, no
 *     generic key copy — so an unknown key on a caller object can never
 *     reach a confirmed intent);
 *   - the per-member submission driver over the T11 direct journey with the
 *     honest collection summary (COMPLETE only when every confirmed member
 *     settled completed; partial failures are never absorbed).
 *
 * Authorization stays on the T01 contract: every effectful leg is an S1 /
 * acquisition.acquire confirmed intent (the T01 direct vocabulary), gated by
 * `validateConfirmedIntent` BEFORE any submission — the same gate the T11
 * journey re-runs inside.
 *
 * Honest status (T10 baseline vocabulary): the S2/S5/S6 entries built here
 * are PROVEN at logical-chain + bounded-fixture level (real loopback bytes,
 * real K permits/journals). Real installed browser sessions belong to T15
 * validation-browser and are NOT_PROVEN here by design.
 */
import { validateConfirmedIntent } from '../contracts/index.ts';
import type { DownloadRuntime } from '../composition/runtime.ts';
import { submitConfirmedDownload, type SubmissionOutcome } from '../composition/journey.ts';
import type { SemanticConfirmationPlan, SemanticConfirmationRequest } from '../semantic/index.ts';

/** Bounded caller identity riding every confirmed intent (T01 grammar). */
export interface SliceCallerIdentity {
  readonly actor: string;
  readonly sessionRef: string;
}

/**
 * The only effectful authorization the S2/S5/S6 entries submit: the T01
 * direct vocabulary (single direct transfer, slice S1). Media members are the
 * S3 journey's authority, not these slices'.
 */
export const SLICE_DIRECT_BINDING = {
  allowedOperation: 'acquisition.acquire',
  slice: 'S1',
} as const;

/**
 * Per-member delivery facts the caller declares up front (finite, closed).
 * `digestAnchor` and `declaredBytes` are REQUIRED by the sealed download
 * composition: its B policy projects the FULL T01 field set, so a member
 * intent without them can never dispatch — declared here explicitly instead
 * of failing behind the K facade.
 */
export interface SliceMemberDeliveryFacts {
  /** Explicit occurrence id for this member's confirmed intent. */
  readonly requestId: string;
  /** Opaque Host-resolvable target token; raw locators are refused. */
  readonly targetRef: string;
  /** Required by the sealed policy projection: lowercase 64-hex digest. */
  readonly digestAnchor: string;
  /** Required by the sealed policy projection (≤ the 1 MiB profile bound). */
  readonly declaredBytes: number;
}

/** A typed refusal that happened BEFORE any K admission (zero effects). */
export interface SliceJourneyRefusal {
  readonly status: 'refused';
  readonly code: string;
  readonly message: string;
}

/**
 * Build the confirmation plan for an ALREADY-DECIDED deterministic outcome:
 * the caller must ratify exactly the decided member(s). This reuses the T05
 * confirmation-request levels (MATERIAL_ITEM for one member, BATCH_GROUP for
 * a member set); per-item interrogation is never the default path (C30).
 */
export function decidedOutcomePlan(memberIds: readonly string[]): SemanticConfirmationPlan {
  const requests: readonly SemanticConfirmationRequest[] =
    memberIds.length === 1
      ? [{ level: 'MATERIAL_ITEM', memberRef: memberIds[0]! }]
      : [{ level: 'BATCH_GROUP', memberRefs: [...memberIds] }];
  return { requests, perItemInterrogationUsed: false };
}

/** The closed batch confirmation-facts shape shared by S5/S6. */
export interface SliceBatchConfirmationFacts {
  /** Exactly one batch claim covering every decided member exactly once. */
  readonly kind: 'BATCH';
  readonly confirmationType: 'CONFIRM_SELECTION';
  readonly memberRefs: readonly string[];
}

/**
 * Validate batch confirmation facts against the decided member set: one
 * BATCH claim of type CONFIRM_SELECTION covering EXACTLY the decided set,
 * each member exactly once (the frozen S5/S6 engine discipline — conflicting
 * or multiple claims are never silently replayed as one approved group).
 * Returns the sorted decided set on success, a refusal code otherwise.
 */
export function validateBatchConfirmation(
  facts: unknown,
  decided: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) {
    return {
      ok: false,
      code: 'CONFIRMATION_MALFORMED',
      message: 'batch confirmation facts must be a plain object',
    };
  }
  const record = facts as Record<string, unknown>;
  if (record['kind'] !== 'BATCH' || record['confirmationType'] !== 'CONFIRM_SELECTION') {
    return {
      ok: false,
      code: 'CONFIRMATION_MALFORMED',
      message: "batch confirmation requires kind 'BATCH' and confirmationType 'CONFIRM_SELECTION'",
    };
  }
  const refs = record['memberRefs'];
  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string')) {
    return {
      ok: false,
      code: 'CONFIRMATION_MALFORMED',
      message: 'batch confirmation memberRefs must be an array of member ids',
    };
  }
  const memberRefs = refs as readonly string[];
  const decidedSet = new Set(decided);
  const seen = new Set<string>();
  for (const ref of memberRefs) {
    if (!decidedSet.has(ref)) {
      return {
        ok: false,
        code: 'CONFIRMATION_MEMBER_OUTSIDE_DECIDED_SET',
        message: `confirmed member '${ref}' is outside the deterministic decided set; a confirmation can never widen the decided scope`,
      };
    }
    if (seen.has(ref)) {
      return {
        ok: false,
        code: 'CONFIRMATION_SET_MISMATCH',
        message: `confirmed member '${ref}' appears more than once; a batch covers every member exactly once`,
      };
    }
    seen.add(ref);
  }
  if (memberRefs.length !== decided.length) {
    return {
      ok: false,
      code: 'CONFIRMATION_SET_MISMATCH',
      message: `batch confirmation covers ${memberRefs.length} of ${String(decided.length)} decided members; the decided set must be covered exactly`,
    };
  }
  return { ok: true };
}

/**
 * Construct ONE T01 confirmed-intent candidate for one confirmed member.
 * Explicit per-field construction is the whitelist (T08 discipline): the
 * input is the closed facts interface, browser context has no representation,
 * and unknown keys on any caller object cannot propagate.
 */
export function buildDirectIntentCandidate(input: {
  readonly requestId: string;
  readonly lineageId: string;
  readonly targetRef: string;
  readonly outputRootScope: string;
  readonly digestAnchor?: string;
  readonly declaredBytes?: number;
  readonly caller: SliceCallerIdentity;
}): Record<string, unknown> {
  return {
    requestId: input.requestId,
    lineageId: input.lineageId,
    targetRef: input.targetRef,
    outputRootScope: input.outputRootScope,
    allowedOperation: SLICE_DIRECT_BINDING.allowedOperation,
    slice: SLICE_DIRECT_BINDING.slice,
    ...(input.digestAnchor === undefined ? {} : { digestAnchor: input.digestAnchor }),
    ...(input.declaredBytes === undefined ? {} : { declaredBytes: input.declaredBytes }),
    caller: { actor: input.caller.actor, sessionRef: input.caller.sessionRef },
  };
}

/**
 * Pre-send refusal diagnostics for one candidate: the canonical T01 gate plus
 * the sealed composition's profile projection requirement (digestAnchor and
 * declaredBytes must be present — the sealed B projects the full field set).
 */
export function intentCandidateDiagnostics(candidate: unknown): readonly string[] {
  const check = validateConfirmedIntent(candidate);
  if (!check.ok) {
    return check.diagnostics.map((entry) => entry.code);
  }
  const missing: string[] = [];
  if (check.value.digestAnchor === undefined) {
    missing.push('PROFILE_DIGEST_ANCHOR_REQUIRED');
  }
  if (check.value.declaredBytes === undefined) {
    missing.push('PROFILE_DECLARED_BYTES_REQUIRED');
  }
  return missing;
}

/** One member's settled journey outcome (typed T11 result, verbatim). */
export interface SliceMemberOutcome {
  readonly memberId: string;
  readonly requestId: string;
  readonly outcome: SubmissionOutcome;
}

/** Honest per-member accounting; COMPLETE is never claimed from counts alone. */
export interface SliceCollectionSummary {
  readonly requested: number;
  readonly completed: number;
  readonly replayed: number;
  readonly failed: number;
  /** COMPLETE only when EVERY confirmed member settled completed. */
  readonly collectionStatus: 'COMPLETE' | 'PARTIAL' | 'FAILED';
}

/**
 * Submit the already-confirmed per-member intents through the T11 direct
 * journey, in the canonical order given. Every member is attempted exactly
 * once (no retry, no re-ordering); per-member terminal outcomes are returned
 * verbatim so coverage truth stays per-member evidence, never a count.
 */
export async function submitConfirmedMembers(
  runtime: DownloadRuntime,
  members: readonly { readonly memberId: string; readonly candidate: Record<string, unknown> }[],
  options: { readonly messageIdPrefix?: string } = {},
): Promise<{
  readonly members: readonly SliceMemberOutcome[];
  readonly summary: SliceCollectionSummary;
}> {
  const outcomes: SliceMemberOutcome[] = [];
  for (const member of members) {
    const outcome = await submitConfirmedDownload(runtime, member.candidate, {
      ...(options.messageIdPrefix === undefined
        ? {}
        : { messageId: `${options.messageIdPrefix}-${member.memberId}` }),
    });
    outcomes.push({
      memberId: member.memberId,
      requestId: member.candidate['requestId'] as string,
      outcome,
    });
  }
  const completed = outcomes.filter((entry) => entry.outcome.status === 'completed').length;
  const replayed = outcomes.filter((entry) => entry.outcome.status === 'replayed').length;
  const failed = outcomes.length - completed - replayed;
  const summary: SliceCollectionSummary = {
    requested: outcomes.length,
    completed,
    replayed,
    failed,
    collectionStatus:
      completed === outcomes.length ? 'COMPLETE' : completed === 0 ? 'FAILED' : 'PARTIAL',
  };
  return { members: outcomes, summary };
}
