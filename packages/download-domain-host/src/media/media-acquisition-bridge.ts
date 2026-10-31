/**
 * v0.2 T06 — media C/Host acquisition bridge (HLS only) behind the Kernel
 * permit gate.
 *
 * T04 gate pattern applied to the media lane: without a valid Kernel permit
 * binding the exact confirmed intent, the bridge refuses with a typed
 * diagnostic and performs ZERO network requests and ZERO filesystem writes
 * (observable through the returned counters and any fixture server). The
 * actual HLS pull is executed exclusively by the existing
 * `@xdownload/hls-vod-adapter` engine (manifest/playlist ports, provenance
 * planning, budget-ledger admission, assembly/probe, canonical terminal
 * projection) — this bridge is a Host adapter, not a second engine: it adds
 * no fetch path, no retry and no ledger of its own.
 *
 * Protocol support is deliberately narrow: only an explicit `HLS` protocol
 * declaration is executed; every other declaration is a typed refusal before
 * any effect. Summary/materialization follow the canonical T01 contracts:
 * the bridge returns an `EffectEnvelope` and only a `terminal` phase settles
 * the effect; successful materialization carries validated
 * `MaterializedEvidence` (digest-backed, inside the authorized output root)
 * and the artifact bytes actually written.
 *
 * Budget truth is single: one engine `TransferLedger` per acquisition,
 * created from the permit's canonical budget profile; manifest/media-playlist
 * requests debit the same transfer domain the engine debits for segments
 * (PRD §15.2/§15.4, C28). Budget/member exhaustion terminates honestly — a
 * failed terminal envelope, never a partial success.
 */
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bindLocator,
  deepFreeze,
  makeContractId,
  makeLogicalTargetId,
} from '@xdownload/domain-contracts';
import {
  normalizeEffectEnvelope,
  validateConfirmedIntent,
  validateMaterializedEvidence,
  type EffectEnvelope,
  type MaterializedEvidence,
} from '../../../download-domain-app/src/contracts/index.ts';
import { bindRenditionToTarget } from '../../../hls-vod-adapter/src/bind.ts';
import { createTransferLedger } from '../../../hls-vod-adapter/src/budget.ts';
import {
  createSyntheticMediaAssemblyPort,
  type MediaAssemblyPort,
} from '../../../hls-vod-adapter/src/assemble.ts';
import { createFfmpegTsMediaAssemblyPort } from '../../../hls-vod-adapter/src/ffmpeg-ts.ts';
import {
  s4HlsSelectionTupleDigest,
  validateConfirmedS4HlsIntent,
  type S4ConfirmedSelection,
} from '../../../download-domain-app/src/integrations/s4-hls-vod-contract.ts';
import {
  createAuthorizedHttpSegmentFetcher,
  type AsyncSegmentFetcherPort,
} from '../../../hls-vod-adapter/src/http-segment.ts';
import {
  createAuthorizedHlsManifestPort,
  type HlsManifestFetchResult,
} from '../../../hls-vod-adapter/src/manifest-http.ts';
import {
  decodeMasterPlaylist,
  decodeMediaPlaylist,
} from '../../../hls-vod-adapter/src/playlist.ts';
import { executeHlsVodAcquisitionAsync } from '../../../hls-vod-adapter/src/pipeline-async.ts';
import type { HlsVodPipelineOutcome } from '../../../hls-vod-adapter/src/pipeline.ts';
import type { AcquisitionRun } from '../../../hls-vod-adapter/src/acquire.ts';
import type { SegmentPlanEntry } from '../../../hls-vod-adapter/src/plan.ts';
import {
  MEDIA_ACQUIRE_OPERATION,
  validateMediaAcquisitionPermit,
  type MediaAcquisitionPermit,
} from './media-permit.ts';

/** The only protocol this bridge executes. No broad protocol claims. */
export const MEDIA_SUPPORTED_PROTOCOLS = ['HLS'] as const;

const DEFAULT_MANIFEST_MAX_BYTES = 64 * 1024;
const HARD_MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_SEGMENT_MAX_BYTES = 1024 * 1024;
const HARD_MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const HARD_MAX_TIMEOUT_MS = 30_000;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface MediaAcquisitionTransportRequest {
  readonly protocol: string;
  readonly manifestUri: string;
  readonly artifactFileName?: string;
  readonly permit: unknown;
  readonly fixtureLoopbackHttp?: boolean;
  readonly manifestMaxBytes?: number;
  readonly segmentMaxBytes?: number;
  readonly timeoutMs?: number;
}

