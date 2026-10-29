/**
 * v0.2 T12 — S3 media acquisition journey under K (integration-other lane;
 * write set packages/download-domain-app/src/integrations/** only).
 *
 * The release-claimed S3 ("Direct Media File") journey connected to K, the
 * T11 way: a sealed closed-world BUILD whose K/S bytes are the #183 PoC
 * payloads verbatim, whose B is THIS lane's media re-seal of the T03 download
 * policy (only the effect target changed to the frozen T01 operation
 * 'media.acquire'), and whose C is THIS lane's real media capability module
 * bound to the trusted Host pin of the T06 media bridge. The physical HLS
 * pull is executed exclusively by the existing @xdownload/hls-vod-adapter
 * engine behind `acquireMediaViaHls` — no second engine, no second fetch
 * path, no second ledger (budget truth stays the engine TransferLedger the
 * T06 bridge creates from the permit's canonical budget profile).
 *
 * Permit pin (the T06 "sealed media capability + permit pin" seam): the K
 * external Effect Permit gate dispatches the sealed media C module with the
 * kernel-minted live permit claim ({effectId, durableControlTurnId}). The
 * pin then:
 *   1. fail-closed parses the kernel permit claim (no claim ⇒ typed refusal,
 *      zero network, zero writes);
 *   2. re-validates the projected intent through the T01 no-widening grammar
 *      and refuses any operation other than 'media.acquire';
 *   3. resolves the opaque targetRef through the injected media registry
 *      ONLY (the registry is the single source of manifest/segment origins
 *      and the canonical budget profile);
 *   4. derives the T06 `media-acquisition-permit` by binding the kernel
 *      permit identity to the seeded registry facts — nothing wider than
 *      either input (the T06 bridge re-validates the derived permit
 *      fail-closed before any effect);
 *   5. binds the K permit identity INTO the successful terminal evidence
 *      (permitEffectId/durableControlTurnId) so the journey's evidence
 *      verification proves the artifact was produced under exactly one
 *      K-issued permit.
 *
 * The journey (`submitConfirmedMediaDownload`) mirrors the T11 journey
 * contract step-for-step — T01 gate before send, one K send, terminal unwrap
 * through the envelope grammar, evidence verification against the REAL bytes
 * on disk, zero retry ever — reusing the same T01 contract helpers. It is
 * re-derived here (not imported) because the frozen T11 write set owns
 * journey.ts and this lane must not edit merged files; the observable
 * contract is identical.
 *
 * Honest status (T10 baseline vocabulary): this journey is PROVEN at
 * bounded-fixture level (real loopback HLS master→playlist→segments→
 * digest-backed materialization through the real engine and the real K).
 * Installed-path media validation (real deployed Host, real release SHA) is
 * NOT_PROVEN here and belongs to T16 validation-product.
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
import type { V10PublicIntent } from '@kaicreator/domain-harness-contracts';
import { load, type DomainApp } from '@kaicreator/domain-harness-microkernel';
import {
  AUDIENCE,
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
  buildDownloadDomainApp,
  verifySealedModules,
} from '../business/composition.ts';
import {
  normalizeEffectEnvelope,
  validateConfirmedIntent,
  validateMaterializedEvidence,
  validateRouteTable,
  REFERENCE_TOKEN_PATTERN,
  type ConfirmedDownloadIntent,
  type EffectEnvelope,
  type MaterializedEvidence,
  type OperationDeclaration,
} from '../contracts/index.ts';
import { FileCasDocStore } from '../composition/runtime.ts';
import { InMemoryMediaTargetRegistry } from './media-registry.ts';
import { acquireMediaViaHls } from '../../../download-domain-host/src/media/media-acquisition-bridge.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Sealed media composition (T03 K/S + this lane's media B/C).
// ---------------------------------------------------------------------------

export const APP_ID_MEDIA = 'app:xdownload-download-domain-t12-media';
export const BUILD_ID_MEDIA = 'xdownload-v02-t12-media-v1';
export const MEDIA_CAPABILITY_MODULE_ID = 'capability-media-acquire@0.2.0-t12';
export const MEDIA_BUSINESS_MODULE_ID = 'business-media@0.2.0-t12';

/** The only operation this composition serves (frozen T01 vocabulary). */
export const MEDIA_ACQUIRE_OPERATION = 'media.acquire';
/** The only T01 slice this lane's media journey admits (T10 S3 descriptor). */
export const MEDIA_SLICE = 'S3';

