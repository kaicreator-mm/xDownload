import { describe, expect, it } from 'vitest';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
import { preflightSelectedHlsVod } from '../src/selected-preflight.ts';

const masterUrl = 'https://cdn.example.test/master.m3u8';
const renditionUrl = 'https://cdn.example.test/v360/index.m3u8';
const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",RESOLUTION=640x360',
  'v360/index.m3u8',
].join('\n');
const media = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:5',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4.0,',
  'part-01.ts',
  '#EXTINF:4.0,',
  'part-02.ts',
  '#EXT-X-ENDLIST',
].join('\n');

const logicalTargetId = unwrapOrThrow(makeLogicalTargetId('hls-selected-file-001'));
const manifestLocator = unwrapOrThrow(
  bindLocator({ kind: 'direct', uri: masterUrl }, logicalTargetId, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: masterUrl,
  }),
);

function input() {
  return {
    logicalTargetId,
    manifestLocator,
    masterText: master,
    selectedRenditionUri: renditionUrl,
    mediaText: media,
  };
}

describe('S4 Core-owned frozen HLS preflight composition', () => {
  it('prepares exactly selected rendition and finite canonical segments, without transfer', () => {
    const result = preflightSelectedHlsVod(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.binding.renditionId).toBe(renditionUrl);
    expect(result.value.segmentPlan.entries).toHaveLength(2);
    expect(result.value.segmentPlan.entries.map((x) => x.locator.locator.uri)).toEqual([
      'https://cdn.example.test/v360/part-01.ts',
      'https://cdn.example.test/v360/part-02.ts',
    ]);
  });

  it('cannot substitute a model-proposed rendition missing from master', () => {
    const result = preflightSelectedHlsVod({
      ...input(),
      selectedRenditionUri: 'https://other.example.test/evil.m3u8',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects unclosed/live playlists before any segment acquisition', () => {
    const result = preflightSelectedHlsVod({
      ...input(),
      mediaText: media.replace('#EXT-X-ENDLIST', ''),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects AES-128 encrypted topology rather than treating segments as plain file', () => {
    const result = preflightSelectedHlsVod({
      ...input(),
      mediaText: media.replace(
        '#EXTINF:4.0,',
        '#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n#EXTINF:4.0,',
      ),
    });
    expect(result.ok).toBe(false);
  });

  it('malformed manifest fails before a rendition can be planned', () => {
    const result = preflightSelectedHlsVod({
      ...input(),
      masterText: '#EXTM3U\n#EXT-X-VERSION:3\nunbound.m3u8',
    });
    expect(result.ok).toBe(false);
  });
});