/** One legacy S3 media acquisition request at the Host boundary. */
export interface MediaAcquisitionBridgeRequest extends MediaAcquisitionTransportRequest {
  readonly intent: unknown;
  /** Explicit trusted rendition URI; missing selection is refused, never defaults to variant zero. */
  readonly selectedRenditionUri?: string;
}

/** S4 selected-HLS request: the explicit selection is inside the closed S4 intent, not a slice field. */
export interface S4HlsVodBridgeRequest extends MediaAcquisitionTransportRequest {
  readonly intent: unknown;
}

interface MediaIntentContext {
  readonly requestId: string;
  readonly lineageId: string;
  readonly contractId?: string;
  readonly targetRef: string;
  readonly outputRootScope: string;
  readonly allowedOperation: string;
  readonly digestAnchor?: string;
}

interface HlsExecutionOptions {
  readonly selectedRenditionUri?: string;
  readonly selection?: S4ConfirmedSelection;
  readonly assemblyPort: MediaAssemblyPort;
  readonly artifactExtension: 'bin' | 'ts';
}

/** Observable effect counters returned with every bridge result. */
export interface MediaBridgeCounters {
  readonly manifestRequests: number;
  readonly mediaPlaylistRequests: number;
  readonly segmentRequests: number;
  readonly networkRequests: number;
  readonly fileWrites: number;
  readonly permitRefusals: number;
  readonly protocolRefusals: number;
  readonly operationRefusals: number;
  readonly domainRefusals: number;
}

/** Bounded human-auditable acquisition summary (single effect, single lineage). */
export interface MediaAcquisitionSummary {
  readonly requestId: string;
  readonly lineageId: string;
  readonly targetRef: string;
  readonly outcomeKind: 'COMPLETED' | 'FAILED' | 'BUDGET_STOPPED' | 'UNSUPPORTED';
  readonly chainAccepted: boolean;
  readonly outcomeClass: string;
  readonly stopKind: string;
  readonly segmentsPlanned: number;
  readonly segmentsTransferred: number;
  readonly transferredByteCount: number;
}

/**
 * Bridge result. `admitted: false` refusals happen strictly before any
 * network/filesystem effect (counters prove it). Admitted results always
 * carry a terminal `EffectEnvelope` (A05: only a typed terminal settles the
 * effect) plus validated materialized evidence on success.
 */
export type MediaAcquisitionBridgeResult =
  | {
      readonly admitted: false;
      readonly code: string;
      readonly message: string;
      readonly counters: MediaBridgeCounters;
    }
  | {
      readonly admitted: true;
      readonly envelope: EffectEnvelope;
      readonly summary: MediaAcquisitionSummary;
      readonly evidence: MaterializedEvidence | undefined;
      readonly counters: MediaBridgeCounters;
    };

interface MutableCounters {
  manifestRequests: number;
  mediaPlaylistRequests: number;
  segmentRequests: number;
  fileWrites: number;
  permitRefusals: number;
  protocolRefusals: number;
  operationRefusals: number;
  domainRefusals: number;
}

function snapshotCounters(counters: MutableCounters): MediaBridgeCounters {
  return deepFreeze({
    manifestRequests: counters.manifestRequests,
    mediaPlaylistRequests: counters.mediaPlaylistRequests,
    segmentRequests: counters.segmentRequests,
    networkRequests:
      counters.manifestRequests + counters.mediaPlaylistRequests + counters.segmentRequests,
    fileWrites: counters.fileWrites,
    permitRefusals: counters.permitRefusals,
    protocolRefusals: counters.protocolRefusals,
    operationRefusals: counters.operationRefusals,
    domainRefusals: counters.domainRefusals,
  });
}

function refuseResult(
  counters: MutableCounters,
  code: string,
  message: string,
): MediaAcquisitionBridgeResult {
  return deepFreeze({
    admitted: false as const,
    code,
    message,
    counters: snapshotCounters(counters),
  });
}

type ManifestFetchKind = 'manifest' | 'playlist';

