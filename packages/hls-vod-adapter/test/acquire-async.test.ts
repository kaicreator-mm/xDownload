import { describe, expect, it } from 'vitest';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
import { acquirePlannedSegmentsAsync, resumeAcquisitionAsync } from '../src/acquire-async.ts';
import { createTransferLedger } from '../src/budget.ts';
import { preflightSelectedHlsVod } from '../src/selected-preflight.ts';
import type { AsyncSegmentFetcherPort } from '../src/http-segment.ts';

const target = unwrapOrThrow(makeLogicalTargetId('s4-async-ledger-001'));
const uri = 'https://media.example.test/master.m3u8';
const manifestLocator = unwrapOrThrow(
  bindLocator({ kind: 'direct', uri }, target, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: uri,
  }),
);
const checked = preflightSelectedHlsVod({
  logicalTargetId: target,
  manifestLocator,
  masterText: [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=100000,CODECS="xdv1-video"',
    'v0/index.m3u8',
  ].join('\n'),
  selectedRenditionUri: 'https://media.example.test/v0/index.m3u8',
  mediaText: [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:5',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXTINF:4.0,',
    'one.ts',
    '#EXTINF:4.0,',
    'two.ts',
    '#EXT-X-ENDLIST',
  ].join('\n'),
});
if (!checked.ok) throw new Error('frozen S4 fixture rejected');
const plan = checked.value.segmentPlan;

function ledger(bytes: number) {
  return createTransferLedger({
    discovery: { domain: 'discovery', maxGeneratedRequests: 0 },
    transfer: { domain: 'transfer', maxBytes: bytes, maxSegments: 4, maxRetryTransferRequests: 2 },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 4 },
  });
}

describe('S4 async HLS transfer honors Core budget before real HTTP', () => {
  it('rejects expensive worst-case fetches BEFORE the first HTTP effect', async () => {
    let requests = 0;
    const port: AsyncSegmentFetcherPort = {
      fetcherId: 'test',
      maxResponseBytes: 4,
      async fetch() {
        requests += 1;
        return { ok: true, bytes: new Uint8Array(4) };
      },
    };
    const budget = ledger(3);
    const result = await acquirePlannedSegmentsAsync(plan, budget, port);
    expect(result.stop.kind).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(requests).toBe(0);
    expect(budget.consumed().transfer.bytes).toBe(0);
  });

  it('transfers two frozen segments through the ledger and counts actual bytes', async () => {
    let requests = 0;
    const port: AsyncSegmentFetcherPort = {
      fetcherId: 'test',
      maxResponseBytes: 2,
      async fetch() {
        requests += 1;
        return { ok: true, bytes: Uint8Array.of(1, 2) };
      },
    };
    const budget = ledger(4);
    const result = await acquirePlannedSegmentsAsync(plan, budget, port);
    expect(result.stop.kind).toBe('ALL_SEGMENTS_TRANSFERRED');
    expect(result.transferred).toHaveLength(2);
    expect(requests).toBe(2);
    expect(budget.consumed().transfer.bytes).toBe(4);
    expect(budget.consumed().transfer.segments).toBe(2);
  });

  it('stops after failed transfer, retry reuses frozen plan and inherited budget', async () => {
    let requests = 0;
    const port: AsyncSegmentFetcherPort = {
      fetcherId: 'test',
      maxResponseBytes: 2,
      async fetch() {
        requests += 1;
        return requests === 2
          ? { ok: false, failure: 'UNREACHABLE' }
          : { ok: true, bytes: Uint8Array.of(1, 2) };
      },
    };
    const budget = ledger(4);
    const first = await acquirePlannedSegmentsAsync(plan, budget, port);
    expect(first.stop.kind).toBe('SEGMENT_FAILURE');
    expect(first.transferred).toHaveLength(1);
    const second = await resumeAcquisitionAsync(first, budget, port);
    expect(second.stop.kind).toBe('ALL_SEGMENTS_TRANSFERRED');
    expect(second.transferred).toHaveLength(2);
    expect(requests).toBe(3);
    expect(budget.consumed().transfer.bytes).toBe(4);
    expect(budget.consumed().transfer.retryTransferRequests).toBe(1);
  });

  it('converts throwing port into bounded segment failure, never completion', async () => {
    const result = await acquirePlannedSegmentsAsync(plan, ledger(10), {
      fetcherId: 'throw',
      maxResponseBytes: 2,
      async fetch() {
        throw new Error('network died');
      },
    });
    expect(result.stop.kind).toBe('SEGMENT_FAILURE');
    expect(result.transferred).toHaveLength(0);
  });
});
