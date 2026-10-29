/**
 * v0.2 T05 negative/positive semantic lane tests — ambiguity routes to
 * requiresConfirmation and the lane never silently selects (node:test,
 * colocated inside the T05 write set).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FINITE_MEMBERSHIP_BASIS,
  decodeFiniteMemberSet,
  type FiniteMemberSet,
} from './finite-membership.ts';
import {
  decodeMemberObservations,
  decodeSemanticRecipe,
  evaluateRecipe,
  type MemberObservations,
  type RecipeEvaluation,
} from './recipe-eval.ts';
import { selectTarget, rankingFingerprint } from './selection.ts';
import { MAX_MATERIAL_ITEM_CONFIRMATIONS } from './confirmation.ts';

function scopeWith(memberIds: string[]): FiniteMemberSet {
  const result = decodeFiniteMemberSet({ basis: FINITE_MEMBERSHIP_BASIS, memberIds });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable: fixture scope refused');
  return result.value;
}

function observationFor(memberId: string, facts: Record<string, string>): MemberObservations {
  const decoded = decodeMemberObservations({ memberId, facts });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) throw new Error('unreachable: fixture observation refused');
  return decoded.value;
}

function evaluateMembers(
  memberIds: string[],
  kindByMember: Record<string, string>,
): RecipeEvaluation {
  const recipe = decodeSemanticRecipe({
    recipeId: 'recipe:fixture-video',
    matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
  });
  assert.equal(recipe.ok, true);
  if (!recipe.ok) throw new Error('unreachable: fixture recipe refused');
  const scope = scopeWith(memberIds);
  const observations = memberIds.map((memberId) =>
    observationFor(memberId, { kind: kindByMember[memberId] ?? '' }),
  );
  const evaluation = evaluateRecipe(recipe.value, scope, observations);
  assert.equal(evaluation.ok, true);
  if (!evaluation.ok) throw new Error('unreachable: fixture evaluation refused');
  return evaluation.value;
}

describe('selectTarget — unique evidence selects, everything else confirms', () => {
  it('selects the single full match and carries a stable fingerprint', () => {
    const evaluation = evaluateMembers(['member-a', 'member-b'], {
      'member-a': 'video',
      'member-b': 'audio',
    });
    const decision = selectTarget(evaluation);
    assert.equal(decision.outcome, 'SELECTED');
    if (decision.outcome === 'SELECTED') {
      assert.equal(decision.selectedMemberId, 'member-a');
      assert.equal(decision.rankingFingerprint, rankingFingerprint(evaluation));
    }
  });

  it('a two-way tie is ambiguous: REQUIRES_CONFIRMATION with one MATERIAL_ITEM per member', () => {
    const evaluation = evaluateMembers(['member-b', 'member-a', 'member-c'], {
      'member-a': 'video',
      'member-b': 'video',
      'member-c': 'audio',
    });
    const decision = selectTarget(evaluation);
    assert.equal(decision.outcome, 'REQUIRES_CONFIRMATION');
    if (decision.outcome === 'REQUIRES_CONFIRMATION') {
      assert.equal(decision.reason, 'AMBIGUOUS_TIE');
      assert.deepEqual(decision.contestedMemberIds, ['member-a', 'member-b']);
      assert.deepEqual(decision.confirmation.requests, [
        { level: 'MATERIAL_ITEM', memberRef: 'member-a' },
        { level: 'MATERIAL_ITEM', memberRef: 'member-b' },
      ]);
      assert.equal(decision.confirmation.perItemInterrogationUsed, false);
    }
  });

  it(`a tie above ${MAX_MATERIAL_ITEM_CONFIRMATIONS} members collapses into one BATCH_GROUP (C30: no per-item interrogation)`, () => {
    const members = ['m5', 'm1', 'm3', 'm2', 'm4'];
    const evaluation = evaluateMembers(
      members,
      Object.fromEntries(members.map((m) => [m, 'video'])),
    );
    const decision = selectTarget(evaluation);
    assert.equal(decision.outcome, 'REQUIRES_CONFIRMATION');
    if (decision.outcome === 'REQUIRES_CONFIRMATION') {
      assert.equal(decision.reason, 'AMBIGUOUS_TIE');
      assert.equal(decision.confirmation.requests.length, 1);
      assert.deepEqual(decision.confirmation.requests[0], {
        level: 'BATCH_GROUP',
        memberRefs: ['m1', 'm2', 'm3', 'm4', 'm5'],
      });
    }
  });

  it('zero matches is insufficient evidence: REQUIRES_CONFIRMATION, never a closest-match guess', () => {
    const members = ['member-a', 'member-b'];
    const evaluation = evaluateMembers(members, { 'member-a': 'audio', 'member-b': 'image' });
    const decision = selectTarget(evaluation);
    assert.equal(decision.outcome, 'REQUIRES_CONFIRMATION');
    if (decision.outcome === 'REQUIRES_CONFIRMATION') {
      assert.equal(decision.reason, 'INSUFFICIENT_EVIDENCE');
      assert.deepEqual(decision.contestedMemberIds, []);
      assert.deepEqual(decision.confirmation.requests, [
        { level: 'MANUAL_SELECTION_UI', candidateRefs: ['member-a', 'member-b'] },
      ]);
      assert.equal(decision.confirmation.escalationReason, 'INSUFFICIENT_DECISIVE_EVIDENCE');
    }
  });

  it('partial condition counts never rank a winner (traceability only)', () => {
    // Recipe with two conditions: member-a satisfies one, member-b none.
    const recipe = decodeSemanticRecipe({
      recipeId: 'recipe:two-conditions',
      matcher: {
        allOf: [
          { field: 'kind', op: 'equals', value: 'video' },
          { field: 'source', op: 'exists' },
        ],
      },
    });
    assert.equal(recipe.ok, true);
    if (!recipe.ok) throw new Error('unreachable: fixture recipe refused');
    const scope = scopeWith(['member-a', 'member-b']);
    const evaluation = evaluateRecipe(recipe.value, scope, [
      observationFor('member-a', { kind: 'video' }),
      observationFor('member-b', { kind: 'other', source: 'x' }),
    ]);
    assert.equal(evaluation.ok, true);
    if (!evaluation.ok) throw new Error('unreachable: evaluation refused');
    const decision = selectTarget(evaluation.value);
    assert.equal(decision.outcome, 'REQUIRES_CONFIRMATION');
    if (decision.outcome === 'REQUIRES_CONFIRMATION') {
      assert.equal(decision.reason, 'INSUFFICIENT_EVIDENCE');
    }
    // Traceability data still records the partial satisfaction ordering.
    assert.equal(evaluation.value.ranking[0]?.memberId, 'member-a');
    assert.equal(evaluation.value.ranking[0]?.matched, false);
  });

  it('every undecided outcome carries at least one confirmation request (never silent)', () => {
    const cases: RecipeEvaluation[] = [
      evaluateMembers(['member-a', 'member-b'], { 'member-a': 'video', 'member-b': 'video' }),
      evaluateMembers(['member-a'], { 'member-a': 'audio' }),
      evaluateMembers(['member-a', 'member-b', 'member-c'], {}),
    ];
    for (const evaluation of cases) {
      const decision = selectTarget(evaluation);
      if (decision.outcome === 'REQUIRES_CONFIRMATION') {
        assert.ok(decision.confirmation.requests.length >= 1);
      } else {
        assert.fail('these fixtures must not produce a selection');
      }
    }
  });

  it('selection is deterministic under repeated evaluation', () => {
    const first = selectTarget(
      evaluateMembers(['member-a', 'member-b'], { 'member-a': 'video', 'member-b': 'video' }),
    );
    for (let run = 0; run < 10; run += 1) {
      assert.deepEqual(
        selectTarget(
          evaluateMembers(['member-a', 'member-b'], { 'member-a': 'video', 'member-b': 'video' }),
        ),
        first,
      );
    }
  });
});