function manifestRefusalCode(
  kind: ManifestFetchKind,
  result: Extract<HlsManifestFetchResult, { readonly ok: false }>,
): string {
  switch (result.reason) {
    case 'UNSUPPORTED':
      return 'MEDIA_ORIGIN_NOT_PERMITTED';
    case 'UNREACHABLE':
      return kind === 'manifest' ? 'MEDIA_MANIFEST_UNAVAILABLE' : 'MEDIA_PLAYLIST_UNAVAILABLE';
    case 'OVERSIZE':
      return kind === 'manifest' ? 'MEDIA_MANIFEST_OVERSIZE' : 'MEDIA_PLAYLIST_OVERSIZE';
    case 'INVALID_MANIFEST':
      return kind === 'manifest' ? 'MEDIA_MANIFEST_MALFORMED' : 'MEDIA_PLAYLIST_MALFORMED';
  }
}

/**
 * Build the canonical failed terminal envelope for an admitted acquisition.
 * Construction is an internal invariant; a normalization failure here is a
 * programmer error and throws instead of faking any result.
 */
function failAdmitted(
  externalRef: string,
  code: string,
  message: string,
  summary: MediaAcquisitionSummary,
  counters: MutableCounters,
): MediaAcquisitionBridgeResult {
  const normalized = normalizeEffectEnvelope({
    phase: 'terminal',
    externalRef,
    outcome: { ok: false, error: { code, message } },
  });
  if (!normalized.ok) {
    throw new Error(
      'bridge invariant violation: failed terminal envelope rejected by the T01 grammar',
    );
  }
  return deepFreeze({
    admitted: true as const,
    envelope: normalized.value,
    summary,
    evidence: undefined,
    counters: snapshotCounters(counters),
  });
}

function boundedCount(
  value: number | undefined,
  fallback: number,
  hardMax: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) return undefined;
  return value;
}

/**
 * Execute one permitted media acquisition end-to-end. Missing/invalid permit,
 * non-HLS protocol declaration, foreign operation or out-of-scope origin
 * refuse with zero network requests and zero filesystem writes.
 */
/**
 * Legacy S3 media adapter. The target registry must provide an explicit
 * rendition URI; there is no implicit first-variant selection.
 */
export async function acquireMediaViaHls(
  request: MediaAcquisitionBridgeRequest,
): Promise<MediaAcquisitionBridgeResult> {
  const intentCheck = validateConfirmedIntent(request.intent);
  if (!intentCheck.ok) {
    const counters = emptyCounters();
    return refuseResult(
      counters,
      'MEDIA_INTENT_MALFORMED',
      `confirmed intent rejected by the no-widening contract: ${intentCheck.diagnostics.map((entry) => entry.code).join(',')}`,
    );
  }
  return executeMediaHls(request, intentCheck.value, {
    selectedRenditionUri: request.selectedRenditionUri,
    assemblyPort: createSyntheticMediaAssemblyPort(),
    artifactExtension: 'bin',
  });
}

/**
 * S4 selected-HLS adapter. It requires a fresh, exact tuple match and uses
 * the real FFmpeg/ffprobe media oracle; missing host tools produce
 * INSUFFICIENT_EVIDENCE and never a successful artifact.
 */
export async function acquireSelectedHlsVod(
  request: S4HlsVodBridgeRequest,
): Promise<MediaAcquisitionBridgeResult> {
  const intentCheck = validateConfirmedS4HlsIntent(request.intent);
  if (!intentCheck.ok) {
    const counters = emptyCounters();
    return refuseResult(
      counters,
      'S4_INTENT_INVALID',
      `S4 confirmed selection refused: ${intentCheck.diagnostics.map((entry) => entry.code).join(',')}`,
    );
  }
  const intent = intentCheck.value;
  if (Date.parse(intent.selection.expiresAt) <= Date.now()) {
    const counters = emptyCounters();
    return refuseResult(counters, 'S4_SELECTION_EXPIRED', 'the confirmed S4 selection has expired');
  }
  if (intent.selection.manifestUri !== request.manifestUri) {
    const counters = emptyCounters();
    return refuseResult(
      counters,
      'S4_SELECTION_TARGET_MISMATCH',
      'selection manifest does not match the trusted Host target',
    );
  }
  return executeMediaHls(request, intent, {
    selectedRenditionUri: intent.selection.renditionUri,
    selection: intent.selection,
    assemblyPort: createFfmpegTsMediaAssemblyPort(),
    artifactExtension: 'ts',
  });
}

