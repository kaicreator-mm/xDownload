/**
 * T06 S4 HLS VOD Domain App integration.
 *
 * A separate K composition preserves the S4 selected-rendition contract:
 * it does not pass an S4 request through the generic ConfirmedDownloadIntent
 * S1/S3 slice field. The Host re-observes the manifest and verifies the
 * confirmed selection tuple before it executes the existing HLS/FFmpeg path.
 *
 * V022-A02 boundary note: this module no longer imports
 * @xdownload/download-domain-host. REMOVED here, RELOCATE-TO-CORE-A04:
 * `executeS4Hls` (the trusted pin body that drove the real T06 Host bridge
 * `acquireSelectedHlsVod`) and `assembleS4HlsRuntime` (test/fixture-only
 * standalone assembly around it) — Host-owned physical assembly belongs to
 * the Core composition root (A04), which already composes its own S4 Host
 * bridge over `acquireS4HlsBridgePin`. KEPT until A04 (current Core route
 * deep-import compatibility, NOT re-exported by the public App root):
 * `sealS4HlsComposition`, `s4HlsCompositionContribution`,
 * `acquireS4HlsBridgePin` and the S4 pin contract types. See
 * s4-hls-vod.test.ts for the enumerated integration scenario map.
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
  validateMaterializedEvidence,
  validateRouteTable,
  type EffectEnvelope,
  type MaterializedEvidence,
  type OperationDeclaration,
} from '../contracts/index.ts';
import type { FileCasDocStore } from '../composition/runtime.ts';
import type { InMemoryMediaTargetRegistry } from './media-registry.ts';
import { S4_HLS_MEDIA_OPERATION, validateConfirmedS4HlsIntent } from './s4-hls-vod-contract.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export const APP_ID_S4_HLS_VOD = 'app:xdownload-s4-hls-vod';
export const BUILD_ID_S4_HLS_VOD = 'xdownload-v021-s4-hls-vod-v1';
export const S4_HLS_BUSINESS_MODULE_ID = 'business-s4-hls-vod@0.2.1';
export const S4_HLS_CAPABILITY_MODULE_ID = 'capability-s4-hls-vod@0.2.1';
export const S4_HLS_ROUTE: V10RouteRowInput = {
  intentId: 'confirmDownload',
  operationId: S4_HLS_MEDIA_OPERATION,
  capabilityId: 'media',
  handlerId: 'acquireS4HlsVod',
};
const DECLARATIONS: readonly OperationDeclaration[] = [
  {
    operationId: S4_HLS_MEDIA_OPERATION,
    capabilityId: 'media',
    handlerId: 'acquireS4HlsVod',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
];

/**
 * Convert one already-built module back into a rebuildable module input
 * (dropping build-only null fields). Needed when splicing an existing
 * composition's K/S modules into a new single-K build alongside the S4
 * contribution.
 */
