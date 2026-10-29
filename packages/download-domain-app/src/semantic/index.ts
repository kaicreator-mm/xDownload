/**
 * v0.2 T05 — semantic lane public index.
 *
 * Deterministic recipe/selection over finite declared membership, with
 * ambiguity routed to confirmation and advisory opinions bounded to
 * non-authoritative contestation. The zero-LLM path is the default and
 * complete path; the optional advisory surface is data-only injection.
 */
export {
  FINITE_MEMBERSHIP_BASIS,
  MAX_FINITE_MEMBERS,
  compareCodeUnitOrder,
  decodeFiniteMemberSet,
  memberIsInScope,
  type FiniteMemberSet,
} from './finite-membership.ts';
export {
  MAX_MATCHER_CONDITIONS,
  MAX_MEMBER_FACTS,
  RECIPE_MATCH_OPERATORS,
  decodeMemberObservations,
  decodeSemanticRecipe,
  evaluateRecipe,
  type MemberObservations,
  type RankedCandidate,
  type RecipeEvaluation,
  type SemanticMatchCondition,
  type SemanticMatchOperator,
  type SemanticRecipe,
} from './recipe-eval.ts';
export {
  MAX_MATERIAL_ITEM_CONFIRMATIONS,
  buildConfirmationPlan,
  type SelectionAmbiguityReason,
  type SemanticConfirmationPlan,
  type SemanticConfirmationRequest,
} from './confirmation.ts';
export { rankingFingerprint, selectTarget, type SelectionDecision } from './selection.ts';
export {
  ADVISORY_CERTAINTY_CEILING,
  ADVISORY_FORBIDDEN_AUTHORITY_FIELDS,
  ADVISORY_KIND,
  ADVISORY_OPINION_KINDS,
  applyAdvisories,
  refuseAdvisoryAsAuthority,
  validateAdvisoryOpinion,
  type AdvisoryOpinion,
  type AdvisoryOpinionKind,
} from './advisory.ts';
export {
  decodeSemanticLaneRequest,
  runSemanticLaneNoLlm,
  runSemanticLaneWithAdvisories,
  type AdvisorySource,
  type SemanticLaneOutcome,
  type SemanticLaneRequest,
} from './run.ts';
