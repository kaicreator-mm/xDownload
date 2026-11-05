/**
 * U05-T03 desktop download-manager service tests — behavioral proof over the
 * REAL combined candidate: the T01 Core seam server (schema 1.4.0 S1 job
 * index + DESKTOP_UI S1 admission) serving the T02 Desktop adapter over a
 * real loopback transport, with the shell DesktopManager on top.
 *
 * The T02 Mock Transport tests are adapter-unit evidence only; THESE tests
 * are the combined-candidate Core admission gate:
 *
 * - the add flow routes the canonical confirmation AND the S1
 *   direct-acquisition command through the real Core admission;
 * - managerRefresh enumerates ONLY the Core-owned durable S1 index: a new
 *   manager instance re-enumerates existing jobs, authorized-surface jobs
 *   (CLI) are visible, cross-install peers are refused, and a query
 *   refusal/disconnect is a typed refusal — never an empty successful list;
 * - exact 0/199/200/201 index semantics with totalCount/truncated;
 * - cancel/retry remain Core control transitions; Core re-decides and typed
 *   refusals surface verbatim;
 * - shared-adapter serialization/coalescing holds over the index read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  currentSeamSchemaIdentity,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type SeamListenTarget,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import {
  createDesktopUiAdapter,
  type DesktopUiAdapter,
  type S1JobIndexResult,
} from '@xdownload/desktop-ui';
import { DesktopManager } from '../src/main/manager.ts';
import type {
  ManagerCommandDelivery,
  ManagerJobListDocument,
  ShellRefusal,
} from '../src/main/shell-contract.ts';

const INSTALL_ID = 'install-001';
const USER_ID = 'user-001';
const EXPECTED_PEER: ExpectedPeerScope = {
  installId: INSTALL_ID,
  userId: USER_ID,
  allowedSurfaces: ['CLI', 'DESKTOP_UI'],
};

// ---- deterministic localhost fixtures (raw wire shapes, self-contained) -----

const DOMAIN_SCHEMA_ID = 'xdownload.domain-contracts';

function rawSingleResourceContract(contractId: string): Record<string, unknown> {
  return {
    schemaIdentity: { schema: DOMAIN_SCHEMA_ID, version: '1.0.0' },
    contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: 'target-file-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: {
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
    },
    authorizationContextRef: 'authctx/local-001',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
  };
}

function s1ExecutionPayload(): Record<string, unknown> {
  return {
    snapshotId: 's1snap-001',
    memberId: 's1member-001',
    artifactId: 's1artifact-001',
    delivery: {
      locatorUri: 'http://127.0.0.1:9/file.bin',
      declaredRedirectHosts: ['127.0.0.1:9'],
      expectedSha256: 'a'.repeat(64),
    },
  };
}

let requestSequence = 0;

function rawCommand(input: {
  commandType: string;
  aggregateId: string;
  payload: unknown;
  expectedRevision?: number;
  surface?: 'CLI' | 'DESKTOP_UI';
  issuedAt?: string;
}): Record<string, unknown> {
  requestSequence += 1;
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: { installId: INSTALL_ID, userId: USER_ID, surface: input.surface ?? 'CLI' },
    requestId: `mgr-req-${String(requestSequence).padStart(4, '0')}`,
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision ?? 0,
    correlation: {},
    issuedAt: input.issuedAt ?? '2026-10-04T01:00:00Z',
    payload: input.payload,
  };
}

/** Seed one accepted S1 job straight into the real Core (no shell involved). */
function seedS1(server: CoreSeamServer, aggregateId: string, surface: 'CLI' | 'DESKTOP_UI'): void {
  const submitted = server.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId,
        payload: rawSingleResourceContract(aggregateId),
        surface,
      }),
    ),
  );
  expect(submitted.outcome).toBe('ACCEPTED');
  const executed = server.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId,
        expectedRevision: 1,
        payload: s1ExecutionPayload(),
        surface,
      }),
    ),
  );
  expect(executed.outcome).toBe('ACCEPTED');
}

// ---- the real combined-candidate harness ------------------------------------

