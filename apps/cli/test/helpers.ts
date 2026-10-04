/**
 * T013 concern-test fixtures and harness. Self-contained: no cross-package
 * test imports. The harness composes the real in-process seam server + the
 * loopback transports + the real seam client (the exact composition
 * `packages/core-seam/test/transport-loopback.test.ts` demonstrates), then
 * drives the CLI adapter through `runAdapter` with injectable ports. No
 * Desktop, no browser, no external service, no real network beyond loopback.
 */

import { afterEach } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  createSeamClient,
  currentSeamSchemaIdentity,
  type CommandEnvelope,
  type CommandType,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type PeerIdentity,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamResponse,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import { currentSchemaIdentity, scopeIdentityKey } from '@xdownload/domain-contracts';
import { runArgv, type AdapterPorts, type AdapterResult } from '../src/adapter.ts';

/** The seam under test admits the CLI surface only — every accepted CLI
 * operation below therefore also proves the SurfaceKind 'CLI' presentation. */
export const EXPECTED_PEER: ExpectedPeerScope = {
  installId: 'install-cli-001',
  userId: 'user-cli-001',
  allowedSurfaces: ['CLI'],
};

export function cliPeer(): PeerIdentity {
  return { installId: EXPECTED_PEER.installId, userId: EXPECTED_PEER.userId, surface: 'CLI' };
}

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

