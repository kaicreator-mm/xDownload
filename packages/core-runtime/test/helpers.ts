/**
 * T015 focused-integration fixtures — compose the real runtime against local
 * fixtures only (temp dirs, real SQLite files, real artifact directories,
 * controlled localhost HTTP). Deterministic, offline, no browser.
 *
 * Raw seam payloads are plain objects so every seam interaction exercises
 * the untrusted-input decode path. All canonical vocabulary comes from
 * @xdownload/domain-contracts — the suites introduce no glue-local types.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLoopbackServerTransport,
  currentSeamSchemaIdentity,
  makeCommandRequestId,
  type CommandEnvelope,
  type CommandRequestId,
  type CommandType,
  type ExpectedPeerScope,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamCorrelation,
  type SeamListenTarget,
  type SeamResponse,
} from '@xdownload/core-seam';
import type { CoreRuntime, CoreRuntimeOptions } from '../src/index.ts';
import { closeCoreRuntime, createCoreRuntime } from '../src/index.ts';

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const EXPECTED_PEER: ExpectedPeerScope = {
  installId: 'install-001',
  userId: 'user-001',
  allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
};

export function peer(surface: PeerIdentity['surface'] = 'CLI'): PeerIdentity {
  return { installId: 'install-001', userId: 'user-001', surface };
}

export function runtimeOptions(rootDir: string): CoreRuntimeOptions {
  return { rootDir, expectedPeer: EXPECTED_PEER };
}

export function openRuntime(rootDir: string): CoreRuntime {
  return createCoreRuntime(runtimeOptions(rootDir));
}

export function closeRuntime(runtime: CoreRuntime): void {
  closeCoreRuntime(runtime);
}

// ---------------------------------------------------------------- seam frames

export const DOMAIN_SCHEMA = 'xdownload.domain-contracts' as const;

export function domainSchemaIdentity(): { schema: typeof DOMAIN_SCHEMA; version: string } {
  return { schema: DOMAIN_SCHEMA, version: '1.0.0' };
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
    maxBytes: 1_000_000,
    maxSegments: 50,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

/** Profile variant with tight limits, for exhaustion scenarios. */
export function profileWith(overrides: {
  readonly maxBytes?: number;
  readonly maxActiveElapsedMs?: number;
  readonly maxGeneratedRequests?: number;
}): Record<string, unknown> {
  return {
    discovery: {
      domain: 'discovery',
      ...(overrides.maxGeneratedRequests === undefined
        ? {}
        : { maxGeneratedRequests: overrides.maxGeneratedRequests }),
    },
    transfer: {
      domain: 'transfer',
      ...(overrides.maxBytes === undefined ? {} : { maxBytes: overrides.maxBytes }),
      maxSegments: 50,
      maxActiveTransferMs: 3_600_000,
      maxRetryTransferRequests: 5,
    },
    globalSafety: {
      domain: 'global_safety',
      maxTotalGeneratedRequests: 500,
      ...(overrides.maxActiveElapsedMs === undefined
        ? {}
        : { maxActiveElapsedMs: overrides.maxActiveElapsedMs }),
    },
  };
}

export interface RawContractOverrides {
  readonly contractId?: string;
  readonly intentType?: 'SINGLE_RESOURCE' | 'COLLECTION';
  readonly requestedTarget?: string;
  readonly requestedScope?: Record<string, unknown>;
  readonly budgetProfile?: unknown;
  readonly explorationPermission?: string;
}

export function rawSingleResourceContract(
  overrides: RawContractOverrides = {},
): Record<string, unknown> {
  const contractId = overrides.contractId ?? 'contract-single-001';
  const targetId = overrides.requestedTarget ?? 'target-file-001';
  return {
    schemaIdentity: domainSchemaIdentity(),
    contractId,
    status: 'CONFIRMED',
    intentType: overrides.intentType ?? 'SINGLE_RESOURCE',
    requestedTarget: targetId,
    requestedScope: overrides.requestedScope ?? { kind: 'single_resource', targetId },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: overrides.budgetProfile ?? BUDGET_PROFILE,
    authorizationContextRef: 'authctx/local-001',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
  };
}

export function rawCollectionContract(
  overrides: RawContractOverrides = {},
): Record<string, unknown> {
  return rawSingleResourceContract({
    contractId: 'contract-collection-001',
    intentType: 'COLLECTION',
    requestedTarget: 'target-collection-root-001',
    requestedScope: {
      kind: 'explicit_member_set',
      memberIds: ['member-001', 'member-002', 'member-003'],
    },
    explorationPermission: 'COLLECTION_MEMBER_EDGES',
    ...overrides,
    ...(overrides.requestedScope === undefined ? {} : { requestedScope: overrides.requestedScope }),
  });
}