interface Harness {
  readonly adapter: DesktopUiAdapter;
  readonly manager: DesktopManager;
  readonly server: CoreSeamServer;
  /** Stops ONLY the seam server transport (a real Core loss). */
  stopCore(): Promise<void>;
  stop(): Promise<void>;
}

async function startHarness(options?: {
  readonly installId?: string;
  readonly userId?: string;
  readonly withJournal?: boolean;
}): Promise<Harness> {
  const transport: SeamServerTransport = createLoopbackServerTransport({
    host: '127.0.0.1',
    port: 0,
  });
  const seam = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    ...(options?.withJournal === false ? {} : { journal: createInMemorySeamJournal() }),
    s1DirectAcquisition: { begin() {} },
  });
  if (!seam.ok) {
    throw new Error('harness seam composition refused');
  }
  const server: CoreSeamServer = seam.value;
  const target: SeamListenTarget = await transport.start({
    onFrame: (connection, frame) => {
      connection.send(JSON.stringify(server.handleFrame(frame)));
    },
    onConnectionEnded: () => undefined,
  });
  const adapter = createDesktopUiAdapter({
    transport: createLoopbackClientTransport(),
    target,
    installId: options?.installId ?? INSTALL_ID,
    userId: options?.userId ?? USER_ID,
    now: () => '2026-10-31T09:00:00Z',
  });
  const manager = new DesktopManager({
    getAdapter: () => adapter,
    getConnectionWhenUnconfigured: () => 'UNCONFIGURED',
  });
  return {
    adapter,
    manager,
    server,
    stopCore: () => transport.stop(),
    stop: async () => {
      await adapter.close();
      await transport.stop();
    },
  };
}

function isRefusal(answer: unknown): answer is ShellRefusal {
  return (answer as ShellRefusal).ok === false;
}

function expectList(answer: unknown): ManagerJobListDocument {
  if (isRefusal(answer)) {
    throw new Error(`expected a list document, got refusal: ${answer.detail}`);
  }
  return answer as ManagerJobListDocument;
}

function expectActionList(action: {
  readonly list: ManagerJobListDocument | ShellRefusal;
}): ManagerJobListDocument {
  if (isRefusal(action.list)) {
    throw new Error(`expected an embedded list, got refusal: ${action.list.detail}`);
  }
  return action.list;
}

describe('DesktopManager S1 add flow over the real combined Core (T01 seam + T02 adapter)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it('preview builds a non-authoritative draft: no command is routed', async () => {
    const preview = await harness.manager.previewAdd({
      url: 'https://example.com/media/stream.m3u8',
    });
    expect(isRefusal(preview)).toBe(false);
    if (isRefusal(preview)) {
      return;
    }
    expect(preview.document).toBe('xdownload.desktop.manager.preview');
    expect(preview.url).toBe('https://example.com/media/stream.m3u8');
    expect(preview.confirmationRequests.map((request) => request.level)).toEqual(['SCOPE_LEVEL']);
    expect(harness.adapter.hasDraftIntent()).toBe(true);
    expect(harness.adapter.lastRouted()).toEqual([]);
  });

  it('preview refuses hostile URLs and a second pending draft', async () => {
    for (const hostile of ['ftp://example.com/x', 'not-a-url', 'https://e.com/x\n', '']) {
      const answer = await harness.manager.previewAdd({ url: hostile });
      expect(isRefusal(answer), hostile).toBe(true);
    }
    const first = await harness.manager.previewAdd({ url: 'https://example.com/a' });
    expect(isRefusal(first)).toBe(false);
    const second = await harness.manager.previewAdd({ url: 'https://example.com/b' });
    expect(isRefusal(second)).toBe(true);
  });

  it('confirm routes SUBMIT_CONTRACT and EXECUTE_S1_DIRECT_ACQUISITION through the real Core S1 admission', async () => {
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.confirmAdd();
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.action).toBe('add');
    expect(action.routed).toBe(true);
    expect(action.rejections).toEqual([]);
    // The exact admission sequence over the real seam: contract confirmation
    // first, then the S1 direct-acquisition command with the same identity.
    expect(harness.adapter.sentCommandEnvelopes().map((envelope) => envelope.commandType)).toEqual([
      'SUBMIT_CONTRACT',
      'EXECUTE_S1_DIRECT_ACQUISITION',
    ]);
    expect(action.lineageId).toBe(harness.adapter.sentCommandEnvelopes()[1]?.aggregateId ?? null);
    // The embedded list read the durable index: the row is the Core's S1
    // projection (not session state), with exact index counters.
    const list = expectActionList(action);
    expect(list.totalCount).toBe(1);
    expect(list.truncated).toBe(false);
    const row = list.jobs[0];
    expect(row?.lane).toBe('s1');
    expect(row?.lineageId).toBe(action.lineageId);
    expect(row?.contractStatus).toBe('CONFIRMED');
    expect(row?.terminal).toBeNull();
    expect(list.connection).toBe('CONNECTED');
    // Pending state holds until a Core projection provides terminal truth:
    // the fresh row is not terminal and carries no completion claim.
    expect(list.pendingPreview).toBeNull();
  });

  it('a NEW manager instance re-enumerates the existing S1 jobs from the durable index', async () => {
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.confirmAdd();
    if (isRefusal(action)) {
      throw new Error('confirm refused');
    }
    // A second manager over the same Core (e.g. a restarted window): no
    // session state is shared — enumeration comes from the durable index.
    const secondManager = new DesktopManager({
      getAdapter: () => harness.adapter,
      getConnectionWhenUnconfigured: () => 'UNCONFIGURED',
    });
    const list = expectList(await secondManager.list());
    expect(list.totalCount).toBe(1);
    expect(list.jobs.map((row) => row.lineageId)).toEqual([action.lineageId]);
    expect(list.jobs[0]?.lane).toBe('s1');
  });

  it('discard clears the pending preview without routing anything', async () => {
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.discardPreview();
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.action).toBe('discard-preview');
    expect(action.routed).toBe(false);
    expect(harness.adapter.hasDraftIntent()).toBe(false);
    expect(harness.manager.hasPendingPreview()).toBe(false);
    expect(expectActionList(action).pendingPreview).toBeNull();
  });
});

