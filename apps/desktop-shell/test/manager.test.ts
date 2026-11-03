/**
 * T08 desktop download-manager service tests — behavioral proof over the
 * REAL seam authority server (the way the packaged Core host answers):
 *
 * - the add flow routes through the adapter's canonical confirmation
 *   workflow and the preview stays non-authoritative (no command routed);
 * - the job list is built ONLY from Core projections (a failed read renders
 *   the truthful absent row — never a cached or guessed status);
 * - cancel routes as a Core control transition; retry ineligibility is the
 *   adapter's own typed refusal; Core-typed rejections surface verbatim;
 * - reveal is gated on a FRESH projection proving COMPLETE plus the
 *   user-chosen destination — and never claims an artifact path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type SeamListenTarget,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import { createDesktopUiAdapter, type DesktopUiAdapter } from '@xdownload/desktop-ui';
import { DesktopManager } from '../src/main/manager.ts';
import type { ShellRefusal } from '../src/main/shell-contract.ts';

const INSTALL_ID = 'mgrtest';
const USER_ID = 'mgruser';
const EXPECTED_PEER: ExpectedPeerScope = {
  installId: INSTALL_ID,
  userId: USER_ID,
  allowedSurfaces: ['DESKTOP_UI'],
};

interface Harness {
  readonly adapter: DesktopUiAdapter;
  readonly manager: DesktopManager;
  readonly revealed: string[];
  /** Stops ONLY the seam server transport (a real Core loss). */
  stopCore(): Promise<void>;
  stop(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const transport: SeamServerTransport = createLoopbackServerTransport({
    host: '127.0.0.1',
    port: 0,
  });
  const seam = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
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
    installId: INSTALL_ID,
    userId: USER_ID,
    now: () => '2026-10-31T09:00:00Z',
  });
  const revealed: string[] = [];
  const manager = new DesktopManager({
    getAdapter: () => adapter,
    getConnectionWhenUnconfigured: () => 'UNCONFIGURED',
    pickDestination: async () => null,
    revealFolder: (path) => {
      revealed.push(path);
      return true;
    },
  });
  return {
    adapter,
    manager,
    revealed,
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

describe('DesktopManager add flow (real seam)', () => {
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

  it('confirm routes the contract and the list row comes from the Core projection', async () => {
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.confirmAdd();
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.action).toBe('add');
    expect(action.routed).toBe(true);
    expect(action.rejections).toEqual([]);
    expect(action.list.jobs.length).toBe(1);
    const row = action.list.jobs[0];
    expect(row?.present).toBe(true);
    expect(row?.contractStatus).toBe('CONFIRMED');
    expect(row?.lineageId).toBe(action.lineageId);
    expect(row?.destination).toBeNull();
    // The row carries the Core's own status words — never a fabricated one.
    expect(action.list.connection).toBe('CONNECTED');
  });

  it('confirm records the chosen destination and the row mirrors it', async () => {
    await harness.manager.previewAdd({
      url: 'https://example.com/a.mp4',
      destination: 'C:/downloads',
    });
    const action = await harness.manager.confirmAdd();
    if (isRefusal(action)) {
      throw new Error('confirm refused');
    }
    expect(action.list.jobs[0]?.destination).toBe('C:/downloads');
  });

  it('a refresh after a Core loss renders truthful absent rows (no cached status)', async () => {
    await harness.manager.previewAdd({ url: 'https://example.com/a.mp4' });
    const action = await harness.manager.confirmAdd();
    if (isRefusal(action)) {
      throw new Error('confirm refused');
    }
    expect(action.list.jobs[0]?.present).toBe(true);
    // Kill the Core endpoint for real: the projection read now fails and the
    // row must say exactly that — never keep the last known status.
    await harness.stopCore();
    const list = await harness.manager.list();
    expect(list.connection).toBe('DISCONNECTED');
    expect(list.jobs[0]?.present).toBe(false);
    expect(list.jobs[0]?.contractStatus).toBeNull();
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
    expect(action.list.pendingPreview).toBeNull();
  });
});