export function s4HlsSealedPassthrough(module: V10BuiltApp['modules'][number]): V10ModuleInput {
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

function s4BusinessModuleInput(base: V10BuiltApp): V10ModuleInput {
  const module = base.modules.find((candidate) => candidate.role === 'business');
  if (module === undefined) {
    throw new Error('S4_HLS_COMPOSITION_BINDING_MISMATCH: base business module missing');
  }
  const source = readFileSync(join(HERE, 's4-hls-vod-business.mjs'), 'utf8');
  return {
    ...s4HlsSealedPassthrough(module),
    packageId: S4_HLS_BUSINESS_MODULE_ID,
    moduleSource: source,
    moduleSha256: sha256Hex(source),
    provides: ['business:policy/1', 'intent:confirmDownload'],
  };
}
function s4CapabilityModuleInput(base: V10BuiltApp): V10ModuleInput {
  const module = base.modules.find((candidate) => candidate.role === 'capability');
  if (module === undefined) {
    throw new Error('S4_HLS_COMPOSITION_BINDING_MISMATCH: base capability module missing');
  }
  const source = readFileSync(join(HERE, 's4-hls-vod-capability.mjs'), 'utf8');
  return {
    ...s4HlsSealedPassthrough(module),
    packageId: S4_HLS_CAPABILITY_MODULE_ID,
    moduleSource: source,
    moduleSha256: sha256Hex(source),
    endpoint: 'capability-endpoint',
    provides: ['capability:media/1'],
    capabilityId: 'media',
    handlers: [{ operationId: S4_HLS_ROUTE.operationId, handler: S4_HLS_ROUTE.handlerId }],
  };
}

/**
 * The S4 contribution for a production single-K composition: T02 splices these
 * sealed business/capability module inputs, route row and operation
 * declarations into its ONE existing Core-owned build instead of loading a
 * second K; the Host bridge is then registered via `acquireS4HlsBridgePin()`.
 */
export interface S4HlsContribution {
  readonly business: V10ModuleInput;
  readonly capability: V10ModuleInput;
  readonly route: V10RouteRowInput;
  readonly declarations: readonly OperationDeclaration[];
}
export function s4HlsCompositionContribution(): S4HlsContribution {
  const t03 = buildDownloadDomainApp();
  return {
    business: s4BusinessModuleInput(t03.built),
    capability: s4CapabilityModuleInput(t03.built),
    route: S4_HLS_ROUTE,
    declarations: DECLARATIONS,
  };
}

export function sealS4HlsComposition(): V10BuiltApp {
  const t03 = buildDownloadDomainApp();
  const modules: readonly V10ModuleInput[] = t03.built.modules.map((module) => {
    if (module.role === 'business') return s4BusinessModuleInput(t03.built);
    if (module.role === 'capability') return s4CapabilityModuleInput(t03.built);
    return s4HlsSealedPassthrough(module);
  });
  const routeCheck = validateRouteTable([S4_HLS_ROUTE], DECLARATIONS);
  if (!routeCheck.ok || t03.routes.length !== 1) {
    throw new Error(
      'S4_HLS_COMPOSITION_BINDING_MISMATCH: route is outside frozen media.acquire vocabulary',
    );
  }
  const built = buildV10App({
    appId: APP_ID_S4_HLS_VOD,
    audience: AUDIENCE,
    targetProfile: t03.built.targetProfile,
    modules,
    routes: [S4_HLS_ROUTE],
    hardBudget: t03.built.hardBudget,
    buildId: BUILD_ID_S4_HLS_VOD,
  });
  verifySealedModules(built);
  const kernel = built.modules.find((module) => module.role === 'kernel-primary');
  const standard = built.modules.find((module) => module.role === 'standard-primary');
  const business = built.modules.find((module) => module.role === 'business');
  const capability = built.modules.find((module) => module.role === 'capability');
  if (
    kernel?.moduleSha256 !== POC183_KERNEL_MODULE_SHA256 ||
    standard?.moduleSha256 !== POC183_STANDARD_MODULE_SHA256 ||
    business?.packageId !== S4_HLS_BUSINESS_MODULE_ID ||
    capability?.packageId !== S4_HLS_CAPABILITY_MODULE_ID ||
    capability.externalEffect !== true ||
    capability.capabilityId !== 'media'
  ) {
    throw new Error('S4_HLS_COMPOSITION_SEAL_FAILED: K/S or S4 B/C seal mismatch');
  }
  return built;
}

export const S4_HLS_BRIDGE_PIN = '__xdownloadS4HlsVodBridge';
export interface S4HlsBridgePin {
  acquireS4HlsVod(payload: Record<string, unknown>, permit: unknown): Promise<unknown>;
}
function hostGlobals(): { [S4_HLS_BRIDGE_PIN]?: S4HlsBridgePin } {
  return globalThis as unknown as { [S4_HLS_BRIDGE_PIN]?: S4HlsBridgePin };
}
/**
 * Single-owner registration of the trusted T06 Host bridge pin. The pin is the
 * process-global routing authority for S4 media effects, so a second live
 * registration is refused atomically instead of silently displacing the first
 * holder (a displaced bridge could route effects to the wrong target registry).
 *
 * V022-A02: TRANSITIONAL CORE COMPATIBILITY — the current Core route
 * (`core-runtime/src/domain-app-route.ts`) deep-imports this seam to install
 * its own S4 Host bridge; it stays exported from this deep module path only
 * (never via the public App root) until A04 moves the consumer to the
 * Host-owned adapter and deletes the App-side seam.
 */
export interface S4HlsBridgeLease {
  readonly bridge: S4HlsBridgePin;
  release(): void;
}
export type S4HlsBridgeRegistration =
  | { readonly ok: true; readonly lease: S4HlsBridgeLease }
  | { readonly ok: false; readonly code: 'S4_BRIDGE_PIN_CONFLICT'; readonly message: string };
export function acquireS4HlsBridgePin(bridge: S4HlsBridgePin): S4HlsBridgeRegistration {
  const holder = hostGlobals()[S4_HLS_BRIDGE_PIN];
  if (holder !== undefined) {
    return {
      ok: false,
      code: 'S4_BRIDGE_PIN_CONFLICT',
      message:
        'an S4 HLS Host bridge pin is already registered; release the live lease before installing another',
    };
  }
  hostGlobals()[S4_HLS_BRIDGE_PIN] = bridge;
  let released = false;
  return {
    ok: true,
    lease: {
      bridge,
      release(): void {
        if (released) return;
        released = true;
        if (hostGlobals()[S4_HLS_BRIDGE_PIN] === bridge) delete hostGlobals()[S4_HLS_BRIDGE_PIN];
      },
    },
  };
}
export interface S4HlsPinCounters {
  acquireCalls: number;
  permitRefusals: number;
  intentRefusals: number;
  registryRefusals: number;
  completedExecutions: number;
  failedExecutions: number;
}
/**
 * The assembled S4 runtime contract consumed by `submitConfirmedS4HlsVod`.
 * TRANSITIONAL (A02→A04): the physical assembly (standalone seal → pin →
 * SDK `load`) moved to the Core composition root; the current Core route
 * composes the one production single-K runtime itself and only needs the
 * seal, the contribution and this journey contract surface.
 */
export interface S4HlsRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: FileCasDocStore;
  readonly registry: InMemoryMediaTargetRegistry;
  readonly pin: S4HlsPinCounters;
  stop(): void;
}

