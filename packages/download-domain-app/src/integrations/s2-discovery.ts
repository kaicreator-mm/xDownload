/**
 * v0.2 T12 — S2 discovery/attachment journey under K (integration-other
 * lane; write set packages/download-domain-app/src/integrations/** only).
 *
 * The release-claimed S2 ("Browser Download Handoff / Explicit Current-page
 * Attachment", T10 DESCRIPTOR_REGISTRY_MATCH) connected to K as one
 * deterministic chain over the merged T05 semantic lane:
 *
 *   1. DECODE — the declared finite current-page member set, the declarative
 *      recipe and the declared observation facts are decoded through the T05
 *      exact-key decoders (`decodeSemanticLaneRequest`). Nothing here
 *      discovers its own scope: the member set is handed in, finite and
 *      bounded (T05 `DECLARED_FINITE_SET`, MAX_FINITE_MEMBERS cap).
 *   2. EVALUATE — `runSemanticLaneNoLlm` (the zero-LLM default path; no
 *      advisory port exists on this entry). Any ambiguity — AMBIGUOUS_TIE or
 *      INSUFFICIENT_EVIDENCE — routes to the T05 confirmation plan with ZERO
 *      effects; the lane never silently chooses.
 *   3. CONFIRM — a unique SELECTED member proceeds only with explicit caller
 *      confirmation facts binding EXACTLY that member (a different member is
 *      an over-selection refusal). Without facts the journey returns the
 *      decided plan (one MATERIAL_ITEM confirmation request) and stops.
 *   4. SUBMIT — the confirmed attachment becomes ONE T01 confirmed intent
 *      (S1 / acquisition.acquire, the T01 direct vocabulary) submitted
 *      through the T11 `submitConfirmedDownload` journey: one K send, one
 *      permit, digest-backed terminal evidence or a truthful failure.
 *
 * No-widening facts: the member set stays finite; authorization follows the
 * T01 contract; browser context has ZERO representation (the confirmation
 * facts interface is closed and the intent candidate is built field-by-field
 * — the T08 payload-construction discipline).
 *
 * Honest status (T10 baseline vocabulary): this entry is PROVEN at
 * logical-chain + bounded-fixture level (real loopback bytes, real K
 * permit/journal). The real installed browser session belongs to T15
 * validation-browser and is NOT_PROVEN here by design.
 */
import type { DownloadRuntime } from '../composition/runtime.ts';
import { submitConfirmedDownload, type SubmissionOutcome } from '../composition/journey.ts';
import {
  decodeSemanticLaneRequest,
  runSemanticLaneNoLlm,
  type SemanticConfirmationPlan,
  type SelectionAmbiguityReason,
} from '../semantic/index.ts';
import {
  buildDirectIntentCandidate,
  decidedOutcomePlan,
  intentCandidateDiagnostics,
  type SliceCallerIdentity,
  type SliceJourneyRefusal,
} from './slice-journey-shared.ts';

/** The declared semantic inputs (decoded through the T05 exact-key decoders). */
export interface S2SemanticInput {
  readonly recipe: unknown;
  readonly scope: unknown;
  readonly observations: readonly unknown[];
}

/**
 * Closed confirmation facts for one explicit attachment decision. There is no
 * field for cookies, tabs, history, page URLs or any other browser context;
 * the constructor copies the download fields explicitly one by one (T08).
 * `digestAnchor`/`declaredBytes` are required by the sealed composition's
 * full-field-set policy projection (see slice-journey-shared).
 */
export interface S2ConfirmationFacts {
  /** Must be EXACTLY the member the deterministic lane selected. */
  readonly confirmedMemberId: string;
  readonly requestId: string;
  readonly lineageId: string;
  readonly targetRef: string;
  readonly outputRootScope: string;
  /** Required by the sealed policy projection: lowercase 64-hex digest. */
  readonly digestAnchor: string;
  /** Required by the sealed policy projection (≤ the 1 MiB profile bound). */
  readonly declaredBytes: number;
  readonly caller: SliceCallerIdentity;
}

export interface S2DiscoveryJourneyRequest {
  readonly semantic: S2SemanticInput;
  readonly confirmation?: S2ConfirmationFacts;
}

/** A truthful S2 journey outcome. Only `completed`/`replayed`/`failed` have
 * passed K admission; `needs-confirmation`/`refused` are zero-effect stops. */
type S2CompletedSubmission = Extract<SubmissionOutcome, { status: 'completed' }>;

