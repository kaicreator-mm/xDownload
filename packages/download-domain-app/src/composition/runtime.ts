/**
 * v0.2 T11 — download Domain App RUNTIME assembly (integration-direct lane;
 * write set packages/download-domain-app/src/composition/** only).
 *
 * `assembleDownloadRuntime` end-to-end composes the sealed K/S/B/C BUILD of
 * the T03 composition with the REAL C/Host acquisition implementation:
 *
 *   - K/S/B bytes come from the T03 sealed producer verbatim (kernel-primary
 *     and standard-primary must still reproduce the #183 PoC manifest module
 *     hashes; the B policy module is the sealed business-download.mjs);
 *   - the C capability module is THIS lane's capability-acquisition-direct.mjs
 *     (same route binding as T03: ACQUISITION_ROUTE, capabilityId
 *     'acquisition', handler 'acquire', externalEffect: true) re-sealed into
 *     one BUILD by the public @kaicreator/domain-harness-build producer;
 *   - the physical C implementation is the T04 `DirectAcquisitionBridge`
 *     (permit gate, registry-resolved targetRef, CanonicalBudgetLedger single
 *     budget truth, digest-backed atomic materialization), pinned on
 *     `globalThis.__xdownloadDirectAcquisitionBridge` BEFORE the SDK public
 *     `load` runs (the #183 PoC host-dependency pattern; a missing pin fails
 *     closed inside the sealed C module);
 *   - the K documents live in a caller-owned DURABLE store: this lane ships
 *     the plain-file CAS `FileCasDocStore` (store choice is written up on the
 *     class: the T09 LineageStore seam is a single-document lineage-authority
 *     shape, not a keyed V10DocStore, and the real SQLite leg stays with the
 *     T13 packaging writer per the T09 evidence).
 *
 * Everything below the facade is trusted Host application code over the SDK
 * public surface (`buildV10App`, `load`, `DomainApp`); there is no SDK
 * internal import anywhere.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildV10App, type V10BuiltApp, type V10ModuleInput } from '@kaicreator/domain-harness-build';
import type { V10DocStore, V10DocWriteCondition, V10RouteRowInput } from '@kaicreator/domain-harness-contracts';
import { load, type DomainApp } from '@kaicreator/domain-harness-microkernel';
import {
  CanonicalBudgetLedger,
  DirectAcquisitionBridge,
  InMemoryTargetRefRegistry,
  type TargetRefRecord,
} from '../../../download-domain-host/src/direct/index.ts';
import {
  ACQUISITION_ROUTE,
  AUDIENCE,
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
  buildDownloadDomainApp,
  verifySealedModules,
} from '../business/composition.ts';
import { validateRouteTable, type OperationDeclaration } from '../contracts/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Caller-owned durable K document store (plain-file CAS).
// ---------------------------------------------------------------------------

export interface FileCasDocStoreCounts {
  reads: number;
  writes: number;
  removes: number;
  persists: number;
}

/**
 * The composition's durable store choice, written up per the T11 contract:
 *
 *   - The K `load` needs a keyed multi-document CAS (`V10DocStore`:
 *     get/put/remove/keys). The T09 `LineageStore` seam is deliberately a
 *     SINGLE-document lineage-authority shape (one `LineageLedgerDoc` with
 *     its own schema and revision), so it cannot back the K docs port
 *     without re-implementing the keyed layer anyway; it is consumed
 *     read-only here (design reuse), not wrapped.
 *   - The real SQLite/Host CAS leg stays NOT_PROVEN exactly as the T09
 *     lane recorded it (`better-sqlite3` is unresolvable in this workspace;
 *     adding the driver is a lockfile change reserved to the T13 final
 *     packaging writer). No mock admission is passed off as SQLite.
 *   - What ships is the proven #183 PoC durable pattern: ONE JSON file,
 *     whole-document temp+rename persistence on every conditional write,
 *     revision-checked CAS. Readers never observe a torn document and a
 *     real process boundary (stop + reopen of the same file) observes
 *     exactly the durable bytes — the property the restart test proves.
 *     Single-process-safe by construction; cross-process writers are not
 *     its claim (one-writer-per-runtime is the composition's guarantee).
 */
