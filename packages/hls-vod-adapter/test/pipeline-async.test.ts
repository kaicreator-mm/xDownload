import { describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeContractId,
  makeLogicalTargetId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  createEvidencelessMediaAssemblyPort,
  createSyntheticMediaAssemblyPort,
  createSyntheticSegmentBytes,
} from '../src/assemble.ts';
import { createTransferLedger } from '../src/budget.ts';
import { preflightSelectedHlsVod } from '../src/selected-preflight.ts';
import { executeHlsVodAcquisitionAsync } from '../src/pipeline-async.ts';
import type { AsyncSegmentFetcherPort } from '../src/http-segment.ts';

const targetId = unwrapOrThrow(makeLogicalTargetId('hls-async-media-001'));
const uri = 'https://media.example.test/master.m3u8';
const locator = unwrapOrThrow(
  bindLocator({ kind: 'direct', uri }, targetId, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: uri,
  }),
);
const masterText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=100000,CODECS="xdv1-video"',
  'v0/index.m3u8',
].join('\n');
const mediaText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:5',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4.0,',
  'part1.ts',
  '#EXTINF:4.0,',
  'part2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

function pipelineData(text = mediaText) {
  const chosen = preflightSelectedHlsVod({
    logicalTargetId: targetId,
    manifestLocator: locator,
    masterText,
    selectedRenditionUri: 'https://media.example.test/v0/index.m3u8',
    mediaText: text,
  });
  if (!chosen.ok) throw new Error('bad fixture selection');
  return chosen.value;
}

function ledger() {
  return createTransferLedger({
    discovery: { domain: 'discovery', maxGeneratedRequests: 0 },
    transfer: {
      domain: 'transfer',
      maxBytes: 256,
      maxSegments: 4,
      maxRetryTransferRequests: 1,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 4 },
  });
}

function port(failSecond = false): AsyncSegmentFetcherPort {
  return {
    fetcherId: 'fixture-async-hls-port',
    maxResponseBytes: 64,
    async fetch(entry) {
      if (failSecond && entry.position === 1) {
        return { ok: false, failure: 'UNREACHABLE' };
      }
      return {
        ok: true,
        bytes: createSyntheticSegmentBytes({
          durationSeconds: entry.durationSeconds,
          codecClass: 'xdv1-video',
        }),
      };
    },
  };
}

function input(assemblyPort = createSyntheticMediaAssemblyPort()) {
  const chosen = pipelineData();
  return {
    contractId: unwrapOrThrow(makeContractId('hls-async-contract-001')),
    snapshotId: undefined,
    binding: chosen.binding,
    master: chosen.master,
    mediaPlaylist: chosen.media,
    mediaPlaylistLocator: chosen.binding.renditionLocator,
    ledger: ledger(),
    fetcher: port(),
    assemblyPort,
    recordedAt: '2026-10-15T00:00:00.000Z',
  };
}

describe('S4 async segment path uses canonical HLS media validation', () => {
  it('executes frozen async segments and validates all four independent layers', async () => {
    const result = await executeHlsVodAcquisitionAsync(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run?.transferred).toHaveLength(2);
    expect(result.value.chain?.accepted).toBe(true);
    expect(result.value.chain?.media.status).toBe('PASSED');
    expect(result.value.chain?.format.status).toBe('PASSED');
  });

  it('never invents Media success from a deliberately evidenceless probe', async () => {
    const result = await executeHlsVodAcquisitionAsync(
      input(createEvidencelessMediaAssemblyPort('no-probe', 'no real media evidence')),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chain?.accepted).toBe(false);
    expect(result.value.chain?.media.status).toBe('NOT_PERFORMED');
  });

  it('records a failed segment and skips an invalid partial assembly', async () => {
    const result = await executeHlsVodAcquisitionAsync({
      ...input(),
      fetcher: port(true),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run?.stop.kind).toBe('SEGMENT_FAILURE');
    expect(result.value.run?.transferred).toHaveLength(1);
    expect(result.value.chain?.accepted).toBe(false);
    expect(result.value.chain?.media.status).toBe('NOT_PERFORMED');
  });

  it('rejects encrypted media topology before calling asynchronous fetch', async () => {
    let invoked = 0;
    const data = input();
    const result = await executeHlsVodAcquisitionAsync({
      ...data,
      mediaPlaylist: {
        ...data.mediaPlaylist,
        keys: [{ index: 0, method: 'AES-128', hasKeyUri: true }],
      },
      fetcher: {
        fetcherId: 'must-not-fetch',
        maxResponseBytes: 64,
        async fetch() {
          invoked += 1;
          return { ok: false, failure: 'FAILED' };
        },
      },
    });
    expect(invoked).toBe(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).not.toBe('COMPLETED');
  });
});
