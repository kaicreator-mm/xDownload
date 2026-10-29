/**
 * v0.2 T05 negative/positive semantic lane tests — finite membership and
 * determinism (node:test, colocated inside the T05 write set per the frozen
 * Task Pack; root Node24 toolchain, no extra manifest).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FINITE_MEMBERSHIP_BASIS,
  MAX_FINITE_MEMBERS,
  decodeFiniteMemberSet,
  memberIsInScope,
  type FiniteMemberSet,
} from './finite-membership.ts';
import {
  decodeMemberObservations,
  decodeSemanticRecipe,
  evaluateRecipe,
  type MemberObservations,
  type RecipeEvaluation,
  type SemanticRecipe,
} from './recipe-eval.ts';
import { rankingFingerprint, selectTarget } from './selection.ts';

/** Seed fixture, serialized so every run starts from fresh mutable objects. */
const SCOPE_SEED = {
  basis: FINITE_MEMBERSHIP_BASIS,
  memberIds: ['member-c', 'member-a', 'member-b'],
  collectionId: 'collection:fixture-1',
};
const RECIPE_SEED = {
  recipeId: 'recipe:fixture-video',
  matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
};
const OBSERVATIONS_SEED: readonly { memberId: string; facts: Record<string, string> }[] = [
  { memberId: 'member-a', facts: { kind: 'video' } },
  { memberId: 'member-b', facts: { kind: 'audio' } },
  { memberId: 'member-c', facts: {} },
];

function fresh(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function mustDecode<T>(
  result: { ok: boolean; value?: T; diagnostics?: readonly unknown[] },
  what: string,
): T {
  assert.equal(result.ok, true, `${what} must decode`);
  if (!result.ok) {
    throw new Error(`unreachable: ${what} fixture refused`);
  }
  return result.value as T;
}

function freshScope(): FiniteMemberSet {
  return mustDecode(decodeFiniteMemberSet(fresh(SCOPE_SEED)), 'scope');
}
function freshRecipe(): SemanticRecipe {
  return mustDecode(decodeSemanticRecipe(fresh(RECIPE_SEED)), 'recipe');
}
function freshObservations(): MemberObservations[] {
  return OBSERVATIONS_SEED.map((entry, index) =>
    mustDecode(decodeMemberObservations(fresh(entry)), `observation[${index}]`),
  );
}
function freshEvaluation():
  { ok: true; value: RecipeEvaluation } | { ok: false; diagnostics: readonly unknown[] } {
  return evaluateRecipe(freshRecipe(), freshScope(), freshObservations());
}

describe('decodeFiniteMemberSet — finite declared membership', () => {
  it('decodes into a canonically sorted, frozen member set', () => {
    const scope = freshScope();
    assert.deepEqual(scope.memberIds, ['member-a', 'member-b', 'member-c']);
    assert.ok(Object.isFrozen(scope));
    assert.ok(Object.isFrozen(scope.memberIds));
  });

  it('is order-invariant: any submission order decodes to the identical value', () => {
    const permutations = [
      ['member-a', 'member-b', 'member-c'],
      ['member-c', 'member-b', 'member-a'],
      ['member-b', 'member-c', 'member-a'],
    ];
    for (const memberIds of permutations) {
      const result = decodeFiniteMemberSet({
        basis: FINITE_MEMBERSHIP_BASIS,
        memberIds,
        collectionId: 'collection:fixture-1',
      });
      assert.deepEqual(mustDecode(result, 'permuted scope'), freshScope());
    }
  });

  it('refuses membership beyond the explicit finite bound (no silent truncation)', () => {
    const oversized = Array.from(
      { length: MAX_FINITE_MEMBERS + 1 },
      (_, index) => `m${String(index).padStart(6, '0')}`,
    );
    const result = decodeFiniteMemberSet({ basis: FINITE_MEMBERSHIP_BASIS, memberIds: oversized });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, 'MEMBERSHIP_DRIFT');
      assert.match(result.diagnostics[0]?.message ?? '', /not finite and is refused/);
    }
  });

  it('accepts exactly the bound (boundary is inclusive)', () => {
    const atBound = Array.from(
      { length: MAX_FINITE_MEMBERS },
      (_, index) => `m${String(index).padStart(6, '0')}`,
    );
    const result = decodeFiniteMemberSet({ basis: FINITE_MEMBERSHIP_BASIS, memberIds: atBound });
    assert.equal(result.ok, true);
  });

  it('refuses duplicates, empty set, wrong basis, unknown fields and malformed ids', () => {
    const duplicate = decodeFiniteMemberSet({
      basis: FINITE_MEMBERSHIP_BASIS,
      memberIds: ['member-a', 'member-a'],
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.diagnostics[0]?.code, 'MEMBERSHIP_DRIFT');

    const empty = decodeFiniteMemberSet({ basis: FINITE_MEMBERSHIP_BASIS, memberIds: [] });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.diagnostics[0]?.code, 'EMPTY_SET_NOT_SUCCESS');

    const wrongBasis = decodeFiniteMemberSet({
      basis: 'SUPPORTED_TEMPLATE',
      memberIds: ['member-a'],
    });
    assert.equal(wrongBasis.ok, false);
    if (!wrongBasis.ok) assert.equal(wrongBasis.diagnostics[0]?.code, 'UNKNOWN_ENUM_VALUE');

    const widened = decodeFiniteMemberSet({
      basis: FINITE_MEMBERSHIP_BASIS,
      memberIds: ['member-a'],
      frontier: 'https://example.test/crawl-all',
    });
    assert.equal(widened.ok, false);
    if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');

    const malformed = decodeFiniteMemberSet({
      basis: FINITE_MEMBERSHIP_BASIS,
      memberIds: ['not an id!'],
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.diagnostics[0]?.code, 'MALFORMED_REQUIRED_FIELD');
  });

  it('membership test is identity-set based', () => {
    const scope = freshScope();
    assert.equal(memberIsInScope(scope, 'member-a'), true);
    assert.equal(memberIsInScope(scope, 'member-z'), false);
  });
});

