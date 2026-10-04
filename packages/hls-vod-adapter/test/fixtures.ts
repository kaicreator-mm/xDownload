/**
 * T009 deterministic local fixtures: synthetic HLS playlists, segment bytes,
 * bindings, plans, ledgers and fetcher/probe stubs. No real network, no real
 * CDN, no real DRM content, no filesystem — every fixture is generated.
 */

import {
  bindLocator,
  decodeBudgetProfile,
  makeContractId,
  makeLogicalTargetId,
  type BudgetProfile,
  type ConsumedBudget,
  type ContractId,
  type LogicalTargetId,
  type LocatorBinding,
  type ResourceLocator,
} from '@xdownload/domain-contracts';
import { bindRenditionToTarget, type HlsRenditionBinding } from '../src/bind.ts';
import { decodeMasterPlaylist, decodeMediaPlaylist, type MediaPlaylist } from '../src/playlist.ts';
import {
  planSegmentsFromMediaPlaylist,
  type SegmentPlan,
  type SegmentPlanEntry,
} from '../src/plan.ts';
import type { SegmentFetcherPort, SegmentFetchResult } from '../src/acquire.ts';
import { createTransferLedger, type TransferLedger } from '../src/budget.ts';
import { createSyntheticSegmentBytes } from '../src/assemble.ts';

export const TARGET_ID_RAW = 'target-hls-vod-1';
export const CONTRACT_ID_RAW = 'contract-hls-vod-1';
export const RECORDED_AT = '2026-10-04T00:00:00.000Z';

export const MASTER_URI = 'https://cdn.example.com/vod/master.m3u8';
export const VARIANT_URI = 'https://cdn.example.com/vod/media-720p.m3u8';
export const CDN_MEDIA_PLAYLIST_URI = 'https://edge-cdn.example.net/hls/media-720p.m3u8';

export function targetId(): LogicalTargetId {
  const decoded = makeLogicalTargetId(TARGET_ID_RAW);
  if (!decoded.ok) {
    throw new Error(
      `fixture target id rejected: ${decoded.diagnostics.map((d) => d.code).join(',')}`,
    );
  }
  return decoded.value;
}

export function contractId(): ContractId {
  const decoded = makeContractId(CONTRACT_ID_RAW);
  if (!decoded.ok) {
    throw new Error(
      `fixture contract id rejected: ${decoded.diagnostics.map((d) => d.code).join(',')}`,
    );
  }
  return decoded.value;
}

export function masterManifestText(): string {
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

export function mediaPlaylistText(options?: {
  readonly segmentDurations?: readonly number[];
  readonly closed?: boolean;
  readonly withDiscontinuity?: boolean;
  readonly withMap?: boolean;
  readonly keyMethod?: 'NONE' | 'AES-128' | 'SAMPLE-AES';
  readonly playlistType?: 'VOD' | 'EVENT';
  readonly withByterange?: boolean;
  readonly version?: number;
}): string {
  const durations = options?.segmentDurations ?? [4, 4, 3.5];
  const closed = options?.closed ?? true;
  const lines: string[] = [
    '#EXTM3U',
    `#EXT-X-VERSION:${options?.version ?? 4}`,
    '#EXT-X-TARGETDURATION:4',
  ];
  if (options?.playlistType !== undefined) {
    lines.push(`#EXT-X-PLAYLIST-TYPE:${options.playlistType}`);
  }
  if (options?.keyMethod !== undefined) {
    lines.push(
      options.keyMethod === 'NONE'
        ? '#EXT-X-KEY:METHOD=NONE'
        : '#EXT-X-KEY:METHOD=' + options.keyMethod + ',URI="https://keys.example.com/key1"',
    );
  }
  if (options?.withMap === true) {
    lines.push('#EXT-X-MAP:URI="init.mp4"');
  }
  durations.forEach((duration, index) => {
    lines.push(`#EXTINF:${String(duration)},seg-${String(index)}`);
    if (options?.withByterange === true) {
      lines.push(`#EXT-X-BYTERANGE:${String(1000 + index)}@${String(index * 1000)}`);
    }
    lines.push(`seg-${String(index)}.ts`);
    if (options?.withDiscontinuity === true && index === 0) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
  });
  if (closed) {
    lines.push('#EXT-X-ENDLIST');
  }
  lines.push('');
  return lines.join('\n');
}

export function masterWithMediaRenditionsText(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="audio-en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video"',
    'media-720p.m3u8',
    '',
  ].join('\n');
}

export function decodeMasterFixture(): ReturnType<typeof decodeMasterPlaylist> {
  return decodeMasterPlaylist(masterManifestText(), MASTER_URI);
}

export function decodeMediaFixture(
  options?: Parameters<typeof mediaPlaylistText>[0],
  baseUri: string = VARIANT_URI,
): MediaPlaylist {
  const decoded = decodeMediaPlaylist(mediaPlaylistText(options), baseUri);
  if (!decoded.ok) {
    throw new Error(
      `fixture media playlist rejected: ${decoded.diagnostics.map((d) => d.code).join(',')}`,
    );
  }
  return decoded.value;
}