function emptyCounters(): MutableCounters {
  return {
    manifestRequests: 0,
    mediaPlaylistRequests: 0,
    segmentRequests: 0,
    fileWrites: 0,
    permitRefusals: 0,
    protocolRefusals: 0,
    operationRefusals: 0,
    domainRefusals: 0,
  };
}

async function executeMediaHls(
  request: MediaAcquisitionTransportRequest,
  intent: MediaIntentContext,
  execution: HlsExecutionOptions,
): Promise<MediaAcquisitionBridgeResult> {
  const counters: MutableCounters = {
    manifestRequests: 0,
    mediaPlaylistRequests: 0,
    segmentRequests: 0,
    fileWrites: 0,
    permitRefusals: 0,
    protocolRefusals: 0,
    operationRefusals: 0,
    domainRefusals: 0,
  };
  const refuse = (code: string, message: string): MediaAcquisitionBridgeResult =>
    refuseResult(counters, code, message);

  if (intent.allowedOperation !== MEDIA_ACQUIRE_OPERATION) {
    counters.operationRefusals += 1;
    return refuse(
      'MEDIA_OPERATION_MISMATCH',
      `media bridge executes only ${MEDIA_ACQUIRE_OPERATION}; intent authorizes '${intent.allowedOperation}'`,
    );
  }
  if (request.protocol !== 'HLS') {
    counters.protocolRefusals += 1;
    return refuse(
      'MEDIA_PROTOCOL_UNSUPPORTED',
      `protocol '${request.protocol}' is outside the declared media support (${MEDIA_SUPPORTED_PROTOCOLS.join(', ')} only)`,
    );
  }
  const permitCheck = validateMediaAcquisitionPermit(request.permit);
  if (!permitCheck.ok) {
    counters.permitRefusals += 1;
    return refuse(
      'MEDIA_PERMIT_REQUIRED',
      `no valid Kernel permit: ${permitCheck.diagnostics.map((entry) => entry.code).join(',')}`,
    );
  }
  const permit: MediaAcquisitionPermit = permitCheck.value;
  if (permit.requestId !== intent.requestId || permit.lineageId !== intent.lineageId) {
    counters.permitRefusals += 1;
    return refuse(
      'MEDIA_PERMIT_REQUIRED',
      'permit does not bind this confirmed intent (requestId/lineageId mismatch)',
    );
  }
  let manifestUrl: URL;
  try {
    manifestUrl = new URL(request.manifestUri);
  } catch {
    counters.domainRefusals += 1;
    return refuse('MEDIA_ORIGIN_NOT_PERMITTED', 'manifest locator is not an absolute URL');
  }
  if (!permit.allowedManifestOrigins.includes(manifestUrl.origin)) {
    counters.domainRefusals += 1;
    return refuse(
      'MEDIA_ORIGIN_NOT_PERMITTED',
      `manifest origin '${manifestUrl.origin}' is outside the Kernel-authorized manifest scope`,
    );
  }

  // ---- Admitted. Real execution is entirely engine-owned from here.
  const manifestMaxBytes = boundedCount(
    request.manifestMaxBytes,
    DEFAULT_MANIFEST_MAX_BYTES,
    HARD_MAX_MANIFEST_BYTES,
  );
  const segmentMaxBytes = boundedCount(
    request.segmentMaxBytes,
    DEFAULT_SEGMENT_MAX_BYTES,
    HARD_MAX_SEGMENT_BYTES,
  );
  const timeoutMs = boundedCount(request.timeoutMs, DEFAULT_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS);
  if (manifestMaxBytes === undefined || segmentMaxBytes === undefined || timeoutMs === undefined) {
    return refuse(
      'MEDIA_INTENT_MALFORMED',
      'transport bounds must be safe integers within engine hard limits',
    );
  }
  const externalRef = `${MEDIA_ACQUIRE_OPERATION}:${intent.requestId}`;
  const preEngineSummary = (code: string, message: string): MediaAcquisitionBridgeResult =>
    failAdmitted(
      externalRef,
      code,
      message,
      summaryOf(intent, { outcomeKind: 'FAILED' }),
      counters,
    );

  const manifestPort = createAuthorizedHlsManifestPort({
    allowedOrigins: permit.allowedManifestOrigins,
    maxBytes: manifestMaxBytes,
    timeoutMs,
    ...(request.fixtureLoopbackHttp === true ? { allowLoopbackHttpFixture: true } : {}),
  });
  const segmentFetcher: AsyncSegmentFetcherPort = createAuthorizedHttpSegmentFetcher({
    allowedOrigins: permit.allowedSegmentOrigins,
    maxBytes: segmentMaxBytes,
    timeoutMs,
    ...(request.fixtureLoopbackHttp === true ? { allowLoopbackHttpFixture: true } : {}),
  });
  const ledger = createTransferLedger(permit.budget);

  const fetchPlaylistResource = async (
    kind: ManifestFetchKind,
    uri: string,
  ): Promise<
    { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: string }
  > => {
    if (kind === 'manifest') {
      counters.manifestRequests += 1;
    } else {
      counters.mediaPlaylistRequests += 1;
    }
    const result = await manifestPort.fetchManifest(uri);
    if (!result.ok) {
      return { ok: false, code: manifestRefusalCode(kind, result) };
    }
    // Engine budget semantics (C28): manifest/media-playlist requests are
    // transfer effects debiting the same single transfer ledger as segments.
    ledger.recordTransfer('MANIFEST_REQUEST', result.byteLength);
    return { ok: true, text: result.text };
  };

  const masterFetch = await fetchPlaylistResource('manifest', request.manifestUri);
  if (!masterFetch.ok) {
    return preEngineSummary(masterFetch.code, 'authorized manifest fetch refused before decoding');
  }
  const master = decodeMasterPlaylist(masterFetch.text, request.manifestUri);
  if (!master.ok) {
    return preEngineSummary('MEDIA_MANIFEST_MALFORMED', 'master playlist failed bounded decoding');
  }
  const selectedUri = execution.selectedRenditionUri;
  if (selectedUri === undefined) {
    return preEngineSummary(
      'MEDIA_RENDITION_REQUIRED',
      'an explicit rendition selection is required; implicit first-variant fallback is forbidden',
    );
  }
  const variants = master.value.variants.filter((variant) => variant.uri === selectedUri);
  if (variants.length !== 1) {
    return preEngineSummary(
      'MEDIA_RENDITION_UNRESOLVED',
      'selected rendition does not correspond to exactly one declared master variant',
    );
  }
  const selected = variants[0]!;
  if (execution.selection !== undefined) {
    const selection = execution.selection;
    const expectedDigest = s4HlsSelectionTupleDigest({
      contractId: intent.contractId!,
      snapshotId: selection.snapshotId,
      memberId: selection.memberId,
      previewId: selection.previewId,
      renditionKey: selection.renditionKey,
      renditionUri: selection.renditionUri,
      manifestUri: selection.manifestUri,
      mediaProfileId: selection.mediaProfileId,
      bandwidth: selected.bandwidth,
      ...(selected.resolution === undefined
        ? {}
        : {
            width: selected.resolution.width,
            height: selected.resolution.height,
          }),
    });
    if (
      selection.manifestUri !== request.manifestUri ||
      selection.renditionUri !== selected.uri ||
      selection.renditionKey !== `rend-${String(selected.index)}` ||
      selection.displayedTupleDigest !== expectedDigest
    ) {
      return preEngineSummary(
        'S4_SELECTION_STALE_OR_MISMATCHED',
        'the confirmed rendition tuple no longer matches the freshly fetched master manifest',
      );
    }
  }
  const targetId = makeLogicalTargetId(intent.targetRef);
  const contractId = makeContractId(intent.contractId ?? `contract-${intent.requestId}`);
  if (!targetId.ok || !contractId.ok) {
    return preEngineSummary('MEDIA_BINDING_REJECTED', 'canonical identity binding refused');
  }
  const manifestLocator = bindLocator(
    { kind: 'direct', uri: request.manifestUri },
    targetId.value,
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: request.manifestUri,
    },
  );
  if (!manifestLocator.ok) {
    return preEngineSummary('MEDIA_BINDING_REJECTED', 'manifest locator binding refused');
  }
  const binding = bindRenditionToTarget({
    logicalTargetId: targetId.value,
    manifestLocator: manifestLocator.value,
    master: master.value,
    selectedVariant: selected,
  });
  if (!binding.ok) {
    return preEngineSummary('MEDIA_BINDING_REJECTED', 'rendition binding refused by the engine');
  }
  const renditionUri = binding.value.renditionLocator.locator.uri;
  const playlistFetch = await fetchPlaylistResource('playlist', renditionUri);
  if (!playlistFetch.ok) {
    return preEngineSummary(playlistFetch.code, 'authorized media playlist fetch refused');
  }
  const mediaPlaylist = decodeMediaPlaylist(playlistFetch.text, renditionUri);
  if (!mediaPlaylist.ok) {
    return preEngineSummary('MEDIA_PLAYLIST_MALFORMED', 'media playlist failed bounded decoding');
  }

  const countedFetcher: AsyncSegmentFetcherPort = Object.freeze({
    fetcherId: segmentFetcher.fetcherId,
    maxResponseBytes: segmentFetcher.maxResponseBytes,
    async fetch(entry: SegmentPlanEntry) {
      counters.segmentRequests += 1;
      return segmentFetcher.fetch(entry);
    },
  });
  const pipeline = await executeHlsVodAcquisitionAsync({
    contractId: contractId.value,
    snapshotId: undefined,
    binding: binding.value,
    master: master.value,
    mediaPlaylist: mediaPlaylist.value,
    mediaPlaylistLocator: binding.value.renditionLocator,
    ledger,
    fetcher: countedFetcher,
    assemblyPort: execution.assemblyPort,
    recordedAt: new Date().toISOString(),
  });
  if (!pipeline.ok) {
    return preEngineSummary(
      'MEDIA_PIPELINE_REJECTED',
      'engine pipeline refused the admitted acquisition',
    );
  }

  const outcome = pipeline.value;
  const summary = summaryOf(intent, { outcomeKind: outcome.kind }, outcome);
  if (
    outcome.kind === 'COMPLETED' &&
    outcome.run !== undefined &&
    outcome.chain?.accepted === true
  ) {
    return await materializeCompleted(
      intent,
      outcome.run,
      summary,
      externalRef,
      counters,
      request,
      execution.artifactExtension,
    );
  }
  if (outcome.kind === 'BUDGET_STOPPED' && outcome.run !== undefined) {
    const stop = outcome.run.stop;
    const code =
      stop.kind === 'GLOBAL_SAFETY_LIMIT' ? 'GLOBAL_SAFETY_LIMIT' : 'TRANSFER_BUDGET_EXHAUSTED';
    const position = stop.kind === 'ALL_SEGMENTS_TRANSFERRED' ? undefined : stop.position;
    return failAdmitted(
      externalRef,
      code,
      `budget exhaustion stopped the acquisition truthfully at segment position ${String(position)}; requested scope was never redefined`,
      summary,
      counters,
    );
  }
  if (outcome.kind === 'UNSUPPORTED') {
    return failAdmitted(
      externalRef,
      'MEDIA_TOPOLOGY_UNSUPPORTED',
      `topology classified unsupported before any transfer: ${outcome.unsupportedReason ?? 'unknown'}`,
      summary,
      counters,
    );
  }
  return failAdmitted(
    externalRef,
    'MEDIA_VALIDATION_FAILED',
    `acquisition stopped: ${summary.stopKind}; a failed or partial transfer is never accepted`,
    summary,
    counters,
  );
}