describe('DesktopManager durable index visibility and isolation (real Core)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it('an authorized-surface (CLI) S1 job from the same install/user is visible to the shell', async () => {
    seedS1(harness.server, 'contract-cli-0001', 'CLI');
    const list = expectList(await harness.manager.list());
    expect(list.totalCount).toBe(1);
    expect(list.jobs.map((row) => row.lineageId)).toEqual(['contract-cli-0001']);
    expect(list.jobs[0]?.lane).toBe('s1');
    // Reopen is a fresh read: a second refresh replays the durable journal
    // and returns the same truthful projection (no fabricated scope facts).
    const refreshed = expectList(await harness.manager.list());
    expect(refreshed.jobs).toEqual(list.jobs);
  });

  it('a cross-install peer is refused: the refresh is a typed refusal, never an empty successful list', async () => {
    seedS1(harness.server, 'contract-local-0001', 'CLI');
    const foreign = await startHarness({ installId: 'install-999' });
    try {
      const answer = await foreign.manager.list();
      expect(isRefusal(answer)).toBe(true);
      if (isRefusal(answer)) {
        expect(answer.detail).toContain('rejected');
      }
    } finally {
      await foreign.stop();
    }
  });

  it('a Core without the durable journal fails closed: the query refusal is not an empty list', async () => {
    const noJournal = await startHarness({ withJournal: false });
    try {
      const answer = await noJournal.manager.list();
      expect(isRefusal(answer)).toBe(true);
      if (isRefusal(answer)) {
        expect(answer.detail).toContain('rejected');
      }
    } finally {
      await noJournal.stop();
    }
  });

  it('a Core loss mid-session renders a typed refusal, not an empty successful list', async () => {
    seedS1(harness.server, 'contract-local-0001', 'CLI');
    const before = expectList(await harness.manager.list());
    expect(before.jobs).toHaveLength(1);
    await harness.stopCore();
    const answer = await harness.manager.list();
    expect(isRefusal(answer)).toBe(true);
    if (isRefusal(answer)) {
      expect(answer.detail).toContain('disconnected');
    }
  });

  it('a Core loss after a successful empty index read is detected by the next fresh index query', async () => {
    const before = expectList(await harness.manager.list());
    expect(before.connection).toBe('CONNECTED');
    expect(before.jobs).toEqual([]);
    expect(before.totalCount).toBe(0);
    await harness.stopCore();
    const after = await harness.manager.list();
    expect(isRefusal(after)).toBe(true);
    if (isRefusal(after)) {
      expect(after.detail).toContain('disconnected');
    }
  });

  it.each([0, 199, 200, 201])(
    'keeps exact 0/199/200/201 index semantics at %i jobs',
    async (count) => {
      for (let index = 1; index <= count; index += 1) {
        seedS1(harness.server, `contract-${String(index).padStart(3, '0')}`, 'CLI');
      }
      const document = expectList(await harness.manager.list());
      expect(document.totalCount).toBe(count);
      expect(document.jobs).toHaveLength(Math.min(count, 200));
      expect(document.truncated).toBe(count > 200);
      if (count > 0) {
        // Latest durable commit first.
        expect(document.jobs[0]?.lineageId).toBe(`contract-${String(count).padStart(3, '0')}`);
      }
    },
    20_000,
  );
});

