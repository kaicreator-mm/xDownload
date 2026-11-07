/**
 * v0.2 T11 — download Domain App direct-lane sealed composition,
 * V022-A04 consolidated.
 *
 * The Domain App is domain-only (A04): this module owns the sealed BUILD
 * producer `sealDirectComposition` (T03 K/S/B bytes verbatim + this lane's
 * capability-acquisition-direct.mjs re-sealed by the public
 * @kaicreator/domain-harness-build producer), the domain-facing runtime
 * contract the journeys consume (`DownloadRuntime` over structural ports —
 * the physical Host store/bridge/registry/ledger instances are structurally
 * assignable to these ports at the Core composition root), and the
 * `DIRECT_BRIDGE_PIN` ABI name the sealed direct C module reaches (the
 * sealed module carries the literal; the constant is the typed reference
 * for the Core-side pin installer).
 *
 * V022-A04 relocations now landed:
 *   - `FileCasDocStore` moved to the Host (`download-domain-host` storage
 *     lane, A03) and is deleted here; the App-side `DownloadRuntime.store`
 *     port is the narrow structural evidence surface (`KDocStoreEvidencePort`)
 *     the Host store satisfies.
 *   - `assembleDownloadRuntime` (and its A02 relocation sentinel) deleted:
 *     the real assembly (sealed BUILD + T04 Host bridge pin + durable store
 *     + SDK public `load`) lives at the Core composition root, which owns
 *     the Host adapters; the migrated S2/S5/S6 slice tests and the
 *     Direct seven-scenario integration matrix re-established under
 *     packages/core-runtime/test (A04) assemble there.
 *
 * See composition-runtime.test.ts for the domain-level scenario map (sealed
 * identity, T01 no-widening gate, sealed capability ABI seam).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  buildV10App,
  type V10BuiltApp,
  type V10ModuleInput,
  type V10RouteRowInput,
} from '@kaicreator/domain-harness-build';
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
// Domain-facing runtime contract (structural ports; the physical instances
// are Host-owned and assembled by the Core composition root).
// ---------------------------------------------------------------------------

/**
 * Narrow structural evidence port of the durable K document store. The
 * Host-owned `FileCasDocStore` is structurally assignable to this port
 * (same member names and arities); the App never names the physical class.
 * Journeys and tests read durable permit/journal evidence through this
 * surface only.
 */
export interface KDocStoreEvidencePort {
  /** Durable K effect-journal rows currently persisted (restart evidence). */
  journalRows(): readonly { key: string; record: unknown }[];
  /** Durable K effect-permit documents currently persisted (permit evidence). */
  permitDocs(): readonly { key: string; value: unknown }[];
}

/**
 * The trusted Host bridge pin name the sealed direct C module reaches. The
 * sealed capability module carries the literal
 * `globalThis.__xdownloadDirectAcquisitionBridge`; this constant is the
 * typed reference for the Core-side pin installer.
 */
export const DIRECT_BRIDGE_PIN = '__xdownloadDirectAcquisitionBridge';

/**
 * Transitional bridge-side counter view (the T04 DirectAcquisitionBridge
 * counter shape, structurally re-declared so this module needs no Host
 * import). The physical bridge lives in download-domain-host; Core
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
 * implementation; Core installs the real instance). */
export interface TransitionalDirectBridgeView {
  readonly counters: DirectBridgeCountersView;
}

/** Trusted registry seed: opaque handles → delivery facts (resolved by the
 * trusted Host registry at assembly time; the record shape is Host-owned). */
export interface TargetRefSeed {
  readonly handle: string;
  readonly record: unknown;
}

/**
 * The direct runtime contract consumed by the domain journey
 * (`submitConfirmedDownload`) and the S2/S5/S6 slice journeys. Domain-facing
 * by construction (V022-A04): every member is a domain port or an opaque
 * handle — the physical Host store/bridge/registry/ledger instances Core
 * assembles are structurally assignable to these views, and no App source
 * imports the Host package.
 */
export interface DownloadRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  /** Durable K document store evidence port (Host store is assignable). */
  readonly store: KDocStoreEvidencePort;
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
