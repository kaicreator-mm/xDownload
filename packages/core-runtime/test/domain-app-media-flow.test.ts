/**
 * V022-A04 — S3/S4 media integration scenario maps, re-established under
 * the Core composition root (packages/core-runtime/test/, discovered by
 * `pnpm run ci:verify`).
 *
 * Every runtime here is assembled Core-side from the stable package roots:
 * sealed media/S4 BUILD producers and the domain journeys from
 * `@xdownload/download-domain-app`; the Host durable store, the opaque
 * media targetRef registry and the T06 HLS acquisition bridge from
 * `@xdownload/download-domain-host`; the one K through the SDK public
 * `load`. No mocks, no second engine, no second ledger.
 *
 * Scenario coverage (A02 P1/P2 and Task Pack §4.3, no case reduced):
 *   S3 — positive bounded HLS journey under one K permit with exact fixture
 *        hit accounting; pre-send refusals (foreign operation/slice,
 *        widened intent, incomplete sealed profile) with zero effects;
 *        unknown/locator-shaped targetRef and over-profile declaredBytes
 *        refused before any segment request or file write; digest mismatch
 *        never overwrites the prior completed artifact.
 *   S4 — the closed explicit rendition-selection contract; unknown target
 *        refusal through K/Host; topology refusals (unclosed live playlist,
 *        AES-128, duplicate variants) with hit accounting; the real FFmpeg
 *        VOD materialization (environment-gated: absence of ffmpeg/ffprobe
 *        is NOT_PROVEN, never a silent PASS); the duplicate bridge
 *        registration discipline; the second-standalone-assembly conflict;
 *        the single externally-built K composition of the S4 contribution
 *        with a stubbed bridge pin (the one-K splice shape).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { load } from '@kaicreator/domain-harness-microkernel';
import { createSyntheticSegmentBytes } from '@xdownload/hls-vod-adapter';
import { REFERENCE_TOKEN_PATTERN } from '@xdownload/domain-contracts';
import {
  MEDIA_ACQUIRE_OPERATION,
  MEDIA_BRIDGE_PIN,
  buildS4HlsSingleKComposition,
  sealMediaComposition,
  sealS4HlsComposition,
  s4HlsSelectionTupleDigest,
  submitConfirmedMediaDownload,
  submitConfirmedS4HlsVod,
  validateConfirmedIntent,
  validateConfirmedS4HlsIntent,
  S4_HLS_BRIDGE_PIN,
  S4_HLS_MEDIA_OPERATION,
  S4_HLS_MEDIA_PROFILE,
  acquireS4HlsBridgePin,
  normalizeEffectEnvelope,
  type ConfirmedDownloadIntent,
  type ConfirmedS4HlsIntent,
  type EffectEnvelope,
  type MediaDownloadRuntime,
  type MediaPinCounters,
  type MediaSubmissionOutcome,
  type S4HlsPinCounters,
  type S4HlsRuntime,
} from '@xdownload/download-domain-app';
import {
  FileCasDocStore,
  InMemoryMediaTargetRegistry,
  acquireMediaViaHls,
  acquireSelectedHlsVod,
} from '@xdownload/download-domain-host';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function budgetFixture(maxBytes = 16_000_000): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes,
      maxSegments: 16,
      maxRetryTransferRequests: 8,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1000 },
  };
}

function boundedPermitIdOf(effectId: string): string {
  if (REFERENCE_TOKEN_PATTERN.test(effectId)) return effectId;
  const digest = createHash('sha256').update(effectId).digest('hex').slice(0, 32);
  return `xd-t12-media-${digest}`;
}

function refusalEnvelope(externalRef: string, code: string, message: string): EffectEnvelope {
  return { phase: 'terminal', externalRef, outcome: { ok: false, error: { code, message } } };
}

// ---------------------------------------------------------------------------
// Core-side media runtime assembly (S3): seal → registry → permit pin → load.
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
 * The trusted S3 media pin body (T11 pin pattern + T06 permit derivation),
 * assembled Core-side: kernel permit gate → T01 no-widening re-check →
 * opaque targetRef resolution through the injected Host registry ONLY →
 * permit derivation binding the kernel identity to the seeded registry
 * facts (never wider than either input) → the existing T06 engine. Success
 * binds the K permit identity into the terminal evidence.
 */
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

/** The pin shape the sealed media C module reaches on globalThis. */
interface MediaBridgePin {
  acquireMedia: (payload: Record<string, unknown>, permit: unknown) => Promise<unknown>;
}

function mediaHostGlobals(): { [MEDIA_BRIDGE_PIN]?: MediaBridgePin } {
  return globalThis as unknown as { [MEDIA_BRIDGE_PIN]?: MediaBridgePin };
}

function emptyMediaPinCounters(): MediaPinCounters {
  return {
    acquireMediaCalls: 0,
    permitRefusals: 0,
    intentRefusals: 0,
    operationRefusals: 0,
    registryRefusals: 0,
    completedExecutions: 0,
    failedExecutions: 0,
  };
}

/**
 * Assemble the S3 media runtime Core-side (A04 composition pattern): seal
 * the App media BUILD, seed the Host registry, install the `MEDIA_BRIDGE_PIN`
 * permit-derivation pin BEFORE the SDK public `load`, and load the one K.
 */
