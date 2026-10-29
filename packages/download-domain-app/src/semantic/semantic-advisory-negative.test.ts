/**
 * v0.2 T05 negative/positive semantic lane tests — advisory opinions are
 * bounded: no grant fields, no authority conversion, no self-confirming
 * composition (node:test, colocated inside the T05 write set).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  validateConfirmedIntent,
  validateRouteTable,
  type ConfirmedDownloadIntent,
  type OperationDeclaration,
  type OperationRouteRow,
} from '../contracts/index.ts';
import {
  ADVISORY_CERTAINTY_CEILING,
  ADVISORY_FORBIDDEN_AUTHORITY_FIELDS,
  ADVISORY_KIND,
  applyAdvisories,
  refuseAdvisoryAsAuthority,
  validateAdvisoryOpinion,
  type AdvisoryOpinion,
} from './advisory.ts';
import {
  FINITE_MEMBERSHIP_BASIS,
  decodeFiniteMemberSet,
  type FiniteMemberSet,
} from './finite-membership.ts';
import {
  decodeMemberObservations,
  decodeSemanticRecipe,
  evaluateRecipe,
  type RecipeEvaluation,
} from './recipe-eval.ts';
import { selectTarget } from './selection.ts';
import { decodeSemanticLaneRequest, runSemanticLaneWithAdvisories } from './run.ts';

function advisoryFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    advisoryKind: ADVISORY_KIND,
    opinionId: 'opinion:001',
    opinionKind: 'RANK_HINT',
    aboutMemberId: 'member-a',
    certainty: ADVISORY_CERTAINTY_CEILING,
    ...overrides,
  };
}

function scopeFixture(members: string[]): FiniteMemberSet {
  const decoded = decodeFiniteMemberSet({ basis: FINITE_MEMBERSHIP_BASIS, memberIds: members });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) throw new Error('unreachable: fixture scope refused');
  return decoded.value;
}

/**
 * Unique-match evaluation: member-a matches `kind=video`, others do not.
 */
function uniqueMatchEvaluation(): { scope: FiniteMemberSet; evaluation: RecipeEvaluation } {
  const scope = scopeFixture(['member-a', 'member-b']);
  const recipe = decodeSemanticRecipe({
    recipeId: 'recipe:fixture-video',
    matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
  });
  assert.equal(recipe.ok, true);
  if (!recipe.ok) throw new Error('unreachable: fixture recipe refused');
  const observations = [
    { memberId: 'member-a', facts: { kind: 'video' } },
    { memberId: 'member-b', facts: { kind: 'audio' } },
  ].map((entry) => {
    const decoded = decodeMemberObservations(entry);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error('unreachable: fixture observation refused');
    return decoded.value;
  });
  const evaluation = evaluateRecipe(recipe.value, scope, observations);
  assert.equal(evaluation.ok, true);
  if (!evaluation.ok) throw new Error('unreachable: fixture evaluation refused');
  return { scope, evaluation: evaluation.value };
}

describe('validateAdvisoryOpinion — an advisory can never carry authority', () => {
  it('accepts a well-formed SUGGESTIVE opinion', () => {
    const result = validateAdvisoryOpinion(advisoryFixture());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.certainty, 'SUGGESTIVE');
      assert.equal(result.value.advisoryKind, ADVISORY_KIND);
    }
  });

  it(`refuses every authority field name (${ADVISORY_FORBIDDEN_AUTHORITY_FIELDS.length} names) with EVIDENCE_SCOPE_PROMOTION_FORBIDDEN`, () => {
    for (const field of ADVISORY_FORBIDDEN_AUTHORITY_FIELDS) {
      const attempt = advisoryFixture({
        [field]: field === 'caller' ? { actor: 'x' } : 'authority-value',
      });
      const result = validateAdvisoryOpinion(attempt);
      assert.equal(result.ok, false, `field '${field}' must be refused`);
      if (!result.ok) {
        assert.equal(result.diagnostics[0]?.code, 'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN');
        assert.match(result.diagnostics[0]?.message ?? '', new RegExp(`'${field}'`));
      }
    }
  });

  it('refuses any certainty other than the SUGGESTIVE ceiling as a promotion attempt', () => {
    for (const certainty of ['DECISIVE', 'PROBATIVE', 'INSUFFICIENT_EVIDENCE']) {
      const result = validateAdvisoryOpinion(advisoryFixture({ certainty }));
      assert.equal(result.ok, false, `certainty '${certainty}' must be refused`);
      if (!result.ok) {
        assert.equal(result.diagnostics[0]?.code, 'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN');
      }
    }
  });

  it('refuses unknown fields (no-widening) and malformed identifiers', () => {
    const widened = validateAdvisoryOpinion(
      advisoryFixture({ suggestedUrl: 'https://example.test/x' }),
    );
    assert.equal(widened.ok, false);
    if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');

    const malformed = validateAdvisoryOpinion(advisoryFixture({ opinionId: 'bad id!' }));
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.diagnostics[0]?.code, 'MALFORMED_REQUIRED_FIELD');
  });
});