export const MEDIA_ROUTE: V10RouteRowInput = {
  intentId: 'confirmDownload',
  operationId: MEDIA_ACQUIRE_OPERATION,
  capabilityId: 'media',
  handlerId: 'acquireMedia',
};

const MEDIA_OPERATION_DECLARATIONS: readonly OperationDeclaration[] = [
  {
    operationId: MEDIA_ACQUIRE_OPERATION,
    capabilityId: 'media',
    handlerId: 'acquireMedia',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
];

export interface SealedMediaComposition {
  readonly built: V10BuiltApp;
  readonly routes: readonly V10RouteRowInput[];
}

/**
 * Project a sealed module record back into BUILD-input shape (the T11
 * producer round-trip: absent optional fields are normalized to null/false
 * by the producer and its input grammar only accepts `undefined` there).
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
 * Seal the MEDIA download Domain App: the T03 producer's K/S module bytes
 * (re-verified against the #183 PoC manifest hashes inside
 * `buildDownloadDomainApp`) with the T03 B/C modules REPLACED by this lane's
 * media B/C modules, re-sealed into one BUILD by the public `buildV10App`.
 * The media route is cross-checked against the frozen T01 vocabulary and the
 * sealed declarations before anything is sealed.
 */
export function sealMediaComposition(): SealedMediaComposition {
  const t03 = buildDownloadDomainApp();
  const businessSource = readFileSync(join(HERE, 'business-media.mjs'), 'utf8');
  const businessSha256 = sha256Hex(businessSource);
  const capabilitySource = readFileSync(join(HERE, 'capability-media-acquire.mjs'), 'utf8');
  const capabilitySha256 = sha256Hex(capabilitySource);

  const modules: readonly V10ModuleInput[] = t03.built.modules.map((module) => {
    if (module.role === 'business') {
      return {
        ...sealedToInput(module),
        packageId: MEDIA_BUSINESS_MODULE_ID,
        moduleSource: businessSource,
        moduleSha256: businessSha256,
        provides: ['business:policy/1', 'intent:confirmDownload'],
      };
    }
    if (module.role === 'capability') {
      return {
        ...sealedToInput(module),
        packageId: MEDIA_CAPABILITY_MODULE_ID,
        moduleSource: capabilitySource,
        moduleSha256: capabilitySha256,
        endpoint: 'capability-endpoint',
        provides: ['capability:media/1'],
        capabilityId: 'media',
        handlers: [{ operationId: MEDIA_ROUTE.operationId, handler: MEDIA_ROUTE.handlerId }],
      };
    }
    return sealedToInput(module);
  });

  const replacedBusiness = modules.find((module) => module.role === 'business');
  const replacedCapability = modules.find((module) => module.role === 'capability');
  if (
    replacedBusiness?.packageId !== MEDIA_BUSINESS_MODULE_ID ||
    replacedCapability?.packageId !== MEDIA_CAPABILITY_MODULE_ID
  ) {
    throw new Error(
      'MEDIA_COMPOSITION_SEAL_FAILED: the media B/C modules did not replace the T03 modules',
    );
  }
  if (
    t03.built.modules.some(
      (module) =>
        module.packageId === MEDIA_BUSINESS_MODULE_ID ||
        module.packageId === MEDIA_CAPABILITY_MODULE_ID,
    )
  ) {
    throw new Error(
      'MEDIA_COMPOSITION_SEAL_FAILED: the T03 B/C modules must not coexist with the media modules',
    );
  }

  // T01 authority cross-check on THIS seal's single route before anything is
  // sealed: exactly the media route declaration, validated against the frozen
  // vocabulary and the sealed capability/handler binding.
  if (t03.routes.length !== 1) {
    throw new Error('MEDIA_COMPOSITION_SEAL_FAILED: the media seal declares exactly one route');
  }
  const routeCheck = validateRouteTable([MEDIA_ROUTE], MEDIA_OPERATION_DECLARATIONS);
  if (!routeCheck.ok) {
    throw new Error(
      `CONTRACT_BINDING_MISMATCH: ${routeCheck.diagnostics[0]?.code ?? 'unknown'} — media route refused`,
    );
  }

  const built = buildV10App({
    appId: APP_ID_MEDIA,
    audience: AUDIENCE,
    targetProfile: t03.built.targetProfile,
    modules,
    routes: [MEDIA_ROUTE],
    hardBudget: t03.built.hardBudget,
    buildId: BUILD_ID_MEDIA,
  });

  // Post-seal self-checks: bytes still hash to their own seals, the K/S seals
  // still equal the #183 PoC manifest values, and the B/C slots are the media
  // modules (bytes-bound, not the T03 modules).
  verifySealedModules(built);
  const sealedKernel = built.modules.find((module) => module.role === 'kernel-primary');
  const sealedStandard = built.modules.find((module) => module.role === 'standard-primary');
  const sealedBusiness = built.modules.find((module) => module.role === 'business');
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
    sealedBusiness?.packageId !== MEDIA_BUSINESS_MODULE_ID ||
    sealedBusiness.moduleSha256 !== businessSha256
  ) {
    throw new Error(
      'MEDIA_COMPOSITION_SEAL_FAILED: sealed business is not the media policy module',
    );
  }
  if (
    sealedCapability?.packageId !== MEDIA_CAPABILITY_MODULE_ID ||
    sealedCapability.moduleSha256 !== capabilitySha256 ||
    sealedCapability.externalEffect !== true ||
    sealedCapability.capabilityId !== 'media'
  ) {
    throw new Error(
      'MEDIA_COMPOSITION_SEAL_FAILED: sealed capability is not the real media module',
    );
  }

  return { built, routes: [MEDIA_ROUTE] };
}