async function assembleMediaRuntimeCore(options: {
  readonly storePath: string;
  readonly mediaTargetRefs?: readonly { readonly handle: string; readonly record: unknown }[];
}): Promise<MediaDownloadRuntime> {
  const { built } = sealMediaComposition();
  const store = new FileCasDocStore(options.storePath);
  const registry = new InMemoryMediaTargetRegistry(options.mediaTargetRefs ?? []);
  const pin = emptyMediaPinCounters();
  const bridgePin: MediaBridgePin = {
    acquireMedia: (payload, permit) => executeMediaAcquisition(payload, permit, registry, pin),
  };
  mediaHostGlobals()[MEDIA_BRIDGE_PIN] = bridgePin;
  const app = await load(built, {
    store,
    tenantId: 'tenant:xdownload-v02-t12',
    deploymentIdentity: {
      deployedAppId: 'deploy:xdownload-v02-t12-media',
      tenantId: 'tenant:xdownload-v02-t12',
      appId: built.appId,
    },
    queryAuthority: {
      principal: { actor: 'xdownload-v02-t12-host' },
      authorize: (candidate, target) =>
        Boolean(
          candidate !== null &&
          typeof candidate === 'object' &&
          (candidate as { actor?: string }).actor === 'xdownload-v02-t12-host' &&
          target.tenantId === 'tenant:xdownload-v02-t12',
        ),
    },
  });
  return {
    built,
    app,
    store,
    registry,
    pin,
    stop(): void {
      app.stop();
      if (mediaHostGlobals()[MEDIA_BRIDGE_PIN] === bridgePin) {
        delete mediaHostGlobals()[MEDIA_BRIDGE_PIN];
      }
      store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Core-side S4 runtime assembly: seal → registry → pin → single-owner load.
// ---------------------------------------------------------------------------

function emptyS4PinCounters(): S4HlsPinCounters {
  return {
    acquireCalls: 0,
    permitRefusals: 0,
    intentRefusals: 0,
    registryRefusals: 0,
    completedExecutions: 0,
    failedExecutions: 0,
  };
}

/**
 * The trusted S4 pin body (same discipline as the Core production route):
 * kernel permit gate → closed S4 intent re-validation → opaque targetRef
 * resolution through the Host registry → confirmed-selection/tuple match
 * against the seeded registry facts → permit derivation → the T06
 * `acquireSelectedHlsVod` engine. Success binds the K permit identity into
 * the terminal evidence.
 */
async function executeS4Hls(
  payload: Record<string, unknown>,
  permit: unknown,
  registry: InMemoryMediaTargetRegistry,
  counters: S4HlsPinCounters,
): Promise<EffectEnvelope> {
  counters.acquireCalls += 1;
  const kernelPermit = parseKernelPermit(permit);
  if (kernelPermit === null) {
    counters.permitRefusals += 1;
    return refusalEnvelope(
      'media.acquire:unpermitted',
      'MEDIA_PERMIT_REQUIRED',
      'Kernel effect permit is required',
    );
  }
  const externalRef = kernelPermit.effectId;
  const candidate: Record<string, unknown> = { ...payload };
  delete candidate.effectId;
  // The K's rule projection maps digestAnchor unconditionally; an absent
  // optional anchor rides the internal path as null (dropped here).
  if (candidate['digestAnchor'] === null) delete candidate['digestAnchor'];
  const checked = validateConfirmedS4HlsIntent(candidate);
  if (!checked.ok) {
    counters.intentRefusals += 1;
    return refusalEnvelope(
      externalRef,
      'S4_INTENT_INVALID',
      checked.diagnostics[0]?.message ?? 'S4 intent refused',
    );
  }
  const intent: ConfirmedS4HlsIntent = checked.value;
  const recordCheck = registry.resolve(intent.targetRef);
  if (!recordCheck.ok) {
    counters.registryRefusals += 1;
    return refusalEnvelope(
      externalRef,
      recordCheck.diagnostics[0]?.code ?? 'MEDIA_TARGET_UNKNOWN',
      'opaque targetRef did not resolve',
    );
  }
  const record = recordCheck.value;
  if (
    record.protocol !== 'HLS' ||
    record.manifestUri !== intent.selection.manifestUri ||
    (record.selectedRenditionUri !== undefined &&
      record.selectedRenditionUri !== intent.selection.renditionUri)
  ) {
    counters.registryRefusals += 1;
    return refusalEnvelope(
      externalRef,
      'S4_SELECTION_TARGET_MISMATCH',
      'confirmed selection does not match trusted target registry facts',
    );
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
    if (!normalized.ok) {
      throw new Error('S4 Host permit enrichment rejected the T01 envelope grammar');
    }
    counters.completedExecutions += 1;
    return normalized.value;
  }
  counters.failedExecutions += 1;
  return result.envelope;
}

/**
 * Assemble one S4 runtime Core-side. A second live S4 assembly beside this
 * one is refused by the single-owner registrar (the preserved S4
 * second-standalone-assembly conflict), never displacing this holder.
 */
async function assembleS4RuntimeCore(options: {
  readonly storePath: string;
  readonly mediaTargetRefs?: readonly { readonly handle: string; readonly record: unknown }[];
  readonly tenantId?: string;
}): Promise<S4HlsRuntime> {
  const built = sealS4HlsComposition();
  const store = new FileCasDocStore(options.storePath);
  const registry = new InMemoryMediaTargetRegistry(options.mediaTargetRefs ?? []);
  const pin = emptyS4PinCounters();
  const registration = acquireS4HlsBridgePin({
    acquireS4HlsVod: (payload, permit) => executeS4Hls(payload, permit, registry, pin),
  });
  if (!registration.ok) {
    store.close();
    throw new Error(`S4_BRIDGE_PIN_CONFLICT: ${registration.message}`);
  }
  const tenantId = options.tenantId ?? 'tenant:xdownload-v021-s4';
  let app;
  try {
    app = await load(built, {
      store,
      tenantId,
      deploymentIdentity: {
        deployedAppId: 'deploy:xdownload-v021-s4',
        tenantId,
        appId: built.appId,
      },
      queryAuthority: {
        principal: { actor: 'xdownload-v021-s4-host' },
        authorize: (candidate, target) =>
          Boolean(
            candidate !== null &&
            typeof candidate === 'object' &&
            (candidate as { actor?: string }).actor === 'xdownload-v021-s4-host' &&
            target.tenantId === tenantId,
          ),
      },
    });
  } catch (error) {
    registration.lease.release();
    store.close();
    throw error;
  }
  return {
    built,
    app,
    store,
    registry,
    pin,
    stop(): void {
      app.stop();
      registration.lease.release();
      store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// S3 — bounded hand-crafted HLS fixture (no ffmpeg required).
// ---------------------------------------------------------------------------

const SEGMENT_DURATIONS = [2, 3, 4] as const;

function segmentBytes(durationSeconds: number): Uint8Array {
  return createSyntheticSegmentBytes({ durationSeconds, codecClass: 'xdv1-video' });
}

function assembledBytes(): Uint8Array {
  const parts = SEGMENT_DURATIONS.map((duration) => segmentBytes(duration));
  const expected = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    expected.set(part, offset);
    offset += part.length;
  }
  return expected;
}

let s3Server: Server | undefined;
let s3Origin = '';
const s3Hits = new Map<string, number>();
let s3Root = '';
let s3Runtime: MediaDownloadRuntime | undefined;

function totalS3Hits(): number {
  let total = 0;
  for (const value of s3Hits.values()) total += value;
  return total;
}

function s3MasterText(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video",RESOLUTION=1280x720',
    'media-720p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="xdv1-video",RESOLUTION=640x360',
    'media-360p.m3u8',
    '',
  ].join('\n');
}

function s3MediaPlaylistText(): string {
  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  SEGMENT_DURATIONS.forEach((duration, index) => {
    lines.push(`#EXTINF:${String(duration)},seg-${String(index)}`);
    lines.push(`seg-${String(index)}.ts`);
  });
  lines.push('#EXT-X-ENDLIST');
  lines.push('');
  return lines.join('\n');
}

function mediaIntent(
  requestId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    requestId,
    lineageId: 'lineage-s3-media',
    targetRef: 'ref:media/master',
    outputRootScope: s3Root,
    allowedOperation: 'media.acquire',
    slice: 'S3',
    // The sealed download policy projects the full T01 field set: this
    // composition's intents carry the digest anchor and a declared size
    // (bounded by the sealed 1 MiB application-profile guard).
    digestAnchor: sha256(assembledBytes()),
    declaredBytes: 16_384,
    caller: { actor: 'zcode:xd-a04-builder-agent', sessionRef: 'session:a04-media-test' },
    ...overrides,
  };
}

function assertS3ZeroEffectsSince(
  beforeHits: number,
  beforeAcquires: number,
  beforePermits: number,
): void {
  assert.equal(totalS3Hits() - beforeHits, 0, 'the physical fixture must see zero requests');
  assert.equal(
    s3Runtime!.pin.acquireMediaCalls - beforeAcquires,
    0,
    'the pin must see zero dispatches',
  );
  assert.equal(s3Runtime!.store.permitDocs().length - beforePermits, 0, 'no K permit may exist');
}

describe('S3 — Core media flow (bounded HLS fixture)', () => {
  beforeAll(async () => {
    s3Hits.clear();
    s3Root = mkdtempSync(join(tmpdir(), 'xd-a04-s3-'));
    s3Server = createServer((request, response) => {
      const url = request.url ?? '';
      s3Hits.set(url, (s3Hits.get(url) ?? 0) + 1);
      if (url === '/master.m3u8') {
        response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        response.end(s3MasterText());
        return;
      }
      if (url === '/media-720p.m3u8') {
        response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        response.end(s3MediaPlaylistText());
        return;
      }
      const segmentMatch = /^\/seg-(\d+)\.ts$/.exec(url);
      if (segmentMatch !== null) {
        const bytes = segmentBytes(SEGMENT_DURATIONS[Number(segmentMatch[1])] ?? 0);
        response.writeHead(200, { 'content-length': String(bytes.length) });
        response.end(Buffer.from(bytes));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolveListen) => s3Server!.listen(0, '127.0.0.1', resolveListen));
    const address = s3Server!.address();
    if (address === null || typeof address === 'string') {
      throw new Error('S3 fixture server missing port');
    }
    s3Origin = `http://127.0.0.1:${String(address.port)}`;

    s3Runtime = await assembleMediaRuntimeCore({
      storePath: join(s3Root, 'k-docs.json'),
      mediaTargetRefs: [
        {
          handle: 'ref:media/master',
          record: {
            protocol: 'HLS',
            manifestUri: `${s3Origin}/master.m3u8`,
            selectedRenditionUri: `${s3Origin}/media-720p.m3u8`,
            artifactFileName: 'media-001.bin',
            allowedManifestOrigins: [s3Origin],
            allowedSegmentOrigins: [s3Origin],
            budget: budgetFixture(),
            fixtureLoopbackHttp: true,
          },
        },
      ],
    });
  });

  afterAll(async () => {
    s3Runtime?.stop();
    s3Runtime = undefined;
    rmSync(s3Root, { recursive: true, force: true });
    await new Promise<void>((resolveClose, rejectClose) => {
      if (s3Server === undefined) {
        resolveClose();
        return;
      }
      s3Server.closeAllConnections();
      s3Server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      s3Server = undefined;
    });
  });

  it('pulls manifest→playlist→segments through the engine and materializes digest-backed evidence', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const expected = assembledBytes();

    const outcome: MediaSubmissionOutcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-001', { digestAnchor: sha256(expected) }),
    );
    assert.equal(outcome.status, 'completed');
    if (outcome.status !== 'completed') return;

    // Evidence reproduces the assembled plan-order bytes and the REAL file.
    assert.equal(outcome.evidence.fileSha256, sha256(expected));
    assert.equal(outcome.evidence.bytesWritten, expected.byteLength);
    assert.equal(outcome.evidence.stopReason, 'COMPLETED');
    const onDisk = readFileSync(outcome.evidence.artifactPath);
    assert.equal(sha256(onDisk), sha256(expected));
    assert.equal(outcome.summary.outcomeKind, 'COMPLETED');
    assert.equal(outcome.summary.segmentsTransferred, 3);
    assert.equal(outcome.summary.transferredByteCount, expected.byteLength);
    assert.equal(outcome.confirmed.slice, 'S3');
    assert.equal(outcome.confirmed.allowedOperation, 'media.acquire');

    // Exactly one K-issued permit identity rode the dispatch.
    assert.ok(outcome.permitEffectId.length > 0);
    const permitCount = runtime.store.permitDocs().length;
    assert.equal(permitCount, 1, 'exactly one durable K permit must exist');
    const receipt = outcome.receipt as {
      status?: string;
      admitted?: { effects?: { disposition?: string }[] };
    };
    assert.equal(receipt.status, 'admitted');
    assert.equal(receipt.admitted?.effects?.[0]?.disposition, 'executed');

    // Physical evidence: 1 manifest + 1 media playlist + 3 segments, no more.
    assert.equal(s3Hits.get('/master.m3u8'), 1);
    assert.equal(s3Hits.get('/media-720p.m3u8'), 1);
    assert.equal(totalS3Hits() - beforeHits, 5);
    assert.equal(runtime.pin.acquireMediaCalls, 1);
    assert.equal(runtime.pin.completedExecutions, 1);
    assert.equal(runtime.pin.permitRefusals, 0);
  });

  it('refuses a foreign allowedOperation pre-send with zero effects', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-op', { allowedOperation: 'acquisition.acquire' }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_OPERATION_MISMATCH');
    assertS3ZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses a foreign slice pre-send (the media journey admits S3 only)', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-slice', { slice: 'S1' }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_SLICE_MISMATCH');
    assertS3ZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses a widened intent through the T01 gate with zero effects', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-wide', { manifestUrl: 'https://evil.example/master.m3u8' }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_INTENT_INVALID');
    assert.ok(outcome.message.includes('SCOPE_WIDENING_REFUSED'));
    assertS3ZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses an intent missing the sealed profile fields with zero effects', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-profile', { digestAnchor: undefined }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_PROFILE_BINDING_INCOMPLETE');
    assertS3ZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('fails at the trusted registry for an unknown targetRef before any request', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-ghost', { targetRef: 'ref:media/ghost' }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'CONTRACT_BINDING_MISMATCH');
    assert.equal(outcome.confirmed.targetRef, 'ref:media/ghost');
    assert.equal(
      totalS3Hits() - beforeHits,
      0,
      'an unresolvable target must never touch the network',
    );
    assert.equal(existsSync(join(s3Root, 's3-media-ghost.bin')), false);
  });

  it('fails at the sealed B profile bound when declaredBytes exceeds it (zero effects run)', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-oversize', { declaredBytes: 2_097_152 }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'EFFECT_ENVELOPE_MISSING');
    assert.equal(
      totalS3Hits() - beforeHits,
      0,
      'a profile-refused intent must never reach the engine',
    );
    assert.equal(
      runtime.pin.acquireMediaCalls - beforeAcquires,
      0,
      'no dispatch for a refused intent',
    );
    assert.equal(
      runtime.store.permitDocs().length - beforePermits,
      0,
      'no permit for a refused intent',
    );
  });

  it('refuses to materialize when assembled bytes miss the confirmed anchor (no overwrite)', async () => {
    const runtime = s3Runtime!;
    const beforeHits = totalS3Hits();
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-tamper', { digestAnchor: 'a'.repeat(64) }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'MEDIA_DIGEST_MISMATCH');
    assert.equal(outcome.terminal?.phase, 'terminal');
    assert.equal(
      totalS3Hits() - beforeHits,
      5,
      'the engine ran; the anchor refused materialization',
    );
    // The tampered run must not have written: the artifact is still exactly
    // the earlier completed run's bytes (same sealed artifact file name).
    const untouched = readFileSync(join(s3Root, 'media-001.bin'));
    assert.equal(sha256(untouched), sha256(assembledBytes()));
    assert.equal(runtime.pin.completedExecutions, 1, 'no second completed execution');
  });
});

