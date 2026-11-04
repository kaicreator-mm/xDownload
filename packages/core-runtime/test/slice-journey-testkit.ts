/**
 * V022-A04 — Core-owned test support for the S2/S5/S6 slice journey tests
 * and the Direct integration matrix (migrated from the Domain App
 * integrations lane; packages/core-runtime/test/).
 *
 * NOT a test file: this module registers no tests and is imported
 * exclusively by the Core test files colocated in this directory. It carries
 * the T11/T12 precedent's real localhost fixture (random port, per-path
 * behavior, recorded requests) and the Core-side direct-runtime workspace
 * factory — the same zero-mock discipline as the T11 composition matrix:
 * real sealed K runtime assembled by the Core composition layer, real
 * pinned T04 Host bridge, real 127.0.0.1 bytes.
 *
 * A04 ownership: the physical assembly (sealed BUILD + Host bridge pin +
 * durable Host store + SDK public `load`) lives HERE, next to the Core
 * tests, consuming the Domain App and the trusted Host ONLY through their
 * stable package roots — the exact import discipline the production
 * `core-runtime/src/domain-app-route.ts` obeys.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from '@kaicreator/domain-harness-microkernel';
import {
  DIRECT_BRIDGE_PIN,
  sealDirectComposition,
  type DownloadRuntime,
} from '@xdownload/download-domain-app';
import {
  CanonicalBudgetLedger,
  DirectAcquisitionBridge,
  FileCasDocStore,
  InMemoryTargetRefRegistry,
  type TargetRefRecord,
} from '@xdownload/download-domain-host';

export type Behavior = (request: IncomingMessage, response: ServerResponse) => void;

export class LocalHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<string, Behavior>();
  readonly requests: string[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((request: IncomingMessage, response: ServerResponse) => {
      this.requests.push(request.url ?? '/');
      const behavior = this.behaviors.get((request.url ?? '/').split('?')[0] ?? '/');
      if (behavior === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('fixture: no behavior');
        return;
      }
      behavior(request, response);
    });
  }

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  serveBytes(path: string, body: Uint8Array): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.end(Buffer.from(body));
    });
  }

  /** Serve a first partial byte range and never finish (client must abort). */
  stallAfterBytes(path: string, body: Uint8Array, stallAfterBytes: number): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.write(Buffer.from(body.subarray(0, stallAfterBytes)));
      // Never end: the AbortSignal is the only way this response completes.
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolveStart) => {
      this.server.listen(0, '127.0.0.1', () => resolveStart());
    });
    this.port = (this.server.address() as { port: number }).port;
  }

  get host(): string {
    return `127.0.0.1:${String(this.port)}`;
  }

  uri(path: string): string {
    return `http://127.0.0.1:${String(this.port)}${path}`;
  }

  requestCount(path: string): number {
    return this.requests.filter((recorded) => recorded === path).length;
  }

  get totalRequests(): number {
    return this.requests.length;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolveStop, rejectStop) => {
      this.server.close((error) => (error === undefined ? resolveStop() : rejectStop(error)));
    });
  }
}

/** The pin shape the sealed direct C module reaches on globalThis. */
interface DirectBridgePin {
  acquire: (payload: Record<string, unknown>, permit: unknown) => Promise<unknown>;
}

function hostGlobals(): { [DIRECT_BRIDGE_PIN]?: DirectBridgePin } {
  return globalThis as unknown as { [DIRECT_BRIDGE_PIN]?: DirectBridgePin };
}

const DEFAULT_BUDGET_PROFILE = {
  discovery: { domain: 'discovery' },
  transfer: { domain: 'transfer', maxBytes: 1_048_576 },
  globalSafety: { domain: 'global_safety' },
} as const;

export interface AssembleDirectRuntimeOptions {
  /** Durable store file path (plain-file CAS; reopened across restarts). */
  readonly storePath: string;
  /** Trusted registry seed: opaque handles → delivery facts (Host record shape). */
  readonly targetRefs?: readonly { readonly handle: string; readonly record: TargetRefRecord }[];
  /** Canonical budget profile (decodes through the T04 ledger). */
  readonly budgetProfile?: unknown;
}

/**
 * Assemble the direct download runtime Core-side (the A04 composition
 * pattern): seal the App BUILD through the App package root, open the
 * Host-owned durable store/registry/ledger/bridge through the Host package
 * root, install the `DIRECT_BRIDGE_PIN` pin BEFORE the SDK public `load`,
 * and load the one K. The returned object satisfies the App
 * `DownloadRuntime` domain contract structurally (the Host store is
 * assignable to the `KDocStoreEvidencePort`; the bridge counters view is
 * the structural `TransitionalDirectBridgeView`). `stop()` releases the pin
 * (only if still ours), stops the app, aborts every in-flight submission
 * and closes the store.
 */