// ---------------------------------------------------------------------------
// Runtime assembly (T11 pattern: pin before load, durable caller-owned store).
// ---------------------------------------------------------------------------

/** The trusted Host bridge pin name the sealed media C module reaches. */
export const MEDIA_BRIDGE_PIN = '__xdownloadMediaAcquisitionBridge';

interface MediaBridgePin {
  acquireMedia: (payload: Record<string, unknown>, permit: unknown) => Promise<unknown>;
}

function hostGlobals(): { [MEDIA_BRIDGE_PIN]?: MediaBridgePin } {
  return globalThis as unknown as { [MEDIA_BRIDGE_PIN]?: MediaBridgePin };
}

/** Observable pin counters (zero-effect evidence alongside fixture counts). */
export interface MediaPinCounters {
  acquireMediaCalls: number;
  permitRefusals: number;
  intentRefusals: number;
  operationRefusals: number;
  registryRefusals: number;
  completedExecutions: number;
  failedExecutions: number;
}

export interface MediaTargetSeed {
  readonly handle: string;
  readonly record: unknown;
}

export interface AssembleMediaRuntimeOptions {
  /** Durable store file path (plain-file CAS; reopened across restarts). */
  readonly storePath: string;
  /** Trusted registry seed: opaque handles → media delivery facts. */
  readonly mediaTargetRefs?: readonly MediaTargetSeed[];
  readonly tenantId?: string;
  readonly deployedAppId?: string;
  readonly queryPrincipal?: string;
  readonly now?: () => number;
}

export interface MediaDownloadRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: FileCasDocStore;
  readonly registry: InMemoryMediaTargetRegistry;
  /** Live pin counters (the trusted seam's own zero-effect evidence). */
  readonly pin: MediaPinCounters;
  /** Truthful cancellation before send; the T06 bridge owns in-flight transfer. */
  stop(): void;
}

/**
 * Assemble the S3 media runtime: seal the media BUILD, install the trusted
 * T06 bridge pin (permit derivation over the seeded registry), open the
 * durable store and call the SDK public `load`. `stop()` releases the pin
 * (only if still ours), stops the app and closes the store.
 */
