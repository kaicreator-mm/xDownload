/**
 * v0.2 T05 — deterministic recipe evaluation over a finite declared scope.
 *
 * A semantic recipe is declarative product knowledge: an identity plus an
 * `allOf` matcher over declared observation facts, using the frozen
 * equals/contains/exists operator vocabulary of the existing discovery
 * Recipe schema. The interpreter is a pure function:
 *
 *   finite member set + declared per-member facts → total, ordered ranking
 *
 * Every step is deterministic and side-effect free — same inputs yield a
 * deeply equal output on every run. No wall-clock, no randomness, no network,
 * no environment reads. The evaluation can never widen its scope: observation
 * records for members outside the declared finite set are refused, and every
 * in-scope member must carry exactly one observation record, so the ranking
 * is total over the declared universe.
 */
import {
  deepFreeze,
  diagnostic,
  fail,
  makeMemberId,
  ok,
  type DomainValidationResult,
  type MemberId,
} from '@xdownload/domain-contracts';

import { compareCodeUnitOrder, type FiniteMemberSet } from './finite-membership.ts';

/** Frozen matcher-operator vocabulary (reuse of the discovery Recipe schema). */
export const RECIPE_MATCH_OPERATORS = ['equals', 'contains', 'exists'] as const;
export type SemanticMatchOperator = (typeof RECIPE_MATCH_OPERATORS)[number];

export interface SemanticMatchCondition {
  readonly field: string;
  readonly op: SemanticMatchOperator;
  readonly value?: string;
}

export interface SemanticRecipe {
  readonly recipeId: string;
  readonly matcher: { readonly allOf: readonly SemanticMatchCondition[] };
}

const RECIPE_FIELDS: readonly string[] = ['recipeId', 'matcher'];
const MATCHER_FIELDS: readonly string[] = ['allOf'];
const CONDITION_FIELDS: readonly string[] = ['field', 'op', 'value'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const FIELD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/;

/** Explicit bound on matcher complexity (finite declarable recipe). */
export const MAX_MATCHER_CONDITIONS = 64;

/**
 * Decode an unknown value into a SemanticRecipe. Exact-key and bounded:
 * unknown fields are refused, matcher size is capped, and only the frozen
 * operator vocabulary is accepted.
 */
export function decodeSemanticRecipe(value: unknown): DomainValidationResult<SemanticRecipe> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'recipe', 'semantic recipe must be a plain object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!RECIPE_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  const recipeId = record.recipeId;
  if (typeof recipeId !== 'string' || !ID_PATTERN.test(recipeId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipeId',
        'recipeId must match the bounded identifier grammar',
      ),
    ]);
  }
  const matcher = record.matcher;
  if (typeof matcher !== 'object' || matcher === null || Array.isArray(matcher)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'matcher', 'matcher must be a plain object'),
    ]);
  }
  const matcherRecord = matcher as Record<string, unknown>;
  for (const key of Object.keys(matcherRecord)) {
    if (!MATCHER_FIELDS.includes(key)) {
      return fail([
        diagnostic('SCOPE_WIDENING_REFUSED', `matcher.${key}`, `unknown matcher field: ${key}`),
      ]);
    }
  }
  const rawConditions = matcherRecord.allOf;
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'matcher.allOf',
        'matcher.allOf must be a non-empty array',
      ),
    ]);
  }
  if (rawConditions.length > MAX_MATCHER_CONDITIONS) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'matcher.allOf',
        `matcher exceeds the declarable bound (${rawConditions.length} > ${MAX_MATCHER_CONDITIONS} conditions)`,
      ),
    ]);
  }
  const conditions: SemanticMatchCondition[] = [];
  for (let index = 0; index < rawConditions.length; index += 1) {
    const decoded = decodeCondition(rawConditions[index], `matcher.allOf[${index}]`);
    if (!decoded.ok) {
      return decoded;
    }
    conditions.push(decoded.value);
  }
  return ok(
    deepFreeze({
      recipeId,
      matcher: deepFreeze({ allOf: deepFreeze(conditions) }),
    }),
  );
}

