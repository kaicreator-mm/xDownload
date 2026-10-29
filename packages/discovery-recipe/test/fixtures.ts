/**
 * T011 concern-test fixtures. Builders return RAW plain objects so every test
 * exercises the untrusted-input decode path, plus canonical budget/evidence
 * helpers. Fixture page/member corpora are structured local data — no
 * browser, network, filesystem or live-web inputs (T003 owns corpora).
 */

import {
  budgetRemaining,
  coverageTargetFor,
  decodeAcquisitionContract,
  decodeBudgetProfile,
  decodeSelectionSnapshot,
  evidenceRecord,
  makeEvidenceId,
  makeMemberId,
  unwrapOrThrow,
  type AcquisitionContract,
  type BudgetRemaining,
  type ClaimSubject,
  type ClaimType,
  type ContinuationScope,
  type EvidenceId,
  type EvidenceRecord,
  type MemberId,
  type SelectionSnapshot,
} from '@xdownload/domain-contracts';
import { decodeRecipeDefinition, type RecipeDefinition } from '../src/index.ts';

export const SCHEMA = { schema: 'xdownload.domain-contracts', version: '1.0.0' } as const;

export const mid = (raw: string): MemberId => unwrapOrThrow(makeMemberId(raw));
export const eid = (raw: string): EvidenceId => unwrapOrThrow(makeEvidenceId(raw));

export const BUDGET_PROFILE_RAW = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 50,
    maxNavigationActions: 20,
    maxModelCalls: 5,
  },
  transfer: { domain: 'transfer', maxBytes: 1_000_000_000, maxSegments: 5000 },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

const ZERO_CONSUMED = {
  discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
  transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
} as const;

const FULL_DISCOVERY_CONSUMED = {
  discovery: { generatedRequests: 50, navigationActions: 20, modelCalls: 5 },
  transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
} as const;

const FULL_GLOBAL_CONSUMED = {
  discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
  transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 500, modelCostUnits: 0, activeElapsedMs: 7_200_000 },
} as const;

