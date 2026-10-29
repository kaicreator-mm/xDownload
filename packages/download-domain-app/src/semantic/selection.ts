/**
 * v0.2 T05 — deterministic single-target selection.
 *
 * The selection rule is fail-closed and has no tie-breaking heuristic:
 *
 * - exactly one full matcher match → SELECTED;
 * - two or more full matches → REQUIRES_CONFIRMATION (AMBIGUOUS_TIE);
 * - zero full matches → REQUIRES_CONFIRMATION (INSUFFICIENT_EVIDENCE).
 *
 * Partial condition counts are traceability data only — they never rank a
 * winner ("closest match" is a silent guess). Every undecided outcome carries
 * a deterministic confirmation plan; a decision is never silent.
 */
import { deepFreeze, type MemberId } from '@xdownload/domain-contracts';

import {
  buildConfirmationPlan,
  type SemanticConfirmationPlan,
  type SelectionAmbiguityReason,
} from './confirmation.ts';
import { compareCodeUnitOrder } from './finite-membership.ts';
import type { RecipeEvaluation } from './recipe-eval.ts';

export type SelectionDecision =
  | {
      readonly outcome: 'SELECTED';
      readonly recipeId: string;
      readonly selectedMemberId: MemberId;
      /** Deterministic trace of the ranking the selection is anchored to. */
      readonly rankingFingerprint: string;
    }
  | {
      readonly outcome: 'REQUIRES_CONFIRMATION';
      readonly recipeId: string;
      readonly reason: SelectionAmbiguityReason;
      /** Sorted members requiring disambiguation (tie set or advisory-contested set). */
      readonly contestedMemberIds: readonly MemberId[];
      readonly confirmation: SemanticConfirmationPlan;
      readonly rankingFingerprint: string;
    };

/** Deterministic, environment-independent fingerprint of an evaluation ranking. */
export function rankingFingerprint(evaluation: RecipeEvaluation): string {
  const parts = evaluation.ranking.map(
    (candidate) =>
      `${candidate.memberId}:${candidate.matched ? '1' : '0'}:${candidate.satisfiedConditionCount}`,
  );
  return `${evaluation.recipeId}#${parts.join('|')}`;
}

/**
 * Select at most one target from a total recipe evaluation. Ambiguity of any
 * kind returns the requiresConfirmation branch — the lane never silently
 * chooses among equally supported candidates and never guesses from absent
 * evidence.
 */
export function selectTarget(
  evaluation: RecipeEvaluation,
  advisoryContestedMemberIds: readonly MemberId[] = [],
): SelectionDecision {
  const fingerprint = rankingFingerprint(evaluation);
  const matched = evaluation.matchedMemberIds;
  const uniqueMatchContested =
    matched.length === 1 && advisoryContestedMemberIds.includes(matched[0] as MemberId);
  if (matched.length === 1 && !uniqueMatchContested) {
    return deepFreeze({
      outcome: 'SELECTED',
      recipeId: evaluation.recipeId,
      selectedMemberId: matched[0] as MemberId,
      rankingFingerprint: fingerprint,
    });
  }
  let reason: SelectionAmbiguityReason;
  let contested: readonly MemberId[];
  if (matched.length > 1) {
    reason = 'AMBIGUOUS_TIE';
    contested = matched;
  } else if (matched.length === 0) {
    reason = 'INSUFFICIENT_EVIDENCE';
    contested = [];
  } else {
    // A unique match exists but an advisory contested exactly that member:
    // the decision is re-anchored with the user. Advisories can force
    // confirmation; they can never confirm a selection by themselves.
    reason = 'ADVISORY_CONTESTED';
    contested = deepFreeze([...advisoryContestedMemberIds].sort(compareCodeUnitOrder));
  }
  const scopeKey = evaluation.evaluationScope.collectionId ?? evaluation.recipeId;
  return deepFreeze({
    outcome: 'REQUIRES_CONFIRMATION',
    recipeId: evaluation.recipeId,
    reason,
    contestedMemberIds: contested,
    confirmation: buildConfirmationPlan({
      reason,
      memberIds:
        reason === 'INSUFFICIENT_EVIDENCE' ? evaluation.evaluationScope.memberIds : contested,
      scopeKey,
    }),
    rankingFingerprint: fingerprint,
  });
}