describe('DesktopManager control transitions remain Core commands (real Core)', () => {
  let harness: Harness;
  let lineageId: string;

  beforeEach(async () => {
    harness = await startHarness();
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.confirmAdd();
    if (isRefusal(action) || action.lineageId === null) {
      throw new Error('harness add refused');
    }
    lineageId = action.lineageId;
  });

  afterEach(async () => {
    await harness.stop();
  });

  it('does not route cancel or retry when the fresh Core projection read fails', async () => {
    const commandsBefore = harness.adapter
      .sentCommandEnvelopes()
      .map((envelope) => ({ commandType: envelope.commandType, requestId: envelope.requestId }));
    expect(commandsBefore.map((item) => item.commandType)).toEqual([
      'SUBMIT_CONTRACT',
      'EXECUTE_S1_DIRECT_ACQUISITION',
    ]);

    // The adapter still holds the last successful projection. A failed
    // re-attach must not let a control command use that stale cached revision.
    await harness.stopCore();

    const cancel = await harness.manager.cancelJob({ lineageId });
    expect(isRefusal(cancel)).toBe(true);
    if (isRefusal(cancel)) {
      expect(cancel.detail).toContain('fresh Core projection was not confirmed');
    }

    const retry = await harness.manager.retryJob({ lineageId });
    expect(isRefusal(retry)).toBe(true);
    if (isRefusal(retry)) {
      expect(retry.detail).toContain('fresh Core projection was not confirmed');
    }

    const commandsAfter = harness.adapter
      .sentCommandEnvelopes()
      .map((envelope) => ({ commandType: envelope.commandType, requestId: envelope.requestId }));
    expect(commandsAfter).toEqual(commandsBefore);
  });

  it('cancel routes a Core control transition; the refreshed row follows the projection', async () => {
    const action = await harness.manager.cancelJob({ lineageId });
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.action).toBe('cancel');
    expect(action.routed).toBe(true);
    expect(action.rejections).toEqual([]);
    expect(expectActionList(action).jobs[0]?.lineageStatus).toBe('CANCELLED');
  });

  it('retry without projected failed members is the typed ineligible refusal', async () => {
    const action = await harness.manager.retryJob({ lineageId });
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.routed).toBe(false);
    expect(action.refusalDetail).toContain('retry unavailable');
    expect(action.rejections).toEqual([]);
  });

  it('control on an unknown lineage is a typed refusal (Core re-decides; nothing fabricated)', async () => {
    const cancel = await harness.manager.cancelJob({ lineageId: 'contract-unknown-000001' });
    expect(isRefusal(cancel)).toBe(false);
    if (!isRefusal(cancel)) {
      expect(cancel.routed).toBe(false);
      expect(cancel.refusalDetail).toContain('no live Core projection');
    }
  });
});

