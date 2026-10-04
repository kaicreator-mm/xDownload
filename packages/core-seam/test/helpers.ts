/**
 * T004 seam-test fixtures. Builders return RAW plain objects so every test
 * exercises the untrusted-input decode path (`unknown -> canonical value`),
 * never already-typed construction. Self-contained: no cross-package test
 * imports.
 */

import type {
  AcquisitionContract,
  SelectionSnapshot,
  TerminalResult,
} from '@xdownload/domain-contracts';
import { currentSeamSchemaIdentity } from '../src/index.ts';
import type {
  CommandEnvelope,
  CommandType,
  ExpectedPeerScope,
  PeerIdentity,
  QueryEnvelope,
  SeamCorrelation,
} from '../src/index.ts';

/** Test files may import any seam runtime symbol through this helper module. */
export * from '../src/index.ts';

export const DOMAIN_SCHEMA_ID = 'xdownload.domain-contracts' as const;

export function domainSchemaIdentity(version = '1.0.0'): {
  schema: typeof DOMAIN_SCHEMA_ID;
  version: string;
} {
  return { schema: DOMAIN_SCHEMA_ID, version };
}

export const BUDGET_PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 50,
    maxNavigationActions: 20,
    maxModelCalls: 5,
  },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_000_000_000,
    maxSegments: 5000,
    maxActiveTransferMs: 3_600_000,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

export function rawSingleResourceContract(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: domainSchemaIdentity(),
    contractId: 'contract-single-001',
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: 'target-file-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: BUDGET_PROFILE,
    authorizationContextRef: 'authctx/local-001',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

export function rawCollectionContract(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return rawSingleResourceContract({
    contractId: 'contract-collection-001',
    intentType: 'COLLECTION',
    requestedTarget: 'target-collection-root-001',
    collectionIdentity: 'collection/playlist-001',
    membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
    requestedScope: {
      kind: 'entire_supported_collection',
      collectionIdentity: 'collection/playlist-001',
    },
    explorationPermission: 'COLLECTION_MEMBER_EDGES',
    ...overrides,
  });
}

export function rawSnapshot(
  overrides: Record<string, unknown> = {},
  scope: Record<string, unknown> = {
    kind: 'entire_supported_collection',
    collectionIdentity: 'collection/playlist-001',
  },
): Record<string, unknown> {
  const members = (scope['memberIds'] as readonly string[] | undefined) ?? [
    'member-001',
    'member-002',
    'member-003',
  ];
  return {
    schemaIdentity: domainSchemaIdentity(),
    snapshotId: 'snapshot-001',
    contractId: 'contract-collection-001',
    collectionIdentity: 'collection/playlist-001',
    requestedScope: scope,
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      collectionIdentity: 'collection/playlist-001',
      scopeKind: scope['kind'],
      scopeIdentityKey: snapshotScopeKey(scope),
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: members },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: members },
    selectedMemberIds: members,
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: members },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

function snapshotScopeKey(scope: Record<string, unknown>): string {
  const kind = String(scope['kind']);
  const collection =
    scope['collectionIdentity'] === undefined ? '' : String(scope['collectionIdentity']);
  if (kind === 'explicit_member_set' || kind === 'selected_collection_members') {
    const members = ((scope['memberIds'] as readonly string[]) ?? []).slice().sort().join(',');
    return `${kind}:${collection}:${members}`;
  }
  if (kind === 'collection_page_range') {
    return `${kind}:${collection}:${String(scope['fromPage'])}..${String(scope['toPage'])}`;
  }
  if (kind === 'single_resource') {
    return `${kind}:${String(scope['targetId'])}`;
  }
  return `${kind}:${collection}`;
}

export function rawTerminalResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: domainSchemaIdentity(),
    contractId: 'contract-single-001',
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    recordedAt: '2026-10-04T01:00:00Z',
    ...overrides,
  };
}

/** Peer fixtures: the expected same-install/same-user scope and matching peers. */
export const EXPECTED_PEER: ExpectedPeerScope = {
  installId: 'install-001',
  userId: 'user-001',
  allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
};

export function peer(surface: PeerIdentity['surface'] = 'CLI'): PeerIdentity {
  return { installId: 'install-001', userId: 'user-001', surface };
}

export function foreignPeer(surface: PeerIdentity['surface'] = 'CLI'): PeerIdentity {
  return { installId: 'install-999', userId: 'user-999', surface };
}

export let nextRequestId = 0;

export function requestId(): string {
  nextRequestId += 1;
  return `req-${String(nextRequestId).padStart(4, '0')}`;
}

/** Raw command envelope builder (pre-decode wire shape). */
export function rawCommand(input: {
  commandType: CommandType;
  aggregateId: string;
  payload?: unknown;
  expectedRevision?: number;
  requestId?: string;
  correlation?: SeamCorrelation;
  issuedAt?: string;
  asPeer?: PeerIdentity;
}): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: input.asPeer ?? peer(),
    requestId: input.requestId ?? requestId(),
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision ?? 0,
    correlation: input.correlation ?? {},
    issuedAt: input.issuedAt ?? '2026-10-04T01:00:00Z',
    payload: input.payload ?? {},
  };
}

/** Raw query envelope builder (pre-decode wire shape). */
export function rawQuery(input: {
  aggregateId: string;
  requestId?: string;
  asPeer?: PeerIdentity;
  issuedAt?: string;
}): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    queryType: 'READ_PROJECTION',
    peer: input.asPeer ?? peer(),
    requestId: input.requestId ?? requestId(),
    aggregateId: input.aggregateId,
    issuedAt: input.issuedAt ?? '2026-10-04T01:00:00Z',
  };
}

export interface AcceptedAggregate {
  readonly aggregateId: string;
  readonly revision: number;
}

/** Typed envelopes for client-side submits (already decoded shape). */
export function commandEnvelope(raw: Record<string, unknown>): CommandEnvelope {
  return raw as unknown as CommandEnvelope;
}

export function queryEnvelope(raw: Record<string, unknown>): QueryEnvelope {
  return raw as unknown as QueryEnvelope;
}

export type { AcquisitionContract, SelectionSnapshot, TerminalResult };