export interface S4HlsJourneyResult {
  readonly status: 'completed' | 'replayed' | 'refused' | 'failed';
  readonly code?: string;
  readonly message?: string;
  readonly evidence?: MaterializedEvidence;
  readonly terminal?: EffectEnvelope;
  readonly receipt?: Record<string, unknown>;
  readonly summary?: {
    readonly segmentsTransferred: number;
    readonly transferredByteCount: number;
  };
}

export async function submitConfirmedS4HlsVod(
  runtime: S4HlsRuntime,
  candidate: unknown,
  options: { readonly messageId?: string; readonly signal?: AbortSignal } = {},
): Promise<S4HlsJourneyResult> {
  const checked = validateConfirmedS4HlsIntent(candidate);
  if (!checked.ok) {
    return {
      status: 'refused',
      code: 'S4_INTENT_INVALID',
      message: checked.diagnostics[0]?.message ?? 'S4 intent refused',
    };
  }
  const intent = checked.value;
  if (options.signal?.aborted === true) {
    return {
      status: 'refused',
      code: 'SUBMISSION_ABORTED',
      message: 'submission aborted before K send',
    };
  }
  const publicIntent: V10PublicIntent = {
    intentType: 'confirmDownload',
    instanceKey: 's4-hls-' + intent.requestId,
    messageId: options.messageId ?? 'msg-s4-hls-' + intent.requestId,
    // The K's rule projection maps digestAnchor unconditionally; an absent
    // optional anchor rides the internal path as null and is dropped again at
    // the bridge before contract validation.
    input: {
      ...(intent as unknown as Record<string, unknown>),
      digestAnchor: intent.digestAnchor ?? null,
    },
  };
  const receipt = (await runtime.app.send(publicIntent)) as Record<string, unknown>;
  const view = receipt as {
    readonly idempotentReplay?: boolean;
    readonly admitted?: { readonly effects?: readonly { readonly output?: unknown }[] };
  };
  if (view.idempotentReplay === true) return { status: 'replayed', receipt };
  const effect = view.admitted?.effects?.[0];
  if (effect === undefined) {
    return {
      status: 'failed',
      code: 'EFFECT_ENVELOPE_MISSING',
      message: 'K receipt has no media effect envelope',
      receipt,
    };
  }
  const normalized = normalizeEffectEnvelope(effect.output);
  if (!normalized.ok) {
    return {
      status: 'failed',
      code: 'EFFECT_ENVELOPE_INVALID',
      message: normalized.diagnostics[0]?.message ?? 'invalid effect envelope',
      receipt,
    };
  }
  const terminal = normalized.value;
  if (terminal.phase !== 'terminal') {
    return {
      status: 'failed',
      code: 'EFFECT_NOT_TERMINAL',
      message: 'S4 effect did not settle terminally',
      terminal,
      receipt,
    };
  }
  if (terminal.outcome.ok === false) {
    return {
      status: 'failed',
      code: terminal.outcome.error.code,
      message: terminal.outcome.error.message,
      terminal,
      receipt,
    };
  }
  const output = terminal.outcome.output;
  if (
    output.permitEffectId === undefined ||
    typeof output.permitEffectId !== 'string' ||
    output.permitEffectId.length === 0 ||
    output.durableControlTurnId === undefined ||
    typeof output.durableControlTurnId !== 'string' ||
    output.durableControlTurnId.length === 0
  ) {
    return {
      status: 'failed',
      code: 'EVIDENCE_PERMIT_IDENTITY_MISSING',
      message: 'terminal output is not bound to the K permit',
      terminal,
      receipt,
    };
  }
  const evidenceCheck = validateMaterializedEvidence(
    {
      fileSha256: output.fileSha256,
      bytesWritten: output.bytesWritten,
      artifactPath: output.artifactPath,
      stopReason: output.stopReason,
    },
    intent.outputRootScope,
  );
  if (!evidenceCheck.ok) {
    return {
      status: 'failed',
      code: 'EVIDENCE_INVALID',
      message: evidenceCheck.diagnostics[0]?.message ?? 'invalid artifact evidence',
      terminal,
      receipt,
    };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(evidenceCheck.value.artifactPath);
  } catch {
    return {
      status: 'failed',
      code: 'EVIDENCE_FILE_UNREADABLE',
      message: 'materialized S4 artifact cannot be read back',
      terminal,
      receipt,
    };
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (
    digest !== evidenceCheck.value.fileSha256 ||
    bytes.byteLength !== evidenceCheck.value.bytesWritten
  ) {
    return {
      status: 'failed',
      code: 'EVIDENCE_DIGEST_MISMATCH',
      message: 'S4 artifact bytes do not reproduce Host evidence',
      terminal,
      receipt,
    };
  }
  return {
    status: 'completed',
    evidence: evidenceCheck.value,
    terminal,
    receipt,
    summary: {
      segmentsTransferred:
        typeof output.segmentsTransferred === 'number' ? output.segmentsTransferred : 0,
      transferredByteCount:
        typeof output.transferredByteCount === 'number' ? output.transferredByteCount : 0,
    },
  };
}
