/**
 * v0.2 T12 — S5 current-page collection journey under K (integration-other
 * lane; write set packages/download-domain-app/src/integrations/** only).
 *
 * The release-claimed S5 ("Current-page Resource Collection", T10
 * DESCRIPTOR_REGISTRY_MATCH) connected to K as one deterministic chain over
 * the merged T05 semantic lane:
 *
 *   1. DECODE + EVALUATE — the declared finite current-page member set, the
 *      declarative recipe and the declared observation facts are decoded and
 *      evaluated deterministically (`evaluateRecipe`). The FULL-MATCH set
 *      (`matchedMemberIds`, canonical order) IS the deterministic collection:
 *      a collection is not a single-target selection, so multi-match is the
 *      expected shape, never an ambiguity.
 *   2. CONFIRM — zero matches is insufficient decisive evidence: the T05
 *      MANUAL_SELECTION_UI plan is returned with ZERO effects. With matches,
 *      the caller's batch confirmation facts must be ONE BATCH claim of type
 *      CONFIRM_SELECTION covering EXACTLY the matched set, each member
 *      exactly once (the frozen S5 engine discipline: BATCH [A,A] + SINGLE
 *      [B] must never authorize [A,B]); anything else refuses or re-asks
 *      with zero effects. Without facts the journey returns the decided
 *      BATCH_GROUP plan and stops.
 *   3. SUBMIT — each confirmed member becomes ONE T01 confirmed intent (S1 /
 *      acquisition.acquire) submitted through the T11 direct journey, in
 *      canonical order, each exactly once. Delivery facts must be declared
 *      for EXACTLY the confirmed set — a fact for an unconfirmed member is
 *      latent scope widening and refuses before any submission.
 *
 * Coverage honesty (PRD-§17/§19): the journey returns per-member terminal
 * evidence and a summary whose COMPLETE requires EVERY confirmed member to
 * have settled completed — count equality, page limits and timeouts are never
 * coverage closure; a failed member is never absorbed into a complete claim.
 *
 * No-widening facts: finite declared members only; authorization on the T01
 * contract; browser context has zero representation (closed confirmation
 * interface, field-by-field intent construction — the T08 discipline).
 *
 * Honest status (T10 baseline vocabulary): PROVEN at logical-chain +
 * bounded-fixture level. The real installed browser session belongs to T15
 * validation-browser and is NOT_PROVEN here by design.
 */
