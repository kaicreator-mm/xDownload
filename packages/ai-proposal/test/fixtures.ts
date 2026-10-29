/**
 * T012 concern-test fixtures. Builders return RAW plain objects so every
 * test exercises the untrusted-input decode path. Structured local data
 * only — no browser, network, filesystem or live-model inputs.
 */

import type { ContractAuthorityFacts, ProposalEvaluationContext } from '../src/proposalPolicy.ts';
import type { ProviderIdentity } from '../src/providerPort.ts';
import { AI_PROPOSAL_SCHEMA_ID, AI_PROPOSAL_SCHEMA_VERSION } from '../src/proposalEnvelope.ts';

export const FAKE_PROVIDER_IDENTITY: ProviderIdentity = {
  providerId: 'fake/deterministic',
  modelId: 'bounded-recipe-proposer-1',
};

export const GAP_REF = 'gap/playlist-continuation-001';
export const CONTRACT_REF = 'contract-s6-playlist';

/** Confirmed playlist contract with declared natural-end continuation authority. */
export const CONTINUATION_CONTRACT: ContractAuthorityFacts = {
  status: 'CONFIRMED',
  continuationScope: { kind: 'DECLARED_NATURAL_END' },
  explorationPermission: 'DECLARED_CONTINUATION_EDGES',
};

/** Confirmed current-page contract without any continuation/exploration authority. */
export const CURRENT_PAGE_CONTRACT: ContractAuthorityFacts = {
  status: 'CONFIRMED',
  continuationScope: { kind: 'NONE' },
  explorationPermission: 'NONE',
};

export function evaluationContext(
  overrides: Partial<ProposalEvaluationContext> = {},
): ProposalEvaluationContext {
  return {
    expectedGapRef: GAP_REF,
    expectedContractRef: CONTRACT_REF,
    expectedProvider: FAKE_PROVIDER_IDENTITY,
    ...overrides,
  };
}

/**
 * A legal model-proposed recipe (raw payload, decoded by the policy through
 * the unmodified Recipe decoder). Model proposals are SUGGESTIVE at best.
 */
export function legalRecipePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    recipeId: 'recipe/playlist-natural-end-suggested',
    applicabilityScope: {
      description: 'Supported playlist template pages with an explicit member relation',
      scopeKeys: ['playlist-template'],
    },
    matcher: {
      allOf: [
        { field: 'pageKind', op: 'equals', value: 'playlist' },
        { field: 'playlistTemplate', op: 'equals', value: 'playlist-v1' },
        { field: 'membershipRelation', op: 'exists' },
      ],
    },
    parameterSchema: [{ name: 'maxMembers', type: 'number', required: false }],
    allowedCapabilities: ['observe_current_page', 'collect_candidates'],
    evidenceRules: {
      emittedClaimTypes: ['RESOURCE_IDENTITY'],
      certaintyCeiling: 'SUGGESTIVE',
      independenceFromDiscovery: 'DISCOVERY_DERIVED',
      evidenceDomain: 'CONTINUATION_NAVIGATION',
    },
    validationRequirements: ['membership', 'target'],
    failureConditions: [
      { code: 'TEMPLATE_MISMATCH', description: 'Playlist template signature not matched' },
    ],
    deterministicFallback: {
      kind: 'ASK_USER',
      description: 'Ask the user to confirm the continuation basis',
    },
    ...overrides,
  };
}

/** Raw proposal envelope binding payload to the canonical gap/contract/provider context. */
export function proposalEnvelope(
  payload: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: { schema: AI_PROPOSAL_SCHEMA_ID, version: AI_PROPOSAL_SCHEMA_VERSION },
    proposalId: 'proposal/playlist-continuation-001',
    provider: {
      providerId: FAKE_PROVIDER_IDENTITY.providerId,
      modelId: FAKE_PROVIDER_IDENTITY.modelId,
    },
    provenance: { gapRef: GAP_REF, contractRef: CONTRACT_REF },
    payload: payload,
    ...overrides,
  };
}

/** Raw bounded gap envelope (untrusted caller shape). */
export function gapEnvelopeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gap: {
      gapId: 'gap/playlist-continuation-001',
      gapKind: 'CONTINUATION_UNCLOSABLE',
      description: 'playlist pagination control not identified on current page',
      fallbackPreference: 'ASK_USER',
    },
    observations: {
      pageKind: 'playlist',
      playlistTemplate: 'playlist-v1',
      membershipRelation: 'a.playlist-item',
    },
    capabilityFacts: ['observe_current_page', 'collect_candidates'],
    contractContext: {
      contractRef: CONTRACT_REF,
      scopeSummary: 'entire_supported_collection collection/playlist-042',
    },
    ...overrides,
  };
}

export const SENTINEL_SECRET = 'sentinel-session-cookie-9f2a7c';

/** Proposal bytes as the fake provider would return them for the legal case. */
export function legalProposalBytes(): Record<string, unknown> {
  return proposalEnvelope(legalRecipePayload());
}
