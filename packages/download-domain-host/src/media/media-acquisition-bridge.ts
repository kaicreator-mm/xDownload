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
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  type ConfirmedDownloadIntent,
  type EffectEnvelope,
  type MaterializedEvidence,
} from '../../../download-domain-app/src/contracts/index.ts';
import { bindRenditionToTarget } from '../../../hls-vod-adapter/src/bind.ts';
import { createTransferLedger } from '../../../hls-vod-adapter/src/budget.ts';
import { createSyntheticMediaAssemblyPort } from '../../../hls-vod-adapter/src/assemble.ts';
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

/** One confirmed media acquisition request at the Host boundary. */
export interface MediaAcquisitionBridgeRequest {
  /** Confirmed download intent (validated no-widening; operation must be media.acquire). */
  readonly intent: unknown;
  /** Explicit protocol declaration; only 'HLS' is executed. */
  readonly protocol: string;
  /** Trusted-Host-resolved manifest locator for the intent's opaque targetRef. */
  readonly manifestUri: string;
  /** Exact rendition URI declared by the master playlist; defaults to the first variant. */
  readonly selectedRenditionUri?: string;
  /** Bounded artifact file name inside the authorized root (no separators). */
  readonly artifactFileName?: string;
  /** Kernel permit (validated fail-closed; missing/invalid refuses with zero effects). */
  readonly permit: unknown;
  /**
   * Fixture-only loopback HTTP exception forwarded to the engine ports.
   * Production callers MUST leave this false (engine default).
   */
  readonly fixtureLoopbackHttp?: boolean;
  readonly manifestMaxBytes?: number;
  readonly segmentMaxBytes?: number;
  readonly timeoutMs?: number;
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
export async function acquireMediaViaHls(
  request: MediaAcquisitionBridgeRequest,
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

  // ---- Gate chain: every refusal below precedes ANY network/filesystem effect.
  const intentCheck = validateConfirmedIntent(request.intent);
  if (!intentCheck.ok) {
    return refuse(
      'MEDIA_INTENT_MALFORMED',
      `confirmed intent rejected by the no-widening contract: ${intentCheck.diagnostics
        .map((entry) => entry.code)
        .join(',')}`,
    );
  }
  const intent: ConfirmedDownloadIntent = intentCheck.value;
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
  const selected =
    request.selectedRenditionUri === undefined
      ? master.value.variants[0]
      : master.value.variants.find((variant) => variant.uri === request.selectedRenditionUri);
  if (selected === undefined) {
    return preEngineSummary(
      'MEDIA_RENDITION_UNRESOLVED',
      'selected rendition does not correspond to exactly one declared master variant',
    );
  }
  const targetId = makeLogicalTargetId(intent.targetRef);
  const contractId = makeContractId(`contract-${intent.requestId}`);
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
    assemblyPort: createSyntheticMediaAssemblyPort(),
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
    return await materializeCompleted(intent, outcome.run, summary, externalRef, counters, request);
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
  intent: ConfirmedDownloadIntent,
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
  intent: ConfirmedDownloadIntent,
  run: AcquisitionRun,
  summary: MediaAcquisitionSummary,
  externalRef: string,
  counters: MutableCounters,
  request: MediaAcquisitionBridgeRequest,
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
  const fileName = request.artifactFileName ?? `${intent.requestId}.bin`;
  if (!ARTIFACT_NAME_PATTERN.test(fileName)) {
    return failAdmitted(
      externalRef,
      'MEDIA_ARTIFACT_NAME_MALFORMED',
      'artifact file name must be a bounded single path segment',
      summary,
      counters,
    );
  }
  const artifactPath = `${intent.outputRootScope.replace(/[\\/]+$/, '')}/${fileName}`;
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
  try {
    await mkdir(intent.outputRootScope, { recursive: true });
    await writeFile(artifactPath, assembled);
  } catch (error) {
    return failAdmitted(
      externalRef,
      'MEDIA_MATERIALIZATION_FAILED',
      `artifact write failed inside the authorized root: ${error instanceof Error ? error.message : 'unknown error'}`,
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
