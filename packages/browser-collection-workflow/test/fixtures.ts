/**
 * T016 concern-test fixtures. Contracts/snapshots/evidence builders return RAW
 * plain objects decoded through the canonical domain-contracts paths (same
 * discipline as the T011/T015 fixtures). Fixture pages/members are structured
 * local data plus the shared controlled localhost HTTP fixture — no browser,
 * no third-party network, fresh per case.
 *
 * Real-browser tuple execution is owned by T021 on the exact T016 candidate;
 * T016 introduces no browser driver (recorded F1 choice), so every suite here
 * proves the composed flows at fixture/observation-feed level.
 */

import { createHash } from 'node:crypto';
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
  type ConfirmationOutcome,
  type ContinuationScope,
  type EvidenceRecord,
  type SelectionSnapshot,
} from '@xdownload/domain-contracts';
import type {
  ConfirmationOutcomeSource,
  ConfirmationOutcomeSourceResolution,
} from '../src/index.ts';

export const SCHEMA = { schema: 'xdownload.domain-contracts', version: '1.0.0' } as const;

export const mid = (raw: string) => unwrapOrThrow(makeMemberId(raw));
export const eid = (raw: string) => unwrapOrThrow(makeEvidenceId(raw));

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Deterministic payload of a given size (repeating byte pattern). */
export function payload(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index + seed) % 251;
  }
  return bytes;
}

/** Deterministic bytes derived from a stable identifier (fixture delivery). */
export function seedBytes(size: number, id: string): Uint8Array {
  let seed = 7;
  for (const char of id) {
    seed = (seed * 31 + char.charCodeAt(0)) % 251;
  }
  return payload(size, seed);
}

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

const profile = unwrapOrThrow(decodeBudgetProfile(BUDGET_PROFILE_RAW));

/** All three budget domains have room. */
export const budgetsOpen: BudgetRemaining = budgetRemaining(profile, ZERO_CONSUMED);
/** DiscoveryBudget exhausted; transfer/global open (C23 shape). */
export const budgetsDiscoveryExhausted: BudgetRemaining = budgetRemaining(
  profile,
  FULL_DISCOVERY_CONSUMED,
);
/** GlobalSafetyBudget exhausted (highest stop precedence; C02 cap shape). */
export const budgetsGlobalExhausted: BudgetRemaining = budgetRemaining(
  profile,
  FULL_GLOBAL_CONSUMED,
);

const S5_LAYERS = ['membership', 'target', 'transfer', 'format', 'coverage'] as const;
const S6_LAYERS = ['membership', 'target', 'transfer', 'coverage'] as const;

/** Confirmed S2 single-resource contract (explicit current-page attachment). */
export function singleResourceContract(
  overrides: Record<string, unknown> = {},
): AcquisitionContract {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: SCHEMA,
      contractId: 'contract-s2-attachment',
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      requestedTarget: 'target-s2-file-001',
      requestedScope: { kind: 'single_resource', targetId: 'target-s2-file-001' },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
      automationMode: 'AUTO',
      explorationPermission: 'NONE',
      budgetProfile: BUDGET_PROFILE_RAW,
      authorizationContextRef: 'authctx/local-s2',
      validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Confirmed current-page collection contract (S5 shape), continuation NONE. */
export function currentPageContract(overrides: Record<string, unknown> = {}): AcquisitionContract {
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
export function playlistContract(
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

/** Confirmed collection_page_range contract (gallery pages). */
export function pageRangeContract(
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
        fromPage,
        toPage,
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
export function finiteSetContract(
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
        memberIds: [...memberIds],
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
    return { kind: 'EXPLICIT_IDENTITIES', memberIds };
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
    { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: [...selectedMemberIds] },
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
      coverageTarget,
      requestedMemberBasis: snapshotBasisFor(contract),
      authAccessibleBasis: { kind: 'UNKNOWN' },
      selectedMemberIds: [...selectedMemberIds],
      authorizationContextRef: contract.authorizationContextRef,
      profileContextRef: 'profile/default-001',
      selectionClaims: claims,
      sourceMarker: { system: 'xdownload-browser-collection-workflow', version: 'v0.1.0' },
      createdAt: '2026-10-04T02:00:00Z',
      ...overrides,
    }),
  );
}

/** Raw untrusted PAGE_CONTEXT observation message (pre-gate) for a fixture page. */
export function pageContextObservation(input: {
  readonly origin: string;
  readonly pageUrl: string;
  readonly title?: string;
  readonly partition?: string;
  readonly tabId?: number;
}): Record<string, unknown> {
  return {
    boundary: 'CONTENT_SCRIPT',
    kind: 'PAGE_CONTEXT',
    provenance: {
      tabId: input.tabId ?? 7,
      frameId: 0,
      origin: input.origin,
      ...(input.partition === undefined ? {} : { partition: input.partition }),
    },
    payload: {
      pageUrl: input.pageUrl,
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  };
}

/** Raw untrusted NETWORK_OBSERVATION message bound to a fixture request. */
export function networkObservation(input: {
  readonly origin: string;
  readonly requestUrl: string;
  readonly requestRef: string;
}): Record<string, unknown> {
  return {
    boundary: 'CONTENT_SCRIPT',
    kind: 'NETWORK_OBSERVATION',
    provenance: { tabId: 7, frameId: 0, origin: input.origin, requestRef: input.requestRef },
    payload: { requestUrl: input.requestUrl, requestMethod: 'GET' },
  };
}

/** Independently validated evidence record (oracle-grade, T011 pattern). */
export function independentEvidence(
  evidenceId: string,
  claimSubject: ClaimSubject,
  claimType: ClaimType = 'AUTHORIZATION',
): EvidenceRecord {
  return evidenceRecord({
    evidenceId: eid(evidenceId),
    claimType,
    claimSubject,
    sourceType: 'INDEPENDENT_VALIDATOR',
    provenance: { sourceIdentity: 'validator:independent-fixture' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'AUTHORIZATION' },
    certaintyClass: 'DECISIVE',
  });
}

/**
 * Explicitly injected confirmation-outcome source driving a composed flow
 * (review P1-1 repair): scripted outcomes enter ONLY through this declared
 * port, so every flow result records INJECTED_SOURCE provenance for them —
 * they are never autonomous CONFIRMED truth. Without an injected source a
 * required confirmation degrades to the typed cannot-proceed outcome.
 */
export function injectedConfirmationSource(
  outcomesFor?: (memberRefs: readonly string[]) => readonly ConfirmationOutcome[],
): ConfirmationOutcomeSource {
  return {
    resolve: ({
      memberRefs,
    }: {
      readonly memberRefs: readonly string[];
    }): ConfirmationOutcomeSourceResolution => ({
      kind: 'RESOLVED',
      origin: 'INJECTED_SOURCE',
      outcomes: outcomesFor ? outcomesFor(memberRefs) : memberRefs.map(() => 'CONFIRMED' as const),
    }),
  };
}
