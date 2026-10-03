import { expect } from 'vitest';
/**
 * T002 contract-test fixtures. Builders return RAW plain objects so every
 * test exercises the untrusted-input decode path (`unknown -> canonical
 * value`), never already-typed construction.
 */

import { unwrapOrThrow } from '../src/index.ts';
import { decodeAcquisitionContract, type AcquisitionContract } from '../src/index.ts';
import { decodeSelectionSnapshot, type SelectionSnapshot } from '../src/index.ts';
import { decodeTerminalResult, type TerminalResult } from '../src/index.ts';
import {
  makeCollectionId,
  makeEvidenceId,
  makeLogicalTargetId,
  makeMemberId,
} from '../src/index.ts';
import type { DomainValidationResult, ValidationDiagnostic } from '../src/index.ts';
import type { RequestedScope } from '../src/index.ts';

/** Branded-id shortcuts for typed fixtures. */
export const eid = (raw: string) => decodeOk(makeEvidenceId(raw));
export const mid = (raw: string) => decodeOk(makeMemberId(raw));
export const tid = (raw: string) => decodeOk(makeLogicalTargetId(raw));
export const cid = (raw: string) => decodeOk(makeCollectionId(raw));

/** Typed requested-scope fixtures (post-decode canonical values). */
export function pageRangeScope(
  collection: string,
  fromPage: number,
  toPage: number,
): RequestedScope {
  return { kind: 'collection_page_range', collectionIdentity: cid(collection), fromPage, toPage };
}

export function entireCollectionScope(collection: string): RequestedScope {
  return { kind: 'entire_supported_collection', collectionIdentity: cid(collection) };
}

/** Unwrap a validation result or fail the test with its diagnostics. */
export function decodeOk<T>(result: DomainValidationResult<T>): T {
  return unwrapOrThrow(result);
}

/** Assert the result was rejected with a given diagnostic code (and optional invariant). */
export function expectCode<T>(
  result: DomainValidationResult<T>,
  code: string,
  invariant?: string,
): readonly ValidationDiagnostic[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return [];
  }
  const match = result.diagnostics.some(
    (d) => d.code === code && (invariant === undefined || d.invariant === invariant),
  );
  const message = `expected diagnostic ${code}${invariant ? ` (${invariant})` : ''}, got ${JSON.stringify(result.diagnostics)}`;
  expect(match, message).toBe(true);
  return result.diagnostics;
}

export const SCHEMA_ID = 'xdownload.domain-contracts' as const;

export function schemaIdentity(version = '1.0.0'): { schema: typeof SCHEMA_ID; version: string } {
  return { schema: SCHEMA_ID, version };
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
    schemaIdentity: schemaIdentity(),
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

export function confirmedSingleResourceContract(): AcquisitionContract {
  return unwrapOrThrow(decodeAcquisitionContract(rawSingleResourceContract()));
}

export function confirmedCollectionContract(
  overrides: Record<string, unknown> = {},
): AcquisitionContract {
  return unwrapOrThrow(decodeAcquisitionContract(rawCollectionContract(overrides)));
}

export function rawSnapshot(
  overrides: Record<string, unknown> = {},
  scope: Record<string, unknown> = {
    kind: 'entire_supported_collection',
    collectionIdentity: 'collection/playlist-001',
  },
): Record<string, unknown> {
  return {
    schemaIdentity: schemaIdentity(),
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
    requestedMemberBasis: {
      kind: 'EXPLICIT_IDENTITIES',
      memberIds: ['member-001', 'member-002', 'member-003'],
    },
    authAccessibleBasis: {
      kind: 'EXPLICIT_IDENTITIES',
      memberIds: ['member-001', 'member-002', 'member-003'],
    },
    selectedMemberIds: ['member-001', 'member-002', 'member-003'],
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      {
        kind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: ['member-001', 'member-002', 'member-003'],
      },
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
    const members = (scope['memberIds'] as readonly string[]).slice().sort().join(',');
    return `${kind}:${collection}:${members}`;
  }
  if (kind === 'collection_page_range') {
    return `${kind}:${collection}:${String(scope['fromPage'])}..${String(scope['toPage'])}`;
  }
  if (kind === 'single_resource') {
    return `single_resource:${String(scope['targetId'])}`;
  }
  return `${kind}:${collection}`;
}

export function confirmedSnapshot(overrides: Record<string, unknown> = {}): SelectionSnapshot {
  return unwrapOrThrow(decodeSelectionSnapshot(rawSnapshot(overrides)));
}

export function rawTerminalResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: schemaIdentity(),
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

export function decodedTerminalResult(overrides: Record<string, unknown> = {}): TerminalResult {
  return unwrapOrThrow(decodeTerminalResult(rawTerminalResult(overrides)));
}