function decodeCondition(
  value: unknown,
  path: string,
): DomainValidationResult<SemanticMatchCondition> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'match condition must be a plain object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!CONDITION_FIELDS.includes(key)) {
      return fail([
        diagnostic('SCOPE_WIDENING_REFUSED', `${path}.${key}`, `unknown condition field: ${key}`),
      ]);
    }
  }
  const field = record.field;
  if (typeof field !== 'string' || !FIELD_PATTERN.test(field)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', `${path}.field`, 'condition field must be bounded'),
    ]);
  }
  if (!RECIPE_MATCH_OPERATORS.includes(record.op as SemanticMatchOperator)) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        `${path}.op`,
        `operator must be one of ${RECIPE_MATCH_OPERATORS.join(', ')} (frozen vocabulary)`,
      ),
    ]);
  }
  const op = record.op as SemanticMatchOperator;
  let conditionValue: string | undefined;
  if (record.value !== undefined) {
    if (
      typeof record.value !== 'string' ||
      record.value.length === 0 ||
      record.value.length > 256
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `${path}.value`,
          'condition value must be a bounded string',
        ),
      ]);
    }
    conditionValue = record.value;
  }
  if ((op === 'equals' || op === 'contains') && conditionValue === undefined) {
    return fail([
      diagnostic('MISSING_REQUIRED_FIELD', `${path}.value`, `operator '${op}' requires a value`),
    ]);
  }
  if (op === 'exists' && conditionValue !== undefined) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', `${path}.value`, "operator 'exists' takes no value"),
    ]);
  }
  return ok(
    deepFreeze({
      field,
      op,
      ...(conditionValue === undefined ? {} : { value: conditionValue }),
    }),
  );
}

/** Declared observation facts for one in-scope member (bounded, string-valued). */
export interface MemberObservations {
  readonly memberId: MemberId;
  readonly facts: Readonly<Record<string, string>>;
}

/** Explicit bound on declared facts per member (finite declarable input). */
export const MAX_MEMBER_FACTS = 32;

const OBSERVATION_FIELDS: readonly string[] = ['memberId', 'facts'];

/**
 * Decode one member observation record. Exact-key; the fact map is bounded
 * and its values must be strings (declared facts, not parsed blobs).
 */
export function decodeMemberObservations(
  value: unknown,
): DomainValidationResult<MemberObservations> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'observations',
        'member observations must be a plain object',
      ),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!OBSERVATION_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  const memberId = record.memberId;
  const decodedMember = makeMemberId(typeof memberId === 'string' ? memberId : String(memberId));
  if (!decodedMember.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'memberId',
        'memberId must match the bounded identifier grammar',
      ),
    ]);
  }
  const rawFacts = record.facts;
  if (typeof rawFacts !== 'object' || rawFacts === null || Array.isArray(rawFacts)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'facts', 'facts must be a plain object')]);
  }
  const factRecord = rawFacts as Record<string, unknown>;
  const factKeys = Object.keys(factRecord);
  if (factKeys.length > MAX_MEMBER_FACTS) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'facts',
        `declared facts exceed the bound (${factKeys.length} > ${MAX_MEMBER_FACTS})`,
      ),
    ]);
  }
  const facts: Record<string, string> = {};
  for (const key of factKeys) {
    if (!FIELD_PATTERN.test(key)) {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', `facts.${key}`, 'fact key must be bounded'),
      ]);
    }
    const factValue = factRecord[key];
    if (typeof factValue !== 'string' || factValue.length > 1024) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `facts.${key}`,
          'fact value must be a string of at most 1024 chars',
        ),
      ]);
    }
    facts[key] = factValue;
  }
  return ok(deepFreeze({ memberId: decodedMember.value, facts: deepFreeze(facts) }));
}

/** One member's matcher verdict inside the finite scope. */
export interface RankedCandidate {
  readonly memberId: MemberId;
  /** True only when EVERY matcher condition is satisfied (decisive evidence). */
  readonly matched: boolean;
  /** Number of satisfied conditions (traceability only; never a selection rank). */
  readonly satisfiedConditionCount: number;
}