describe('semantic lane determinism — same input, identical output', () => {
  it('evaluation and selection are deeply equal across 25 fresh runs', () => {
    const baseline = freshEvaluation();
    assert.equal(baseline.ok, true);
    if (!baseline.ok) throw new Error('unreachable: baseline evaluation refused');
    const baselineSelection = selectTarget(baseline.value);
    for (let run = 0; run < 25; run += 1) {
      const next = freshEvaluation();
      assert.equal(next.ok, true);
      if (!next.ok) throw new Error('unreachable: repeat evaluation refused');
      assert.deepEqual(next.value, baseline.value);
      assert.deepEqual(selectTarget(next.value), baselineSelection);
    }
  });

  it('observation submission order cannot change the outcome (fixed permutations)', () => {
    const baseline = freshEvaluation();
    assert.equal(baseline.ok, true);
    if (!baseline.ok) throw new Error('unreachable: baseline evaluation refused');
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [2, 0, 1],
    ];
    for (const order of orders) {
      const observations = freshObservations();
      const reordered = order.map((index) => {
        const entry = observations[index];
        if (entry === undefined) throw new Error('unreachable: permutation index out of range');
        return entry;
      });
      const result = evaluateRecipe(freshRecipe(), freshScope(), reordered);
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error('unreachable: permuted evaluation refused');
      assert.deepEqual(result.value, baseline.value);
      assert.equal(rankingFingerprint(result.value), rankingFingerprint(baseline.value));
    }
  });

  it('the ranking is total and canonically ordered over the finite scope', () => {
    const evaluation = freshEvaluation();
    assert.equal(evaluation.ok, true);
    if (!evaluation.ok) throw new Error('unreachable: evaluation refused');
    assert.deepEqual(
      evaluation.value.ranking.map((candidate) => candidate.memberId),
      ['member-a', 'member-b', 'member-c'],
    );
    assert.deepEqual(evaluation.value.matchedMemberIds, ['member-a']);
  });
});