// ---------------------------------------------------------------------------
// S4 — selected-HLS VOD under K (contract, refusals, conflict, splice, ffmpeg).
// ---------------------------------------------------------------------------

interface S4IntentOptions {
  readonly manifestUri?: string;
  readonly renditionUri?: string;
  readonly targetRef?: string;
  readonly digestAnchor?: string;
}

function s4ConfirmedIntent(
  outputRootScope: string,
  options: S4IntentOptions = {},
): Record<string, unknown> {
  const now = Date.now();
  const tuple = {
    contractId: 'contract-s4-001',
    snapshotId: 'snapshot-s4-001',
    memberId: 'member-s4-001',
    previewId: 'preview-s4-001',
    renditionKey: 'rend-0',
    renditionUri: options.renditionUri ?? 'https://cdn.example.test/vod/720p.m3u8',
    manifestUri: options.manifestUri ?? 'https://cdn.example.test/vod/master.m3u8',
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: 1_500_000,
    width: 1280,
    height: 720,
  };
  return {
    requestId: 'req-s4-001',
    lineageId: 'lineage-s4-001',
    contractId: tuple.contractId,
    targetRef: options.targetRef ?? 'ref:s4-target-missing',
    outputRootScope,
    allowedOperation: S4_HLS_MEDIA_OPERATION,
    selection: {
      confirmedSelectionId: 'confirmed-s4-001',
      previewId: tuple.previewId,
      snapshotId: tuple.snapshotId,
      memberId: tuple.memberId,
      manifestUri: tuple.manifestUri,
      mediaProfileId: tuple.mediaProfileId,
      renditionKey: tuple.renditionKey,
      renditionUri: tuple.renditionUri,
      displayedTupleDigest: s4HlsSelectionTupleDigest(tuple),
      confirmedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 59_000).toISOString(),
    },
    caller: { actor: 'a04-s4-test', sessionRef: 'session-s4-001' },
    ...(options.digestAnchor === undefined ? {} : { digestAnchor: options.digestAnchor }),
  };
}