export class FileCasDocStore implements V10DocStore {
  readonly path: string;
  readonly counts: FileCasDocStoreCounts = { reads: 0, writes: 0, removes: 0, persists: 0 };
  private readonly docs: Map<string, { value: unknown; revision: number }>;
  /** True when the in-memory map holds writes not yet on disk. */
  private dirty = false;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.docs = existsSync(path)
      ? new Map(Object.entries(JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, { value: unknown; revision: number }>))
      : new Map();
  }

  async get(key: string): Promise<{ value: unknown; revision: number } | null> {
    this.counts.reads += 1;
    const row = this.docs.get(key);
    return row === undefined ? null : { value: row.value, revision: row.revision };
  }

  async put(key: string, value: unknown, condition: V10DocWriteCondition): Promise<{ revision: number }> {
    this.counts.writes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(new Error(`CAS conflict on ${key}: document already exists`), {
          code: 'HOST_CAS_CONFLICT',
        });
      }
      this.docs.set(key, { value, revision: 0 });
      this.persist();
      return { revision: 0 };
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(
          `CAS conflict on ${key}: revision moved (expected ${condition.revision}, held ${existing === undefined ? 'absent' : existing.revision})`,
        ),
        { code: 'HOST_CAS_CONFLICT' },
      );
    }
    this.docs.set(key, { value, revision: condition.revision + 1 });
    this.persist();
    return { revision: condition.revision + 1 };
  }

  async remove(key: string, condition: V10DocWriteCondition): Promise<void> {
    this.counts.removes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(
          new Error(`CAS conflict on ${key}: create-conditioned remove refuses a present document`),
          { code: 'HOST_CAS_CONFLICT' },
        );
      }
      return;
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(new Error(`CAS conflict on ${key}: revision moved (expected ${condition.revision})`), {
        code: 'HOST_CAS_CONFLICT',
      });
    }
    this.docs.delete(key);
    this.persist();
  }

  keys(): readonly string[] {
    return [...this.docs.keys()].sort();
  }

  /** Durable K effect-journal rows currently persisted (restart evidence). */
  journalRows(): readonly { key: string; record: unknown }[] {
    return this.keys()
      .filter((key) => key.includes('effect-journal:'))
      .map((key) => {
        const value = this.docs.get(key)?.value as { record?: unknown } | undefined;
        return { key, record: value?.record ?? value };
      });
  }

  /** Durable K effect-permit documents currently persisted (permit evidence). */
  permitDocs(): readonly { key: string; value: unknown }[] {
    return this.keys()
      .filter((key) => key.includes('effect-permit:'))
      .map((key) => ({ key, value: this.docs.get(key)?.value }));
  }

  private persist(): void {
    this.counts.persists += 1;
    this.dirty = false;
    const snapshot = JSON.stringify(
      Object.fromEntries([...this.docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    );
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, snapshot);
    renameSync(temporary, this.path);
  }

  /**
   * Flush and seal the durable file (idempotent). Every mutation already
   * persisted itself synchronously, so this only writes when the map holds
   * unpersisted state — a second `close` on an already-clean store (double
   * stop, teardown after the workspace vanished) is an honest no-op, never
   * a spurious write to a vanished directory.
   */
  close(): void {
    if (this.dirty) this.persist();
  }
}

// ---------------------------------------------------------------------------
// Sealed direct composition (T03 K/S/B + this lane's real C).
// ---------------------------------------------------------------------------

export const APP_ID_DIRECT = 'app:xdownload-download-domain-t11';
export const BUILD_ID_DIRECT = 'xdownload-v02-t11-v1';
export const DIRECT_CAPABILITY_MODULE_ID = 'capability-acquisition-direct@0.2.0-t11';