export function manifestLocatorFixture(): LocatorBinding<LogicalTargetId> {
  const bound = bindLocator({ kind: 'direct', uri: MASTER_URI }, targetId(), {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: MASTER_URI,
  });
  if (!bound.ok) {
    throw new Error('fixture manifest locator rejected');
  }
  return bound.value;
}

export function mediaPlaylistLocatorFixture(
  uri: string = VARIANT_URI,
  origin: string = MASTER_URI,
  kind: ResourceLocator['kind'] = 'direct',
): LocatorBinding<LogicalTargetId> {
  const bound = bindLocator({ kind, uri }, targetId(), {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: origin,
  });
  if (!bound.ok) {
    throw new Error('fixture media playlist locator rejected');
  }
  return bound.value;
}

/** Bind the 720p variant of the fixture master to the fixture logical target. */
export function bindingFixture(): HlsRenditionBinding {
  const master = decodeMasterFixture();
  if (!master.ok) {
    throw new Error('fixture master rejected');
  }
  const bound = bindRenditionToTarget({
    logicalTargetId: targetId(),
    manifestLocator: manifestLocatorFixture(),
    master: master.value,
    selectedVariant: master.value.variants[0]!,
  });
  if (!bound.ok) {
    throw new Error(`fixture binding rejected: ${bound.diagnostics.map((d) => d.code).join(',')}`);
  }
  return bound.value;
}

export function planFixture(options?: Parameters<typeof mediaPlaylistText>[0]): SegmentPlan {
  const planned = planSegmentsFromMediaPlaylist({
    binding: bindingFixture(),
    mediaPlaylist: decodeMediaFixture(options),
    mediaPlaylistLocator: mediaPlaylistLocatorFixture(),
  });
  if (!planned.ok) {
    throw new Error(`fixture plan rejected: ${planned.diagnostics.map((d) => d.code).join(',')}`);
  }
  return planned.value;
}

/** Deterministic recording fetcher: synthetic bytes by default, per-position overrides. */
export function recordingFetcher(
  overrides: Readonly<Record<number, SegmentFetchResult>> = {},
): SegmentFetcherPort & { readonly calls: SegmentPlanEntry[] } {
  const calls: SegmentPlanEntry[] = [];
  return {
    fetcherId: 'recording-fetcher/1',
    calls,
    fetch(entry: SegmentPlanEntry): SegmentFetchResult {
      calls.push(entry);
      const override = overrides[entry.position];
      if (override !== undefined) {
        return override;
      }
      return {
        ok: true,
        bytes: segmentBytesFor(entry),
      };
    },
  };
}

export function failureAt(
  position: number,
  failure: 'MISSING' | 'UNREACHABLE' | 'FAILED',
): SegmentFetchResult {
  return {
    ok: false,
    failure,
    detail: `fixture failure ${failure} at position ${String(position)}`,
  };
}

/** Synthetic segment bytes matching a plan entry's declared duration/byterange. */
export function segmentBytesFor(
  entry: Pick<SegmentPlanEntry, 'durationSeconds' | 'byterange'>,
): Uint8Array {
  return createSyntheticSegmentBytes({
    durationSeconds: entry.durationSeconds,
    codecClass: 'xdv1-video',
    declaredLength: entry.byterange === undefined ? undefined : entry.byterange.length,
  });
}

export function transferProfileFixture(overrides?: {
  readonly maxBytes?: number;
  readonly maxSegments?: number;
  readonly maxRetryTransferRequests?: number;
}): BudgetProfile {
  const decoded = decodeBudgetProfile({
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes: overrides?.maxBytes ?? 1_000_000,
      maxSegments: overrides?.maxSegments ?? 16,
      maxRetryTransferRequests: overrides?.maxRetryTransferRequests ?? 8,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1000 },
  });
  if (!decoded.ok) {
    throw new Error('fixture budget profile rejected');
  }
  return decoded.value;
}

export function consumedFixture(overrides?: {
  readonly discoveryExhaustedAt?: number;
  readonly transferBytes?: number;
  readonly transferSegments?: number;
  readonly retryRequests?: number;
  readonly globalSafetyExhaustedAt?: number;
}): ConsumedBudget {
  return {
    discovery: {
      generatedRequests: overrides?.discoveryExhaustedAt ?? 0,
      navigationActions: 0,
      modelCalls: 0,
    },
    transfer: {
      bytes: overrides?.transferBytes ?? 0,
      segments: overrides?.transferSegments ?? 0,
      activeTransferMs: 0,
      retryTransferRequests: overrides?.retryRequests ?? 0,
    },
    globalSafety: {
      totalGeneratedRequests: overrides?.globalSafetyExhaustedAt ?? 0,
      modelCostUnits: 0,
      activeElapsedMs: 0,
    },
  };
}

export function ledgerFixture(profile?: BudgetProfile, consumed?: ConsumedBudget): TransferLedger {
  return createTransferLedger(profile ?? transferProfileFixture(), consumed);
}