const FULL_TRANSFER_CONSUMED = {
  discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
  transfer: { bytes: 1_000_000_000, segments: 5000, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
} as const;

const profile = unwrapOrThrow(decodeBudgetProfile(BUDGET_PROFILE_RAW));

/** All three budget domains have room. */
export const budgetsOpen: BudgetRemaining = budgetRemaining(profile, ZERO_CONSUMED);
/** DiscoveryBudget exhausted; transfer/global open (C23/C28 shape). */
export const budgetsDiscoveryExhausted: BudgetRemaining = budgetRemaining(
  profile,
  FULL_DISCOVERY_CONSUMED,
);
/** GlobalSafetyBudget exhausted (highest stop precedence). */
export const budgetsGlobalExhausted: BudgetRemaining = budgetRemaining(
  profile,
  FULL_GLOBAL_CONSUMED,
);
/** TransferBudget exhausted. */
export const budgetsTransferExhausted: BudgetRemaining = budgetRemaining(
  profile,
  FULL_TRANSFER_CONSUMED,
);

const S5_LAYERS = ['membership', 'target', 'transfer', 'format', 'coverage'] as const;
const S6_LAYERS = ['membership', 'target', 'transfer', 'coverage'] as const;

/** Confirmed `current_page` collection contract (S5 shape), continuation NONE. */
export function confirmedCurrentPageContract(
  overrides: Record<string, unknown> = {},
): AcquisitionContract {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: SCHEMA,
      contractId: 'contract-s5-current-page',
      status: 'CONFIRMED',
      intentType: 'COLLECTION',
      requestedTarget: 'target-current-page-root',
      collectionIdentity: 'collection/current-page-001',
      membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
      requestedScope: { kind: 'current_page', collectionIdentity: 'collection/current-page-001' },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      explorationPermission: 'NONE',
      budgetProfile: BUDGET_PROFILE_RAW,
      authorizationContextRef: 'authctx/local-s5',
      validationPolicy: { requiredLayers: S5_LAYERS },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Confirmed supported-collection contract (S6 shape) with optional continuation. */
export function confirmedPlaylistContract(
  overrides: Record<string, unknown> = {},
  continuation: ContinuationScope = { kind: 'NONE' },
  explorationPermission:
    'COLLECTION_MEMBER_EDGES' | 'DECLARED_CONTINUATION_EDGES' = continuation.kind === 'NONE'
    ? 'COLLECTION_MEMBER_EDGES'
    : 'DECLARED_CONTINUATION_EDGES',
): AcquisitionContract {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: SCHEMA,
      contractId: 'contract-s6-playlist',
      status: 'CONFIRMED',
      intentType: 'COLLECTION',
      requestedTarget: 'target-playlist-root',
      collectionIdentity: 'collection/playlist-042',
      membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/playlist-v1' },
      requestedScope: {
        kind: 'entire_supported_collection',
        collectionIdentity: 'collection/playlist-042',
      },
      continuationScope: continuation,
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      explorationPermission: explorationPermission,
      budgetProfile: BUDGET_PROFILE_RAW,
      authorizationContextRef: 'authctx/local-s6',
      validationPolicy: { requiredLayers: S6_LAYERS },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Confirmed `collection_page_range` contract. */
export function confirmedPageRangeContract(
  fromPage: number,
  toPage: number,
  overrides: Record<string, unknown> = {},
): AcquisitionContract {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: SCHEMA,
      contractId: `contract-page-range-${String(fromPage)}-${String(toPage)}`,
      status: 'CONFIRMED',
      intentType: 'COLLECTION',
      requestedTarget: 'target-gallery-root',
      collectionIdentity: 'collection/gallery-007',
      membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
      requestedScope: {
        kind: 'collection_page_range',
        collectionIdentity: 'collection/gallery-007',
        fromPage: fromPage,
        toPage: toPage,
      },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      explorationPermission: 'COLLECTION_MEMBER_EDGES',
      budgetProfile: BUDGET_PROFILE_RAW,
      authorizationContextRef: 'authctx/local-range',
      validationPolicy: { requiredLayers: S6_LAYERS },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Confirmed user-declared finite member set contract. */
export function confirmedFiniteSetContract(
  memberIds: readonly string[],
  overrides: Record<string, unknown> = {},
): AcquisitionContract {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: SCHEMA,
      contractId: 'contract-finite-set',
      status: 'CONFIRMED',
      intentType: 'COLLECTION',
      requestedTarget: 'target-declared-set',
      collectionIdentity: 'collection/declared-001',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: {
        kind: 'explicit_member_set',
        collectionIdentity: 'collection/declared-001',
        memberIds: memberIds,
      },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      explorationPermission: 'NONE',
      budgetProfile: BUDGET_PROFILE_RAW,
      authorizationContextRef: 'authctx/local-finite',
      validationPolicy: { requiredLayers: S6_LAYERS },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Snapshot basis matching the contract's membership basis. */
function snapshotBasisFor(contract: AcquisitionContract): Record<string, unknown> {
  const basis = contract.membershipBasis?.basis;
  if (basis === 'CONFIRMED_PAGE_SNAPSHOT') {
    return { kind: 'CONFIRMED_PAGE_SNAPSHOT' };
  }
  if (basis === 'DECLARED_FINITE_SET') {
    const scope = contract.requestedScope;
    const memberIds =
      scope.kind === 'explicit_member_set' || scope.kind === 'selected_collection_members'
        ? [...scope.memberIds]
        : [];
    return { kind: 'EXPLICIT_IDENTITIES', memberIds: memberIds };
  }
  return { kind: 'SUPPORTED_COLLECTION_MEMBERSHIP' };
}

/** Build a confirmed snapshot binding exactly the contract's frozen scope (raw decode path). */
export function snapshotFor(
  contract: AcquisitionContract,
  selectedMemberIds: readonly string[],
  overrides: Record<string, unknown> = {},
): SelectionSnapshot {
  const claims = overrides['selectionClaims'] ?? [
    {
      kind: 'BATCH',
      confirmationType: 'CONFIRM_SELECTION',
      memberRefs: [...selectedMemberIds],
    },
  ];
  const coverageTarget = {
    ...coverageTargetFor(contract.requestedScope, 1),
    collectionIdentity: contract.collectionIdentity ?? null,
  };
  return unwrapOrThrow(
    decodeSelectionSnapshot({
      schemaIdentity: SCHEMA,
      snapshotId: `snapshot-for-${contract.contractId}`,
      contractId: contract.contractId,
      collectionIdentity: contract.collectionIdentity,
      requestedScope: contract.requestedScope,
      continuationScope: contract.continuationScope,
      coverageTarget: coverageTarget,
      requestedMemberBasis: snapshotBasisFor(contract),
      authAccessibleBasis: { kind: 'UNKNOWN' },
      selectedMemberIds: [...selectedMemberIds],
      authorizationContextRef: contract.authorizationContextRef,
      profileContextRef: 'profile/default-001',
      selectionClaims: claims,
      sourceMarker: { system: 'xdownload-discovery-recipe', version: 'v0.1.0' },
      createdAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Independently validated evidence record (oracle-grade). */
export function independentEvidence(
  evidenceId: string,
  claimSubject: ClaimSubject,
  claimType: ClaimType = 'MEMBERSHIP',
): EvidenceRecord {
  return evidenceRecord({
    evidenceId: eid(evidenceId),
    claimType: claimType,
    claimSubject: claimSubject,
    sourceType: 'INDEPENDENT_VALIDATOR',
    provenance: { sourceIdentity: 'validator:independent-fixture' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'MEMBERSHIP' },
    certaintyClass: 'DECISIVE',
  });
}

/** Discovery-derived membership evidence from discovery itself (never oracle-grade). */
export function discoveryEvidence(
  evidenceId: string,
  claimSubject: ClaimSubject,
  claimType: ClaimType = 'MEMBERSHIP',
): EvidenceRecord {
  return evidenceRecord({
    evidenceId: eid(evidenceId),
    claimType: claimType,
    claimSubject: claimSubject,
    sourceType: 'DISCOVERY_INFERENCE',
    provenance: { sourceIdentity: 'discovery:t011-engine' },
    independenceFromDiscovery: 'DISCOVERY_DERIVED',
    scope: { domain: 'MEMBERSHIP' },
    certaintyClass: 'PROBATIVE',
  });
}

/** The canonical declarative gallery recipe used across engine tests. */
export function galleryRecipe(overrides: Record<string, unknown> = {}): RecipeDefinition {
  return unwrapOrThrow(
    decodeRecipeDefinition({
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
      ...overrides,
    }),
  );
}

export const GALLERY_OBSERVATIONS: Readonly<Record<string, string>> = {
  pageKind: 'gallery',
  galleryTemplate: 'gallery-v1',
  membershipRelation: 'dom-figures[gallery-item]',
};

export function memberSubjects(ids: readonly string[]): ClaimSubject[] {
  return ids.map((id) => ({ kind: 'MEMBER' as const, ref: id }));
}

export const asMembers = (ids: readonly string[]): MemberId[] => ids.map((id) => mid(id));
