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
  acquireSelectedHlsVod,
  s4HlsSelectionTupleDigest,
  type MediaAcquisitionBridgeRequest,
  type S4HlsVodBridgeRequest,
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
    // V022-A03: the S3 media lane validates the A01B neutral DTO, which pins
    // the slice to S3.
    slice: 'S3',
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

  it('refuses a request outside the pinned media.acquire + S3 lane with zero requests', async () => {
    const beforeHits = totalHits();
    // A foreign operation is refused by the A01B neutral DTO itself
    // (pinned to media.acquire), before the permit, engine or network.
    const wrongOperation = await acquireMediaViaHls(
      bridgeRequest({ intent: intentFixture({ allowedOperation: 'acquisition.acquire' }) }),
    );
    assert.equal(wrongOperation.admitted, false);
    if (wrongOperation.admitted) throw new Error('expected refusal');
    assert.equal(wrongOperation.code, 'MEDIA_INTENT_MALFORMED');
    assert.equal(wrongOperation.counters.networkRequests, 0);
    assert.equal(wrongOperation.counters.fileWrites, 0);

    // A foreign slice is equally refused by the DTO pin (S3 only).
    const wrongSlice = await acquireMediaViaHls(
      bridgeRequest({ intent: intentFixture({ slice: 'S1' }) }),
    );
    assert.equal(wrongSlice.admitted, false);
    if (wrongSlice.admitted) throw new Error('expected refusal');
    assert.equal(wrongSlice.code, 'MEDIA_INTENT_MALFORMED');
    assert.equal(wrongSlice.counters.networkRequests, 0);

    // An unknown (widening) field refuses through the no-widening contract.
    const widened = await acquireMediaViaHls(
      bridgeRequest({ intent: { ...intentFixture(), extra: 'widened' } }),
    );
    assert.equal(widened.admitted, false);
    if (widened.admitted) throw new Error('expected refusal');
    assert.equal(widened.code, 'MEDIA_INTENT_MALFORMED');
    assert.equal(widened.counters.networkRequests, 0);

    assert.equal(totalHits() - beforeHits, 0);
    assert.equal(existsSync(ROOT), false);
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

describe('S4 selected-HLS lane — neutral DTO and fresh-facts tuple digest (V022-A03)', () => {
  const S4_PROFILE = 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1';

  // Known-answer vectors computed with the Domain App/Core
  // `s4HlsSelectionTupleDigest` implementation (byte-identical requirement):
  // the Host re-implementation must reproduce them exactly.
  const VECTOR_WITH_RESOLUTION = {
    input: {
      contractId: 'contract-s4-001',
      snapshotId: 'snap-001',
      memberId: 'member-001',
      previewId: 'preview-001',
      renditionKey: 'rend-1',
      renditionUri: 'https://media.example.com/vod/media-720p.m3u8',
      manifestUri: 'https://media.example.com/vod/master.m3u8',
      mediaProfileId: S4_PROFILE,
      bandwidth: 1500000,
      width: 1280,
      height: 720,
    },
    digest: '4245f8ac85a36366766bfafa969eaed3f5753b2fb11cd42d48c7bee671df2b84',
  };
  const VECTOR_NO_RESOLUTION = {
    input: {
      contractId: 'contract-s4-001',
      snapshotId: 'snap-001',
      memberId: 'member-001',
      previewId: 'preview-001',
      renditionKey: 'rend-2',
      renditionUri: 'https://media.example.com/vod/media-live.m3u8',
      manifestUri: 'https://media.example.com/vod/master.m3u8',
      mediaProfileId: S4_PROFILE,
      bandwidth: 600000,
    },
    digest: '13f3fa8e473914928559ec0f6b0649ba8870161cd4052de9eb4b2f22163c47de',
  };

  it('recomputes the selection tuple digest byte-identically to the App/Core algorithm (known-answer cross-check)', () => {
    assert.equal(
      s4HlsSelectionTupleDigest(VECTOR_WITH_RESOLUTION.input),
      VECTOR_WITH_RESOLUTION.digest,
    );
    assert.equal(
      s4HlsSelectionTupleDigest(VECTOR_NO_RESOLUTION.input),
      VECTOR_NO_RESOLUTION.digest,
    );
  });

  function s4Selection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      confirmedSelectionId: 'sel-001',
      previewId: 'preview-001',
      snapshotId: 'snap-001',
      memberId: 'member-001',
      manifestUri: `${origin}/master.m3u8`,
      mediaProfileId: S4_PROFILE,
      renditionKey: 'rend-0',
      renditionUri: `${origin}/media-720p.m3u8`,
      displayedTupleDigest: s4HlsSelectionTupleDigest({
        contractId: 'contract-s4-001',
        snapshotId: 'snap-001',
        memberId: 'member-001',
        previewId: 'preview-001',
        renditionKey: 'rend-0',
        renditionUri: `${origin}/media-720p.m3u8`,
        manifestUri: `${origin}/master.m3u8`,
        mediaProfileId: S4_PROFILE,
        bandwidth: 1500000,
        width: 1280,
        height: 720,
      }),
      confirmedAt: '2026-11-03T00:00:00Z',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    };
  }

  function s4Request(overrides: Record<string, unknown> = {}): S4HlsVodBridgeRequest {
    return {
      intent: {
        requestId: 'req-s4-001',
        lineageId: 'lineage-s4-001',
        contractId: 'contract-s4-001',
        targetRef: 'ref:s4-target-001',
        outputRootScope: ROOT,
        allowedOperation: 'media.acquire',
        selection: s4Selection(),
        caller: { actor: 's4-host-test', sessionRef: 'session-s4-001' },
      },
      protocol: 'HLS',
      manifestUri: `${origin}/master.m3u8`,
      permit: permitFixture({ requestId: 'req-s4-001', lineageId: 'lineage-s4-001' }),
      fixtureLoopbackHttp: true,
      ...overrides,
    } as unknown as S4HlsVodBridgeRequest;
  }

  it('refuses an S4 request rejected by the neutral A01 DTO before any effect', async () => {
    const beforeHits = totalHits();
    // Expired selection: the DTO freshness grammar refuses before effects.
    const expired = await acquireSelectedHlsVod(
      s4Request({
        intent: {
          requestId: 'req-s4-001',
          lineageId: 'lineage-s4-001',
          contractId: 'contract-s4-001',
          targetRef: 'ref:s4-target-001',
          outputRootScope: ROOT,
          allowedOperation: 'media.acquire',
          selection: s4Selection({
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          caller: { actor: 's4-host-test', sessionRef: 'session-s4-001' },
        },
      }),
    );
    assert.equal(expired.admitted, false);
    if (expired.admitted) throw new Error('expected refusal');
    assert.equal(expired.code, 'S4_INTENT_INVALID');
    assert.equal(expired.counters.networkRequests, 0);
    assert.equal(expired.counters.fileWrites, 0);

    // Foreign operation: the DTO pins media.acquire.
    const wrongOperation = await acquireSelectedHlsVod(
      s4Request({
        intent: {
          requestId: 'req-s4-001',
          lineageId: 'lineage-s4-001',
          contractId: 'contract-s4-001',
          targetRef: 'ref:s4-target-001',
          outputRootScope: ROOT,
          allowedOperation: 'acquisition.acquire',
          selection: s4Selection(),
          caller: { actor: 's4-host-test', sessionRef: 'session-s4-001' },
        },
      }),
    );
    assert.equal(wrongOperation.admitted, false);
    if (wrongOperation.admitted) throw new Error('expected refusal');
    assert.equal(wrongOperation.code, 'S4_INTENT_INVALID');
    assert.equal(wrongOperation.counters.networkRequests, 0);

    assert.equal(totalHits() - beforeHits, 0);
    assert.equal(existsSync(join(ROOT, 'req-s4-001.ts')), false);
  });

  it('refuses a stale selection tuple against the freshly fetched master facts before any segment request', async () => {
    const beforeSegmentHits = segmentHits();
    // The displayed digest belongs to DIFFERENT master facts (tampered after
    // confirmation): the Host recompute from fresh master facts must catch it
    // after the playlist fetches and before any segment transfer.
    const stale = await acquireSelectedHlsVod(
      s4Request({
        intent: {
          requestId: 'req-s4-001',
          lineageId: 'lineage-s4-001',
          contractId: 'contract-s4-001',
          targetRef: 'ref:s4-target-001',
          outputRootScope: ROOT,
          allowedOperation: 'media.acquire',
          selection: s4Selection({ displayedTupleDigest: 'f'.repeat(64) }),
          caller: { actor: 's4-host-test', sessionRef: 'session-s4-001' },
        },
      }),
    );
    assert.equal(stale.admitted, true);
    if (!stale.admitted) throw new Error('expected admitted result');
    assert.equal(stale.envelope.phase, 'terminal');
    if (stale.envelope.phase !== 'terminal' || stale.envelope.outcome.ok !== false) {
      throw new Error('expected failed terminal envelope');
    }
    assert.equal(stale.envelope.outcome.error.code, 'S4_SELECTION_STALE_OR_MISMATCHED');
    assert.equal(stale.counters.segmentRequests, 0);
    assert.equal(stale.counters.fileWrites, 0);
    assert.equal(stale.evidence, undefined);
    assert.equal(segmentHits() - beforeSegmentHits, 0);
    assert.equal(existsSync(join(ROOT, 'req-s4-001.ts')), false);
  });
});