function s4MasterPlaylist(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
    'media.m3u8',
    '',
  ].join('\n');
}

function ffmpegAvailable(): boolean {
  const probe = spawnSync('ffmpeg', ['-version'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  return probe.status === 0;
}

const HAS_FFMPEG = ffmpegAvailable();

async function createRealHlsFixture(root: string): Promise<{
  readonly mediaPlaylist: string;
  readonly segmentNames: readonly string[];
  readonly segments: readonly Buffer[];
}> {
  const fixtureDir = join(root, 'fixture');
  await mkdir(fixtureDir, { recursive: true });
  const mediaPath = join(fixtureDir, 'media.m3u8');
  const segmentPattern = join(fixtureDir, 'segment%03d.ts');
  const generated = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x90:rate=25:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:sample_rate=48000:duration=4',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'baseline',
      '-level',
      '3.0',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '50',
      '-keyint_min',
      '50',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-force_key_frames',
      'expr:gte(t,n_forced*2)',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      segmentPattern,
      mediaPath,
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  assert.equal(generated.status, 0, `ffmpeg fixture generation failed: ${generated.stderr}`);
  const mediaPlaylist = await readFile(mediaPath, 'utf8');
  const segmentNames = mediaPlaylist
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  assert.ok(
    segmentNames.length >= 2,
    'real S4 fixture must contain at least two independently probed TS segments',
  );
  assert.ok(
    segmentNames.every((name) => basename(name) === name),
    'fixture playlist segment names must be basenames',
  );
  const segments = await Promise.all(segmentNames.map((name) => readFile(join(fixtureDir, name))));
  return { mediaPlaylist, segmentNames, segments };
}

async function runS4RefusalScenario(input: {
  readonly master: string;
  readonly media: string;
  readonly expectedCode: string;
  readonly expectedPlaylistRequests: number;
}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-refusal-'));
  let runtime: S4HlsRuntime | undefined;
  let server: Server | undefined;
  try {
    const outputRoot = resolve(join(root, 'output'));
    await mkdir(outputRoot, { recursive: true });
    const hits = new Map<string, number>();
    const serverInstance = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
      const body =
        pathname === '/master.m3u8'
          ? input.master
          : pathname === '/media.m3u8'
            ? input.media
            : undefined;
      if (body !== undefined) {
        response.writeHead(200, {
          'content-type': 'application/vnd.apple.mpegurl',
          'content-length': String(Buffer.byteLength(body)),
        });
        response.end(body);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server = serverInstance;
    await new Promise<void>((resolveListen, rejectListen) => {
      serverInstance.once('error', rejectListen);
      serverInstance.listen(0, '127.0.0.1', resolveListen);
    });
    const address = serverInstance.address();
    if (address === null || typeof address === 'string') {
      throw new Error('S4 refusal fixture server did not bind a TCP port');
    }
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const manifestUri = origin + '/master.m3u8';
    const renditionUri = origin + '/media.m3u8';
    const targetRef = 'ref:s4-target-negative';
    runtime = await assembleS4RuntimeCore({
      storePath: join(root, 'k-documents.json'),
      mediaTargetRefs: [
        {
          handle: targetRef,
          record: {
            protocol: 'HLS',
            manifestUri,
            selectedRenditionUri: renditionUri,
            artifactFileName: 's4-refusal.ts',
            allowedManifestOrigins: [origin],
            allowedSegmentOrigins: [origin],
            // The engine's conservative pre-HTTP gate admits a segment only
            // when the fetcher's worst-case bound still fits the remaining
            // budget, so the transfer budget must exceed segmentMaxBytes
            // (2 MiB) plus the playlist fetches.
            budget: budgetFixture(8_000_000),
            fixtureLoopbackHttp: true,
          },
        },
      ],
    });
    const intent = s4ConfirmedIntent(outputRoot, { manifestUri, renditionUri, targetRef });
    const selection = intent.selection as Record<string, unknown>;
    selection.displayedTupleDigest = s4HlsSelectionTupleDigest({
      contractId: 'contract-s4-001',
      snapshotId: 'snapshot-s4-001',
      memberId: 'member-s4-001',
      previewId: 'preview-s4-001',
      renditionKey: 'rend-0',
      renditionUri,
      manifestUri,
      mediaProfileId: S4_HLS_MEDIA_PROFILE,
      bandwidth: 500_000,
      width: 160,
      height: 90,
    });

    const result = await submitConfirmedS4HlsVod(runtime, intent);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') throw new Error('expected a typed S4 topology refusal');
    assert.equal(result.code, input.expectedCode);
    assert.equal(runtime.pin.acquireCalls, 1);
    assert.equal(runtime.pin.completedExecutions, 0);
    assert.equal(runtime.pin.failedExecutions, 1);
    assert.equal(hits.get('/master.m3u8'), 1);
    assert.equal(hits.get('/media.m3u8') ?? 0, input.expectedPlaylistRequests);
    assert.equal(hits.get('/segment000.ts') ?? 0, 0);
    assert.equal(hits.get('/key.bin') ?? 0, 0);
    assert.deepEqual(await readdir(outputRoot), []);
  } finally {
    runtime?.stop();
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => {
        server!.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    }
    await rm(root, { recursive: true, force: true });
  }
}

describe('S4 — Core selected-HLS flow', () => {
  it('accepts only the closed explicit rendition-selection contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-contract-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });

      const valid = validateConfirmedS4HlsIntent(s4ConfirmedIntent(outputRoot));
      assert.equal(valid.ok, true);

      const widened = validateConfirmedS4HlsIntent({
        ...s4ConfirmedIntent(outputRoot),
        rawUrl: 'https://cdn.example.test/vod/master.m3u8',
      });
      assert.equal(widened.ok, false);
      if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects future-dated and expired confirmation windows before K send', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-expiry-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      const future = s4ConfirmedIntent(outputRoot);
      const futureSelection = future.selection as Record<string, unknown>;
      futureSelection.confirmedAt = new Date(Date.now() + 1_000).toISOString();
      futureSelection.expiresAt = new Date(Date.now() + 30_000).toISOString();
      assert.equal(validateConfirmedS4HlsIntent(future).ok, false);

      const expired = s4ConfirmedIntent(outputRoot);
      const expiredSelection = expired.selection as Record<string, unknown>;
      expiredSelection.confirmedAt = new Date(Date.now() - 61_000).toISOString();
      expiredSelection.expiresAt = new Date(Date.now() - 1_000).toISOString();
      assert.equal(validateConfirmedS4HlsIntent(expired).ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses unknown S4 targets before media effects through K/Host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-runtime-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });

      const runtime = await assembleS4RuntimeCore({
        storePath: join(root, 'k-documents.json'),
        mediaTargetRefs: [],
      });
      try {
        const result = await submitConfirmedS4HlsVod(runtime, s4ConfirmedIntent(outputRoot));
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed') throw new Error('expected unknown target refusal');
        assert.equal(result.code, 'CONTRACT_BINDING_MISMATCH');
        assert.equal(runtime.pin.acquireCalls, 1);
        assert.equal(runtime.pin.registryRefusals, 1);
        assert.equal(runtime.pin.completedExecutions, 0);
        assert.deepEqual(await readdir(outputRoot), []);
      } finally {
        runtime.stop();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an unclosed live playlist before requesting any segment', async () => {
    await runS4RefusalScenario({
      master: s4MasterPlaylist(),
      media: [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:2.000000,',
        'segment000.ts',
        '',
      ].join('\n'),
      expectedCode: 'MEDIA_TOPOLOGY_UNSUPPORTED',
      expectedPlaylistRequests: 1,
    });
  });

  it('refuses AES-128 protected media without requesting keys or segments', async () => {
    await runS4RefusalScenario({
      master: s4MasterPlaylist(),
      media: [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        '#EXTINF:2.000000,',
        'segment000.ts',
        '#EXTINF:2.000000,',
        'segment001.ts',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
      expectedCode: 'MEDIA_TOPOLOGY_UNSUPPORTED',
      expectedPlaylistRequests: 1,
    });
  });

  it('refuses duplicate variants before fetching a media playlist', async () => {
    const ambiguousMaster = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
      'media.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=600000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
      'media.m3u8',
      '',
    ].join('\n');
    await runS4RefusalScenario({
      master: ambiguousMaster,
      media: '',
      expectedCode: 'MEDIA_MANIFEST_MALFORMED',
      expectedPlaylistRequests: 0,
    });
  });

  it('rejects a duplicate bridge registration without displacing the live holder', () => {
    const first = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error('expected first registration to succeed');

    const second = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => {
        throw new Error('never routed');
      },
    });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error('expected duplicate registration refusal');
    assert.equal(second.code, 'S4_BRIDGE_PIN_CONFLICT');

    // The live holder keeps its authority: the conflicting registration routed nothing.
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], first.lease.bridge);
    first.lease.release();
    first.lease.release();
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], undefined);

    const reacquired = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(reacquired.ok, true);
    if (reacquired.ok) reacquired.lease.release();
  });

  it('refuses a second standalone assembly beside a live runtime instead of displacing its bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-conflict-'));
    let first: S4HlsRuntime | undefined;
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      first = await assembleS4RuntimeCore({
        storePath: join(root, 'k-first.json'),
        mediaTargetRefs: [],
      });

      await assert.rejects(
        assembleS4RuntimeCore({ storePath: join(root, 'k-second.json'), mediaTargetRefs: [] }),
        /S4_BRIDGE_PIN_CONFLICT/,
      );

      // Zero wrong-registry effects from the refused assembly: the live
      // runtime still owns the pin and answers with its own registry refusal.
      const result = await submitConfirmedS4HlsVod(first, s4ConfirmedIntent(outputRoot));
      assert.equal(result.status, 'failed');
      if (result.status !== 'failed') throw new Error('expected unknown target refusal');
      assert.equal(result.code, 'CONTRACT_BINDING_MISMATCH');
      assert.equal(first.pin.acquireCalls, 1);
      assert.equal(first.pin.registryRefusals, 1);
      assert.deepEqual(await readdir(outputRoot), []);
    } finally {
      first?.stop();
      await rm(root, { recursive: true, force: true });
    }

    // After the live runtime is stopped, a new assembly may hold the pin again.
    const secondRoot = await mkdtemp(join(tmpdir(), 'xd-a04-s4-reacquire-'));
    try {
      const second = await assembleS4RuntimeCore({
        storePath: join(secondRoot, 'k-second.json'),
        mediaTargetRefs: [],
      });
      second.stop();
    } finally {
      await rm(secondRoot, { recursive: true, force: true });
    }
  });

  it('composes the S4 contribution into one externally-built single-K app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-single-k-'));
    // The App-owned single-K splice producer (V022-A04): T03 base + the S4
    // contribution in ONE build, externally named; K/S bytes, the frozen
    // route and the declarations stay identical to `sealS4HlsComposition`.
    const built = buildS4HlsSingleKComposition(
      'app:xdownload-a04-single-k-contribution',
      'xdownload-a04-single-k-contribution-v1',
    );

    const store = new FileCasDocStore(join(root, 'single-k-documents.json'));
    const pinCounters = emptyS4PinCounters();
    const registration = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => {
        pinCounters.acquireCalls += 1;
        pinCounters.registryRefusals += 1;
        return {
          phase: 'terminal',
          externalRef: 'media.acquire:unpermitted',
          outcome: {
            ok: false,
            error: { code: 'MEDIA_TARGET_UNKNOWN', message: 'opaque targetRef did not resolve' },
          },
        };
      },
    });
    assert.equal(registration.ok, true);
    if (!registration.ok) throw new Error('expected contribution bridge registration');
    try {
      const app = await load(built, {
        store,
        tenantId: 'tenant:xdownload-a04-single-k',
        deploymentIdentity: {
          deployedAppId: 'deploy:xdownload-a04-single-k',
          tenantId: 'tenant:xdownload-a04-single-k',
          appId: built.appId,
        },
        queryAuthority: {
          principal: { actor: 'xdownload-a04-single-k-host' },
          authorize: (candidate, target) =>
            Boolean(
              candidate !== null &&
              typeof candidate === 'object' &&
              (candidate as { actor?: string }).actor === 'xdownload-a04-single-k-host' &&
              target.tenantId === 'tenant:xdownload-a04-single-k',
            ),
        },
      });
      try {
        assert.equal(typeof (globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], 'object');
        const runtime: S4HlsRuntime = {
          built,
          app,
          store,
          registry: undefined,
          pin: pinCounters,
          stop() {
            app.stop();
          },
        };
        const result = await submitConfirmedS4HlsVod(
          runtime,
          s4ConfirmedIntent(join(root, 'output')),
        );
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed')
          throw new Error('expected typed registry refusal through one K');
        assert.equal(result.code, 'MEDIA_TARGET_UNKNOWN');
        assert.equal(pinCounters.acquireCalls, 1);
      } finally {
        app.stop();
      }
    } finally {
      if (registration.ok) registration.lease.release();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('materializes real HLS VOD through K/Host with FFmpeg integrity checks', async (context) => {
    if (!HAS_FFMPEG) {
      // NOT_PROVEN — the environment lacks ffmpeg/ffprobe; the bounded
      // synthetic refusals above still prove the K/Host path, and the real
      // FFmpeg materialization remains explicitly unproven here (never a
      // silent PASS).
      context.skip();
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'xd-a04-s4-positive-'));
    let runtime: S4HlsRuntime | undefined;
    let server: Server | undefined;
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      const fixture = await createRealHlsFixture(root);
      const expectedBytes = Buffer.concat([...fixture.segments]);
      const digestAnchor = createHash('sha256').update(expectedBytes).digest('hex');

      const hits = new Map<string, number>();
      const serverInstance = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
        const body =
          pathname === '/master.m3u8'
            ? s4MasterPlaylist()
            : pathname === '/media.m3u8'
              ? fixture.mediaPlaylist
              : undefined;
        if (body !== undefined) {
          response.writeHead(200, {
            'content-type': 'application/vnd.apple.mpegurl',
            'content-length': String(Buffer.byteLength(body)),
          });
          response.end(body);
          return;
        }
        const name = pathname.slice(1);
        const segment = fixture.segmentNames.indexOf(name);
        if (segment >= 0) {
          response.writeHead(200, {
            'content-type': 'video/mp2t',
            'content-length': String(fixture.segments[segment]?.length ?? 0),
          });
          response.end(fixture.segments[segment]);
          return;
        }
        response.writeHead(404);
        response.end();
      });
      server = serverInstance;
      await new Promise<void>((resolveListen, rejectListen) => {
        serverInstance.once('error', rejectListen);
        serverInstance.listen(0, '127.0.0.1', resolveListen);
      });
      const address = serverInstance.address();
      if (address === null || typeof address === 'string') {
        throw new Error('S4 fixture server did not bind a TCP port');
      }
      const origin = `http://127.0.0.1:${String(address.port)}`;
      const manifestUri = `${origin}/master.m3u8`;
      const renditionUri = `${origin}/media.m3u8`;

      runtime = await assembleS4RuntimeCore({
        storePath: join(root, 'k-documents.json'),
        mediaTargetRefs: [
          {
            handle: 'ref:s4-target-positive',
            record: {
              protocol: 'HLS',
              manifestUri,
              selectedRenditionUri: renditionUri,
              artifactFileName: 's4-positive.ts',
              allowedManifestOrigins: [origin],
              allowedSegmentOrigins: [origin],
              budget: budgetFixture(8_000_000),
              fixtureLoopbackHttp: true,
            },
          },
        ],
      });
      const intent = s4ConfirmedIntent(outputRoot, {
        manifestUri,
        renditionUri,
        targetRef: 'ref:s4-target-positive',
        digestAnchor,
      });
      const selection = intent.selection as Record<string, unknown>;
      selection.displayedTupleDigest = s4HlsSelectionTupleDigest({
        contractId: 'contract-s4-001',
        snapshotId: 'snapshot-s4-001',
        memberId: 'member-s4-001',
        previewId: 'preview-s4-001',
        renditionKey: 'rend-0',
        renditionUri,
        manifestUri,
        mediaProfileId: S4_HLS_MEDIA_PROFILE,
        bandwidth: 500_000,
        width: 160,
        height: 90,
      });

      const result = await submitConfirmedS4HlsVod(runtime, intent);
      assert.equal(result.status, 'completed');
      if (result.status !== 'completed') return;
      assert.equal(result.evidence?.fileSha256, digestAnchor);
      assert.equal(result.evidence?.bytesWritten, expectedBytes.byteLength);
      assert.equal(result.summary?.segmentsTransferred, fixture.segmentNames.length);
      assert.ok(result.summary?.transferredByteCount);
      const onDisk = readFileSync(join(outputRoot, 's4-positive.ts'));
      assert.equal(sha256(onDisk), digestAnchor);

      // Exactly one master + one media playlist + exactly one fetch per segment.
      assert.equal(hits.get('/master.m3u8'), 1);
      assert.equal(hits.get('/media.m3u8'), 1);
      for (const name of fixture.segmentNames) assert.equal(hits.get(`/${name}`), 1);
      assert.equal(hits.size, fixture.segmentNames.length + 2);
      assert.equal(runtime.pin.acquireCalls, 1);
      assert.equal(runtime.pin.completedExecutions, 1);
      assert.equal(runtime.pin.registryRefusals, 0);
    } finally {
      runtime?.stop();
      if (server !== undefined) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose, rejectClose) => {
          server!.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
        });
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
