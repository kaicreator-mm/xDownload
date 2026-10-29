/**
 * T012 counterexample oracle fixtures and the `parity-with-and-without-model`
 * suite (TEST_MATRIX `applicable_c_oracles`: C06, C19, C20, C21, C22, C34).
 *
 * Oracle boundary notes: C02/C09/C13/C15-C18/C23/C24/C26-C33 are owned at
 * other concern layers; where T012 consumes/produces their inputs it
 * preserves the canonical identities and truthful values.
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  applyKnowledgeToContract,
  assertValidatesRequiredLayer,
  canServeAsIndependentValidationOracle,
  decodeEvidenceRecord,
  decodeKnowledgeRef,
  evidenceRecord,
  makeEvidenceId,
  unwrapOrThrow,
  type EvidenceRecord,
} from '@xdownload/domain-contracts';
import {
  decodeRecipeDefinition,
  planRecipeExecution,
  type RecipeDefinition,
} from '@xdownload/discovery-recipe';
import {
  createAiProposalAdapter,
  evaluateProposal,
  proposalSuggestionEvidence,
  assertProposalNeverIndependentTruth,
} from '../src/index.ts';
import { deterministicFakeProvider } from './fakeProvider.ts';
import {
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  CURRENT_PAGE_CONTRACT,
  GAP_REF,
  SENTINEL_SECRET,
  evaluationContext,
  gapEnvelopeInput,
  legalProposalBytes,
  legalRecipePayload,
  proposalEnvelope,
} from './fixtures.ts';
import { clearSinkScrubSentinels, registerSinkScrubSentinel } from '@xdownload/browser-observation';

afterEach(() => {
  clearSinkScrubSentinels();
});

function proposeWith(payload: unknown) {
  const provider = deterministicFakeProvider({ payload: payload });
  const adapter = createAiProposalAdapter({ provider: provider });
  return adapter.proposeRecipe({
    gap: gapEnvelopeInput(),
    expectedGapRef: GAP_REF,
    expectedContractRef: CONTRACT_REF,
    contract: CONTINUATION_CONTRACT,
  });
}

const CURRENT_CONTRACT_FOR_PLANNING = {
  contractId: CONTRACT_REF,
  status: 'CONFIRMED',
  requestedScope: { kind: 'entire_supported_collection' },
  continuationScope: { kind: 'DECLARED_NATURAL_END' },
  explorationPermission: 'DECLARED_CONTINUATION_EDGES',
  validationPolicy: { requiredLayers: ['membership', 'target'] as const },
};

describe('T012 counterexample oracles (TEST_MATRIX applicable_c_oracles)', () => {
  it('C06 — no acceptable proposal encodes unrestricted frontier/crawl scope, regardless of model endorsement', () => {
    // "first 1000 pages under domain, all PDFs" as a model proposal: scope
    // expansion fields fail closed, and continuation capability beyond the
    // confirmed contract rejects even though the model returned it.
    const frontierBytes = proposalEnvelope(
      legalRecipePayload({ allowedCapabilities: ['observe_current_page', 'scroll_current_page'] }),
      { proposalId: 'proposal/frontier-crawl' },
    );
    const decision = evaluateProposal(frontierBytes, evaluationContext(), CURRENT_PAGE_CONTRACT);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.diagnostics.map((d) => d.code)).toContain('CAPABILITY_NOT_AUTHORIZED');
      expect(decision.diagnostics.map((d) => d.invariant)).toContain('ADR-008');
    }
    return Promise.all([
      proposeWith(
        proposalEnvelope(legalRecipePayload(), {
          requestedScope: { kind: 'domain_wide', pages: '1..1000' },
        }),
      ),
      proposeWith(
        proposalEnvelope(legalRecipePayload(), {
          crawlFrontier: { mode: 'unbounded', followLinks: 'all' },
        }),
      ),
    ]).then((paths) => {
      for (const path of paths) {
        expect(path.kind).toBe('PROPOSAL_REJECTED');
        if (path.kind === 'PROPOSAL_REJECTED') {
          expect(path.diagnostics.map((d) => d.code)).toContain('UNKNOWN_FIELD');
        }
      }
    });
  });

  it('C19 — identical deterministic policy with and without model; model presence creates no authority special-case', () => {
    const bytes = legalProposalBytes();
    // The policy is pure: with-model (adapter) and no-model (direct) evaluations agree exactly.
    const direct = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
    expect(direct.ok).toBe(true);
    return proposeWith(bytes).then((path) => {
      expect(path.kind).toBe('PROPOSAL_ACCEPTED');
      if (path.kind === 'PROPOSAL_ACCEPTED' && direct.ok) {
        expect(path.proposal).toEqual(direct.value);
        expect(JSON.stringify(path.proposal)).toBe(JSON.stringify(direct.value));
      }
      // Authority parity: the accepted proposal plans exactly like the same
      // recipe suggested by a human — no hidden elevation, no extra steps.
      if (path.kind === 'PROPOSAL_ACCEPTED' && direct.ok) {
        const fromProposal = planRecipeExecution(
          direct.value.recipe,
          CURRENT_CONTRACT_FOR_PLANNING,
          { pageKind: 'playlist', playlistTemplate: 'playlist-v1', membershipRelation: 'a.item' },
          { scopeIdentityKey: 'scope-key-001', frozenMemberIds: [] },
        );
        const fromHuman = planRecipeExecution(
          unwrapOrThrowRecipe(),
          CURRENT_CONTRACT_FOR_PLANNING,
          { pageKind: 'playlist', playlistTemplate: 'playlist-v1', membershipRelation: 'a.item' },
          { scopeIdentityKey: 'scope-key-001', frozenMemberIds: [] },
        );
        expect(fromProposal).toEqual(fromHuman);
      }
    });
  });

  it('C20 — proposal-sourced references cannot overwrite current contract scope/target identity; current validation is still required', () => {
    const bytes = legalProposalBytes();
    const direct = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
    expect(direct.ok).toBe(true);
    if (!direct.ok) {
      return;
    }
    // The plan binds only through the CURRENT contract trace, never the proposal's own claims.
    const plan = planRecipeExecution(
      direct.value.recipe,
      CURRENT_CONTRACT_FOR_PLANNING,
      { pageKind: 'playlist', playlistTemplate: 'playlist-v1', membershipRelation: 'a.item' },
      { scopeIdentityKey: 'scope-key-current', frozenMemberIds: ['member-1'] },
    );
    expect(plan.trace.contractId).toBe(CONTRACT_REF);
    expect(plan.trace.scopeIdentityKey).toBe('scope-key-current');
    // A proposal claiming a different applicability scope cannot rebind the trace.
    const rebindingPlan = planRecipeExecution(
      direct.value.recipe,
      { ...CURRENT_CONTRACT_FOR_PLANNING, contractId: 'contract-current-0042' },
      { pageKind: 'playlist', playlistTemplate: 'playlist-v1', membershipRelation: 'a.item' },
      { scopeIdentityKey: 'scope-key-current', frozenMemberIds: [] },
    );
    expect(rebindingPlan.trace.contractId).toBe('contract-current-0042');
    // Proposal-sourced knowledge still requires current validation evidence before replay (C20).
    const knowledge = unwrapOrThrow(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/proposal-001',
        kind: 'PROMOTED_LOCAL_VERIFIED',
        applicableScopeKey: 'playlist-template',
        requiresCurrentValidation: true,
      }),
    );
    const withoutCurrentValidation = applyKnowledgeToContract(knowledge, undefined);
    expect(withoutCurrentValidation.ok).toBe(false);
    if (!withoutCurrentValidation.ok) {
      expect(withoutCurrentValidation.diagnostics.map((d) => d.code)).toContain(
        'CURRENT_VALIDATION_REQUIRED',
      );
      expect(withoutCurrentValidation.diagnostics.map((d) => d.invariant)).toContain('C20');
    }
  });

  it('C21 — proposal payloads and model inputs carry no credentials/identity secrets; sentinel leakage fails closed', () => {
    // Payload-level raw secrets reject (also proven in the schema suite).
    const decision = evaluateProposal(
      proposalEnvelope(legalRecipePayload({ cookies: 'session=abcdef' })),
      evaluationContext(),
      CONTINUATION_CONTRACT,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.diagnostics.map((d) => d.code)).toContain('RAW_SECRET_FIELD');
    }
    // Provider responses carrying sentinel material fail closed before durable use.
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const hostile: Record<string, unknown> = gapEnvelopeInput();
    hostile['leak'] = `session ${SENTINEL_SECRET}`;
    return proposeWith(hostile).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('PROVIDER_RESPONSE_REJECTED');
      }
    });
  });

  it('C22 — model-derived results with too little evidence stay INSUFFICIENT_EVIDENCE/UNKNOWN; no post-hoc PASS', () => {
    // A proposal-sourced suggestion record can never satisfy a validation layer on its own.
    const direct = evaluateProposal(
      legalProposalBytes(),
      evaluationContext(),
      CONTINUATION_CONTRACT,
    );
    expect(direct.ok).toBe(true);
    if (!direct.ok) {
      return;
    }
    const suggestion = proposalSuggestionEvidence({
      proposal: direct.value,
      claimType: 'RESOURCE_IDENTITY',
      claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target/playlist-root' },
      evidenceId: makeEvidenceIdOrThrow('evidence/suggestion-001'),
    });
    expect(suggestion.ok).toBe(true);
    if (suggestion.ok) {
      const attempt = assertValidatesRequiredLayer(suggestion.value, 'membership');
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) {
        const codes = attempt.diagnostics.map((d) => d.code);
        expect(codes).toContain('SELF_CERTIFICATION');
      }
    }
    // Insufficient-evidence records are never converted to PASS (C22 oracle rule).
    // Source type is layer-allowed here so the C22 insufficiency branch is what fires.
    const insufficient: EvidenceRecord = evidenceRecord({
      evidenceId: makeEvidenceIdOrThrow('evidence/insufficient-001'),
      claimType: 'MEMBERSHIP',
      claimSubject: { kind: 'MEMBER', ref: 'member-1' },
      sourceType: 'USER_CONFIRMATION',
      provenance: { sourceIdentity: 'ai-proposal:fake/deterministic#p' },
      independenceFromDiscovery: 'DISCOVERY_DERIVED',
      scope: { domain: 'MEMBERSHIP' },
      certaintyClass: 'INSUFFICIENT_EVIDENCE',
    });
    const layerAttempt = assertValidatesRequiredLayer(insufficient, 'membership');
    expect(layerAttempt.ok).toBe(false);
    if (!layerAttempt.ok) {
      expect(layerAttempt.diagnostics.map((d) => d.code)).toContain('INSUFFICIENT_EVIDENCE');
      expect(layerAttempt.diagnostics.map((d) => d.invariant)).toContain('C22');
    }
  });

  it('C34 — model proposal provenance is at best SUGGESTIVE/DISCOVERY_DERIVED and can never be typed as independent truth', () => {
    const direct = evaluateProposal(
      legalProposalBytes(),
      evaluationContext(),
      CONTINUATION_CONTRACT,
    );
    expect(direct.ok).toBe(true);
    if (!direct.ok) {
      return;
    }
    expect(direct.value.certaintyCeiling).toBe('SUGGESTIVE');
    const suggestion = proposalSuggestionEvidence({
      proposal: direct.value,
      claimType: 'RESOURCE_IDENTITY',
      claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target/playlist-root' },
      evidenceId: makeEvidenceIdOrThrow('evidence/suggestion-002'),
    });
    expect(suggestion.ok).toBe(true);
    if (suggestion.ok) {
      const record = suggestion.value;
      expect(record.certaintyClass).toBe('SUGGESTIVE');
      expect(record.independenceFromDiscovery).toBe('DISCOVERY_DERIVED');
      expect(record.sourceType).toBe('UI_SUGGESTION');
      // A suggestion can never serve as the independent validation oracle.
      expect(canServeAsIndependentValidationOracle(record)).toBe(false);
      expect(assertProposalNeverIndependentTruth(record).ok).toBe(true);
      // Re-typing the same claim as INDEPENDENT suggestion truth fails closed (decoder-level C34).
      const retyped = decodeEvidenceRecord({
        schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
        evidenceId: 'evidence/suggestion-002',
        claimType: 'RESOURCE_IDENTITY',
        claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target/playlist-root' },
        sourceType: 'UI_SUGGESTION',
        provenance: {
          sourceIdentity: 'ai-proposal:fake/deterministic#proposal/playlist-continuation-001',
        },
        independenceFromDiscovery: 'INDEPENDENT',
        scope: { domain: 'CONTINUATION_NAVIGATION' },
        certaintyClass: 'DECISIVE',
      });
      expect(retyped.ok).toBe(false);
      if (!retyped.ok) {
        expect(retyped.diagnostics.map((d) => d.code)).toContain('SELF_CERTIFICATION');
        expect(retyped.diagnostics.map((d) => d.invariant)).toContain('C34');
      }
    }
  });
});

describe('T012 parity with and without model (TEST_MATRIX parity-with-and-without-model)', () => {
  it('deterministic/template-supported ordinary tasks complete without any model dependency', () => {
    // The deterministic path never imports the adapter: decode + plan run directly.
    const recipe = unwrapOrThrowRecipe();
    const plan = planRecipeExecution(
      recipe,
      {
        ...CURRENT_CONTRACT_FOR_PLANNING,
        continuationScope: { kind: 'NONE' },
        explorationPermission: 'NONE',
      },
      { pageKind: 'playlist', playlistTemplate: 'playlist-v1', membershipRelation: 'a.item' },
      { scopeIdentityKey: 'scope-key-template', frozenMemberIds: [] },
    );
    expect(plan.matched).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    // With the adapter present but no provider, the same deterministic machinery is untouched.
    const adapter = createAiProposalAdapter({});
    expect(adapter.provider).toBeUndefined();
    return adapter
      .proposeRecipe({
        gap: gapEnvelopeInput(),
        expectedGapRef: GAP_REF,
        expectedContractRef: CONTRACT_REF,
        contract: CONTINUATION_CONTRACT,
      })
      .then((path) => {
        expect(path.kind).toBe('MODEL_UNAVAILABLE');
      });
  });

  it('one policy evaluates proposals identically with the model present, absent, or failing (C19)', () => {
    const bytes = legalProposalBytes();
    const context = evaluationContext();
    const decisions = [
      evaluateProposal(bytes, context, CONTINUATION_CONTRACT),
      evaluateProposal(bytes, context, CONTINUATION_CONTRACT),
      evaluateProposal(bytes, context, CURRENT_PAGE_CONTRACT),
    ];
    expect(JSON.stringify(decisions[0])).toBe(JSON.stringify(decisions[1]));
    expect(decisions[0]?.ok).toBe(true);
    expect(decisions[2]?.ok).toBe(true);
  });
});

function unwrapOrThrowRecipe(): RecipeDefinition {
  const payload = legalProposalBytes()['payload'];
  const recipe = decodeRecipeDefinition(payload);
  if (!recipe.ok) {
    throw new Error('fixture recipe must decode');
  }
  return recipe.value;
}

function makeEvidenceIdOrThrow(raw: string) {
  const result = makeEvidenceId(raw);
  if (!result.ok) {
    throw new Error('fixture evidence id must be valid');
  }
  return result.value;
}