describe('advisory → authority conversion is doubly refused', () => {
  it('runtime: the T01 intent boundary refuses an advisory object outright', () => {
    const advisory = validateAdvisoryOpinion(advisoryFixture());
    assert.equal(advisory.ok, true);
    const asIntentAttempt = validateConfirmedIntent(advisory.ok ? advisory.value : undefined);
    assert.equal(asIntentAttempt.ok, false);
    if (!asIntentAttempt.ok) {
      assert.equal(asIntentAttempt.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
    }
  });

  it('runtime: the T01 route-table boundary refuses an advisory mapped as an operation row', () => {
    const declarations: OperationDeclaration[] = [
      {
        operationId: 'acquisition.acquire',
        capabilityId: 'acquisition',
        handlerId: 'acquireFile',
        effectClass: 'non-idempotent',
        externalEffect: true,
      },
    ];
    const advisoryRow = advisoryFixture({ intentId: 'intent-1' }) as unknown as OperationRouteRow;
    const routed = validateRouteTable([advisoryRow], declarations);
    assert.equal(routed.ok, false);
    if (!routed.ok) {
      assert.equal(routed.diagnostics[0]?.code, 'CONTRACT_BINDING_MISMATCH');
    }
  });

  it('runtime: refuseAdvisoryAsAuthority blocks advisories at authority boundaries and passes authorities', () => {
    const advisory = validateAdvisoryOpinion(advisoryFixture());
    assert.equal(advisory.ok, true);
    const blocked = refuseAdvisoryAsAuthority(advisory.ok ? advisory.value : undefined);
    assert.equal(blocked.ok, false);
    if (!blocked.ok)
      assert.equal(blocked.diagnostics[0]?.code, 'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN');

    const authority = {
      requestId: 'req-001',
      lineageId: 'lineage-001',
      targetRef: 'ref:target-001',
      outputRootScope: 'C:/tmp/authorized-root',
      allowedOperation: 'acquisition.acquire',
      slice: 'S1',
      caller: { actor: 'poc-host', sessionRef: 'session-001' },
    };
    assert.equal(refuseAdvisoryAsAuthority(authority).ok, true);
  });

  it('compile-time: AdvisoryOpinion is not assignable to ConfirmedDownloadIntent', () => {
    const advisory = validateAdvisoryOpinion(advisoryFixture());
    assert.equal(advisory.ok, true);
    if (!advisory.ok) throw new Error('unreachable');
    const opinion: AdvisoryOpinion = advisory.value;
    // @ts-expect-error — an advisory is not a confirmed intent (no structural overlap).
    const asIntent: ConfirmedDownloadIntent = opinion;
    void asIntent;
  });
});

describe('applyAdvisories — contestation only, never confirmation', () => {
  it('an advisory on the unique match forces REQUIRES_CONFIRMATION (ADVISORY_CONTESTED)', () => {
    const { scope, evaluation } = uniqueMatchEvaluation();
    assert.equal(selectTarget(evaluation).outcome, 'SELECTED');
    const advisory = validateAdvisoryOpinion(advisoryFixture({ aboutMemberId: 'member-a' }));
    assert.equal(advisory.ok, true);
    if (!advisory.ok) throw new Error('unreachable');
    const contested = applyAdvisories(evaluation, scope, [advisory.value]);
    assert.equal(contested.ok, true);
    if (!contested.ok) throw new Error('unreachable');
    const decision = selectTarget(evaluation, contested.value);
    assert.equal(decision.outcome, 'REQUIRES_CONFIRMATION');
    if (decision.outcome === 'REQUIRES_CONFIRMATION') {
      assert.equal(decision.reason, 'ADVISORY_CONTESTED');
      assert.deepEqual(decision.contestedMemberIds, ['member-a']);
    }
  });

  it('an advisory on a non-selected member cannot change the selection', () => {
    const { scope, evaluation } = uniqueMatchEvaluation();
    const advisory = validateAdvisoryOpinion(advisoryFixture({ aboutMemberId: 'member-b' }));
    assert.equal(advisory.ok, true);
    if (!advisory.ok) throw new Error('unreachable');
    const contested = applyAdvisories(evaluation, scope, [advisory.value]);
    assert.equal(contested.ok, true);
    if (!contested.ok) throw new Error('unreachable');
    const decision = selectTarget(evaluation, contested.value);
    assert.equal(decision.outcome, 'SELECTED');
    if (decision.outcome === 'SELECTED') {
      assert.equal(decision.selectedMemberId, 'member-a');
    }
  });

  it('advisories outside the declared finite scope are refused (membership drift)', () => {
    const { scope, evaluation } = uniqueMatchEvaluation();
    const advisory = validateAdvisoryOpinion(advisoryFixture({ aboutMemberId: 'member-zz' }));
    assert.equal(advisory.ok, true);
    if (!advisory.ok) throw new Error('unreachable');
    const contested = applyAdvisories(evaluation, scope, [advisory.value]);
    assert.equal(contested.ok, false);
    if (!contested.ok) assert.equal(contested.diagnostics[0]?.code, 'MEMBERSHIP_DRIFT');
  });
});

describe('runSemanticLaneWithAdvisories — bounded end-to-end advisory path', () => {
  function laneRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      recipe: {
        recipeId: 'recipe:fixture-video',
        matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
      },
      scope: { basis: FINITE_MEMBERSHIP_BASIS, memberIds: ['member-a', 'member-b'] },
      observations: [
        { memberId: 'member-a', facts: { kind: 'video' } },
        { memberId: 'member-b', facts: { kind: 'audio' } },
      ],
      ...overrides,
    };
  }

  function decodedRequest(overrides: Record<string, unknown> = {}) {
    const decoded = decodeSemanticLaneRequest(laneRequest(overrides));
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error('unreachable: fixture lane request refused');
    return decoded.value;
  }

  it('an invalid advisory (grant field) refuses the whole run — no partial outcome', () => {
    const result = runSemanticLaneWithAdvisories(decodedRequest(), [
      advisoryFixture({ grant: 'acquisition.acquire' }),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, 'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN');
    }
  });

  it('a valid advisory can only add ambiguity; it can never resolve one', () => {
    // Ambiguous base: both members match. An advisory cannot turn this into a selection.
    const ambiguous = decodedRequest({
      observations: [
        { memberId: 'member-a', facts: { kind: 'video' } },
        { memberId: 'member-b', facts: { kind: 'video' } },
      ],
    });
    const contestedAmbiguous = runSemanticLaneWithAdvisories(ambiguous, [advisoryFixture()]);
    assert.equal(contestedAmbiguous.ok, true);
    if (contestedAmbiguous.ok) {
      assert.equal(contestedAmbiguous.value.outcome, 'REQUIRES_CONFIRMATION');
      if (contestedAmbiguous.value.outcome === 'REQUIRES_CONFIRMATION') {
        assert.equal(contestedAmbiguous.value.reason, 'AMBIGUOUS_TIE');
      }
    }
    // Unique base: an advisory on the selected member downgrades to confirmation.
    const unique = runSemanticLaneWithAdvisories(decodedRequest(), [
      advisoryFixture({ aboutMemberId: 'member-a' }),
    ]);
    assert.equal(unique.ok, true);
    if (unique.ok) {
      assert.equal(unique.value.outcome, 'REQUIRES_CONFIRMATION');
      if (unique.value.outcome === 'REQUIRES_CONFIRMATION') {
        assert.equal(unique.value.reason, 'ADVISORY_CONTESTED');
      }
    }
  });
});