describe('DesktopManager control transitions (real seam)', () => {
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

  it('cancel routes a Core control transition; the refreshed row follows the projection', async () => {
    const action = await harness.manager.cancelJob({ lineageId });
    expect(isRefusal(action)).toBe(false);
    if (isRefusal(action)) {
      return;
    }
    expect(action.action).toBe('cancel');
    expect(action.routed).toBe(true);
    expect(action.rejections).toEqual([]);
    expect(action.list.jobs[0]?.lineageStatus).toBe('CANCELLED');
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

  it('cancel/retry on an untracked lineage is a typed refusal (no routing)', async () => {
    const cancel = await harness.manager.cancelJob({ lineageId: 'contract-unknown-000001' });
    expect(isRefusal(cancel)).toBe(true);
    const retry = await harness.manager.retryJob({ lineageId: 'contract-unknown-000001' });
    expect(isRefusal(retry)).toBe(true);
  });
});

describe('DesktopManager reveal and destination gating', () => {
  interface StubHarness {
    readonly manager: DesktopManager;
    readonly revealed: string[];
    readonly jobs: Map<string, { lineageId: string; destination: string | null }>;
  }

  /** A manager over a stub adapter whose projection is read live from the holder. */
  function stubManager(holder: {
    current: ReturnType<typeof stubProjectionView> | null;
  }): StubHarness {
    const stubAdapter = {
      attachAggregate: async () => undefined,
      currentProjectionView: () => holder.current,
    } as unknown as DesktopUiAdapter;
    const revealed: string[] = [];
    const manager = new DesktopManager({
      getAdapter: () => stubAdapter,
      getConnectionWhenUnconfigured: () => 'CONNECTED',
      pickDestination: async () => null,
      revealFolder: (path) => {
        revealed.push(path);
        return true;
      },
    });
    const jobs = (
      manager as unknown as {
        jobs: Map<string, { lineageId: string; destination: string | null }>;
      }
    ).jobs;
    return { manager, revealed, jobs };
  }

  it('reveal is refused for an untracked lineage (nothing revealed)', async () => {
    const harness = stubManager({ current: null });
    const answer = await harness.manager.revealJob({ lineageId: 'contract-none-000001' });
    expect(isRefused(answer)).toBe(true);
    expect(harness.revealed).toEqual([]);
  });

  it('reveal opens the destination folder only for a COMPLETE projection', async () => {
    const holder: { current: ReturnType<typeof stubProjectionView> | null } = { current: null };
    const harness = stubManager(holder);
    harness.jobs.set('contract-complete-000001', {
      lineageId: 'contract-complete-000001',
      destination: 'C:/downloads',
    });

    // Not completed per the fresh projection: refused, nothing revealed.
    holder.current = stubProjectionView('PARTIAL');
    const refused = await harness.manager.revealJob({ lineageId: 'contract-complete-000001' });
    expect(isRefused(refused)).toBe(true);
    expect(harness.revealed).toEqual([]);

    // COMPLETE per the fresh projection: the destination folder reveals.
    holder.current = stubProjectionView('COMPLETE');
    const ok = await harness.manager.revealJob({ lineageId: 'contract-complete-000001' });
    expect(isRefused(ok)).toBe(false);
    if (!isRefused(ok)) {
      expect(ok.revealed).toBe('destination-folder');
      expect(ok.destination).toBe('C:/downloads');
    }
    expect(harness.revealed).toEqual(['C:/downloads']);

    // No destination recorded: refused even when COMPLETE.
    harness.jobs.set('contract-nodest-000001', {
      lineageId: 'contract-nodest-000001',
      destination: null,
    });
    const noDestination = await harness.manager.revealJob({ lineageId: 'contract-nodest-000001' });
    expect(isRefused(noDestination)).toBe(true);
    expect(harness.revealed).toEqual(['C:/downloads']);
  });
});

function isRefused(answer: unknown): answer is ShellRefusal {
  return (answer as ShellRefusal).ok === false;
}

/** Minimal legacy projection view stub for the reveal gate tests. */
function stubProjectionView(requestFulfillment: 'COMPLETE' | 'PARTIAL'): {
  contract: { contractId: string; status: string; intentType: string; revision: number };
  lineage: {
    status: string;
    failedMemberCount: number;
    failedMemberIds: string[];
    retriedMemberIds: string[];
  };
  terminal: {
    requestFulfillment: string;
    coverage: string;
    stopReason: string;
    validationSummary: { status: string; passedCount: number; failedCount: number };
    recordedAt: string;
  };
} {
  return {
    contract: {
      contractId: 'contract-complete-000001',
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      revision: 1,
    },
    lineage: {
      status: 'CLOSED',
      failedMemberCount: 0,
      failedMemberIds: [],
      retriedMemberIds: [],
    },
    terminal: {
      requestFulfillment,
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'NATURAL_END',
      validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
      recordedAt: '2026-10-31T09:00:00Z',
    },
  };
}

const LINEAGE_A = 'contract-a-000001';
const LINEAGE_B = 'contract-b-000002';

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

interface AttachOutcome {
  readonly display: { readonly connection: 'CONNECTED' };
}

class DeferredAdapter {
  readonly attachCalls: string[] = [];
  readonly controlCalls: { readonly action: 'cancel' | 'retry'; readonly lineageId: string }[] = [];
  maxActiveAttaches = 0;
  private activeAttaches = 0;
  private currentLineageId: string | null = null;
  private readonly pendingAttaches: {
    readonly lineageId: string;
    readonly deferred: Deferred<AttachOutcome>;
  }[] = [];

  constructor(readonly views: Map<string, ReturnType<typeof stubProjectionView>>) {}

  attachAggregate(lineageId: string): Promise<AttachOutcome> {
    this.attachCalls.push(lineageId);
    this.currentLineageId = lineageId;
    this.activeAttaches += 1;
    this.maxActiveAttaches = Math.max(this.maxActiveAttaches, this.activeAttaches);
    const deferred = createDeferred<AttachOutcome>();
    this.pendingAttaches.push({ lineageId, deferred });
    return deferred.promise.finally(() => {
      this.activeAttaches -= 1;
    });
  }

  hasPendingAttach(lineageId: string): boolean {
    return this.pendingAttaches.some((pending) => pending.lineageId === lineageId);
  }

  resolveAttach(lineageId: string): void {
    const pending = this.takePendingAttach(lineageId);
    this.currentLineageId = lineageId;
    pending.deferred.resolve({ display: { connection: 'CONNECTED' } });
  }

  rejectAttach(lineageId: string, error: Error): void {
    this.takePendingAttach(lineageId).deferred.reject(error);
  }

  currentProjectionView(): ReturnType<typeof stubProjectionView> | null {
    return this.currentLineageId === null ? null : (this.views.get(this.currentLineageId) ?? null);
  }

  async cancel(): Promise<{
    readonly routed: string[];
    readonly rejections: [];
    readonly refusals: [];
  }> {
    return this.routeControl('cancel');
  }

  async retryFailed(): Promise<{
    readonly routed: string[];
    readonly rejections: [];
    readonly refusals: [];
  }> {
    return this.routeControl('retry');
  }

  private routeControl(action: 'cancel' | 'retry'): {
    readonly routed: string[];
    readonly rejections: [];
    readonly refusals: [];
  } {
    if (this.currentLineageId === null) {
      throw new Error('no attached lineage');
    }
    const lineageId = this.currentLineageId;
    this.controlCalls.push({ action, lineageId });
    return { routed: [lineageId], rejections: [], refusals: [] };
  }

  private takePendingAttach(lineageId: string): {
    readonly lineageId: string;
    readonly deferred: Deferred<AttachOutcome>;
  } {
    const index = this.pendingAttaches.findIndex((pending) => pending.lineageId === lineageId);
    const pending = this.pendingAttaches[index];
    if (index < 0 || pending === undefined) {
      throw new Error(`no pending attach for ${lineageId}`);
    }
    this.pendingAttaches.splice(index, 1);
    return pending;
  }
}

function lineageProjection(
  lineageId: string,
  revision: number,
): ReturnType<typeof stubProjectionView> {
  const view = stubProjectionView('PARTIAL');
  view.contract.contractId = lineageId;
  view.contract.revision = revision;
  return view;
}

function startDeferredManager(): {
  readonly adapter: DeferredAdapter;
  readonly manager: DesktopManager;
} {
  const adapter = new DeferredAdapter(
    new Map([
      [LINEAGE_A, lineageProjection(LINEAGE_A, 11)],
      [LINEAGE_B, lineageProjection(LINEAGE_B, 22)],
    ]),
  );
  const manager = new DesktopManager({
    getAdapter: () => adapter as unknown as DesktopUiAdapter,
    getConnectionWhenUnconfigured: () => 'CONNECTED',
    pickDestination: async () => null,
    revealFolder: () => true,
  });
  const jobs = (
    manager as unknown as {
      jobs: Map<string, { lineageId: string; destination: string | null }>;
    }
  ).jobs;
  jobs.set(LINEAGE_A, { lineageId: LINEAGE_A, destination: 'C:/downloads/a' });
  jobs.set(LINEAGE_B, { lineageId: LINEAGE_B, destination: 'C:/downloads/b' });
  return { adapter, manager };
}

async function resolveNextAttach(adapter: DeferredAdapter, lineageId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(adapter.hasPendingAttach(lineageId)).toBe(true);
  });
  adapter.resolveAttach(lineageId);
}