export async function assembleMediaRuntime(
  options: AssembleMediaRuntimeOptions,
): Promise<MediaDownloadRuntime> {
  const { built } = sealMediaComposition();

  const store = new FileCasDocStore(options.storePath);
  const registry = new InMemoryMediaTargetRegistry(options.mediaTargetRefs ?? []);
  const pin: MediaPinCounters = {
    acquireMediaCalls: 0,
    permitRefusals: 0,
    intentRefusals: 0,
    operationRefusals: 0,
    registryRefusals: 0,
    completedExecutions: 0,
    failedExecutions: 0,
  };

  /**
   * The trusted dispatch seam for media.acquire (T11 pin pattern + T06
   * permit derivation — the full contract is documented on this module).
   */
  const bridgePin: MediaBridgePin = {
    acquireMedia: (payload, permit) => executeMediaAcquisition(payload, permit, registry, pin),
  };
  hostGlobals()[MEDIA_BRIDGE_PIN] = bridgePin;

  const tenantId = options.tenantId ?? 'tenant:xdownload-v02-t12';
  const deployedAppId = options.deployedAppId ?? 'deploy:xdownload-v02-t12-media';
  const principal = options.queryPrincipal ?? 'xdownload-v02-t12-host';
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
    registry,
    pin,
    stop(): void {
      app.stop();
      if (hostGlobals()[MEDIA_BRIDGE_PIN] === bridgePin) {
        delete hostGlobals()[MEDIA_BRIDGE_PIN];
      }
      store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// The permit pin: kernel permit identity + seeded registry facts → T06 bridge.
// ---------------------------------------------------------------------------

interface KernelPermitClaim {
  readonly effectId: string;
  readonly durableControlTurnId: string;
}

function parseKernelPermit(permit: unknown): KernelPermitClaim | null {
  if (typeof permit !== 'object' || permit === null || Array.isArray(permit)) {
    return null;
  }
  const record = permit as Record<string, unknown>;
  const bounded = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (!bounded(record['effectId']) || !bounded(record['durableControlTurnId'])) {
    return null;
  }
  return {
    effectId: record['effectId'] as string,
    durableControlTurnId: record['durableControlTurnId'] as string,
  };
}

/**
 * Bounded permit id for the T06 media permit grammar: the kernel effect
 * identity when it fits the opaque-token grammar, else a deterministic
 * digest alias (same input → same alias, no drift). The RAW effect identity
 * still rides the terminal evidence as permitEffectId.
 */
function boundedPermitIdOf(effectId: string): string {
  if (REFERENCE_TOKEN_PATTERN.test(effectId)) {
    return effectId;
  }
  const digest = createHash('sha256').update(effectId).digest('hex').slice(0, 32);
  return `xd-t12-media-${digest}`;
}

function refusalEnvelope(externalRef: string, code: string, message: string): EffectEnvelope {
  return { phase: 'terminal', externalRef, outcome: { ok: false, error: { code, message } } };
}

async function executeMediaAcquisition(
  payload: Record<string, unknown>,
  permit: unknown,
  registry: InMemoryMediaTargetRegistry,
  counters: MediaPinCounters,
): Promise<EffectEnvelope> {
  counters.acquireMediaCalls += 1;

  // (1) Kernel permit gate — before any registry lookup or effect.
  const kernelPermit = parseKernelPermit(permit);
  const unpermittedRef = `${MEDIA_ACQUIRE_OPERATION}:unpermitted`;
  if (kernelPermit === null) {
    counters.permitRefusals += 1;
    return refusalEnvelope(
      unpermittedRef,
      'MEDIA_PERMIT_REQUIRED',
      'media.acquire requires a kernel permit identity (effectId + durableControlTurnId); refused before any effect',
    );
  }
  const externalRef = kernelPermit.effectId;

  // (2) T01 no-widening re-check of the projected intent.
  const intent: Record<string, unknown> = { ...payload };
  delete intent['effectId'];
  const intentCheck = validateConfirmedIntent(intent);
  if (!intentCheck.ok) {
    counters.intentRefusals += 1;
    return refusalEnvelope(
      externalRef,
      'MEDIA_INTENT_MALFORMED',
      `confirmed intent rejected by the no-widening contract: ${intentCheck.diagnostics
        .map((entry) => entry.code)
        .join(',')}`,
    );
  }
  const confirmed: ConfirmedDownloadIntent = intentCheck.value;
  if (confirmed.allowedOperation !== MEDIA_ACQUIRE_OPERATION) {
    counters.operationRefusals += 1;
    return refusalEnvelope(
      externalRef,
      'MEDIA_OPERATION_MISMATCH',
      `the media bridge executes only ${MEDIA_ACQUIRE_OPERATION}; intent authorizes '${confirmed.allowedOperation}'`,
    );
  }

  // (3) Opaque targetRef resolution through the injected registry only.
  const recordCheck = registry.resolve(confirmed.targetRef);
  if (!recordCheck.ok) {
    counters.registryRefusals += 1;
    return refusalEnvelope(
      externalRef,
      recordCheck.diagnostics[0]!.code,
      recordCheck.diagnostics[0]!.message,
    );
  }
  const record = recordCheck.value;

  // (4) Derive the media permit: kernel identity × seeded registry facts.
  //     Nothing wider than either input; the T06 bridge re-validates it
  //     fail-closed before any network/filesystem effect.
  const mediaPermit = {
    kind: 'media-acquisition-permit',
    permitId: boundedPermitIdOf(kernelPermit.effectId),
    operationId: MEDIA_ACQUIRE_OPERATION,
    requestId: confirmed.requestId,
    lineageId: confirmed.lineageId,
    allowedManifestOrigins: record.allowedManifestOrigins,
    allowedSegmentOrigins: record.allowedSegmentOrigins,
    budget: record.budget,
  };

  // (5) The existing engine executes; the T06 bridge owns every gate beyond
  //     this point (origin scope, protocol, budget, digest anchor).
  const result = await acquireMediaViaHls({
    intent: confirmed,
    protocol: record.protocol,
    manifestUri: record.manifestUri,
    ...(record.selectedRenditionUri === undefined
      ? {}
      : { selectedRenditionUri: record.selectedRenditionUri }),
    ...(record.artifactFileName === undefined ? {} : { artifactFileName: record.artifactFileName }),
    permit: mediaPermit,
    ...(record.fixtureLoopbackHttp === true ? { fixtureLoopbackHttp: true } : {}),
    ...(record.manifestMaxBytes === undefined ? {} : { manifestMaxBytes: record.manifestMaxBytes }),
    ...(record.segmentMaxBytes === undefined ? {} : { segmentMaxBytes: record.segmentMaxBytes }),
    ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs }),
  });

  if (!result.admitted) {
    counters.failedExecutions += 1;
    return refusalEnvelope(externalRef, result.code, result.message);
  }
  const envelope = result.envelope;
  if (envelope.phase === 'terminal' && envelope.outcome.ok) {
    // Bind the K permit identity into the terminal evidence so the journey's
    // verification can prove the artifact was produced under exactly one
    // K-issued permit. Only the two identity fields are added; the evidence
    // fields the T06 bridge produced are forwarded untouched.
    const enriched = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef,
      outcome: {
        ok: true,
        output: {
          ...envelope.outcome.output,
          permitEffectId: kernelPermit.effectId,
          durableControlTurnId: kernelPermit.durableControlTurnId,
        },
      },
    });
    if (!enriched.ok) {
      throw new Error(
        'media pin invariant violation: enriched terminal envelope rejected by the T01 grammar',
      );
    }
    counters.completedExecutions += 1;
    return enriched.value;
  }
  counters.failedExecutions += 1;
  return envelope;
}

