/**
 * T017 convergence-test fixtures. Self-contained composition harness over
 * the real merged packages: one Core runtime (T015) behind the real loopback
 * seam transport, every surface bound through the shared `bindSurfaceToCore`
 * binder, the AI lane composed over the real T012 adapter, and the T012
 * deterministic fake provider doubles. Deterministic and local: no real
 * network provider, no browser, no packaging harness.
 *
 * Raw seam payloads are plain objects so every interaction exercises the
 * untrusted-input decode path. Canonical vocabulary comes only from
 * @xdownload/domain-contracts — no glue-local types.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { scopeIdentityKey } from '@xdownload/domain-contracts';
import { closeCoreRuntime, createCoreRuntime, type CoreRuntime } from '@xdownload/core-runtime';
// The T015 test harness owns the loopback seam binding fixture; reuse it
// verbatim (the T016 suites established this cross-package test import).
import { bindLoopbackSeam } from '../../core-runtime/test/helpers.ts';
import { bindSurfaceToCore, type BoundSurface } from '../src/index.ts';

export { closeCoreRuntime, createCoreRuntime, bindLoopbackSeam };

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------- peers

/** All three surfaces admitted (one-install/one-user scope). */
export const EXPECTED_PEER = {
  installId: 'install-t017',
  userId: 'user-t017',
  allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
} as const;

/** Scope variant excluding the extension surface (deployment-shape parity). */
export const SURFACES_WITHOUT_EXTENSION = {
  installId: 'install-t017',
  userId: 'user-t017',
  allowedSurfaces: ['CLI', 'DESKTOP_UI'],
} as const;

export type AnySurface = 'CLI' | 'DESKTOP_UI' | 'BROWSER_EXTENSION';

let requestCounter = 0;

/** Deterministic per-call request ids (idempotent identity is explicit per test). */
export function nextRequestId(prefix?: string): string {
  requestCounter += 1;
  return `req-${prefix ?? 't017'}-${String(requestCounter).padStart(4, '0')}`;
}

// ------------------------------------------------------------- composition

export interface ComposedCore {
  readonly runtime: CoreRuntime;
  readonly target: { readonly host: string; readonly port: number };
  readonly rootDir: string;
  readonly stop: () => Promise<void>;
}

/** Compose one authoritative Core runtime and bind its seam to the loopback. */
export async function composeCore(
  prefix: string,
  expectedPeer: Readonly<{
    installId: string;
    userId: string;
    allowedSurfaces: readonly string[];
  }> = EXPECTED_PEER,
): Promise<ComposedCore> {
  const rootDir = makeTempDir(prefix);
  const runtime = createCoreRuntime({
    rootDir: rootDir,
    expectedPeer: expectedPeer as unknown as CoreRuntime['expectedPeer'],
  });
  const seam = await bindLoopbackSeam(runtime);
  return {
    runtime: runtime,
    target: seam.target,
    rootDir: rootDir,
    stop: () => {
      closeCoreRuntime(runtime);
      return seam.stop();
    },
  };
}

/** Bind any surface to the composed core through the ONE shared binder. */
export function boundSurface(
  surface: AnySurface,
  core: ComposedCore,
  overrides: {
    readonly installId?: string;
    readonly userId?: string;
  } = {},
): BoundSurface {
  return bindSurfaceToCore({
    surface: surface,
    installId: overrides.installId ?? EXPECTED_PEER.installId,
    userId: overrides.userId ?? EXPECTED_PEER.userId,
    transport: createLoopbackClientTransport(),
    target: core.target,
    makeRequestId: () => nextRequestId(`${surface.toLowerCase()}-auto`),
    now: () => '2026-10-04T01:00:00.000Z',
  });
}

// ------------------------------------------------------- canonical payloads

export const DOMAIN_SCHEMA = { schema: 'xdownload.domain-contracts', version: '1.0.0' } as const;

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
  const contractId = overrides['contractId'] ?? 'contract-t017-single-001';
  return {
    schemaIdentity: DOMAIN_SCHEMA,
    contractId: contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: 'target-file-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: BUDGET_PROFILE,
    authorizationContextRef: 'authctx/local-t017',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

export function rawExplicitSetContract(
  memberIds: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const contractId = overrides['contractId'] ?? 'contract-t017-set-001';
  return rawSingleResourceContract({
    contractId: contractId,
    intentType: 'COLLECTION',
    requestedTarget: 'target-set-root',
    collectionIdentity: 'collection/t017-set',
    membershipBasis: { basis: 'DECLARED_FINITE_SET' },
    requestedScope: { kind: 'explicit_member_set', memberIds: [...memberIds] },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
    automationMode: 'ASSISTED',
    ...overrides,
  });
}

export function rawSnapshotPayload(
  contractId: string,
  memberIds: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  // The effective scope: the override (when the contract scope differs from
  // the plain explicit set) or the explicit set of the selected members.
  const scope = (overrides['requestedScope'] as Record<string, unknown> | undefined) ?? {
    kind: 'explicit_member_set',
    memberIds: [...memberIds],
  };
  const collectionIdentity =
    (scope['collectionIdentity'] as string | undefined) ??
    (overrides['collectionIdentity'] as string | undefined) ??
    'collection/t017-set';
  return {
    schemaIdentity: DOMAIN_SCHEMA,
    snapshotId: overrides['snapshotId'] ?? 'snapshot-t017-001',
    contractId: contractId,
    collectionIdentity: collectionIdentity,
    requestedScope: scope,
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      collectionIdentity: collectionIdentity,
      scopeKind: scope['kind'],
      scopeIdentityKey: scopeIdentityKey(scope as never),
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [...memberIds] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [...memberIds] },
    selectedMemberIds: [...memberIds],
    authorizationContextRef: 'authctx/local-t017',
    profileContextRef: 'profile/default-t017',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: [...memberIds] },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

export interface TerminalTupleInput {
  readonly contractId: string;
  readonly snapshotId?: string;
  readonly requestFulfillment: string;
  readonly targetResolution: string;
  readonly selectionAcquisition: string;
  readonly coverage: string;
  readonly stopReason: string;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly summaryStatus: string;
  readonly outcomes?: readonly { memberId: string; requiredValidationPassed: boolean }[];
  readonly coverageEvidence?: unknown;
  readonly knownAuthInaccessibleRequestedCount?: number;
}

/** Canonical PROJECT_TERMINAL_RESULT payload (six dimensions verbatim). */
export function terminalTuplePayload(input: TerminalTupleInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    schemaIdentity: DOMAIN_SCHEMA,
    contractId: input.contractId,
    requestFulfillment: input.requestFulfillment,
    targetResolution: input.targetResolution,
    selectionAcquisition: input.selectionAcquisition,
    coverage: input.coverage,
    stopReason: input.stopReason,
    validationSummary: {
      status: input.summaryStatus,
      passedCount: input.passedCount,
      failedCount: input.failedCount,
    },
    recordedAt: '2026-10-04T02:00:00Z',
  };
  if (input.snapshotId !== undefined) {
    result['snapshotId'] = input.snapshotId;
  }
  const payload: Record<string, unknown> = { result: result };
  if (input.outcomes !== undefined) {
    payload['selectedValidationOutcomes'] = input.outcomes;
  }
  if (input.coverageEvidence !== undefined) {
    payload['coverageEvidence'] = input.coverageEvidence;
  }
  if (input.knownAuthInaccessibleRequestedCount !== undefined) {
    payload['knownAuthInaccessibleRequestedCount'] = input.knownAuthInaccessibleRequestedCount;
  }
  return payload;
}