export async function assembleDirectRuntime(
  options: AssembleDirectRuntimeOptions,
): Promise<DownloadRuntime> {
  const { built } = sealDirectComposition();

  const store = new FileCasDocStore(options.storePath);
  const registry = new InMemoryTargetRefRegistry();
  for (const seed of options.targetRefs ?? []) {
    const registered = registry.register(seed.handle, seed.record);
    if (!registered.ok) {
      throw new Error(
        `DIRECT_REGISTRY_SEED_REFUSED: ${registered.diagnostics.map((entry) => entry.code).join(', ')}`,
      );
    }
  }
  const ledger = new CanonicalBudgetLedger(options.budgetProfile ?? DEFAULT_BUDGET_PROFILE);
  const bridge = new DirectAcquisitionBridge(registry, ledger);

  const submissions = new Map<string, AbortController>();

  /**
   * The trusted dispatch seam: the K→C external Effect gate invokes the
   * sealed direct C module with (payload, dispatchContext) where payload =
   * the B projection of the T01 intent PLUS the kernel-minted `effectId`.
   * The T04 bridge takes the effect identity through the PERMIT channel
   * (`KernelPermitContext.effectId`, verified by its permit gate) and
   * validates the intent payload against the T01 exact-field grammar — so
   * the pin re-channels that one kernel-added field through the permit it
   * already rides and forwards the pure T01 intent verbatim: no field is
   * invented, none is dropped (the same effectId crosses in the permit),
   * and the caller's cancellation signal rides along per request.
   */
  const pin: DirectBridgePin = {
    acquire: (payload, permit) => {
      const intent: Record<string, unknown> = { ...payload };
      delete intent['effectId'];
      const requestId = intent['requestId'];
      const signal = typeof requestId === 'string' ? submissions.get(requestId)?.signal : undefined;
      return bridge.acquire(intent, permit, signal === undefined ? {} : { signal });
    },
  };
  hostGlobals()[DIRECT_BRIDGE_PIN] = pin;

  const app = await load(built, {
    store,
    tenantId: 'tenant:xdownload-v02-t11',
    deploymentIdentity: {
      deployedAppId: 'deploy:xdownload-v02-t11',
      tenantId: 'tenant:xdownload-v02-t11',
      appId: built.appId,
    },
    queryAuthority: {
      principal: { actor: 'xdownload-v02-t11-host' },
      authorize: (candidate, target) =>
        Boolean(
          candidate !== null &&
          typeof candidate === 'object' &&
          (candidate as { actor?: string }).actor === 'xdownload-v02-t11-host' &&
          target.tenantId === 'tenant:xdownload-v02-t11',
        ),
    },
  });

  return {
    built,
    app,
    store,
    bridge: { counters: bridge.counters },
    registry,
    ledger,
    beginSubmission(requestId: string): AbortController {
      const existing = submissions.get(requestId);
      if (existing !== undefined) return existing;
      const controller = new AbortController();
      submissions.set(requestId, controller);
      return controller;
    },
    settleSubmission(requestId: string): void {
      submissions.delete(requestId);
    },
    cancel(requestId: string, reason?: string): void {
      submissions.get(requestId)?.abort(reason);
    },
    signalFor(requestId: string): AbortSignal | undefined {
      return submissions.get(requestId)?.signal;
    },
    stop(): void {
      for (const controller of submissions.values()) {
        controller.abort('runtime stopped');
      }
      submissions.clear();
      app.stop();
      if (hostGlobals()[DIRECT_BRIDGE_PIN] === pin) {
        delete hostGlobals()[DIRECT_BRIDGE_PIN];
      }
      store.close();
    },
  };
}

/** Declared registry seed: opaque handle → fixture path (resolved at assembly). */
export interface SliceSeedPlan {
  readonly handle: string;
  readonly path: string;
}

export interface SliceWorkspace {
  readonly root: string;
  readonly outputRoot: string;
  readonly storePath: string;
  readonly fixture: LocalHttpFixture;
  readonly runtime: DownloadRuntime;
  dispose(): Promise<void>;
}

/**
 * Assemble one direct-runtime workspace over the shared fixture with the
 * declared seeds registered BEFORE assembly (the registry is consumed by
 * the trusted composition at assembly time, like the T11 matrix does).
 */
export async function makeSliceWorkspace(
  name: string,
  fixture: LocalHttpFixture,
  seedPlans: readonly SliceSeedPlan[],
): Promise<SliceWorkspace> {
  const root = mkdtempSync(join(tmpdir(), `xd-v02-t12-${name}-`));
  const outputRoot = join(root, 'out');
  const storePath = join(root, 'k-docs.json');
  const seeds: { handle: string; record: TargetRefRecord }[] = seedPlans.map((plan) => ({
    handle: plan.handle,
    record: { uri: fixture.uri(plan.path), allowedRedirectHosts: [fixture.host] },
  }));
  const runtime = await assembleDirectRuntime({ storePath, targetRefs: seeds });
  return {
    root,
    outputRoot,
    storePath,
    fixture,
    runtime,
    async dispose(): Promise<void> {
      runtime.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
