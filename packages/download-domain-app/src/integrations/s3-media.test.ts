/**
 * v0.2 T12 — S3 media acquisition journey tests (node:test, colocated).
 *
 * Real end-to-end: the sealed MEDIA composition (T03 K/S bytes at their #183
 * PoC hashes + this lane's media B/C modules) loaded through the SDK public
 * `load`, the pinned T06 media bridge seam, the EXISTING
 * @xdownload/hls-vod-adapter engine, and a REAL bounded HLS fixture served by
 * node:http on an ephemeral 127.0.0.1 port (T06/T11 precedent, zero mocks).
 * The fixture counts every socket request, so every zero-effect negative is
 * proven against the physical server, the pin counters and the durable K
 * store — never against one component's own bookkeeping.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createSyntheticSegmentBytes } from '../../../hls-vod-adapter/src/assemble.ts';
import {
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
} from '../business/composition.ts';
import {
  MEDIA_BUSINESS_MODULE_ID,
  MEDIA_CAPABILITY_MODULE_ID,
  MEDIA_ROUTE,
  assembleMediaRuntime,
  sealMediaComposition,
  submitConfirmedMediaDownload,
  type MediaDownloadRuntime,
  type MediaSubmissionOutcome,
} from './s3-media.ts';

const SEGMENT_DURATIONS = [4, 4, 3.5] as const;
const ROOT = join(tmpdir(), `xd-v02-t12-media-${String(process.pid)}-${String(Date.now())}`);

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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

let server: Server | undefined;
let origin = '';
const hits = new Map<string, number>();
let runtime: MediaDownloadRuntime;

function totalHits(): number {
  let total = 0;
  for (const value of hits.values()) total += value;
  return total;
}

function masterText(): string {
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

function mediaPlaylistText(): string {
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

function budgetFixture(): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes: 16_000_000,
      maxSegments: 16,
      maxRetryTransferRequests: 8,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1000 },
  };
}

function mediaIntent(
  requestId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    requestId,
    lineageId: 'lineage-s3-media',
    targetRef: 'ref:media/master',
    outputRootScope: ROOT,
    allowedOperation: 'media.acquire',
    slice: 'S3',
    // The sealed download policy projects the full T01 field set: this
    // composition's intents carry the digest anchor and a declared size
    // (bounded by the sealed 1 MiB application-profile guard).
    digestAnchor: sha256(assembledBytes()),
    declaredBytes: 16_384,
    caller: { actor: 'zcode:xd-v02-t12-builder-agent', sessionRef: 'session:t12-media-test' },
    ...overrides,
  };
}

function assertZeroEffectsSince(
  beforeHits: number,
  beforeAcquires: number,
  beforePermits: number,
): void {
  assert.equal(totalHits() - beforeHits, 0, 'the physical fixture must see zero requests');
  assert.equal(
    runtime.pin.acquireMediaCalls - beforeAcquires,
    0,
    'the pin must see zero dispatches',
  );
  assert.equal(runtime.store.permitDocs().length - beforePermits, 0, 'no K permit may exist');
}

before(async () => {
  hits.clear();
  server = createServer((request, response) => {
    const url = request.url ?? '';
    hits.set(url, (hits.get(url) ?? 0) + 1);
    if (url === '/master.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end(masterText());
      return;
    }
    if (url === '/media-720p.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end(mediaPlaylistText());
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
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server!.address();
  if (address === null || typeof address === 'string')
    throw new Error('fixture server missing port');
  origin = `http://127.0.0.1:${String(address.port)}`;

  runtime = await assembleMediaRuntime({
    storePath: join(ROOT, 'k-docs.json'),
    mediaTargetRefs: [
      {
        handle: 'ref:media/master',
        record: {
          protocol: 'HLS',
          manifestUri: `${origin}/master.m3u8`,
          selectedRenditionUri: `${origin}/media-720p.m3u8`,
          artifactFileName: 'media-001.bin',
          allowedManifestOrigins: [origin],
          allowedSegmentOrigins: [origin],
          budget: budgetFixture(),
          fixtureLoopbackHttp: true,
        },
      },
    ],
  });
});

after(async () => {
  runtime.stop();
  rmSync(ROOT, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('S3 — sealed media composition identity', () => {
  it('seals the T03 K/S bytes at their #183 PoC hashes with THIS lane as the media B/C', () => {
    const { built, routes } = sealMediaComposition();
    const kernel = built.modules.find((module) => module.role === 'kernel-primary');
    const standard = built.modules.find((module) => module.role === 'standard-primary');
    const business = built.modules.find((module) => module.role === 'business');
    const capability = built.modules.find((module) => module.role === 'capability');
    assert.equal(kernel?.moduleSha256, POC183_KERNEL_MODULE_SHA256);
    assert.equal(standard?.moduleSha256, POC183_STANDARD_MODULE_SHA256);
    assert.equal(business?.packageId, MEDIA_BUSINESS_MODULE_ID);
    assert.equal(capability?.packageId, MEDIA_CAPABILITY_MODULE_ID);
    assert.equal(capability?.externalEffect, true);
    assert.equal(capability?.capabilityId, 'media');
    assert.deepEqual(capability?.handlers, [
      { operationId: 'media.acquire', handler: 'acquireMedia' },
    ]);
    assert.deepEqual(routes, [MEDIA_ROUTE]);
    assert.deepEqual(built.routes, [MEDIA_ROUTE]);
  });
});

describe('S3 — real bounded HLS journey end-to-end under one K permit', () => {
  it('pulls manifest→playlist→segments through the engine and materializes digest-backed evidence', async () => {
    const beforeHits = totalHits();
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
    assert.equal(hits.get('/master.m3u8'), 1);
    assert.equal(hits.get('/media-720p.m3u8'), 1);
    assert.equal(totalHits() - beforeHits, 5);
    assert.equal(runtime.pin.acquireMediaCalls, 1);
    assert.equal(runtime.pin.completedExecutions, 1);
    assert.equal(runtime.pin.permitRefusals, 0);
  });
});

describe('S3 — no-widening and profile refusals before any effect', () => {
  it('refuses a foreign allowedOperation pre-send with zero effects', async () => {
    const beforeHits = totalHits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-op', { allowedOperation: 'acquisition.acquire' }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_OPERATION_MISMATCH');
    assertZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses a foreign slice pre-send (the media journey admits S3 only)', async () => {
    const beforeHits = totalHits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-slice', { slice: 'S1' }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_SLICE_MISMATCH');
    assertZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses a widened intent through the T01 gate with zero effects', async () => {
    const beforeHits = totalHits();
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
    assertZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });

  it('refuses an intent missing the sealed profile fields with zero effects', async () => {
    const beforeHits = totalHits();
    const beforeAcquires = runtime.pin.acquireMediaCalls;
    const beforePermits = runtime.store.permitDocs().length;
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-profile', { digestAnchor: undefined }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEDIA_PROFILE_BINDING_INCOMPLETE');
    assertZeroEffectsSince(beforeHits, beforeAcquires, beforePermits);
  });
});

describe('S3 — admitted dispatches fail truthfully with zero network when unresolvable', () => {
  it('fails at the trusted registry for an unknown targetRef before any request', async () => {
    const beforeHits = totalHits();
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-ghost', { targetRef: 'ref:media/ghost' }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'CONTRACT_BINDING_MISMATCH');
    assert.equal(outcome.confirmed.targetRef, 'ref:media/ghost');
    assert.equal(
      totalHits() - beforeHits,
      0,
      'an unresolvable target must never touch the network',
    );
    assert.equal(existsSync(join(ROOT, 's3-media-ghost.bin')), false);
  });

  it('fails at the sealed B profile bound when declaredBytes exceeds it (zero effects run)', async () => {
    const beforeHits = totalHits();
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
      totalHits() - beforeHits,
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
});

describe('S3 — the digest anchor holds behind the engine acceptance', () => {
  it('refuses to materialize when assembled bytes miss the confirmed anchor', async () => {
    const beforeHits = totalHits();
    const outcome = await submitConfirmedMediaDownload(
      runtime,
      mediaIntent('s3-media-tamper', { digestAnchor: 'a'.repeat(64) }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'MEDIA_DIGEST_MISMATCH');
    assert.equal(outcome.terminal?.phase, 'terminal');
    assert.equal(totalHits() - beforeHits, 5, 'the engine ran; the anchor refused materialization');
    // The tampered run must not have written: the artifact is still exactly
    // the earlier completed run's bytes (same sealed artifact file name).
    const untouched = readFileSync(join(ROOT, 'media-001.bin'));
    assert.equal(sha256(untouched), sha256(assembledBytes()));
    assert.equal(runtime.pin.completedExecutions, 1, 'no second completed execution');
  });
});