// ---------------------------------------------------------------------------
// The S3 media journey (T11 journey contract over the media runtime).
// ---------------------------------------------------------------------------

/** Bounded media summary surfaced from the terminal evidence (never bytes). */
export interface MediaJourneySummary {
  readonly outcomeKind: string | undefined;
  readonly segmentsTransferred: number | undefined;
  readonly transferredByteCount: number | undefined;
}

/** A truthful media journey outcome; `failed` is final and never retried. */
export type MediaSubmissionOutcome =
  | {
      readonly status: 'completed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly evidence: MaterializedEvidence;
      /** The kernel-minted permit identity the one dispatch ran under. */
      readonly permitEffectId: string;
      readonly terminal: EffectEnvelope;
      readonly receipt: Record<string, unknown>;
      readonly summary: MediaJourneySummary;
    }
  | {
      /** Idempotent replay of an already-settled occurrence: zero new effects. */
      readonly status: 'replayed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly receipt: Record<string, unknown>;
    }
  | {
      /** Refused BEFORE K admission: nothing exists, zero effects. */
      readonly status: 'refused';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly status: 'failed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly error: { readonly code: string; readonly message: string };
      /** The typed terminal envelope when one existed (null = never ran). */
      readonly terminal: EffectEnvelope | null;
      readonly receipt: Record<string, unknown> | null;
    };

