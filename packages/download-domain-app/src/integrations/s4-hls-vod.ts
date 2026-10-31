/**
 * T06 S4 HLS VOD Domain App integration.
 *
 * A separate K composition preserves the S4 selected-rendition contract:
 * it does not pass an S4 request through the generic ConfirmedDownloadIntent
 * S1/S3 slice field. The Host re-observes the manifest and verifies the
 * confirmed selection tuple before it executes the existing HLS/FFmpeg path.
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
  validateMaterializedEvidence,
  validateRouteTable,
  REFERENCE_TOKEN_PATTERN,
  type EffectEnvelope,
  type MaterializedEvidence,
  type OperationDeclaration,
} from '../contracts/index.ts';
import { FileCasDocStore } from '../composition/runtime.ts';
import { InMemoryMediaTargetRegistry, type MediaTargetRefSeed } from './media-registry.ts';
import { acquireSelectedHlsVod } from '../../../download-domain-host/src/media/media-acquisition-bridge.ts';
import {
  S4_HLS_MEDIA_OPERATION,
  validateConfirmedS4HlsIntent,
  type ConfirmedS4HlsIntent,
} from './s4-hls-vod-contract.ts';

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
const DECLARATIONS: readonly OperationDeclaration[] = [{
  operationId: S4_HLS_MEDIA_OPERATION,
  capabilityId: 'media',
  handlerId: 'acquireS4HlsVod',
  effectClass: 'non-idempotent',
  externalEffect: true,
}];

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

export function sealS4HlsComposition(): V10BuiltApp {
  const t03 = buildDownloadDomainApp();
  const businessSource = readFileSync(join(HERE, 's4-hls-vod-business.mjs'), 'utf8');
  const capabilitySource = readFileSync(join(HERE, 's4-hls-vod-capability.mjs'), 'utf8');
  const modules: readonly V10ModuleInput[] = t03.built.modules.map((module) => {
    if (module.role === 'business') {
      return {
        ...sealedToInput(module),
        packageId: S4_HLS_BUSINESS_MODULE_ID,
        moduleSource: businessSource,
        moduleSha256: sha256Hex(businessSource),
        provides: ['business:policy/1', 'intent:confirmDownload'],
      };
    }
    if (module.role === 'capability') {
      return {
        ...sealedToInput(module),
        packageId: S4_HLS_CAPABILITY_MODULE_ID,
        moduleSource: capabilitySource,
        moduleSha256: sha256Hex(capabilitySource),
        endpoint: 'capability-endpoint',
        provides: ['capability:media/1'],
        capabilityId: 'media',
        handlers: [{ operationId: S4_HLS_ROUTE.operationId, handler: S4_HLS_ROUTE.handlerId }],
      };
    }
    return sealedToInput(module);
  });
  const routeCheck = validateRouteTable([S4_HLS_ROUTE], DECLARATIONS);
  if (!routeCheck.ok || t03.routes.length !== 1) {
    throw new Error('S4_HLS_COMPOSITION_BINDING_MISMATCH: route is outside frozen media.acquire vocabulary');
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
interface S4HlsBridgePin {
  acquireS4HlsVod(payload: Record<string, unknown>, permit: unknown): Promise<unknown>;
}
function hostGlobals(): { [S4_HLS_BRIDGE_PIN]?: S4HlsBridgePin } {
  return globalThis as unknown as { [S4_HLS_BRIDGE_PIN]?: S4HlsBridgePin };
}
export interface S4HlsPinCounters {
  acquireCalls: number;
  permitRefusals: number;
  intentRefusals: number;
  registryRefusals: number;
  completedExecutions: number;
  failedExecutions: number;
}
export interface S4HlsRuntimeOptions {
  readonly storePath: string;
  readonly mediaTargetRefs?: readonly MediaTargetRefSeed[];
  readonly tenantId?: string;
  readonly deployedAppId?: string;
  readonly queryPrincipal?: string;
  readonly now?: () => number;
}
export interface S4HlsRuntime {
  readonly built: V10BuiltApp;
  readonly app: DomainApp;
  readonly store: FileCasDocStore;
  readonly registry: InMemoryMediaTargetRegistry;
  readonly pin: S4HlsPinCounters;
  stop(): void;
}

interface KernelPermitClaim { readonly effectId: string; readonly durableControlTurnId: string; }
function parseKernelPermit(value: unknown): KernelPermitClaim | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== 'effectId' && key !== 'durableControlTurnId') ||
    typeof record.effectId !== 'string' || record.effectId.length < 1 || record.effectId.length > 256 ||
    typeof record.durableControlTurnId !== 'string' || record.durableControlTurnId.length < 1 || record.durableControlTurnId.length > 256
  ) return undefined;
  return { effectId: record.effectId, durableControlTurnId: record.durableControlTurnId };
}
function boundedPermitIdOf(effectId: string): string {
  if (REFERENCE_TOKEN_PATTERN.test(effectId)) return effectId;
  return 'xd-s4-' + createHash('sha256').update(effectId).digest('hex').slice(0, 32);
}
function refusalEnvelope(externalRef: string, code: string, message: string): EffectEnvelope {
  return { phase: 'terminal', externalRef, outcome: { ok: false, error: { code, message } } };
}

async function executeS4Hls(
  payload: Record<string, unknown>,
  permit: unknown,
  registry: InMemoryMediaTargetRegistry,
  counters: S4HlsPinCounters,
): Promise<EffectEnvelope> {
  counters.acquireCalls += 1;
  const kernelPermit = parseKernelPermit(permit);
  if (kernelPermit === undefined) {
    counters.permitRefusals += 1;
    return refusalEnvelope('media.acquire:unpermitted', 'MEDIA_PERMIT_REQUIRED', 'Kernel effect permit is required');
  }
  const externalRef = kernelPermit.effectId;
  const candidate: Record<string, unknown> = { ...payload };
  delete candidate.effectId;
  const checked = validateConfirmedS4HlsIntent(candidate);
  if (!checked.ok) {
    counters.intentRefusals += 1;
    return refusalEnvelope(externalRef, 'S4_INTENT_INVALID', checked.diagnostics[0]?.message ?? 'S4 intent refused');
  }
  const intent: ConfirmedS4HlsIntent = checked.value;
  const recordCheck = registry.resolve(intent.targetRef);
  if (!recordCheck.ok) {
    counters.registryRefusals += 1;
    return refusalEnvelope(externalRef, recordCheck.diagnostics[0]?.code ?? 'MEDIA_TARGET_UNKNOWN', 'opaque targetRef did not resolve');
  }
  const record = recordCheck.value;
  if (
    record.protocol !== 'HLS' ||
    record.manifestUri !== intent.selection.manifestUri ||
    (record.selectedRenditionUri !== undefined && record.selectedRenditionUri !== intent.selection.renditionUri)
  ) {
    counters.registryRefusals += 1;
    return refusalEnvelope(externalRef, 'S4_SELECTION_TARGET_MISMATCH', 'confirmed selection does not match trusted target registry facts');
  }
  const mediaPermit = {
    kind: 'media-acquisition-permit',
    permitId: boundedPermitIdOf(kernelPermit.effectId),
    operationId: S4_HLS_MEDIA_OPERATION,
    requestId: intent.requestId,
    lineageId: intent.lineageId,
    allowedManifestOrigins: record.allowedManifestOrigins,
    allowedSegmentOrigins: record.allowedSegmentOrigins,
    budget: record.budget,
  };
  const result = await acquireSelectedHlsVod({
    intent,
    protocol: record.protocol,
    manifestUri: record.manifestUri,
    permit: mediaPermit,
    ...(record.artifactFileName === undefined ? {} : { artifactFileName: record.artifactFileName }),
    ...(record.fixtureLoopbackHttp === true ? { fixtureLoopbackHttp: true } : {}),
    ...(record.manifestMaxBytes === undefined ? {} : { manifestMaxBytes: record.manifestMaxBytes }),
    ...(record.segmentMaxBytes === undefined ? {} : { segmentMaxBytes: record.segmentMaxBytes }),
    ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs }),
  });
  if (!result.admitted) {
    counters.failedExecutions += 1;
    return refusalEnvelope(externalRef, result.code, result.message);
  }
  if (result.envelope.phase === 'terminal' && result.envelope.outcome.ok) {
    const normalized = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef,
      outcome: {
        ok: true,
        output: {
          ...result.envelope.outcome.output,
          permitEffectId: kernelPermit.effectId,
          durableControlTurnId: kernelPermit.durableControlTurnId,
        },
      },
    });
    if (!normalized.ok) throw new Error('S4 Host permit enrichment rejected by T01 envelope grammar');
    counters.completedExecutions += 1;
    return normalized.value;
  }
  counters.failedExecutions += 1;
  return result.envelope;
}

export async function assembleS4HlsRuntime(options: S4HlsRuntimeOptions): Promise<S4HlsRuntime> {
  const built = sealS4HlsComposition();
  const store = new FileCasDocStore(options.storePath);
  const registry = new InMemoryMediaTargetRegistry(options.mediaTargetRefs ?? []);
  const pin: S4HlsPinCounters = {
    acquireCalls: 0,
    permitRefusals: 0,
    intentRefusals: 0,
    registryRefusals: 0,
    completedExecutions: 0,
    failedExecutions: 0,
  };
  const bridgePin: S4HlsBridgePin = {
    acquireS4HlsVod: (payload, permit) => executeS4Hls(payload, permit, registry, pin),
  };
  hostGlobals()[S4_HLS_BRIDGE_PIN] = bridgePin;
  const tenantId = options.tenantId ?? 'tenant:xdownload-v021-s4';
  const deployedAppId = options.deployedAppId ?? 'deploy:xdownload-v021-s4';
  const principal = options.queryPrincipal ?? 'xdownload-v021-s4-host';
  const app = await load(built, {
    store,
    tenantId,
    deploymentIdentity: { deployedAppId, tenantId, appId: built.appId },
    queryAuthority: {
      principal: { actor: principal },
      authorize: (candidate, target) => Boolean(
        candidate !== null &&
        typeof candidate === 'object' &&
        (candidate as { actor?: string }).actor === principal &&
        target.tenantId === tenantId,
      ),
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    built, app, store, registry, pin,
    stop(): void {
      app.stop();
      if (hostGlobals()[S4_HLS_BRIDGE_PIN] === bridgePin) delete hostGlobals()[S4_HLS_BRIDGE_PIN];
      store.close();
    },
  };
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
    return { status: 'refused', code: 'S4_INTENT_INVALID', message: checked.diagnostics[0]?.message ?? 'S4 intent refused' };
  }
  const intent = checked.value;
  if (options.signal?.aborted === true) {
    return { status: 'refused', code: 'SUBMISSION_ABORTED', message: 'submission aborted before K send' };
  }
  const publicIntent: V10PublicIntent = {
    intentType: 'confirmDownload',
    instanceKey: 's4-hls-' + intent.requestId,
    messageId: options.messageId ?? 'msg-s4-hls-' + intent.requestId,
    input: intent as unknown as Record<string, unknown>,
  };
  const receipt = await runtime.app.send(publicIntent) as Record<string, unknown>;
  const view = receipt as {
    readonly idempotentReplay?: boolean;
    readonly admitted?: { readonly effects?: readonly { readonly output?: unknown }[] };
  };
  if (view.idempotentReplay === true) return { status: 'replayed', receipt };
  const effect = view.admitted?.effects?.[0];
  if (effect === undefined) {
    return { status: 'failed', code: 'EFFECT_ENVELOPE_MISSING', message: 'K receipt has no media effect envelope', receipt };
  }
  const normalized = normalizeEffectEnvelope(effect.output);
  if (!normalized.ok) {
    return { status: 'failed', code: 'EFFECT_ENVELOPE_INVALID', message: normalized.diagnostics[0]?.message ?? 'invalid effect envelope', receipt };
  }
  const terminal = normalized.value;
  if (terminal.phase !== 'terminal') {
    return { status: 'failed', code: 'EFFECT_NOT_TERMINAL', message: 'S4 effect did not settle terminally', terminal, receipt };
  }
  if (terminal.outcome.ok === false) {
    return { status: 'failed', code: terminal.outcome.error.code, message: terminal.outcome.error.message, terminal, receipt };
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
    return { status: 'failed', code: 'EVIDENCE_PERMIT_IDENTITY_MISSING', message: 'terminal output is not bound to the K permit', terminal, receipt };
  }
  const evidenceCheck = validateMaterializedEvidence({
    fileSha256: output.fileSha256,
    bytesWritten: output.bytesWritten,
    artifactPath: output.artifactPath,
    stopReason: output.stopReason,
  }, intent.outputRootScope);
  if (!evidenceCheck.ok) {
    return { status: 'failed', code: 'EVIDENCE_INVALID', message: evidenceCheck.diagnostics[0]?.message ?? 'invalid artifact evidence', terminal, receipt };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(evidenceCheck.value.artifactPath);
  } catch {
    return { status: 'failed', code: 'EVIDENCE_FILE_UNREADABLE', message: 'materialized S4 artifact cannot be read back', terminal, receipt };
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== evidenceCheck.value.fileSha256 || bytes.byteLength !== evidenceCheck.value.bytesWritten) {
    return { status: 'failed', code: 'EVIDENCE_DIGEST_MISMATCH', message: 'S4 artifact bytes do not reproduce Host evidence', terminal, receipt };
  }
  return {
    status: 'completed',
    evidence: evidenceCheck.value,
    terminal,
    receipt,
    summary: {
      segmentsTransferred: typeof output.segmentsTransferred === 'number' ? output.segmentsTransferred : 0,
      transferredByteCount: typeof output.transferredByteCount === 'number' ? output.transferredByteCount : 0,
    },
  };
}