export type S2DiscoveryOutcome =
  | {
      /** Deterministic ambiguity: the T05 confirmation plan, zero effects. */
      readonly status: 'needs-confirmation';
      readonly reason: SelectionAmbiguityReason;
      readonly plan: SemanticConfirmationPlan;
      /** Deterministic trace of the ranking the decision is anchored to. */
      readonly rankingFingerprint: string;
    }
  | {
      /** The deterministic selection awaits the caller's ratification. */
      readonly status: 'awaiting-confirmation';
      readonly selectedMemberId: string;
      readonly plan: SemanticConfirmationPlan;
      readonly rankingFingerprint: string;
    }
  | SliceJourneyRefusal
  | {
      readonly status: 'completed';
      readonly selectedMemberId: string;
      readonly rankingFingerprint: string;
      readonly confirmed: S2CompletedSubmission['confirmed'];
      readonly evidence: S2CompletedSubmission['evidence'];
      readonly permitEffectId: S2CompletedSubmission['permitEffectId'];
      readonly receipt: S2CompletedSubmission['receipt'];
    }
  | Extract<SubmissionOutcome, { status: 'replayed' }>
  | Extract<SubmissionOutcome, { status: 'failed' }>;

/**
 * Run the S2 discovery/attachment journey. Zero network, zero K admission and
 * zero durable state on every non-submission branch — provable through the
 * runtime's fixture counters, bridge counters and durable store.
 */
export async function runS2DiscoveryJourney(
  runtime: DownloadRuntime,
  request: S2DiscoveryJourneyRequest,
): Promise<S2DiscoveryOutcome> {
  // (1) Decode through the T05 exact-key decoders (no-widening at every layer).
  const decoded = decodeSemanticLaneRequest(request.semantic);
  if (!decoded.ok) {
    return {
      status: 'refused',
      code: 'SEMANTIC_REQUEST_INVALID',
      message: `declared semantic inputs refused: ${decoded.diagnostics.map((entry) => entry.code).join(',')}`,
    };
  }

  // (2) Deterministic evaluation; ambiguity ⇒ confirmation, zero effects.
  const decision = runSemanticLaneNoLlm(decoded.value);
  if (!decision.ok) {
    return {
      status: 'refused',
      code: 'SEMANTIC_EVALUATION_REFUSED',
      message: `semantic evaluation refused: ${decision.diagnostics.map((entry) => entry.code).join(',')}`,
    };
  }
  const outcome = decision.value;
  if (outcome.outcome === 'REQUIRES_CONFIRMATION') {
    return {
      status: 'needs-confirmation',
      reason: outcome.reason,
      plan: outcome.confirmation,
      rankingFingerprint: outcome.rankingFingerprint,
    };
  }
  const selectedMemberId = outcome.selectedMemberId;

  // (3) Explicit confirmation facts binding EXACTLY the selected member.
  const facts = request.confirmation;
  if (facts === undefined) {
    return {
      status: 'awaiting-confirmation',
      selectedMemberId,
      plan: decidedOutcomePlan([selectedMemberId]),
      rankingFingerprint: outcome.rankingFingerprint,
    };
  }
  if (facts.confirmedMemberId !== selectedMemberId) {
    return {
      status: 'refused',
      code: 'CONFIRMATION_MEMBER_MISMATCH',
      message: `confirmation names '${facts.confirmedMemberId}' but the deterministic selection is '${selectedMemberId}'; a confirmation can never substitute a different member`,
    };
  }

  // (4) One T01 confirmed intent (closed-construction, pre-validated), then
  //     the T11 direct journey under K.
  const candidate = buildDirectIntentCandidate({
    requestId: facts.requestId,
    lineageId: facts.lineageId,
    targetRef: facts.targetRef,
    outputRootScope: facts.outputRootScope,
    ...(facts.digestAnchor === undefined ? {} : { digestAnchor: facts.digestAnchor }),
    ...(facts.declaredBytes === undefined ? {} : { declaredBytes: facts.declaredBytes }),
    caller: facts.caller,
  });
  const diagnostics = intentCandidateDiagnostics(candidate);
  if (diagnostics.length > 0) {
    return {
      status: 'refused',
      code: 'INTENT_CANDIDATE_INVALID',
      message: `confirmed intent refused before send: ${diagnostics.join(',')}`,
    };
  }

  const submission = await submitConfirmedDownload(runtime, candidate);
  switch (submission.status) {
    case 'completed':
      return {
        status: 'completed',
        selectedMemberId,
        rankingFingerprint: outcome.rankingFingerprint,
        confirmed: submission.confirmed,
        evidence: submission.evidence,
        permitEffectId: submission.permitEffectId,
        receipt: submission.receipt,
      };
    case 'replayed':
      return { status: 'replayed', confirmed: submission.confirmed, receipt: submission.receipt };
    case 'failed':
      return {
        status: 'failed',
        confirmed: submission.confirmed,
        error: submission.error,
        terminal: submission.terminal,
        receipt: submission.receipt,
        aborted: submission.aborted,
      };
  }
}