function expectLineageRows(document: {
  readonly jobs: readonly { readonly lineageId: string; readonly revision: number | null }[];
}): void {
  expect(document.jobs.map((row) => [row.lineageId, row.revision])).toEqual([
    [LINEAGE_A, 11],
    [LINEAGE_B, 22],
  ]);
}

async function expectSerializedControl(action: 'cancel' | 'retry'): Promise<void> {
  const { adapter, manager } = startDeferredManager();
  const refresh = manager.list();
  await resolveNextAttach(adapter, LINEAGE_A);
  await vi.waitFor(() => {
    expect(adapter.hasPendingAttach(LINEAGE_B)).toBe(true);
  });

  const control =
    action === 'cancel'
      ? manager.cancelJob({ lineageId: LINEAGE_A })
      : manager.retryJob({ lineageId: LINEAGE_A });
  await Promise.resolve();
  adapter.resolveAttach(LINEAGE_B);
  await refresh;

  await resolveNextAttach(adapter, LINEAGE_A);
  await vi.waitFor(() => {
    expect(adapter.controlCalls).toHaveLength(1);
  });
  await resolveNextAttach(adapter, LINEAGE_A);
  await resolveNextAttach(adapter, LINEAGE_B);
  const answer = await control;

  expect(adapter.maxActiveAttaches).toBe(1);
  expect(adapter.controlCalls).toEqual([{ action, lineageId: LINEAGE_A }]);
  expect(isRefusal(answer)).toBe(false);
  if (isRefusal(answer)) {
    throw new Error('control unexpectedly refused');
  }
  expect(answer.action).toBe(action);
  expect(answer.lineageId).toBe(LINEAGE_A);
  expect(answer.routed).toBe(true);
  expectLineageRows(answer.list);
}

