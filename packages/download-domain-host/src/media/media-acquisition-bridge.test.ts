/**
 * v0.2 T06 — media C/Host bridge tests (node:test, colocated per T01
 * precedent). Real bounded HLS fixture served by node:http on an ephemeral
 * 127.0.0.1 port; segment bytes follow the engine's synthetic XDS4 fixture
 * pattern (@xdownload/hls-vod-adapter). The fixture server counts every
 * request, so the permit/protocol/domain negatives prove ZERO network
 * effects, not merely zero counted effects.
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
  acquireMediaViaHls,
  type MediaAcquisitionBridgeRequest,
} from './media-acquisition-bridge.ts';

const SEGMENT_DURATIONS = [4, 4, 3.5] as const;
const ROOT = join(tmpdir(), `xd-t06-media-${String(process.pid)}-${String(Date.now())}`);

let server: Server | undefined;
let origin = '';
let hits = new Map<string, number>();
const missingSegments = new Set<string>();

function segmentBytes(durationSeconds: number): Uint8Array {
  return createSyntheticSegmentBytes({ durationSeconds, codecClass: 'xdv1-video' });
}

function masterText(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video",RESOLUTION=1280x720',
    'media-720p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="xdv1-video",RESOLUTION=640x360',
    'media-360p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=600000,CODECS="xdv1-video"',
    'media-live.m3u8',
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

function unclosedPlaylistText(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-TARGETDURATION:4',
    '#EXTINF:4,seg-0',
    'seg-0.ts',
    '',
  ].join('\n');
}

function totalHits(): number {
  let total = 0;
  for (const value of hits.values()) total += value;
  return total;
}

function segmentHits(): number {
  let total = 0;
  for (const [url, value] of hits) {
    if (url.startsWith('/seg-')) total += value;
  }
  return total;
}

before(async () => {
  hits = new Map();
  server = createServer((request, response) => {
    const url = request.url ?? '';
    hits.set(url, (hits.get(url) ?? 0) + 1);
    if (missingSegments.has(url)) {
      response.writeHead(404);
      response.end();
      return;
    }
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
    if (url === '/media-live.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end(unclosedPlaylistText());
      return;
    }
    const segmentMatch = /^\/seg-(\d+)\.ts$/.exec(url);
    if (segmentMatch !== null) {
      const duration = SEGMENT_DURATIONS[Number(segmentMatch[1])];
      if (duration === undefined) {
        response.writeHead(404);
        response.end();
        return;
      }
      const bytes = segmentBytes(duration);
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
});

after(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function budgetFixture(transfer?: { readonly maxBytes: number }): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes: transfer?.maxBytes ?? 16_000_000,
      maxSegments: 16,
      maxRetryTransferRequests: 8,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1000 },
  };
}

function permitFixture(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'media-acquisition-permit',
    permitId: 'permit-media-001',
    operationId: 'media.acquire',
    requestId: 'req-media-001',
    lineageId: 'lineage-media-001',
    allowedManifestOrigins: [origin],
    allowedSegmentOrigins: [origin],
    budget: budgetFixture(),
    ...overrides,
  };
}

function intentFixture(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    requestId: 'req-media-001',
    lineageId: 'lineage-media-001',
    targetRef: 'ref:media-target-001',
    outputRootScope: ROOT,
    allowedOperation: 'media.acquire',
    slice: 'S1',
    caller: { actor: 'media-host-test', sessionRef: 'session-media-001' },
    ...overrides,
  };
}

function bridgeRequest(overrides?: Record<string, unknown>): MediaAcquisitionBridgeRequest {
  return {
    intent: intentFixture(),
    protocol: 'HLS',
    manifestUri: `${origin}/master.m3u8`,
    selectedRenditionUri: `${origin}/media-720p.m3u8`,
    permit: permitFixture(),
    fixtureLoopbackHttp: true,
    ...overrides,
  } as MediaAcquisitionBridgeRequest;
}

describe('media acquisition bridge — permit/protocol/domain negatives (zero network, zero file)', () => {
  it('refuses without a Kernel permit before any request or write', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(bridgeRequest({ permit: undefined }));
    assert.equal(result.admitted, false);
    if (result.admitted) throw new Error('expected refusal');
    assert.equal(result.code, 'MEDIA_PERMIT_REQUIRED');
    assert.equal(result.counters.networkRequests, 0);
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(result.counters.permitRefusals, 1);
    assert.equal(totalHits() - beforeHits, 0);
    assert.equal(existsSync(ROOT), false);
  });

  it('refuses a permit that does not bind the confirmed intent', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(
      bridgeRequest({ permit: permitFixture({ requestId: 'req-media-OTHER' }) }),
    );
    assert.equal(result.admitted, false);
    if (result.admitted) throw new Error('expected refusal');
    assert.equal(result.code, 'MEDIA_PERMIT_REQUIRED');
    assert.equal(result.counters.networkRequests, 0);
    assert.equal(totalHits() - beforeHits, 0);
  });

  it('refuses a non-HLS protocol declaration with zero requests', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(bridgeRequest({ protocol: 'DASH' }));
    assert.equal(result.admitted, false);
    if (result.admitted) throw new Error('expected refusal');
    assert.equal(result.code, 'MEDIA_PROTOCOL_UNSUPPORTED');
    assert.equal(result.counters.protocolRefusals, 1);
    assert.equal(result.counters.networkRequests, 0);
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(totalHits() - beforeHits, 0);
  });

  it('refuses a foreign allowedOperation with zero requests', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(
      bridgeRequest({ intent: intentFixture({ allowedOperation: 'acquisition.acquire' }) }),
    );
    assert.equal(result.admitted, false);
    if (result.admitted) throw new Error('expected refusal');
    assert.equal(result.code, 'MEDIA_OPERATION_MISMATCH');
    assert.equal(result.counters.operationRefusals, 1);
    assert.equal(result.counters.networkRequests, 0);
    assert.equal(totalHits() - beforeHits, 0);
  });

  it('refuses an out-of-scope manifest origin with zero requests', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(
      bridgeRequest({ manifestUri: 'https://cdn.example.com/vod/master.m3u8' }),
    );
    assert.equal(result.admitted, false);
    if (result.admitted) throw new Error('expected refusal');
    assert.equal(result.code, 'MEDIA_ORIGIN_NOT_PERMITTED');
    assert.equal(result.counters.domainRefusals, 1);
    assert.equal(result.counters.networkRequests, 0);
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(totalHits() - beforeHits, 0);
  });
});

describe('media acquisition bridge — real bounded HLS execution through the existing engine', () => {
  it('pulls playlist+segments over real loopback HTTP, accepts, materializes digest-backed evidence', async () => {
    const beforeHits = totalHits();
    const result = await acquireMediaViaHls(bridgeRequest({ artifactFileName: 'media-001.bin' }));
    assert.equal(result.admitted, true);
    if (!result.admitted) throw new Error('expected admitted result');
    assert.equal(result.envelope.phase, 'terminal');
    if (result.envelope.phase !== 'terminal' || !result.envelope.outcome.ok) {
      throw new Error('expected successful terminal envelope');
    }
    const output = result.envelope.outcome.output;
    assert.equal(output.stopReason, 'COMPLETED');

    assert.equal(result.summary.outcomeKind, 'COMPLETED');
    assert.equal(result.summary.chainAccepted, true);
    assert.equal(result.summary.outcomeClass, 'MEDIA_ACCEPTED');
    assert.equal(result.summary.segmentsPlanned, 3);
    assert.equal(result.summary.segmentsTransferred, 3);
    assert.equal(result.counters.manifestRequests, 1);
    assert.equal(result.counters.mediaPlaylistRequests, 1);
    assert.equal(result.counters.segmentRequests, 3);
    assert.equal(result.counters.networkRequests, 5);
    assert.equal(result.counters.fileWrites, 1);

    const evidence = result.evidence;
    assert.ok(evidence);
    const written = readFileSync(evidence.artifactPath);
    assert.equal(createHash('sha256').update(written).digest('hex'), evidence.fileSha256);
    assert.equal(written.length, evidence.bytesWritten);
    assert.equal(output.fileSha256, evidence.fileSha256);
    assert.ok(evidence.artifactPath.startsWith(ROOT));

    const parts = SEGMENT_DURATIONS.map((duration) => segmentBytes(duration));
    const expected = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      expected.set(part, offset);
      offset += part.length;
    }
    assert.ok(written.equals(Buffer.from(expected)));
    assert.equal(hits.get('/master.m3u8'), 1);
    assert.equal(hits.get('/media-720p.m3u8'), 1);
    assert.equal(totalHits() - beforeHits, 5);
  });

  it('terminates honestly when the transfer budget is exhausted before the first segment', async () => {
    const beforeSegmentHits = segmentHits();
    const result = await acquireMediaViaHls(
      bridgeRequest({ permit: permitFixture({ budget: budgetFixture({ maxBytes: 2048 }) }) }),
    );
    assert.equal(result.admitted, true);
    if (!result.admitted) throw new Error('expected admitted result');
    assert.equal(result.envelope.phase, 'terminal');
    if (result.envelope.phase !== 'terminal' || result.envelope.outcome.ok !== false) {
      throw new Error('expected failed terminal envelope');
    }
    assert.equal(result.envelope.outcome.error.code, 'TRANSFER_BUDGET_EXHAUSTED');
    assert.equal(result.summary.outcomeKind, 'BUDGET_STOPPED');
    assert.equal(result.summary.stopKind, 'TRANSFER_BUDGET_EXHAUSTED');
    assert.equal(result.counters.manifestRequests, 1);
    assert.equal(result.counters.mediaPlaylistRequests, 1);
    assert.equal(result.counters.segmentRequests, 0);
    assert.equal(result.counters.networkRequests, 2);
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(result.evidence, undefined);
    assert.equal(segmentHits() - beforeSegmentHits, 0);
    assert.equal(existsSync(join(ROOT, 'req-media-001.bin')), false);
  });

  it('terminates honestly on member failure (missing segment) without materializing', async () => {
    missingSegments.add('/seg-1.ts');
    try {
      const result = await acquireMediaViaHls(
        bridgeRequest({ artifactFileName: 'member-failed.bin' }),
      );
      assert.equal(result.admitted, true);
      if (!result.admitted) throw new Error('expected admitted result');
      assert.equal(result.envelope.phase, 'terminal');
      if (result.envelope.phase !== 'terminal' || result.envelope.outcome.ok !== false) {
        throw new Error('expected failed terminal envelope');
      }
      assert.equal(result.envelope.outcome.error.code, 'MEDIA_VALIDATION_FAILED');
      assert.equal(result.summary.outcomeKind, 'FAILED');
      assert.equal(result.summary.stopKind, 'SEGMENT_FAILURE');
      assert.equal(result.summary.segmentsTransferred, 1);
      assert.equal(result.summary.chainAccepted, false);
      assert.equal(result.counters.segmentRequests, 2);
      assert.equal(result.counters.fileWrites, 0);
      assert.equal(result.evidence, undefined);
      assert.equal(existsSync(join(ROOT, 'member-failed.bin')), false);
    } finally {
      missingSegments.delete('/seg-1.ts');
    }
  });

  it('classifies an unclosed (live) playlist as unsupported without transfer', async () => {
    const beforeSegmentHits = segmentHits();
    const result = await acquireMediaViaHls(
      bridgeRequest({ selectedRenditionUri: `${origin}/media-live.m3u8` }),
    );
    assert.equal(result.admitted, true);
    if (!result.admitted) throw new Error('expected admitted result');
    assert.equal(result.envelope.phase, 'terminal');
    if (result.envelope.phase !== 'terminal' || result.envelope.outcome.ok !== false) {
      throw new Error('expected failed terminal envelope');
    }
    assert.equal(result.envelope.outcome.error.code, 'MEDIA_TOPOLOGY_UNSUPPORTED');
    assert.equal(result.summary.outcomeKind, 'UNSUPPORTED');
    assert.equal(result.summary.chainAccepted, false);
    assert.equal(result.counters.segmentRequests, 0);
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(segmentHits() - beforeSegmentHits, 0);
  });

  it('refuses to materialize when assembled bytes miss the confirmed digest anchor', async () => {
    const result = await acquireMediaViaHls(
      bridgeRequest({ intent: intentFixture({ digestAnchor: 'a'.repeat(64) }) }),
    );
    assert.equal(result.admitted, true);
    if (!result.admitted) throw new Error('expected admitted result');
    assert.equal(result.envelope.phase, 'terminal');
    if (result.envelope.phase !== 'terminal' || result.envelope.outcome.ok !== false) {
      throw new Error('expected failed terminal envelope');
    }
    assert.equal(result.envelope.outcome.error.code, 'MEDIA_DIGEST_MISMATCH');
    assert.equal(result.counters.fileWrites, 0);
    assert.equal(result.evidence, undefined);
    assert.equal(existsSync(join(ROOT, 'req-media-001.bin')), false);
  });
});