/** The T01 declaration this lane's sealed route is validated against. */
const DIRECT_OPERATION_DECLARATIONS: readonly OperationDeclaration[] = [
  {
    operationId: 'acquisition.acquire',
    capabilityId: 'acquisition',
    handlerId: 'acquire',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
];

export interface SealedDirectComposition {
  readonly built: V10BuiltApp;
  readonly routes: readonly V10RouteRowInput[];
}

/**
 * Project a sealed module record back into BUILD-input shape: the producer
 * normalizes absent optional fields to null/false, and its input grammar
 * only accepts `undefined` there — so the null-valued projections are
 * stripped (and `externalImports` is left to re-normalize exactly as the
 * T03 producer defaulted it).
 */
function sealedToInput(module: V10BuiltApp['modules'][number]): V10ModuleInput {
  return {
    packageId: module.packageId,
    role: module.role,
    abiVersion: module.abiVersion,
    moduleSource: module.moduleSource,
    moduleSha256: module.moduleSha256,
    endpoint: module.endpoint,
    dependencies: module.dependencies,
    provides: module.provides,
    requires: module.requires,
    ...(module.providerId === null ? {} : { providerId: module.providerId }),
    ...(module.hookExport === null ? {} : { hookExport: module.hookExport }),
    ...(module.featureExport === null ? {} : { featureExport: module.featureExport }),
    ...(module.capabilityId === null ? {} : { capabilityId: module.capabilityId }),
    ...(module.handlers === null ? {} : { handlers: module.handlers }),
    ...(module.externalEffect ? { externalEffect: true } : {}),
  };
}

/**
 * Seal the DIRECT download Domain App: the T03 producer's K/S/B module bytes
 * (re-verified against the #183 PoC manifest hashes inside
 * `buildDownloadDomainApp`) with the T03 stub capability REPLACED by this
 * lane's real direct capability module, re-sealed into one BUILD by the
 * public `buildV10App`. The route stays the T03 declaration
 * (`ACQUISITION_ROUTE`) and is cross-checked against the frozen T01
 * vocabulary before sealing.
 */
export function sealDirectComposition(): SealedDirectComposition {
  const t03 = buildDownloadDomainApp();
  // The route is the T03 declaration reused VERBATIM (frozen T01 vocabulary):
  // same object, same capability/handler binding — never re-declared here.
  if (t03.routes.length !== 1 || t03.routes[0] !== ACQUISITION_ROUTE) {
    throw new Error('CONTRACT_BINDING_MISMATCH: the direct seal must reuse the T03 route declaration verbatim');
  }
  const capabilitySource = readFileSync(join(HERE, 'capability-acquisition-direct.mjs'), 'utf8');
  const capabilitySha256 = sha256Hex(capabilitySource);

  const modules: readonly V10ModuleInput[] = t03.built.modules.map((module) =>
    module.role === 'capability'
      ? {
          ...sealedToInput(module),
          packageId: DIRECT_CAPABILITY_MODULE_ID,
          moduleSource: capabilitySource,
          moduleSha256: capabilitySha256,
          endpoint: 'capability-endpoint',
          provides: ['capability:acquisition/1'],
        }
      : sealedToInput(module),
  );

  const replaced = modules.find((module) => module.role === 'capability');
  if (replaced?.packageId !== DIRECT_CAPABILITY_MODULE_ID) {
    throw new Error('DIRECT_COMPOSITION_SEAL_FAILED: the real direct capability module did not replace the T03 stub');
  }
  if (t03.built.modules.some((module) => module.packageId === DIRECT_CAPABILITY_MODULE_ID)) {
    throw new Error('DIRECT_COMPOSITION_SEAL_FAILED: the T03 stub capability must not coexist with the direct module');
  }

  // T01 authority cross-check on THIS seal's route before anything is sealed.
  const routeCheck = validateRouteTable(t03.routes, DIRECT_OPERATION_DECLARATIONS);
  if (!routeCheck.ok) {
    throw new Error(
      `CONTRACT_BINDING_MISMATCH: ${routeCheck.diagnostics[0]?.code ?? 'unknown'} — direct route refused`,
    );
  }

  const built = buildV10App({
    appId: APP_ID_DIRECT,
    audience: AUDIENCE,
    targetProfile: t03.built.targetProfile,
    modules,
    routes: t03.routes,
    hardBudget: t03.built.hardBudget,
    buildId: BUILD_ID_DIRECT,
  });

  // Post-seal self-checks: bytes still hash to their own seals, the K/S
  // seals still equal the #183 PoC manifest values, and the capability slot
  // is the direct module (bytes-bound, not the stub).
  verifySealedModules(built);
  const sealedKernel = built.modules.find((module) => module.role === 'kernel-primary');
  const sealedStandard = built.modules.find((module) => module.role === 'standard-primary');
  const sealedCapability = built.modules.find((module) => module.role === 'capability');
  if (sealedKernel?.moduleSha256 !== POC183_KERNEL_MODULE_SHA256) {
    throw new Error('DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed kernel-primary lost the #183 PoC manifest hash');
  }
  if (sealedStandard?.moduleSha256 !== POC183_STANDARD_MODULE_SHA256) {
    throw new Error('DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed standard-primary lost the #183 PoC manifest hash');
  }
  if (
    sealedCapability?.packageId !== DIRECT_CAPABILITY_MODULE_ID ||
    sealedCapability.moduleSha256 !== capabilitySha256 ||
    sealedCapability.externalEffect !== true ||
    sealedCapability.capabilityId !== 'acquisition'
  ) {
    throw new Error('DIRECT_COMPOSITION_SEAL_FAILED: sealed capability is not the real direct module');
  }

  return { built, routes: t03.routes };
}

// ---------------------------------------------------------------------------
// Runtime assembly.
// ---------------------------------------------------------------------------

/** The trusted Host bridge pin name the sealed direct C module reaches. */
export const DIRECT_BRIDGE_PIN = '__xdownloadDirectAcquisitionBridge';

interface DirectBridgePin {
  acquire: (payload: Record<string, unknown>, permit: unknown) => Promise<unknown>;
}

function hostGlobals(): { [DIRECT_BRIDGE_PIN]?: DirectBridgePin } {
  return globalThis as unknown as { [DIRECT_BRIDGE_PIN]?: DirectBridgePin };
}

export interface TargetRefSeed {
  readonly handle: string;
  readonly record: TargetRefRecord;
}

export interface AssembleDownloadRuntimeOptions {
  /** Durable store file path (plain-file CAS; reopened across restarts). */
  readonly storePath: string;
  /** Trusted registry seed: opaque handles → delivery facts. */
  readonly targetRefs?: readonly TargetRefSeed[];
  /** Canonical budget profile (decodes through the T04 ledger). */
  readonly budgetProfile?: unknown;
  readonly tenantId?: string;
  readonly deployedAppId?: string;
  readonly queryPrincipal?: string;
  readonly now?: () => number;
}

export interface DownloadRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: FileCasDocStore;
  readonly bridge: DirectAcquisitionBridge;
  readonly registry: InMemoryTargetRefRegistry;
  readonly ledger: CanonicalBudgetLedger;
  /** Register the cancellation controller for one in-flight submission. */
  beginSubmission(requestId: string): AbortController;
  /** Drop the cancellation controller once the submission settled. */
  settleSubmission(requestId: string): void;
  /** Truthful cancellation: abort the in-flight transfer for one request. */
  cancel(requestId: string, reason?: string): void;
  /** The live abort signal of one in-flight submission, if any. */
  signalFor(requestId: string): AbortSignal | undefined;
  stop(): void;
}

