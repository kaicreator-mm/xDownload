/**
 * TEST_MATRIX oracles C20 / C21 / C31 through the composed flow.
 *
 * Must prove:
 * - a local recipe replay validates against CURRENT observations: a changed
 *   page/session/layout cannot silently overwrite the frozen scope/targets —
 *   the composed flow surfaces the recipe's deterministic fallback instead of
 *   executing (C20);
 * - shared recipe/selection knowledge carries only opaque
 *   AuthorizationContextRef between reuse and acquisition; task-local
 *   selection cannot become reusable membership authority without validated
 *   provenance (C21/C31).
 */

import { describe, expect, it } from 'vitest';
import {
  assertSelectionKnowledgeReusable,
  decodeRecipeDefinition,
  planRecipeExecution,
} from '@xdownload/discovery-recipe';
import {
  createEvidenceLedger,
  evidenceRecord,
  type EvidenceRecord,
} from '@xdownload/domain-contracts';
import { eid, independentEvidence, SCHEMA } from './fixtures.ts';

const GALLERY_RECIPE = decodeRecipeDefinition({
  schemaIdentity: SCHEMA,
  recipeId: 'recipe/gallery-v1',
  applicabilityScope: {
    description: 'Supported gallery template pages with an explicit member relation',
    scopeKeys: ['gallery-template'],
  },
  matcher: {
    allOf: [
      { field: 'pageKind', op: 'equals', value: 'gallery' },
      { field: 'galleryTemplate', op: 'equals', value: 'gallery-v1' },
      { field: 'membershipRelation', op: 'exists' },
    ],
  },
  parameterSchema: [{ name: 'maxMembers', type: 'number', required: false }],
  allowedCapabilities: [
    'observe_current_page',
    'observe_network',
    'collect_candidates',
    'scroll_current_page',
    'open_confirmed_member_detail',
    'follow_declared_collection_continuation',
  ],
  evidenceRules: {
    emittedClaimTypes: ['RESOURCE_IDENTITY', 'MEMBERSHIP'],
    certaintyCeiling: 'PROBATIVE',
    independenceFromDiscovery: 'DISCOVERY_DERIVED',
    evidenceDomain: 'MEMBERSHIP',
  },
  validationRequirements: ['membership', 'target'],
  failureConditions: [
    { code: 'TEMPLATE_MISMATCH', description: 'Gallery template signature not matched' },
  ],
  deterministicFallback: {
    kind: 'ASK_USER',
    description: 'Ask the user to confirm the collection membership basis',
  },
});

const contractShape = {
  contractId: 'contract-s5-current-page',
  status: 'CONFIRMED',
  requestedScope: { kind: 'current_page' },
  continuationScope: { kind: 'NONE' },
  explorationPermission: 'NONE',
  validationPolicy: { requiredLayers: ['membership', 'target'] as const },
};

const ORIGINAL_OBSERVATIONS = {
  pageKind: 'gallery',
  galleryTemplate: 'gallery-v1',
  membershipRelation: 'dom-figures[gallery-item]',
};

const CHANGED_OBSERVATIONS = {
  pageKind: 'gallery',
  galleryTemplate: 'gallery-v2-redesigned',
  membershipRelation: 'dom-figures[gallery-item]',
};

