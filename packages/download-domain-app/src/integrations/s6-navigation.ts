/**
 * v0.2 T12 — S6 explicit collection journey under K (integration-other lane;
 * write set packages/download-domain-app/src/integrations/** only).
 *
 * The release-claimed S6 ("Explicit Playlist / Gallery Collection", T10
 * DESCRIPTOR_REGISTRY_MATCH) connected to K as one deterministic chain. The
 * slice's scope primitive is the EXPLICIT member set: there is no discovery
 * and no recipe here — the declared finite set IS the scope, and the journey's
 * only decision is identity correspondence between that declared set and the
 * caller's batch confirmation (PRD-§11/§19: completion requires identity
 * correspondence, never count equality):
 *
 *   1. DECODE — the explicitly declared member set is decoded through the T05
 *      finite-membership decoder (`decodeFiniteMemberSet`): canonical order,
 *      duplicate-free, bounded, empty refused. This IS the T05 deterministic
 *      contribution to S6 — a scope that cannot widen, truncate or reorder.
 *   2. CONFIRM — the caller's batch confirmation must cover EXACTLY the
 *      declared set, each member exactly once:
 *        - a member outside the declared set is an over-selection REFUSAL
 *          (a confirmation can never add members);
 *        - a duplicate reference is a confirmation-drift REFUSAL (one batch
 *          covers every member exactly once — the frozen S6 engine
 *          discipline);
 *        - a strict subset re-asks: the declared collection scope is
 *          unchanged, so the journey returns the BATCH_GROUP plan for the
 *          FULL declared set with ZERO effects (a partial batch is never
 *          silently promoted to the declared scope);
 *        - without facts the journey returns that same plan and stops.
 *   3. SUBMIT — every declared member becomes ONE T01 confirmed intent (S1 /
 *      acquisition.acquire) submitted through the T11 direct journey, in
 *      canonical order, each exactly once, with delivery facts declared for
 *      exactly the declared set.
 *
 * No navigation, crawl or continuation exists on this entry: the declared
 * page-range navigation bound of the v0.1 lane lives upstream of this scope
 * (the declared members), and `assertContinuationWithinFrozenScope`
 * semantics are honored by construction — continuation is NONE here, and a
 * confirmed member set can never grow.
 *
 * Honest status (T10 baseline vocabulary): PROVEN at logical-chain +
 * bounded-fixture level. The real installed browser session belongs to T15
 * validation-browser and is NOT_PROVEN here by design.
 */
import {
  decodeFiniteMemberSet,
  buildConfirmationPlan,
  type FiniteMemberSet,
  type SemanticConfirmationPlan,
} from '../semantic/index.ts';
import type { DownloadRuntime } from '../composition/runtime.ts';
import {
  buildDirectIntentCandidate,
  intentCandidateDiagnostics,
  submitConfirmedMembers,
  validateBatchConfirmation,
  type SliceBatchConfirmationFacts,
  type SliceCallerIdentity,
  type SliceCollectionSummary,
  type SliceJourneyRefusal,
  type SliceMemberDeliveryFacts,
  type SliceMemberOutcome,
} from './slice-journey-shared.ts';

export interface S6NavigationJourneyRequest {
  /** The explicitly declared finite member set (the whole S6 scope). */
  readonly scope: unknown;
  /** Explicit batch ratification of the declared set. */
  readonly confirmation?: SliceBatchConfirmationFacts;
  /** One shared collection lineage id (T01 grammar). */
  readonly lineageId: string;
  /** Absolute authorized output root every member artifact materializes in. */
  readonly outputRootScope: string;
  /** Delivery facts keyed by member id; keys must equal the declared set. */
  readonly members: Readonly<Record<string, SliceMemberDeliveryFacts>>;
  readonly caller: SliceCallerIdentity;
}

/** A truthful S6 journey outcome; non-submission branches are zero-effect. */
export type S6NavigationOutcome =
  | {
      /** The declared set awaits (full) batch ratification: plan, zero effects. */
      readonly status: 'needs-confirmation';
      readonly reason: 'AWAITING_BATCH_CONFIRMATION' | 'INCOMPLETE_BATCH';
      readonly plan: SemanticConfirmationPlan;
      readonly declaredMemberIds: readonly string[];
    }
  | SliceJourneyRefusal
  | {
      readonly status: 'completed-collection';
      readonly declaredMemberIds: readonly string[];
      readonly members: readonly SliceMemberOutcome[];
      readonly summary: SliceCollectionSummary;
    };

/**
 * Run the S6 explicit-collection journey. All members are pre-validated
 * BEFORE the first submission; every non-submission branch performs zero
 * network, zero K admission and zero durable state.
 */