function summaryOf(
  intent: MediaIntentContext,
  shape: Pick<MediaAcquisitionSummary, 'outcomeKind'>,
  engine?: HlsVodPipelineOutcome,
): MediaAcquisitionSummary {
  return deepFreeze({
    requestId: intent.requestId,
    lineageId: intent.lineageId,
    targetRef: intent.targetRef,
    outcomeKind: shape.outcomeKind,
    chainAccepted: engine?.chain?.accepted === true,
    outcomeClass: engine?.chain?.outcomeClass ?? 'NOT_PERFORMED',
    stopKind: engine?.run?.stop.kind ?? 'NOT_RUN',
    segmentsPlanned: engine?.run?.plan.entries.length ?? 0,
    segmentsTransferred: engine?.run?.transferred.length ?? 0,
    transferredByteCount: (engine?.run?.transferred ?? []).reduce(
      (total, entry) => total + (entry.result.ok ? entry.result.bytes.length : 0),
      0,
    ),
  });
}

/**
 * Digest-backed materialization of a fully accepted acquisition: assembled
 * plan-order segment bytes are verified against the optional confirmed digest
 * anchor, validated through the canonical T01 MaterializedEvidence contract,
 * and then written exactly once inside the authorized output root. The write
 * counter records only a write that actually happened.
 */