/**
 * The total, deterministic evaluation over the declared finite scope.
 * `ranking` is frozen and ordered: matched members first, then satisfied
 * count descending, then memberId ascending (code-unit order).
 */
export interface RecipeEvaluation {
  readonly recipeId: string;
  /** The exact finite scope that was evaluated (echoed, canonically ordered). */
  readonly evaluationScope: FiniteMemberSet;
  readonly ranking: readonly RankedCandidate[];
  /** Sorted memberIds of the members whose matcher fully matched. */
  readonly matchedMemberIds: readonly MemberId[];
}

/**
 * Evaluate the recipe over the finite scope. `observations` must cover the
 * scope exactly: one record per in-scope member, none outside it. Missing
 * coverage is insufficient evidence (refused, never guessed); extra or
 * duplicate records are membership drift (the evaluation cannot widen scope).
 */
export function evaluateRecipe(
  recipe: SemanticRecipe,
  scope: FiniteMemberSet,
  observations: readonly MemberObservations[],
): DomainValidationResult<RecipeEvaluation> {
  const scopeMembers = scope.memberIds;
  const byMember = new Map<string, Readonly<Record<string, string>>>();
  for (const [index, observation] of observations.entries()) {
    if (!memberIsInSet(scopeMembers, observation.memberId)) {
      return fail([
        diagnostic(
          'MEMBERSHIP_DRIFT',
          `observations[${index}].memberId`,
          `observation for '${observation.memberId}' is outside the declared finite scope; evaluation cannot widen scope`,
        ),
      ]);
    }
    if (byMember.has(observation.memberId)) {
      return fail([
        diagnostic(
          'MEMBERSHIP_DRIFT',
          `observations[${index}].memberId`,
          `duplicate observation record for '${observation.memberId}'`,
        ),
      ]);
    }
    byMember.set(observation.memberId, observation.facts);
  }
  for (const member of scopeMembers) {
    if (!byMember.has(member)) {
      return fail([
        diagnostic(
          'INSUFFICIENT_EVIDENCE',
          'observations',
          `no declared observation facts for in-scope member '${member}'; refusing to evaluate on absent evidence`,
        ),
      ]);
    }
  }
  const ranking: RankedCandidate[] = scopeMembers.map((memberId) => {
    const facts = byMember.get(memberId);
    let satisfied = 0;
    for (const condition of recipe.matcher.allOf) {
      if (conditionSatisfied(condition, facts ?? {})) {
        satisfied += 1;
      }
    }
    return deepFreeze({
      memberId,
      matched: satisfied === recipe.matcher.allOf.length,
      satisfiedConditionCount: satisfied,
    });
  });
  ranking.sort((a, b) => {
    if (a.matched !== b.matched) {
      return a.matched ? -1 : 1;
    }
    if (a.satisfiedConditionCount !== b.satisfiedConditionCount) {
      return b.satisfiedConditionCount - a.satisfiedConditionCount;
    }
    return compareCodeUnitOrder(a.memberId, b.memberId);
  });
  const matchedMemberIds = ranking
    .filter((candidate) => candidate.matched)
    .map((candidate) => candidate.memberId)
    .sort(compareCodeUnitOrder);
  return ok(
    deepFreeze({
      recipeId: recipe.recipeId,
      evaluationScope: scope,
      ranking: deepFreeze(ranking),
      matchedMemberIds: deepFreeze(matchedMemberIds),
    }),
  );
}

function conditionSatisfied(
  condition: SemanticMatchCondition,
  facts: Readonly<Record<string, string>>,
): boolean {
  const observed = facts[condition.field];
  if (condition.op === 'exists') {
    return observed !== undefined;
  }
  if (condition.op === 'equals') {
    return observed === condition.value;
  }
  return observed !== undefined && observed.includes(condition.value ?? '');
}

function memberIsInSet(members: readonly MemberId[], candidate: string): boolean {
  return members.includes(candidate as MemberId);
}