export async function runS6NavigationJourney(
  runtime: DownloadRuntime,
  request: S6NavigationJourneyRequest,
): Promise<S6NavigationOutcome> {
  // (1) Decode the explicit declared set (canonical, bounded, duplicate-free).
  const decoded = decodeFiniteMemberSet(request.scope);
  if (!decoded.ok) {
    return {
      status: 'refused',
      code: 'DECLARED_SCOPE_INVALID',
      message: `declared explicit member set refused: ${decoded.diagnostics.map((entry) => entry.code).join(',')}`,
    };
  }
  const declared: FiniteMemberSet = decoded.value;
  const members_ = declared.memberIds;
  const scopeKey = declared.collectionId ?? 's6-explicit-collection';

  // (2) Identity correspondence between the declared set and the batch.
  if (request.confirmation === undefined) {
    return {
      status: 'needs-confirmation',
      reason: 'AWAITING_BATCH_CONFIRMATION',
      plan: buildConfirmationPlan({ reason: 'AMBIGUOUS_TIE', memberIds: members_, scopeKey }),
      declaredMemberIds: members_,
    };
  }
  const foreignCheck = batchReferencesWithinDeclaredSet(request.confirmation, members_);
  if (!foreignCheck.ok) {
    return { status: 'refused', code: foreignCheck.code, message: foreignCheck.message };
  }
  const batchCheck = validateBatchConfirmation(request.confirmation, members_);
  if (!batchCheck.ok) {
    if (batchCheck.code === 'CONFIRMATION_SET_MISMATCH') {
      // All references were in-scope and unique (checked above): the batch
      // was a strict subset — re-ask for the FULL declared set, zero effects.
      return {
        status: 'needs-confirmation',
        reason: 'INCOMPLETE_BATCH',
        plan: buildConfirmationPlan({ reason: 'AMBIGUOUS_TIE', memberIds: members_, scopeKey }),
        declaredMemberIds: members_,
      };
    }
    return { status: 'refused', code: batchCheck.code, message: batchCheck.message };
  }

  // (3) Delivery facts must cover EXACTLY the declared set.
  const factsByKey = request.members;
  const declaredSet = new Set<string>(members_);
  for (const key of Object.keys(factsByKey)) {
    if (!declaredSet.has(key)) {
      return {
        status: 'refused',
        code: 'MEMBER_FACTS_OUTSIDE_DECLARED_SET',
        message: `delivery facts declared for member '${key}' outside the explicit declared set; facts for undeclared members are latent scope widening`,
      };
    }
  }
  for (const member of members_) {
    if (factsByKey[member] === undefined) {
      return {
        status: 'refused',
        code: 'MEMBER_FACTS_INCOMPLETE',
        message: `no delivery facts declared for declared member '${member}'; a declared member must be resolvable, never silently dropped`,
      };
    }
  }

  // (4) Pre-validate EVERY member intent before the first submission.
  const candidates = members_.map((memberId) => {
    const facts = factsByKey[memberId]!;
    return {
      memberId,
      candidate: buildDirectIntentCandidate({
        requestId: facts.requestId,
        lineageId: request.lineageId,
        targetRef: facts.targetRef,
        outputRootScope: request.outputRootScope,
        ...(facts.digestAnchor === undefined ? {} : { digestAnchor: facts.digestAnchor }),
        ...(facts.declaredBytes === undefined ? {} : { declaredBytes: facts.declaredBytes }),
        caller: request.caller,
      }),
    };
  });
  for (const entry of candidates) {
    const diagnostics = intentCandidateDiagnostics(entry.candidate);
    if (diagnostics.length > 0) {
      return {
        status: 'refused',
        code: 'MEMBER_INTENT_INVALID',
        message: `member '${entry.memberId}' intent refused before any submission: ${diagnostics.join(',')}`,
      };
    }
  }

  // (5) Submit each declared member once, canonical order, under K.
  const { members, summary } = await submitConfirmedMembers(runtime, candidates);
  return { status: 'completed-collection', declaredMemberIds: members_, members, summary };
}

/**
 * S6 pre-check: every batch reference must belong to the declared set and
 * appear exactly once. This runs BEFORE the shared batch validation so an
 * out-of-scope member is reported as an over-selection refusal and a
 * duplicate as confirmation drift — only a genuine strict subset then
 * remains for the re-ask branch. A confirmation can never add members and
 * never replay a member twice.
 */
function batchReferencesWithinDeclaredSet(
  facts: unknown,
  declared: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) {
    return { ok: true }; // (shape errors are reported by the shared validator)
  }
  const refs = (facts as Record<string, unknown>)['memberRefs'];
  if (!Array.isArray(refs)) {
    return { ok: true };
  }
  const declaredSet = new Set(declared);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== 'string') {
      continue; // (shape errors are reported by the shared validator)
    }
    if (!declaredSet.has(ref)) {
      return {
        ok: false,
        code: 'CONFIRMATION_MEMBER_OUTSIDE_DECLARED_SCOPE',
        message: `confirmed member '${ref}' is outside the explicitly declared collection scope; a confirmation can never add members to a declared set`,
      };
    }
    if (seen.has(ref)) {
      return {
        ok: false,
        code: 'CONFIRMATION_SET_MISMATCH',
        message: `confirmed member '${ref}' appears more than once; a batch covers every declared member exactly once`,
      };
    }
    seen.add(ref);
  }
  return { ok: true };
}