describe('DesktopManager R3 repairs (review PR #365 BLOCK P1-01/P1-02)', () => {
  it('R3-01: a rejected second confirmation never executes prior-aggregate S1, keeps the preview, and surfaces the rejection', async () => {
    // Faithful reproduction of the reviewed defect: the adapter's routed
    // history is CUMULATIVE, and its rejected SUBMIT_CONTRACT branch returns
    // that full history even though nothing new routed. The manager must
    // attribute only newly appended commands bound to the pending lineage.
    const sent: { commandType: string; aggregateId: string; requestId: string }[] = [
      { commandType: 'SUBMIT_CONTRACT', aggregateId: 'contract-first-000001', requestId: 'r1' },
      {
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: 'contract-first-000001',
        requestId: 'r2',
      },
    ];
    let executeS1Calls = 0;
    const secondLineageId = 'contract-second-000002';
    const adapter = {
      sentCommandEnvelopes: () => [...sent],
      pendingCommandInfo: () => null,
      enterIntent: () => ({
        display: {},
        routed: [],
        delivery: {
          status: 'NOT_ATTEMPTED',
          commandType: null,
          aggregateId: null,
          requestId: null,
        },
        rejections: [],
        refusals: [],
      }),
      currentDraftView: () => ({
        contractId: secondLineageId,
        automationMode: 'ASSISTED',
        targetRef: 'https://example.com/b.mp4',
        requests: [{ level: 'SCOPE_LEVEL', description: 'scope', proves: 'target' }],
      }),
      hasDraftIntent: () => true,
      discardDraft: () => undefined,
      confirmScope: async () => ({
        display: {},
        // The defective discriminant the review flagged: the FIRST add's
        // commands resurface even though the second submit never routed.
        routed: [...sent],
        delivery: {
          status: 'REJECTED',
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: secondLineageId,
          requestId: 'request-second-rejected',
        },
        rejections: [
          {
            code: 'REQUEST_IDENTITY_CONFLICT',
            message: 'the submitted request identity conflicts with the durable record',
          },
        ],
        refusals: [],
      }),
      executeS1Direct: async () => {
        executeS1Calls += 1;
        sent.push({
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: 'contract-first-000001',
          requestId: 'r3',
        });
        return {
          display: {},
          routed: [...sent],
          delivery: {
            status: 'ACCEPTED',
            commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
            aggregateId: 'contract-first-000001',
            requestId: 'r3',
          },
          rejections: [],
          refusals: [],
        };
      },
      listS1JobProjections: async () => ({
        ok: true as const,
        items: [],
        totalCount: 0,
        truncated: false,
      }),
      currentProjectionView: () => null,
    } as unknown as DesktopUiAdapter;
    const manager = new DesktopManager({
      getAdapter: () => adapter,
      getConnectionWhenUnconfigured: () => 'CONNECTED',
    });

    const preview = await manager.previewAdd({ url: 'https://example.com/b.mp4' });
    expect(isRefusal(preview)).toBe(false);
    const action = await manager.confirmAdd();
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    // The old routed history is NOT attributed to the new lineage...
    expect(action.routed).toBe(false);
    expect(action.lineageId).toBe(secondLineageId);
    expect(action.rejections.map((rejection) => rejection.code)).toEqual([
      'REQUEST_IDENTITY_CONFLICT',
    ]);
    // ...no prior-aggregate S1 was executed and no new command was routed...
    expect(executeS1Calls).toBe(0);
    expect(sent).toHaveLength(2);
    // ...and the pending preview survives for the user to fix or discard.
    expect(manager.hasPendingPreview()).toBe(true);
    expect(expectActionList(action).pendingPreview?.lineageId).toBe(secondLineageId);
  });

  it('R3-02: no Core adapter on first list is a typed refusal, never an ok:true empty index', async () => {
    const manager = new DesktopManager({
      getAdapter: () => undefined,
      getConnectionWhenUnconfigured: () => 'UNCONFIGURED',
    });
    const answer = await manager.list();
    expect(isRefusal(answer)).toBe(true);
    if (isRefusal(answer)) {
      expect(answer.detail).toContain('UNCONFIGURED');
      expect(answer.detail).toContain('cannot be read');
    }
  });

  it('R3-02: a connected Core index with zero rows is the true empty-state (ok, exact totalCount 0)', async () => {
    const harness = await startHarness();
    try {
      const list = expectList(await harness.manager.list());
      expect(list.ok).toBe(true);
      expect(list.connection).toBe('CONNECTED');
      expect(list.totalCount).toBe(0);
      expect(list.truncated).toBe(false);
      expect(list.jobs).toEqual([]);
    } finally {
      await harness.stop();
    }
  });
});