const DEFAULT_BUDGET_PROFILE = {
  discovery: { domain: 'discovery' },
  transfer: { domain: 'transfer', maxBytes: 1_048_576 },
  globalSafety: { domain: 'global_safety' },
} as const;

/**
 * Assemble the one authoritative direct download runtime: seal the BUILD,
 * install the trusted T04 bridge pin, open the durable store and call the
 * SDK public `load`. `stop()` releases the pin (only if still ours), stops
 * the app, aborts every in-flight submission and closes the store.
 */
export async function assembleDownloadRuntime(
  options: AssembleDownloadRuntimeOptions,
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

  const tenantId = options.tenantId ?? 'tenant:xdownload-v02-t11';
  const deployedAppId = options.deployedAppId ?? 'deploy:xdownload-v02-t11';
  const principal = options.queryPrincipal ?? 'xdownload-v02-t11-host';
  const app = await load(built, {
    store,
    tenantId,
    deploymentIdentity: { deployedAppId, tenantId, appId: built.appId },
    queryAuthority: {
      principal: { actor: principal },
      authorize: (candidate, target) =>
        Boolean(
          candidate !== null &&
            typeof candidate === 'object' &&
            (candidate as { actor?: string }).actor === principal &&
            target.tenantId === tenantId,
        ),
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    built,
    app,
    store,
    bridge,
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