import type { DownloadRuntime } from '../composition/runtime.ts';
import {
  decodeSemanticLaneRequest,
  evaluateRecipe,
  buildConfirmationPlan,
  type SemanticConfirmationPlan,
} from '../semantic/index.ts';
import {
  buildDirectIntentCandidate,
  decidedOutcomePlan,
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

export interface S5CollectionJourneyRequest {
  /** Declared finite current-page members + recipe + declared facts (T05). */
  readonly semantic: {
    readonly recipe: unknown;
    readonly scope: unknown;
    readonly observations: readonly unknown[];
  };
  /** Explicit batch ratification of the deterministic matched set. */
  readonly confirmation?: SliceBatchConfirmationFacts;
  /** One shared collection lineage id (T01 grammar). */
  readonly lineageId: string;
  /** Absolute authorized output root every member artifact materializes in. */
  readonly outputRootScope: string;
  /** Delivery facts keyed by member id; keys must equal the confirmed set. */
  readonly members: Readonly<Record<string, SliceMemberDeliveryFacts>>;
  readonly caller: SliceCallerIdentity;
}

/** A truthful S5 journey outcome; non-submission branches are zero-effect. */
export type S5CollectionOutcome =
  | {
      /** Zero decisive evidence (or facts not yet given): plan, zero effects. */
      readonly status: 'needs-confirmation';
      readonly reason: 'INSUFFICIENT_EVIDENCE' | 'AWAITING_BATCH_CONFIRMATION';
      readonly plan: SemanticConfirmationPlan;
      /** The deterministic matched set the plan asks the caller to ratify. */
      readonly matchedMemberIds: readonly string[];
    }
  | SliceJourneyRefusal
  | {
      readonly status: 'completed-collection';
      readonly matchedMemberIds: readonly string[];
      readonly members: readonly SliceMemberOutcome[];
      readonly summary: SliceCollectionSummary;
    };

/**
 * Run the S5 current-page collection journey. All members are pre-validated
 * BEFORE the first submission (an invalid member refuses the whole journey
 * with zero effects — never a half-submitted collection).
 */
export async function runS5CollectionJourney(
  runtime: DownloadRuntime,
  request: S5CollectionJourneyRequest,
): Promise<S5CollectionOutcome> {
  // (1) Decode + deterministic evaluation over the declared finite scope.
  const decoded = decodeSemanticLaneRequest(request.semantic);
  if (!decoded.ok) {
    return {
      status: 'refused',
      code: 'SEMANTIC_REQUEST_INVALID',
      message: `declared semantic inputs refused: ${decoded.diagnostics.map((entry) => entry.code).join(',')}`,
    };
  }
  const evaluation = evaluateRecipe(
    decoded.value.recipe,
    decoded.value.scope,
    decoded.value.observations,
  );
  if (!evaluation.ok) {
    return {
      status: 'refused',
      code: 'SEMANTIC_EVALUATION_REFUSED',
      message: `semantic evaluation refused: ${evaluation.diagnostics.map((entry) => entry.code).join(',')}`,
    };
  }
  const matched = evaluation.value.matchedMemberIds;

  // (2) Confirmation: zero matches ⇒ MANUAL_SELECTION_UI; otherwise exactly
  //     one BATCH claim covering the matched set.
  if (matched.length === 0) {
    const scopeKey = evaluation.value.evaluationScope.collectionId ?? evaluation.value.recipeId;
    return {
      status: 'needs-confirmation',
      reason: 'INSUFFICIENT_EVIDENCE',
      plan: buildConfirmationPlan({
        reason: 'INSUFFICIENT_EVIDENCE',
        memberIds: evaluation.value.evaluationScope.memberIds,
        scopeKey,
      }),
      matchedMemberIds: matched,
    };
  }
  if (request.confirmation === undefined) {
    return {
      status: 'needs-confirmation',
      reason: 'AWAITING_BATCH_CONFIRMATION',
      plan: decidedOutcomePlan(matched),
      matchedMemberIds: matched,
    };
  }
  const batchCheck = validateBatchConfirmation(request.confirmation, matched);
  if (!batchCheck.ok) {
    return { status: 'refused', code: batchCheck.code, message: batchCheck.message };
  }

  // (3) Delivery facts must cover EXACTLY the confirmed set (no latent
  //     widening through facts for unconfirmed members, no unresolvable
  //     confirmed member).
  const factsByKey = request.members;
  const factKeys = Object.keys(factsByKey);
  const matchedSet = new Set<string>(matched);
  for (const key of factKeys) {
    if (!matchedSet.has(key)) {
      return {
        status: 'refused',
        code: 'MEMBER_FACTS_OUTSIDE_CONFIRMED_SET',
        message: `delivery facts declared for member '${key}' which the confirmation did not confirm; facts for unconfirmed members are latent scope widening`,
      };
    }
  }
  for (const member of matched) {
    if (factsByKey[member] === undefined) {
      return {
        status: 'refused',
        code: 'MEMBER_FACTS_INCOMPLETE',
        message: `no delivery facts declared for confirmed member '${member}'; a confirmed member must be resolvable, never silently dropped`,
      };
    }
  }

  // (4) Pre-validate EVERY member intent before the first submission.
  const candidates = matched.map((memberId) => {
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

  // (5) Submit each confirmed member once, canonical order, under K.
  const { members, summary } = await submitConfirmedMembers(runtime, candidates);
  return { status: 'completed-collection', matchedMemberIds: matched, members, summary };
}