describe('DesktopManager shared-adapter serialization', () => {
  it('keeps a delayed A/B list refresh from overlapping or retargeting Cancel A', async () => {
    await expectSerializedControl('cancel');
  });

  it('keeps a delayed A/B list refresh from overlapping or retargeting Retry A', async () => {
    await expectSerializedControl('retry');
  });

  it('binds every list row to its own lineage projection', async () => {
    const { adapter, manager } = startDeferredManager();
    const list = manager.list();
    await resolveNextAttach(adapter, LINEAGE_A);
    await resolveNextAttach(adapter, LINEAGE_B);
    expectLineageRows(await list);
  });

  it('coalesces concurrent public list requests into one in-flight refresh', async () => {
    const { adapter, manager } = startDeferredManager();
    const first = manager.list();
    const second = manager.list();
    expect(second).toBe(first);

    await resolveNextAttach(adapter, LINEAGE_A);
    await resolveNextAttach(adapter, LINEAGE_B);
    const document = await first;
    expect(await second).toBe(document);
    expect(adapter.attachCalls).toEqual([LINEAGE_A, LINEAGE_B]);
    expectLineageRows(document);
  });

  it('recovers the queue and list single-flight state after an adapter rejection', async () => {
    const { adapter, manager } = startDeferredManager();
    const failed = manager.list();
    await vi.waitFor(() => {
      expect(adapter.hasPendingAttach(LINEAGE_A)).toBe(true);
    });
    adapter.rejectAttach(LINEAGE_A, new Error('deferred projection refused'));
    await expect(failed).rejects.toThrow('deferred projection refused');

    const recovered = manager.list();
    expect(recovered).not.toBe(failed);
    await resolveNextAttach(adapter, LINEAGE_A);
    await resolveNextAttach(adapter, LINEAGE_B);
    expectLineageRows(await recovered);
  });
});