export function singleResourceContract(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: currentSchemaIdentity(),
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

export function collectionContract(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return singleResourceContract({
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

export function snapshotPayload(
  overrides: Record<string, unknown> = {},
  memberIds: readonly string[] = ['member-001', 'member-002', 'member-003'],
): Record<string, unknown> {
  const scope = (overrides['requestedScope'] as Record<string, unknown> | undefined) ?? {
    kind: 'entire_supported_collection',
    collectionIdentity: 'collection/playlist-001',
  };
  const collectionIdentity =
    'collectionIdentity' in scope ? (scope['collectionIdentity'] as string) : undefined;
  return {
    schemaIdentity: currentSchemaIdentity(),
    snapshotId: 'snapshot-001',
    contractId: 'contract-collection-001',
    collectionIdentity,
    requestedScope: scope,
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      collectionIdentity: collectionIdentity ?? null,
      scopeKind: scope['kind'],
      scopeIdentityKey: scopeIdentityKey(scope as never),
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds },
    selectedMemberIds: memberIds,
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: memberIds },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

export interface TerminalPayloadInput {
  readonly contractId: string;
  readonly requestFulfillment: string;
  readonly targetResolution: string;
  readonly selectionAcquisition: string;
  readonly coverage: string;
  readonly stopReason: string;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly summaryStatus: string;
  readonly snapshotId?: string;
  readonly outcomes?: readonly { memberId: string; requiredValidationPassed: boolean }[];
  readonly coverageEvidence?: unknown;
  readonly knownAuthInaccessibleRequestedCount?: number;
}

/** Canonical PROJECT_TERMINAL_RESULT payload the harness drives via the seam. */
export function terminalPayload(input: TerminalPayloadInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    schemaIdentity: currentSchemaIdentity(),
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
  const payload: Record<string, unknown> = { result };
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

const running: SeamServerTransport[] = [];

afterEach(async () => {
  for (const transport of running.splice(0)) {
    await transport.stop();
  }
});

export interface RunningSeam {
  readonly server: CoreSeamServer;
  readonly target: SeamListenTarget;
}

/** Start the real seam server behind the loopback transport (port 0). */
export async function startSeam(
  expectedPeer: ExpectedPeerScope = EXPECTED_PEER,
): Promise<RunningSeam> {
  const result = createCoreSeamServer({ expectedPeer });
  if (!result.ok) {
    throw new Error('seam server construction failed');
  }
  const server = result.value;
  const transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
  running.push(transport);
  const target = await transport.start({
    onFrame: (connection, frame) => {
      const response = server.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
  return { server, target };
}

/** A raw harness client (drives Core setup through the same seam ports). */
export function harnessClient(target: SeamListenTarget): SeamClient {
  return createSeamClient({
    transport: createLoopbackClientTransport(),
    target,
    peer: cliPeer(),
  });
}

export async function rawCommand(
  client: SeamClient,
  input: {
    commandType: CommandType;
    aggregateId: string;
    payload?: unknown;
    expectedRevision?: number;
    requestId?: string;
  },
): Promise<SeamResponse> {
  const envelope: CommandEnvelope = {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: cliPeer(),
    requestId: input.requestId ?? `req-h-${Math.random().toString(36).slice(2, 10)}`,
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision ?? 0,
    correlation: {},
    issuedAt: '2026-10-04T01:00:00Z',
    payload: input.payload ?? {},
  } as CommandEnvelope;
  return client.submitCommand(envelope);
}

/** Harness setup: submit one contract through the seam; returns its id. */
export async function setupContract(
  client: SeamClient,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await rawCommand(client, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: String(payload['contractId']),
    payload,
  });
  if (response.outcome !== 'ACCEPTED') {
    throw new Error(`harness contract setup failed: ${JSON.stringify(response.diagnostics)}`);
  }
  return String(payload['contractId']);
}

export async function setupSnapshot(
  client: SeamClient,
  contractId: string,
  revision: number,
  payload: Record<string, unknown>,
): Promise<number> {
  const response = await rawCommand(client, {
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: contractId,
    expectedRevision: revision,
    payload,
  });
  if (response.outcome !== 'ACCEPTED') {
    throw new Error(`harness snapshot setup failed: ${JSON.stringify(response.diagnostics)}`);
  }
  return revision + 1;
}

export async function projectTerminal(
  client: SeamClient,
  contractId: string,
  revision: number,
  payload: Record<string, unknown>,
): Promise<SeamResponse> {
  const response = await rawCommand(client, {
    commandType: 'PROJECT_TERMINAL_RESULT',
    aggregateId: contractId,
    expectedRevision: revision,
    payload,
  });
  if (response.outcome !== 'ACCEPTED') {
    throw new Error(`harness terminal projection failed: ${JSON.stringify(response.diagnostics)}`);
  }
  return response;
}

/** Transport wrapper counting READ_PROJECTION queries sent on the wire. */
export function queryCountingTransport(
  inner: SeamClientTransport,
): SeamClientTransport & { readonly queryCount: () => number } {
  let queries = 0;
  return {
    queryCount: () => queries,
    async connect(target: SeamListenTarget) {
      const connection = await inner.connect(target);
      const originalSend = connection.send.bind(connection);
      connection.send = (frame: string) => {
        try {
          const parsed = JSON.parse(frame) as { kind?: string };
          if (parsed.kind === 'query') {
            queries += 1;
          }
        } catch {
          // counting only; framing errors surface downstream
        }
        originalSend(frame);
      };
      return connection;
    },
  };
}

let requestCounter = 0;

/** Adapter ports over the real loopback transport with deterministic ids. */
export function adapterPorts(
  target: SeamListenTarget,
  overrides: {
    readonly stdinText?: string;
    readonly files?: ReadonlyMap<string, string>;
    readonly transport?: SeamClientTransport;
  } = {},
): AdapterPorts {
  return {
    clientTransport: overrides.transport ?? createLoopbackClientTransport(),
    readSource: async (source) => {
      if (source.stdin) {
        if (overrides.stdinText === undefined) {
          throw new Error('no stdin text configured');
        }
        return overrides.stdinText;
      }
      const file = source.file;
      if (file === undefined) {
        throw new Error('no payload file given');
      }
      const content = overrides.files?.get(file);
      if (content === undefined) {
        throw new Error(`payload file not found: ${file}`);
      }
      return content;
    },
    now: () => '2026-10-04T12:00:00.000Z',
    makeRequestId: () => {
      requestCounter += 1;
      return `req-cli-${String(requestCounter).padStart(4, '0')}`;
    },
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    epochMs: () => Date.now(),
  };
}

export interface CliRun {
  readonly exitCode: number;
  readonly document: string;
  readonly json: unknown;
  readonly result: AdapterResult;
}

const BASE_FLAGS = ['--install-id', EXPECTED_PEER.installId, '--user-id', EXPECTED_PEER.userId];

/** Parse + run one CLI invocation against the given seam target. The command
 * stays in argv[0]; base flags precede the user's flags so explicit argv
 * wins (the real process semantics); argv parse failures map to the same
 * typed error document the process shell emits. */
export async function runCli(
  argv: readonly string[],
  target: SeamListenTarget,
  overrides: {
    readonly stdinText?: string;
    readonly files?: ReadonlyMap<string, string>;
    readonly transport?: SeamClientTransport;
  } = {},
): Promise<CliRun> {
  const command = argv[0];
  if (command === undefined) {
    throw new Error('runCli requires a command as argv[0]');
  }
  const full = [command, ...BASE_FLAGS, '--port', String(target.port), ...argv.slice(1)];
  const result = await runArgv(full, adapterPorts(target, overrides));
  return {
    exitCode: result.exitCode,
    document: result.document,
    json: JSON.parse(result.document) as unknown,
    result,
  };
}
