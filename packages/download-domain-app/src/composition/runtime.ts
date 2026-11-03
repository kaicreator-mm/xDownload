/**
 * v0.2 T11 — download Domain App direct-lane sealed composition.
 *
 * V022-A02 boundary note: this module no longer imports
 * @xdownload/download-domain-host and no longer assembles a live runtime.
 * What stays (all domain-owned):
 *
 *   - the sealed BUILD producer `sealDirectComposition` (T03 K/S/B bytes
 *     verbatim + this lane's capability-acquisition-direct.mjs re-sealed by
 *     the public @kaicreator/domain-harness-build producer);
 *   - the plain-file CAS `FileCasDocStore` — transitional Core compatibility
 *     (the current Core route deep-imports it; A04 moves the consumer to a
 *     Host-owned adapter and deletes this class);
 *   - the `DIRECT_BRIDGE_PIN` ABI name the sealed direct C module reaches
 *     (the sealed module carries the literal; the constant is the typed
 *     reference for the A04 Core-side pin installer).
 *
 * REMOVED in A02, RELOCATE-TO-CORE-A04: `assembleDownloadRuntime` used to
 * compose the sealed BUILD with the REAL T04 Host bridge
 * (DirectAcquisitionBridge / InMemoryTargetRefRegistry /
 * CanonicalBudgetLedger from download-domain-host) and call the SDK public
 * `load`. Host-owned physical assembly now belongs to the Core composition
 * root (A04); the sentinel below keeps the exported contract honest (typed
 * relocation refusal) until the S2/S5/S6 slice journey tests and
 * slice-journey-testkit.ts — outside this Task's write set — are re-pointed
 * by A04. See composition-runtime.test.ts for the enumerated scenario map.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildV10App,
  type V10BuiltApp,
  type V10ModuleInput,
} from '@kaicreator/domain-harness-build';
import type {
  V10DocStore,
  V10DocWriteCondition,
  V10RouteRowInput,
} from '@kaicreator/domain-harness-contracts';
import type { DomainApp } from '@kaicreator/domain-harness-microkernel';
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
 *
 * V022-A02: TRANSITIONAL CORE COMPATIBILITY — internal only, not exported
 * by the public App root; deleted by A04 after Core consumes the Host-owned
 * adapter.
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
      ? new Map(
          Object.entries(
            JSON.parse(readFileSync(this.path, 'utf8')) as Record<
              string,
              { value: unknown; revision: number }
            >,
          ),
        )
      : new Map();
  }

  async get(key: string): Promise<{ value: unknown; revision: number } | null> {
    this.counts.reads += 1;
    const row = this.docs.get(key);
    return row === undefined ? null : { value: row.value, revision: row.revision };
  }

  async put(
    key: string,
    value: unknown,
    condition: V10DocWriteCondition,
  ): Promise<{ revision: number }> {
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
      throw Object.assign(
        new Error(`CAS conflict on ${key}: revision moved (expected ${condition.revision})`),
        {
          code: 'HOST_CAS_CONFLICT',
        },
      );
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
    throw new Error(
      'CONTRACT_BINDING_MISMATCH: the direct seal must reuse the T03 route declaration verbatim',
    );
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
    throw new Error(
      'DIRECT_COMPOSITION_SEAL_FAILED: the real direct capability module did not replace the T03 stub',
    );
  }
  if (t03.built.modules.some((module) => module.packageId === DIRECT_CAPABILITY_MODULE_ID)) {
    throw new Error(
      'DIRECT_COMPOSITION_SEAL_FAILED: the T03 stub capability must not coexist with the direct module',
    );
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
    throw new Error(
      'DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed kernel-primary lost the #183 PoC manifest hash',
    );
  }
  if (sealedStandard?.moduleSha256 !== POC183_STANDARD_MODULE_SHA256) {
    throw new Error(
      'DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed standard-primary lost the #183 PoC manifest hash',
    );
  }
  if (
    sealedCapability?.packageId !== DIRECT_CAPABILITY_MODULE_ID ||
    sealedCapability.moduleSha256 !== capabilitySha256 ||
    sealedCapability.externalEffect !== true ||
    sealedCapability.capabilityId !== 'acquisition'
  ) {
    throw new Error(
      'DIRECT_COMPOSITION_SEAL_FAILED: sealed capability is not the real direct module',
    );
  }

  return { built, routes: t03.routes };
}

// ---------------------------------------------------------------------------
// Transitional runtime contract (V022-A02 → Core A04).
// ---------------------------------------------------------------------------

/**
 * The trusted Host bridge pin name the sealed direct C module reaches. The
 * sealed capability module carries the literal
 * `globalThis.__xdownloadDirectAcquisitionBridge`; this constant is the
 * typed reference for the A04 Core-side pin installer. TRANSITIONAL: not
 * exported by the public App root.
 */
export const DIRECT_BRIDGE_PIN = '__xdownloadDirectAcquisitionBridge';

/**
 * Transitional bridge-side counter view (the T04 DirectAcquisitionBridge
 * counter shape, structurally re-declared so this module needs no Host
 * import). The physical bridge lives in download-domain-host; Core A04
 * assembles it next to the Host adapters.
 */
export interface DirectBridgeCountersView {
  readonly acquireCalls: number;
  readonly permitRefusals: number;
  readonly scopeRefusals: number;
  readonly targetRefRefusals: number;
  readonly pathRefusals: number;
  readonly filesWritten: number;
  readonly bytesDownloaded: number;
}

/** Transitional view of the pinned T04 direct bridge (Host-owned physical
 * implementation; Core A04 installs the real instance). */
export interface TransitionalDirectBridgeView {
  readonly counters: DirectBridgeCountersView;
}

/** Trusted registry seed: opaque handles → delivery facts (resolved by the
 * trusted Host registry at assembly time; the record shape is Host-owned). */
export interface TargetRefSeed {
  readonly handle: string;
  readonly record: unknown;
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

/**
 * The assembled direct download runtime contract. TRANSITIONAL (A02→A04):
 * the physical bridge/registry/ledger are Host-owned, so they appear here
 * only as structural/opaque views; the domain journey (./journey.ts) and
 * the S2/S5/S6 slice journeys consume exactly this surface
 * (`app`, `beginSubmission`, `settleSubmission`, `stop`, plus the
 * `bridge.counters` / `store` evidence accessors), which Core A04 re-homes
 * unchanged next to the Host adapters.
 */
export interface DownloadRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: FileCasDocStore;
  readonly bridge: TransitionalDirectBridgeView;
  /** Host-owned targetRef registry (opaque at the App boundary). */
  readonly registry: unknown;
  /** Host-owned canonical budget ledger (opaque at the App boundary). */
  readonly ledger: unknown;
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

/**
 * V022-A02 RELOCATE-TO-CORE-A04 sentinel. The real assembly (seal → pin the
 * T04 Host bridge → open the durable store → SDK public `load`) moved to
 * the Core composition root, which owns the Host adapters. This sentinel
 * keeps the exported contract honest for the transitional consumers
 * (slice-journey-testkit.ts, outside this Task's write set): calling it
 * fails closed with a typed relocation refusal and creates zero effects
 * (no store file, no pin, no K).
 */
export async function assembleDownloadRuntime(
  _options: AssembleDownloadRuntimeOptions,
): Promise<DownloadRuntime> {
  throw new Error(
    'DIRECT_RUNTIME_ASSEMBLY_RELOCATED: the direct runtime assembly (sealed BUILD + T04 Host bridge pin + durable store + SDK load) moved to the Core composition root (V022-A04); the Domain App no longer imports download-domain-host',
  );
}