// ---- shared-adapter serialization over the S1 index read ---------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const EMPTY_INDEX: S1JobIndexResult = { ok: true, items: [], totalCount: 0, truncated: false };

/**
 * A stub adapter whose index read is deferred: proves the manager serializes
 * list/control operations and never overlaps two index reads.
 */
class DeferredIndexAdapter {
  readonly indexReads: Deferred<S1JobIndexResult>[] = [];
  maxActiveIndexReads = 0;
  private activeIndexReads = 0;

  listS1JobProjections(): Promise<S1JobIndexResult> {
    this.activeIndexReads += 1;
    this.maxActiveIndexReads = Math.max(this.maxActiveIndexReads, this.activeIndexReads);
    const deferred = createDeferred<S1JobIndexResult>();
    this.indexReads.push(deferred);
    return deferred.promise.finally(() => {
      this.activeIndexReads -= 1;
    });
  }

  pendingCommandInfo(): null {
    return null;
  }

  async attachAggregate(): Promise<{
    readonly display: { readonly connection: 'CONNECTED' };
    readonly routed: readonly [];
    readonly delivery: {
      readonly status: 'NOT_ATTEMPTED';
      readonly commandType: null;
      readonly aggregateId: null;
      readonly requestId: null;
    };
    readonly rejections: readonly [];
    readonly refusals: readonly [];
  }> {
    return {
      display: { connection: 'CONNECTED' },
      routed: [],
      delivery: {
        status: 'NOT_ATTEMPTED',
        commandType: null,
        aggregateId: null,
        requestId: null,
      },
      rejections: [],
      refusals: [],
    };
  }

  async cancel(): Promise<{
    readonly routed: readonly { commandType: string; aggregateId: string; requestId: string }[];
    readonly delivery: {
      readonly status: 'ACCEPTED';
      readonly commandType: 'CANCEL_LINEAGE';
      readonly aggregateId: 'x';
      readonly requestId: 'r';
    };
    readonly rejections: readonly [];
    readonly refusals: readonly [];
  }> {
    return {
      routed: [{ commandType: 'CANCEL_LINEAGE', aggregateId: 'x', requestId: 'r' }],
      delivery: {
        status: 'ACCEPTED',
        commandType: 'CANCEL_LINEAGE',
        aggregateId: 'x',
        requestId: 'r',
      },
      rejections: [],
      refusals: [],
    };
  }

  async retryFailed(): Promise<{
    readonly routed: readonly [];
    readonly delivery: {
      readonly status: 'NOT_ATTEMPTED';
      readonly commandType: null;
      readonly aggregateId: null;
      readonly requestId: null;
    };
    readonly rejections: readonly [];
    readonly refusals: readonly [];
  }> {
    return {
      routed: [],
      delivery: {
        status: 'NOT_ATTEMPTED',
        commandType: null,
        aggregateId: null,
        requestId: null,
      },
      rejections: [],
      refusals: [],
    };
  }

  currentDraftView(): null {
    return null;
  }
}

function startDeferredManager(): {
  readonly adapter: DeferredIndexAdapter;
  readonly manager: DesktopManager;
} {
  const adapter = new DeferredIndexAdapter();
  const manager = new DesktopManager({
    getAdapter: () => adapter as unknown as DesktopUiAdapter,
    getConnectionWhenUnconfigured: () => 'CONNECTED',
  });
  return { adapter, manager };
}

