/**
 * v0.2 T05 — the zero-LLM semantic lane entry point.
 *
 * The default path is complete and usable with no model, no provider and no
 * network: decode the finite declared scope, decode the declarative recipe,
 * decode the declared observation facts, evaluate deterministically and
 * select — with every non-unique outcome routed to the requiresConfirmation
 * branch instead of a silent choice.
 *
 * The optional LLM surface is exactly one injected data type (AdvisoryOpinion)
 * plus one pure composition function (applyAdvisories) and a declared
 * AdvisorySource port. The lane never invokes the port, never imports a
 * provider, and the default entry below accepts no advisory parameter at all.
 * No wall-clock, no randomness, no network, no environment reads anywhere in
 * the lane.
 */
import {
  deepFreeze,
  diagnostic,
  fail,
  must,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

import { applyAdvisories, validateAdvisoryOpinion, type AdvisoryOpinion } from './advisory.ts';
import { decodeFiniteMemberSet, type FiniteMemberSet } from './finite-membership.ts';
import {
  decodeMemberObservations,
  decodeSemanticRecipe,
  evaluateRecipe,
  type MemberObservations,
  type SemanticRecipe,
} from './recipe-eval.ts';
import { selectTarget, type SelectionDecision } from './selection.ts';

/** Everything the lane needs — all declared up front, all finite. */
export interface SemanticLaneRequest {
  readonly recipe: SemanticRecipe;
  readonly scope: FiniteMemberSet;
  readonly observations: readonly MemberObservations[];
}

/**
 * Optional advisory injection port. Declared for future lanes that obtain
 * AdvisoryOpinion values from a model provider; the v0.2 semantic lane never
 * calls it — providers remain outside the lane and outside this package's
 * dependency graph.
 */
export type AdvisorySource = (input: {
  readonly recipeId: string;
  readonly scope: FiniteMemberSet;
}) => Promise<readonly AdvisoryOpinion[]>;

/** The only two shapes the lane can produce: a selection or a confirmation. */
export type SemanticLaneOutcome = SelectionDecision;

/**
 * The complete zero-LLM path. Takes decoded lane inputs, evaluates the recipe
 * over the finite scope and returns either the unique selection or the
 * requiresConfirmation branch. No advisory parameter exists on this entry —
 * the default path is advisory-free by construction.
 */
export function runSemanticLaneNoLlm(
  request: SemanticLaneRequest,
): DomainValidationResult<SemanticLaneOutcome> {
  const evaluation = evaluateRecipe(request.recipe, request.scope, request.observations);
  if (!evaluation.ok) {
    return evaluation;
  }
  return ok(selectTarget(evaluation.value));
}

/**
 * The optional advisory path, composed explicitly by the caller: decode the
 * injected opinions (each one exact-key, grant-free, SUGGESTIVE-capped),
 * apply them as contestation to a finished evaluation, and re-select. Every
 * branch remains either SELECTED-without-contestation or a confirmation —
 * an advisory can add ambiguity but can never resolve one.
 */
export function runSemanticLaneWithAdvisories(
  request: SemanticLaneRequest,
  rawAdvisories: readonly unknown[],
): DomainValidationResult<SemanticLaneOutcome> {
  const evaluation = evaluateRecipe(request.recipe, request.scope, request.observations);
  if (!evaluation.ok) {
    return evaluation;
  }
  const advisories: AdvisoryOpinion[] = [];
  const sink: ValidationDiagnostic[] = [];
  for (let index = 0; index < rawAdvisories.length; index += 1) {
    const decoded = validateAdvisoryOpinion(rawAdvisories[index]);
    const value = must(decoded, sink);
    if (value !== undefined) {
      advisories.push(value);
    }
  }
  if (sink.length > 0) {
    return deepFreeze({ ok: false as const, diagnostics: deepFreeze(sink) });
  }
  const contested = applyAdvisories(evaluation.value, request.scope, advisories);
  if (!contested.ok) {
    return contested;
  }
  return ok(selectTarget(evaluation.value, contested.value));
}

/** Convenience decode of a raw lane request (exact-key at every layer). */
const LANE_REQUEST_FIELDS: readonly string[] = ['recipe', 'scope', 'observations'];

export function decodeSemanticLaneRequest(
  value: unknown,
): DomainValidationResult<SemanticLaneRequest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'request', 'lane request must be a plain object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!LANE_REQUEST_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  const sink: ValidationDiagnostic[] = [];
  const recipe = must(decodeSemanticRecipe(record.recipe), sink);
  const scope = must(decodeFiniteMemberSet(record.scope), sink);
  if (recipe === undefined || scope === undefined) {
    return { ok: false, diagnostics: sink };
  }
  const rawObservations = record.observations;
  if (!Array.isArray(rawObservations)) {
    sink.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'observations',
        'lane request requires an observations array',
      ),
    );
    return { ok: false, diagnostics: sink };
  }
  const observations = [];
  for (let index = 0; index < rawObservations.length; index += 1) {
    const decoded = decodeMemberObservations(rawObservations[index]);
    const observationValue = must(decoded, sink);
    if (observationValue !== undefined) {
      observations.push(observationValue);
    }
  }
  if (sink.length > 0) {
    return { ok: false, diagnostics: sink };
  }
  return ok(deepFreeze({ recipe, scope, observations }));
}
