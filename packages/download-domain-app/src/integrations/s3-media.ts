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
 * V022-A02/A04 boundary note: this module no longer imports
 * @xdownload/download-domain-host. REMOVED in A02, RELOCATED-TO-CORE-A04:
 * `assembleMediaRuntime` and the trusted permit pin body
 * (`executeMediaAcquisition`, which drove the real T06 Host bridge
 * `acquireMediaViaHls`) live at the Core composition root
 * (packages/core-runtime/test/domain-app-media-flow.test.ts). V022-A04 R2
 * scoping: the generic media route is NOT composable into the production
 * one-K alongside the S4 route (the pinned SDK refuses the duplicate route
 * pair confirmDownload → media.acquire and binds capabilityId `media`
 * injectively; the sealed #183 Standard Router also routes by intentType
 * only — exact limitation with probe transcripts on
 * kaicreator-mm/xDownload#357), so the S3 integration evidence there is
 * explicitly component-level, never claimed as the Core one-K proof. The
 * `MEDIA_BRIDGE_PIN` ABI name the sealed media C module reaches stays as
 * the typed Core-side pin-installer reference.
 *
 * Honest status (T10 baseline vocabulary): this journey is PROVEN at
 * bounded-fixture level (real loopback HLS master→playlist→segments→
 * digest-backed materialization through the real engine and the real K);
 * the fixture proof itself relocates to Core A04 with the assembly.
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
import type { DomainApp } from '@kaicreator/domain-harness-microkernel';
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
  type ConfirmedDownloadIntent,
  type EffectEnvelope,
  type MaterializedEvidence,
  type OperationDeclaration,
} from '../contracts/index.ts';
import type { KDocStoreEvidencePort } from '../composition/runtime.ts';

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
// Transitional runtime contract (V022-A02 → Core A04).
// ---------------------------------------------------------------------------

/**
 * The trusted Host bridge pin name the sealed media C module reaches. The
 * sealed capability module carries the literal
 * `globalThis.__xdownloadMediaAcquisitionBridge`; this constant is the
 * typed reference for the Core-side pin installer (which owns the permit
 * derivation pin body A02 removed from this module).
 * V022-A04: exported through the public App root for the Core composition
 * root's pin installer; the physical bridge remains Host-owned.
 */
export const MEDIA_BRIDGE_PIN = '__xdownloadMediaAcquisitionBridge';

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

/**
 * The assembled S3 media runtime contract consumed by the domain journey
 * below. Domain-facing by construction (V022-A04, closing A02 P2-1): the
 * store is the narrow structural evidence port and the registry is opaque —
 * no `FileCasDocStore`, no media registry and no physical Runtime type is
 * exposed. The Core composition root assembles the physical instances (Host
 * store + Host registry + permit pin) and passes them structurally.
 */
export interface MediaDownloadRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: KDocStoreEvidencePort;
  /** Host-owned media targetRef registry (opaque at the App boundary). */
  readonly registry: unknown;
  /** Live pin counters (the trusted seam's own zero-effect evidence). */
  readonly pin: MediaPinCounters;
  /** Truthful cancellation before send; the T06 bridge owns in-flight transfer. */
  stop(): void;
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