export interface SubmitConfirmedMediaOptions {
  /** Explicit occurrence message id; defaults to `msg-<requestId>`. */
  readonly messageId?: string;
  /** Caller cancellation BEFORE send (zero-effect refused journey). The T06
   * bridge owns in-flight transfers; no signal is forwarded past admission. */
  readonly signal?: AbortSignal;
}

interface KReceiptView {
  readonly status?: string;
  readonly idempotentReplay?: boolean;
  readonly admitted?: {
    readonly effects?: readonly { readonly output?: unknown }[];
  };
}

/**
 * Run the confirmed S3 media journey end-to-end: T01 gate → one K send under
 * one K-issued permit → the T06 media bridge → the existing HLS engine →
 * digest-backed materialization → evidence verified against the real bytes
 * on disk. No retry, ever. Pre-send refusals (malformed intent, foreign
 * operation, foreign slice, pre-send abort) return `refused` outcomes with
 * zero effects; typed K-gate throws propagate verbatim.
 */
export async function submitConfirmedMediaDownload(
  runtime: MediaDownloadRuntime,
  candidate: unknown,
  options: SubmitConfirmedMediaOptions = {},
): Promise<MediaSubmissionOutcome> {
  // (1) T01 gate before send — no-widening; a refusal never reaches K.
  const intentCheck = validateConfirmedIntent(candidate);
  if (!intentCheck.ok) {
    return {
      status: 'refused',
      code: 'MEDIA_INTENT_INVALID',
      message: `confirmed intent refused before send: ${intentCheck.diagnostics
        .map((entry) => entry.code)
        .join(',')}`,
    };
  }
  const confirmed = intentCheck.value;
  if (confirmed.allowedOperation !== MEDIA_ACQUIRE_OPERATION) {
    return {
      status: 'refused',
      code: 'MEDIA_OPERATION_MISMATCH',
      message: `the media journey submits only ${MEDIA_ACQUIRE_OPERATION}; intent authorizes '${confirmed.allowedOperation}'`,
    };
  }
  if (confirmed.slice !== MEDIA_SLICE) {
    return {
      status: 'refused',
      code: 'MEDIA_SLICE_MISMATCH',
      message: `the media journey admits slice '${MEDIA_SLICE}' only; intent declares '${confirmed.slice}'`,
    };
  }
  // The sealed download policy projects the FULL T01 field set (the same
  // sealed projection the direct composition drives), so a media intent
  // under this composition must carry the digest anchor and the declared
  // size — refusing that here is an honest pre-send profile refusal instead
  // of an internal Host failure behind the K facade.
  if (confirmed.digestAnchor === undefined || confirmed.declaredBytes === undefined) {
    return {
      status: 'refused',
      code: 'MEDIA_PROFILE_BINDING_INCOMPLETE',
      message:
        'the sealed download policy projects the full T01 field set: this composition requires digestAnchor and declaredBytes on every media intent',
    };
  }
  if (options.signal?.aborted === true) {
    return {
      status: 'refused',
      code: 'SUBMISSION_ABORTED',
      message: 'the caller aborted the submission before send; zero effects were created',
    };
  }

  const intent: V10PublicIntent = {
    intentType: 'confirmDownload',
    instanceKey: `download-${confirmed.requestId}`,
    messageId: options.messageId ?? `msg-${confirmed.requestId}`,
    input: confirmed as unknown as Record<string, unknown>,
  };

  // (2) One K send; at most one permit; at most one bridge dispatch.
  //     (No per-submission controller: the T06 bridge owns the in-flight leg.)
  const receipt = (await runtime.app.send(intent)) as Record<string, unknown>;

  const view = receipt as KReceiptView;
  if (view.idempotentReplay === true) {
    return { status: 'replayed', confirmed, receipt };
  }

  // (3) Terminal unwrap through the T01 envelope grammar.
  const effect = view.admitted?.effects?.[0];
  if (effect === undefined) {
    return failed(
      confirmed,
      {
        code: 'EFFECT_ENVELOPE_MISSING',
        message:
          'the admitted receipt carries no external effect envelope (the sealed policy refused the intent)',
      },
      null,
      receipt,
    );
  }
  const normalized = normalizeEffectEnvelope(effect.output);
  if (!normalized.ok) {
    return failed(
      confirmed,
      {
        code: normalized.diagnostics[0]?.code ?? 'EFFECT_ENVELOPE_INVALID',
        message: normalized.diagnostics[0]?.message ?? 'effect output is not a T01 envelope',
      },
      null,
      receipt,
    );
  }
  const terminal: EffectEnvelope = normalized.value;
  if (terminal.phase !== 'terminal') {
    return failed(
      confirmed,
      {
        code: 'EFFECT_NOT_TERMINAL',
        message: `effect settled at phase '${terminal.phase}' under await:'terminal'`,
      },
      terminal,
      receipt,
    );
  }
  if (terminal.outcome.ok === false) {
    return failed(confirmed, terminal.outcome.error, terminal, receipt);
  }

  // (4) Evidence verification — grammar, then real bytes on disk.
  const output = terminal.outcome.output;
  const permitEffectId = output['permitEffectId'];
  if (typeof permitEffectId !== 'string' || permitEffectId.length === 0) {
    return failed(
      confirmed,
      {
        code: 'EVIDENCE_PERMIT_IDENTITY_MISSING',
        message: 'the terminal output carries no permit effect identity',
      },
      terminal,
      receipt,
    );
  }
  const evidenceCheck = validateMaterializedEvidence(
    {
      fileSha256: output['fileSha256'],
      bytesWritten: output['bytesWritten'],
      artifactPath: output['artifactPath'],
      stopReason: output['stopReason'],
    },
    confirmed.outputRootScope,
  );
  if (!evidenceCheck.ok) {
    return failed(
      confirmed,
      {
        code: evidenceCheck.diagnostics[0]?.code ?? 'EVIDENCE_INVALID',
        message:
          evidenceCheck.diagnostics[0]?.message ??
          'materialized evidence refused by the T01 grammar',
      },
      terminal,
      receipt,
    );
  }
  const evidence = evidenceCheck.value;
  let onDisk: Buffer;
  try {
    onDisk = readFileSync(evidence.artifactPath);
  } catch (error) {
    return failed(
      confirmed,
      {
        code: 'EVIDENCE_FILE_UNREADABLE',
        message: `evidence verification failed reading ${evidence.artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
      },
      terminal,
      receipt,
    );
  }
  const onDiskDigest = createHash('sha256').update(onDisk).digest('hex');
  if (onDiskDigest !== evidence.fileSha256 || onDisk.byteLength !== evidence.bytesWritten) {
    return failed(
      confirmed,
      {
        code: 'EVIDENCE_DIGEST_MISMATCH',
        message: `artifact on disk (${onDiskDigest}, ${onDisk.byteLength} bytes) does not reproduce the terminal evidence (${evidence.fileSha256}, ${evidence.bytesWritten} bytes)`,
      },
      terminal,
      receipt,
    );
  }

  const summary: MediaJourneySummary = {
    outcomeKind: typeof output['outcomeKind'] === 'string' ? output['outcomeKind'] : undefined,
    segmentsTransferred:
      typeof output['segmentsTransferred'] === 'number' ? output['segmentsTransferred'] : undefined,
    transferredByteCount:
      typeof output['transferredByteCount'] === 'number'
        ? output['transferredByteCount']
        : undefined,
  };

  return { status: 'completed', confirmed, evidence, permitEffectId, terminal, receipt, summary };
}

function failed(
  confirmed: ConfirmedDownloadIntent,
  error: { code: string; message: string },
  terminal: EffectEnvelope | null,
  receipt: Record<string, unknown> | null,
): MediaSubmissionOutcome {
  return { status: 'failed', confirmed, error, terminal, receipt };
}