async function materializeCompleted(
  intent: MediaIntentContext,
  run: AcquisitionRun,
  summary: MediaAcquisitionSummary,
  externalRef: string,
  counters: MutableCounters,
  request: MediaAcquisitionTransportRequest,
  artifactExtension: 'bin' | 'ts',
): Promise<MediaAcquisitionBridgeResult> {
  const ordered = [...run.transferred].sort(
    (left, right) => left.entry.position - right.entry.position,
  );
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const item of ordered) {
    if (!item.result.ok) {
      return failAdmitted(
        externalRef,
        'MEDIA_VALIDATION_FAILED',
        'accepted outcome without every planned segment is an invariant violation',
        summary,
        counters,
      );
    }
    parts.push(item.result.bytes);
    total += item.result.bytes.length;
  }
  const assembled = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    assembled.set(part, offset);
    offset += part.length;
  }
  const fileSha256 = createHash('sha256').update(assembled).digest('hex');
  if (intent.digestAnchor !== undefined && intent.digestAnchor !== fileSha256) {
    return failAdmitted(
      externalRef,
      'MEDIA_DIGEST_MISMATCH',
      'assembled bytes do not match the confirmed digest anchor; nothing was materialized',
      summary,
      counters,
    );
  }
  const fileName = request.artifactFileName ?? `${intent.requestId}.${artifactExtension}`;
  if (!ARTIFACT_NAME_PATTERN.test(fileName)) {
    return failAdmitted(
      externalRef,
      'MEDIA_ARTIFACT_NAME_MALFORMED',
      'artifact file name must be a bounded single path segment',
      summary,
      counters,
    );
  }
  const artifactPath = join(intent.outputRootScope, fileName);
  const evidence = validateMaterializedEvidence(
    { fileSha256, bytesWritten: total, artifactPath, stopReason: 'COMPLETED' },
    intent.outputRootScope,
  );
  if (!evidence.ok) {
    return failAdmitted(
      externalRef,
      'MEDIA_EVIDENCE_INVALID',
      'materialized evidence refused by the T01 contract',
      summary,
      counters,
    );
  }
  const partialPath = join(
    intent.outputRootScope,
    '.' + fileName + '.' + randomUUID() + '.partial',
  );
  let partialCreated = false;
  let finalCreated = false;
  try {
    await mkdir(intent.outputRootScope, { recursive: true });
    await writeFile(partialPath, assembled, { flag: 'wx', mode: 0o600 });
    partialCreated = true;
    // Hard-link publication is atomic and fails if the destination already
    // exists; unlike rename on POSIX it cannot silently replace a prior file.
    await link(partialPath, artifactPath);
    finalCreated = true;
    await unlink(partialPath);
    partialCreated = false;
  } catch (error) {
    if (partialCreated) await unlink(partialPath).catch(() => undefined);
    if (finalCreated) await unlink(artifactPath).catch(() => undefined);
    return failAdmitted(
      externalRef,
      'MEDIA_MATERIALIZATION_FAILED',
      `atomic artifact publication failed inside the authorized root: ${error instanceof Error ? error.message : 'unknown error'}`,
      summary,
      counters,
    );
  }
  counters.fileWrites += 1;
  const normalized = normalizeEffectEnvelope({
    phase: 'terminal',
    externalRef,
    outcome: {
      ok: true,
      output: {
        artifactPath,
        fileSha256,
        bytesWritten: total,
        stopReason: 'COMPLETED',
        outcomeKind: summary.outcomeKind,
        segmentsTransferred: summary.segmentsTransferred,
        transferredByteCount: summary.transferredByteCount,
      },
    },
  });
  if (!normalized.ok) {
    throw new Error('bridge invariant violation: success envelope rejected by the T01 grammar');
  }
  return deepFreeze({
    admitted: true as const,
    envelope: normalized.value,
    summary,
    evidence: evidence.value,
    counters: snapshotCounters(counters),
  });
}