describe('T016 selection knowledge and recipe replay', () => {
  it('replays the local recipe against current observations and never overwrites the frozen scope (C20)', () => {
    const recipe = GALLERY_RECIPE;
    expect(recipe.ok).toBe(true);
    if (!recipe.ok) throw new Error('unreachable');

    const frozenScopeKey = 'current_page:collection/current-page-001';
    const frozenMembers = ['pl-member-001', 'pl-member-002'];

    // First plan on the original page: matched, with the continuation
    // capability excluded because the confirmed scope is NONE (C06/C08 bond).
    const originalPlan = planRecipeExecution(recipe.value, contractShape, ORIGINAL_OBSERVATIONS, {
      scopeIdentityKey: frozenScopeKey,
      frozenMemberIds: frozenMembers,
    });
    expect(originalPlan.matched).toBe(true);
    expect(originalPlan.trace.contractId).toBe('contract-s5-current-page');
    expect(originalPlan.trace.scopeIdentityKey).toBe(frozenScopeKey);
    expect(
      originalPlan.excluded.some(
        (entry) =>
          entry.capability === 'scroll_current_page' && entry.reason === 'CONTINUATION_SCOPE_NONE',
      ),
    ).toBe(true);

    // Replay on a CHANGED page/session/layout: the matcher fails against the
    // current observation and the deterministic fallback (ASK_USER) surfaces.
    // Nothing about the frozen scope/targets is overwritten.
    const replayPlan = planRecipeExecution(recipe.value, contractShape, CHANGED_OBSERVATIONS, {
      scopeIdentityKey: frozenScopeKey,
      frozenMemberIds: frozenMembers,
    });
    expect(replayPlan.matched).toBe(false);
    expect(replayPlan.fallback?.kind).toBe('ASK_USER');
    expect(replayPlan.steps.length).toBe(0);
    // The frozen targets survive the failed replay untouched.
    expect(frozenMembers).toEqual(['pl-member-001', 'pl-member-002']);
    expect(replayPlan.trace.scopeIdentityKey).toBe(originalPlan.trace.scopeIdentityKey);
  });

  it('task-local selection never becomes reusable membership authority without validated provenance (C31)', () => {
    // Prior 12-of-18 selection knowledge from a different page: applying it
    // without current validated provenance fails closed.
    const taskLocal = {
      knowledgeId: 'knowledge/task-local-12of18',
      kind: 'TASK_LOCAL_SELECTION' as const,
      applicableScopeKey: 'current_page:collection/other-page-009',
      requiresCurrentValidation: true as const,
    };
    const withoutEvidence = assertSelectionKnowledgeReusable({
      knowledge: taskLocal,
      currentValidationEvidence: undefined,
    });
    expect(withoutEvidence.ok).toBe(false);

    // Even unrelated oracle-grade evidence for a different subject does not
    // re-bind the stale task-local selection to the current page.
    const ledger = createEvidenceLedger();
    const unrelated = independentEvidence('evidence-unrelated-page', {
      kind: 'MEMBER',
      ref: 'pl-member-001',
    });
    const appended = ledger.append(unrelated);
    expect(appended.ok).toBe(true);
    const stale = assertSelectionKnowledgeReusable({
      knowledge: taskLocal,
      currentValidationEvidence: appended.ok ? (appended.value as EvidenceRecord) : undefined,
    });
    expect(stale.ok).toBe(false);
  });

  it('promoted knowledge requires current validated provenance; the composed flow carries opaque refs only (C21)', () => {
    // PROMOTED_LOCAL_VERIFIED knowledge without CURRENT validated evidence
    // cannot constrain a new contract (C20 revalidation requirement).
    const promoted = {
      knowledgeId: 'knowledge/promoted-gallery-v1',
      kind: 'PROMOTED_LOCAL_VERIFIED' as const,
      applicableScopeKey: 'current_page:collection/current-page-001',
      requiresCurrentValidation: true as const,
    };
    const withoutCurrent = assertSelectionKnowledgeReusable({
      knowledge: promoted,
      currentValidationEvidence: undefined,
    });
    expect(withoutCurrent.ok).toBe(false);

    // With current oracle-grade validation evidence the promoted knowledge
    // binds — the only sanctioned reuse path.
    const ledger = createEvidenceLedger();
    const current = ledger.append(
      independentEvidence(
        'evidence-current-page-validation',
        { kind: 'COVERAGE_TARGET', ref: 'current_page:collection/current-page-001' },
        'MEMBERSHIP',
      ),
    );
    expect(current.ok).toBe(true);
    const reusable = assertSelectionKnowledgeReusable({
      knowledge: promoted,
      currentValidationEvidence: current.ok ? current.value : undefined,
    });
    expect(reusable.ok).toBe(true);

    // Suggestion-grade observations never satisfy the revalidation
    // requirement — shared knowledge cannot re-bind authority on suggestion
    // grade (C21). The composed flow itself carries only the opaque broker
    // ref between reuse and acquisition (proven in the S2/auth suites).
    const suggestive = ledger.append(
      evidenceRecord({
        evidenceId: eid('evidence-suggestive-observation'),
        claimType: 'MEMBERSHIP',
        claimSubject: { kind: 'COVERAGE_TARGET', ref: 'current_page:collection/current-page-001' },
        sourceType: 'UI_SUGGESTION',
        provenance: { sourceIdentity: 'suggestion:observation-fixture' },
        independenceFromDiscovery: 'DISCOVERY_DERIVED',
        scope: { domain: 'MEMBERSHIP' },
        certaintyClass: 'SUGGESTIVE',
      }),
    );
    expect(suggestive.ok).toBe(true);
    const onSuggestion = assertSelectionKnowledgeReusable({
      knowledge: promoted,
      currentValidationEvidence: suggestive.ok ? suggestive.value : undefined,
    });
    expect(onSuggestion.ok).toBe(false);
  });
});