describe('DesktopManager shared-adapter serialization over the index read', () => {
  it('coalesces concurrent public list requests into one in-flight index read', async () => {
    const { adapter, manager } = startDeferredManager();
    const first = manager.list();
    const second = manager.list();
    expect(second).toBe(first);
    // The serialized operation starts on a microtask after the call.
    await vi.waitFor(() => {
      expect(adapter.indexReads).toHaveLength(1);
    });
    adapter.indexReads[0]?.resolve(EMPTY_INDEX);
    const document = expectList(await first);
    expect(await second).toBe(document);
    expect(adapter.indexReads).toHaveLength(1);
    expect(adapter.maxActiveIndexReads).toBe(1);
  });

  it('serializes a control action behind an in-flight index read (one index read at a time)', async () => {
    const { adapter, manager } = startDeferredManager();
    const list = manager.list();
    await vi.waitFor(() => {
      expect(adapter.indexReads).toHaveLength(1);
    });

    const control = manager.cancelJob({ lineageId: 'contract-a-000001' });
    // The control waits behind the in-flight list: no second index read yet.
    expect(adapter.indexReads).toHaveLength(1);
    adapter.indexReads[0]?.resolve(EMPTY_INDEX);
    await list;

    // Now the control proceeds: attach + cancel + its embedded fresh list.
    await vi.waitFor(() => {
      expect(adapter.indexReads).toHaveLength(2);
    });
    expect(adapter.maxActiveIndexReads).toBe(1);
    adapter.indexReads[1]?.resolve(EMPTY_INDEX);
    const answer = await control;
    expect(isRefusal(answer)).toBe(false);
    if (!isRefusal(answer)) {
      expect(answer.action).toBe('cancel');
      expect(answer.routed).toBe(true);
      expect(expectActionList(answer).totalCount).toBe(0);
    }
  });

  it('recovers the single-flight state after a rejected index read', async () => {
    const { adapter, manager } = startDeferredManager();
    const failed = manager.list();
    await vi.waitFor(() => {
      expect(adapter.indexReads).toHaveLength(1);
    });
    adapter.indexReads[0]?.reject(new Error('index read refused'));
    await expect(failed).rejects.toThrow('index read refused');

    const recovered = manager.list();
    expect(recovered).not.toBe(failed);
    await vi.waitFor(() => {
      expect(adapter.indexReads).toHaveLength(2);
    });
    adapter.indexReads[1]?.resolve(EMPTY_INDEX);
    expectList(await recovered);
  });
});