export function rawSnapshot(
  overrides: Record<string, unknown> = {},
  memberIds: readonly string[] = ['member-001', 'member-002', 'member-003'],
): Record<string, unknown> {
  const scope = {
    kind: 'explicit_member_set',
    memberIds: [...memberIds],
  };
  return {
    schemaIdentity: domainSchemaIdentity(),
    snapshotId: 'snapshot-001',
    contractId: 'contract-collection-001',
    collectionIdentity: 'collection/playlist-001',
    requestedScope: scope,
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      collectionIdentity: 'collection/playlist-001',
      scopeKind: scope.kind,
      scopeIdentityKey: `explicit_member_set:collection/playlist-001:${[...memberIds].sort().join(',')}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [...memberIds] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [...memberIds] },
    selectedMemberIds: [...memberIds],
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: [...memberIds] },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

let nextRequestId = 0;

export function requestId(): CommandRequestId {
  nextRequestId += 1;
  const made = makeCommandRequestId(`t015-req-${String(nextRequestId).padStart(4, '0')}`);
  if (!made.ok) {
    throw new Error('fixture request id rejected');
  }
  return made.value;
}

/** Branded request id from a caller-supplied string (fixture convenience). */
export function requestIdOf(raw: string): CommandRequestId {
  const made = makeCommandRequestId(raw);
  if (!made.ok) {
    throw new Error(`fixture request id rejected: ${raw}`);
  }
  return made.value;
}

export function commandEnvelope(input: {
  readonly commandType: CommandType;
  readonly aggregateId: string;
  readonly payload?: unknown;
  readonly expectedRevision?: number;
  readonly requestId?: CommandRequestId;
  readonly correlation?: SeamCorrelation;
  readonly asPeer?: PeerIdentity;
}): CommandEnvelope {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: input.asPeer ?? peer(),
    requestId: input.requestId ?? requestId(),
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision ?? 0,
    correlation: input.correlation ?? {},
    issuedAt: '2026-10-04T01:00:00Z',
    payload: input.payload ?? {},
  };
}

export function queryEnvelope(input: {
  readonly aggregateId: string;
  readonly requestId?: CommandRequestId;
  readonly asPeer?: PeerIdentity;
}): QueryEnvelope {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    queryType: 'READ_PROJECTION',
    peer: input.asPeer ?? peer(),
    requestId: input.requestId ?? requestId(),
    aggregateId: input.aggregateId,
    issuedAt: '2026-10-04T01:00:00Z',
  };
}

/** Drive one seam command through the runtime's transport-neutral port. */
export function seamCommand(
  runtime: CoreRuntime,
  input: Parameters<typeof commandEnvelope>[0],
): SeamResponse {
  return runtime.seam.handleFrame(JSON.stringify(commandEnvelope(input)));
}

export function seamQuery(runtime: CoreRuntime, aggregateId: string): SeamResponse {
  return runtime.seam.handleFrame(JSON.stringify(queryEnvelope({ aggregateId })));
}

// ------------------------------------------------------- loopback client wiring

export interface LoopbackSeam {
  readonly target: SeamListenTarget;
  readonly stop: () => Promise<void>;
}

/** Bind the composed runtime's seam to the loopback transport (ADR-012). */
export async function bindLoopbackSeam(runtime: CoreRuntime): Promise<LoopbackSeam> {
  const transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
  const target = await transport.start({
    onFrame: (connection, frame) => {
      const response = runtime.seam.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
  return { target, stop: () => transport.stop() };
}

export { sha256HexForTest as sha256 };

function sha256HexForTest(bytes: Uint8Array): string {
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

/** Exact budget profile used by the crash worker (payload-digest stable). */
export const CRASH_BUDGET_PROFILE = {
  discovery: { domain: 'discovery', maxGeneratedRequests: 50 },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_000_000,
    maxSegments: 50,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

/**
 * The exact SUBMIT_CONTRACT payload the crash worker accepts through the
 * seam; restart tests must replay the identical idempotent payload.
 */
export function crashWorkerContractPayload(): Record<string, unknown> {
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
    budgetProfile: CRASH_BUDGET_PROFILE,
    authorizationContextRef: 'authctx/local-001',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
  };
}

import type { DirectFlowOutcome, HlsFlowOutcome } from '../src/index.ts';
import type { DirectTransferOutcome } from '@xdownload/direct-acquisition';
import type { HlsVodPipelineOutcome } from '@xdownload/hls-vod-adapter';
import type { OutcomeRecord } from '@xdownload/core-scheduler';

type ExecutedDirectFlow = DirectFlowOutcome & {
  readonly transfer: DirectTransferOutcome;
  readonly effectOutcome: OutcomeRecord;
};

type ExecutedHlsFlow = HlsFlowOutcome & {
  readonly pipeline: HlsVodPipelineOutcome;
  readonly effectOutcome: OutcomeRecord;
};

/** Narrow a direct flow to an executed (non-replayed) outcome. */
export function executedFlow(flow: DirectFlowOutcome): ExecutedDirectFlow {
  if (flow.attemptReplayed || flow.transfer === undefined) {
    throw new Error('expected an executed (non-replayed) direct flow');
  }
  return flow as ExecutedDirectFlow;
}

/** Narrow an HLS flow to an executed (non-replayed) outcome. */
export function executedHlsFlow(flow: HlsFlowOutcome): ExecutedHlsFlow {
  if (flow.attemptReplayed || flow.pipeline === undefined) {
    throw new Error('expected an executed (non-replayed) HLS flow');
  }
  return flow as ExecutedHlsFlow;
}