describe('DesktopManager ambiguous Add delivery', () => {
  const lineageId = 'contract-desktop-ack-000001';
  const contractRequestId = 'request-contract-stable-001';
  const s1RequestId = 'request-s1-stable-001';

  function createAdapter(unknownAt: 'contract' | 's1'): {
    readonly adapter: DesktopUiAdapter;
    readonly contractRequestIds: string[];
    readonly s1RequestIds: string[];
  } {
    let pending: ManagerCommandDelivery | null = null;
    let draft: {
      readonly contractId: string;
      readonly automationMode: string;
      readonly targetRef: string;
      readonly requests: readonly {
        readonly level: string;
        readonly description: string;
        readonly proves: string;
      }[];
    } | null = null;
    let contractCalls = 0;
    let s1Calls = 0;
    const contractRequestIds: string[] = [];
    const s1RequestIds: string[] = [];

    const commandDelivery = (
      status: 'UNKNOWN' | 'ACCEPTED',
      commandType: string,
      requestId: string,
    ): ManagerCommandDelivery => ({
      status,
      commandType,
      aggregateId: lineageId,
      requestId,
    });
    const outcome = (delivery: ManagerCommandDelivery) => ({
      display: {},
      routed: [],
      delivery,
      rejections: [],
      refusals: [],
    });

    const adapter = {
      pendingCommandInfo: () => pending,
      enterIntent: () => {
        draft = {
          contractId: lineageId,
          automationMode: 'ASSISTED',
          targetRef: 'https://example.com/a.mp4',
          requests: [{ level: 'SCOPE_LEVEL', description: 'scope', proves: 'target' }],
        };
        return outcome({
          status: 'NOT_ATTEMPTED',
          commandType: null,
          aggregateId: null,
          requestId: null,
        });
      },
      currentDraftView: () => draft,
      confirmScope: async () => {
        contractCalls += 1;
        contractRequestIds.push(contractRequestId);
        if (unknownAt === 'contract' && contractCalls === 1) {
          const unknown = commandDelivery('UNKNOWN', 'SUBMIT_CONTRACT', contractRequestId);
          pending = unknown;
          return outcome(unknown);
        }
        pending = null;
        draft = null;
        return outcome(commandDelivery('ACCEPTED', 'SUBMIT_CONTRACT', contractRequestId));
      },
      executeS1Direct: async () => {
        s1Calls += 1;
        s1RequestIds.push(s1RequestId);
        if (unknownAt === 's1' && s1Calls === 1) {
          const unknown = commandDelivery('UNKNOWN', 'EXECUTE_S1_DIRECT_ACQUISITION', s1RequestId);
          pending = unknown;
          return outcome(unknown);
        }
        pending = null;
        return outcome(commandDelivery('ACCEPTED', 'EXECUTE_S1_DIRECT_ACQUISITION', s1RequestId));
      },
      listS1JobProjections: async () => EMPTY_INDEX,
    } as unknown as DesktopUiAdapter;

    return { adapter, contractRequestIds, s1RequestIds };
  }

  function createManager(adapter: DesktopUiAdapter): DesktopManager {
    return new DesktopManager({
      getAdapter: () => adapter,
      getConnectionWhenUnconfigured: () => 'CONNECTED',
    });
  }

  it('keeps an unknown SUBMIT_CONTRACT preview and does not execute S1 until exact replay is acknowledged', async () => {
    const fixture = createAdapter('contract');
    const manager = createManager(fixture.adapter);
    const preview = await manager.previewAdd({ url: 'https://example.com/a.mp4' });
    expect(isRefusal(preview)).toBe(false);

    const first = await manager.confirmAdd();
    expect(isRefusal(first)).toBe(false);
    if (isRefusal(first)) return;
    expect(first.delivery).toMatchObject({
      status: 'UNKNOWN',
      commandType: 'SUBMIT_CONTRACT',
      requestId: contractRequestId,
    });
    expect(first.previewConsumed).toBe(false);
    expect(expectActionList(first).pendingPreview?.lineageId).toBe(lineageId);
    expect(expectActionList(first).pendingCommand?.status).toBe('UNKNOWN');
    expect(fixture.s1RequestIds).toStrictEqual([]);
    expect(manager.hasPendingPreview()).toBe(true);

    const reconciled = await manager.confirmAdd();
    expect(isRefusal(reconciled)).toBe(false);
    if (isRefusal(reconciled)) return;
    expect(reconciled.delivery).toMatchObject({
      status: 'ACCEPTED',
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      requestId: s1RequestId,
    });
    expect(reconciled.previewConsumed).toBe(true);
    expect(expectActionList(reconciled).pendingPreview).toBeNull();
    expect(expectActionList(reconciled).pendingCommand).toBeNull();
    expect(fixture.contractRequestIds).toStrictEqual([contractRequestId, contractRequestId]);
    expect(fixture.s1RequestIds).toStrictEqual([s1RequestId]);
    expect(manager.hasPendingPreview()).toBe(false);
  });

  it('consumes the preview after accepted contract + unknown S1 and reconciles the exact S1 request', async () => {
    const fixture = createAdapter('s1');
    const manager = createManager(fixture.adapter);
    const preview = await manager.previewAdd({ url: 'https://example.com/a.mp4' });
    expect(isRefusal(preview)).toBe(false);

    const first = await manager.confirmAdd();
    expect(isRefusal(first)).toBe(false);
    if (isRefusal(first)) return;
    expect(first.delivery).toMatchObject({
      status: 'UNKNOWN',
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      requestId: s1RequestId,
    });
    expect(first.previewConsumed).toBe(true);
    expect(expectActionList(first).pendingPreview).toBeNull();
    expect(expectActionList(first).pendingCommand).toMatchObject({
      status: 'UNKNOWN',
      requestId: s1RequestId,
    });
    expect(manager.hasPendingPreview()).toBe(false);

    const blockedPreview = await manager.previewAdd({ url: 'https://example.com/another.mp4' });
    expect(isRefusal(blockedPreview)).toBe(true);

    const reconciled = await manager.confirmAdd();
    expect(isRefusal(reconciled)).toBe(false);
    if (isRefusal(reconciled)) return;
    expect(reconciled.delivery).toMatchObject({
      status: 'ACCEPTED',
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      requestId: s1RequestId,
    });
    expect(reconciled.previewConsumed).toBe(true);
    expect(expectActionList(reconciled).pendingCommand).toBeNull();
    expect(fixture.contractRequestIds).toStrictEqual([contractRequestId]);
    expect(fixture.s1RequestIds).toStrictEqual([s1RequestId, s1RequestId]);
  });
});
