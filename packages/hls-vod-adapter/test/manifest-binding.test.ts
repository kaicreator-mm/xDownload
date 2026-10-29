/**
 * T009 TEST_MATRIX suite `manifest-rendition-binding-validation` and the
 * playlist `negative_decode_cases`: parse-before-transfer, explicit
 * manifest/rendition binding identity, binding immutability with successor
 * identity, and fail-closed decode of malformed / unknown-tag /
 * unsupported-version / duplicate-identity inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  bindRenditionToTarget,
  decodeMasterPlaylist,
  decodeMediaPlaylist,
  forbidRenditionSubstitution,
} from '../src/index.ts';
import {
  MASTER_URI,
  VARIANT_URI,
  bindingFixture,
  decodeMasterFixture,
  masterManifestText,
  targetId,
  manifestLocatorFixture,
} from './fixtures.ts';

describe('manifest-rendition-binding-validation', () => {
  it('parses and validates master and media playlist before any segment request', () => {
    const master = decodeMasterFixture();
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    expect(master.value.variants).toHaveLength(2);
    expect(master.value.variants[0]?.uri).toBe(VARIANT_URI);
    expect(master.value.kind).toBe('master');
    const media = decodeMediaPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
      VARIANT_URI,
    );
    expect(media.ok).toBe(true);
    if (media.ok) {
      expect(media.value.segments[0]?.uri).toBe('https://cdn.example.com/vod/seg-0.ts');
    }
  });

  it('binds an explicit manifest/rendition identity to the frozen logical target', () => {
    const master = decodeMasterFixture();
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    const bound = bindRenditionToTarget({
      logicalTargetId: targetId(),
      manifestLocator: manifestLocatorFixture(),
      master: master.value,
      selectedVariant: master.value.variants[0]!,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    expect(bound.value.logicalTargetId).toBe(targetId());
    expect(bound.value.renditionId).toBe(VARIANT_URI);
    expect(bound.value.renditionLocator.identity).toBe(targetId());
    expect(bound.value.renditionLocator.provenance.originLocatorUri).toBe(MASTER_URI);
    expect(bound.value.declared.bandwidth).toBe(1500000);
    expect(bound.value.declared.codecs).toEqual(['xdv1-video']);
  });

  it('binding is deeply frozen (immutable after binding)', () => {
    const binding = bindingFixture();
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.renditionLocator)).toBe(true);
    expect(Object.isFrozen(binding.declared)).toBe(true);
  });

  it('rendition substitution after binding requires successor identity, never silent update', () => {
    const binding = bindingFixture();
    const rejected = forbidRenditionSubstitution(
      binding,
      'https://cdn.example.com/vod/media-360p.m3u8',
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.diagnostics[0]?.code).toBe('SNAPSHOT_MUTATION');
    expect(rejected.diagnostics[0]?.invariant).toBe('L2-inv4');
    expect(rejected.diagnostics[0]?.message).toContain('successor logical-target identity');
    const sameIdentity = forbidRenditionSubstitution(binding, binding.renditionId);
    expect(sameIdentity.ok).toBe(true);
  });

  it('a selected variant outside the manifest identity is not admitted for binding', () => {
    const master = decodeMasterFixture();
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    const bound = bindRenditionToTarget({
      logicalTargetId: targetId(),
      manifestLocator: manifestLocatorFixture(),
      master: master.value,
      selectedVariant: {
        index: 99,
        uri: 'https://other.example.com/substitute.m3u8',
        bandwidth: 1,
        codecs: ['xdv1-video'],
      },
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) {
      return;
    }
    expect(bound.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('segment URIs resolve against the media playlist base, descending from its provenance', () => {
    const master = decodeMasterFixture();
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    expect(master.value.variants[1]?.uri).toBe('https://cdn.example.com/vod/media-360p.m3u8');
  });
});

describe('negative_decode_cases: playlist decode', () => {
  const MEDIA_BASE = VARIANT_URI;

  it('malformed-manifest-required-field: missing EXTM3U header', () => {
    const result = decodeMasterPlaylist('#EXT-X-VERSION:4\n', MASTER_URI);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  it('malformed-manifest-required-field: non-text input', () => {
    expect(decodeMasterPlaylist(42, MASTER_URI).ok).toBe(false);
    expect(decodeMasterPlaylist(null, MASTER_URI).ok).toBe(false);
    expect(decodeMediaPlaylist(undefined, MEDIA_BASE).ok).toBe(false);
  });

  it('malformed-manifest-required-field: missing EXT-X-VERSION', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.diagnostics[0]?.path).toContain('EXT-X-VERSION');
    }
  });

  it('malformed-manifest-required-field: EXT-X-STREAM-INF without BANDWIDTH or URI', () => {
    const noBandwidth = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-STREAM-INF:CODECS="xdv1-video"',
      'v.m3u8',
    ].join('\n');
    const noBandwidthResult = decodeMasterPlaylist(noBandwidth, MASTER_URI);
    expect(noBandwidthResult.ok).toBe(false);
    if (!noBandwidthResult.ok) {
      expect(noBandwidthResult.diagnostics.some((d) => d.path.endsWith('BANDWIDTH'))).toBe(true);
    }
    const noUri = ['#EXTM3U', '#EXT-X-VERSION:4', '#EXT-X-STREAM-INF:BANDWIDTH=100'].join('\n');
    const noUriResult = decodeMasterPlaylist(noUri, MASTER_URI);
    expect(noUriResult.ok).toBe(false);
    if (!noUriResult.ok) {
      expect(noUriResult.diagnostics.some((d) => d.message.includes('variant URI line'))).toBe(
        true,
      );
    }
  });

  it('malformed-manifest-required-field: master playlist without variants', () => {
    const result = decodeMasterPlaylist(['#EXTM3U', '#EXT-X-VERSION:4'].join('\n'), MASTER_URI);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.diagnostics[0]?.path).toBe('masterPlaylist.variants');
    }
  });

  it('unknown-playlist-tag-or-enum-value: unknown authoritative EXT-X tag fails closed', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-BOGUS-TAG:1',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('unknown-playlist-tag-or-enum-value: unknown EXT-X-STREAM-INF attribute fails closed', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-STREAM-INF:BANDWIDTH=1,SOME-UNKNOWN-ATTR=7',
      'v.m3u8',
    ].join('\n');
    const result = decodeMasterPlaylist(text, MASTER_URI);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('UNKNOWN_FIELD');
      expect(result.diagnostics[0]?.path).toContain('SOME-UNKNOWN-ATTR');
    }
  });

  it('unknown-playlist-tag-or-enum-value: unknown EXT-X-PLAYLIST-TYPE enum', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-PLAYLIST-TYPE:SOMEDAY',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('unknown-playlist-tag-or-enum-value: unknown EXT-X-KEY KEYMETHOD', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-KEY:METHOD=BEARD-TUNNEL',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('unsupported-playlist-version: version outside the supported set fails closed', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:99',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
    const masterResult = decodeMasterPlaylist(
      masterManifestText().replace('#EXT-X-VERSION:4', '#EXT-X-VERSION:0'),
      MASTER_URI,
    );
    expect(masterResult.ok).toBe(false);
  });

  it('duplicate-segment-identity-with-conflicting-semantics: same segment identity twice', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
    }
  });

  it('duplicate-segment-identity-with-conflicting-semantics: same URI different byterange is a distinct identity, same identity with conflicting semantics is rejected', () => {
    const sameUriDifferentRange = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:100@0',
      'seg-0.ts',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:100@100',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(decodeMediaPlaylist(sameUriDifferentRange, MEDIA_BASE).ok).toBe(true);
    const conflicting = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:100@0',
      'seg-0.ts',
      '#EXTINF:2.0,',
      '#EXT-X-BYTERANGE:100@0',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(conflicting, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
    }
  });

  it('malformed required fields: missing TARGETDURATION, EXTINF without URI, segment over target duration, malformed byterange', () => {
    const noTarget = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(decodeMediaPlaylist(noTarget, MEDIA_BASE).ok).toBe(false);

    const noUri = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const noUriResult = decodeMediaPlaylist(noUri, MEDIA_BASE);
    expect(noUriResult.ok).toBe(false);
    if (!noUriResult.ok) {
      expect(noUriResult.diagnostics.some((d) => d.message.includes('segment URI'))).toBe(true);
    }

    const overTarget = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:9.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const overResult = decodeMediaPlaylist(overTarget, MEDIA_BASE);
    expect(overResult.ok).toBe(false);
    if (!overResult.ok) {
      expect(overResult.diagnostics[0]?.invariant).toBe('RFC8216');
    }

    const badByterange = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:not-a-range',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(decodeMediaPlaylist(badByterange, MEDIA_BASE).ok).toBe(false);
  });

  it('duplicate variant identity in a master playlist is rejected', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-STREAM-INF:BANDWIDTH=1',
      'media-720p.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2',
      'media-720p.m3u8',
    ].join('\n');
    const result = decodeMasterPlaylist(text, MASTER_URI);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
    }
  });

  it('resolves variant URIs against the master base for identity comparison', () => {
    const result = decodeMasterPlaylist(masterManifestText(), MASTER_URI);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.variants.map((variant) => variant.uri)).toEqual([
        VARIANT_URI,
        'https://cdn.example.com/vod/media-360p.m3u8',
      ]);
    }
  });

  it('malformed-manifest-required-field: orphan segment URI line without a preceding EXTINF fails closed (P1-1)', () => {
    const bareUri = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      'seg-orphan.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const bareResult = decodeMediaPlaylist(bareUri, MEDIA_BASE);
    expect(bareResult.ok).toBe(false);
    if (!bareResult.ok) {
      expect(bareResult.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(bareResult.diagnostics[0]?.path).toBe('mediaPlaylist.EXTINF');
      expect(bareResult.diagnostics[0]?.invariant).toBe('RFC8216');
      expect(bareResult.diagnostics[0]?.message).toContain('without a preceding EXTINF');
    }

    // A malformed playlist is never decoded into a losslessly-shorter plan:
    // the second URI line (no EXTINF of its own) must not be silently dropped.
    const consecutiveUris = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4.0,',
      'seg-0.ts',
      'seg-1-orphan.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const consecutiveResult = decodeMediaPlaylist(consecutiveUris, MEDIA_BASE);
    expect(consecutiveResult.ok).toBe(false);
    if (!consecutiveResult.ok) {
      expect(
        consecutiveResult.diagnostics.some(
          (d) => d.code === 'MISSING_REQUIRED_FIELD' && d.message.includes('seg-1-orphan'),
        ),
      ).toBe(true);
    }
  });

  it('malformed-manifest-required-field: orphan variant URI line without a preceding EXT-X-STREAM-INF fails closed (P1-1)', () => {
    const bareUri = ['#EXTM3U', '#EXT-X-VERSION:4', 'media-720p.m3u8'].join('\n');
    const bareResult = decodeMasterPlaylist(bareUri, MASTER_URI);
    expect(bareResult.ok).toBe(false);
    if (!bareResult.ok) {
      expect(bareResult.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(bareResult.diagnostics[0]?.path).toBe('masterPlaylist.EXT-X-STREAM-INF');
      expect(bareResult.diagnostics[0]?.invariant).toBe('RFC8216');
      expect(bareResult.diagnostics[0]?.message).toContain('without a preceding EXT-X-STREAM-INF');
    }

    // Only the second URI line is orphaned; the decode must reject, never shorten.
    const consecutiveUris = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-STREAM-INF:BANDWIDTH=1500000',
      'media-720p.m3u8',
      'media-360p-orphan.m3u8',
    ].join('\n');
    const consecutiveResult = decodeMasterPlaylist(consecutiveUris, MASTER_URI);
    expect(consecutiveResult.ok).toBe(false);
    if (!consecutiveResult.ok) {
      expect(
        consecutiveResult.diagnostics.some((d) => d.message.includes('media-360p-orphan')),
      ).toBe(true);
    }
  });

  it('positive control: well-formed media and master playlists still decode with full segment/variant fidelity (P1-1)', () => {
    const media = decodeMediaPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXTINF:2.0,',
        'seg-1.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      MEDIA_BASE,
    );
    expect(media.ok).toBe(true);
    if (media.ok) {
      expect(media.value.segments).toHaveLength(2);
      expect(media.value.segments[1]?.uri).toBe('https://cdn.example.com/vod/seg-1.ts');
    }
    const master = decodeMasterFixture();
    expect(master.ok).toBe(true);
    if (master.ok) {
      expect(master.value.variants).toHaveLength(2);
    }
  });

  it('malformed-manifest-required-field: conflicting duplicate EXT-X-PLAYLIST-TYPE fails closed (P2-1)', () => {
    const build = (first: string, second: string): string =>
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        `#EXT-X-PLAYLIST-TYPE:${first}`,
        `#EXT-X-PLAYLIST-TYPE:${second}`,
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
    const result = decodeMediaPlaylist(build('VOD', 'EVENT'), MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === 'MALFORMED_REQUIRED_FIELD' &&
            d.path === 'mediaPlaylist.EXT-X-PLAYLIST-TYPE' &&
            d.message.includes('conflicting duplicate'),
        ),
      ).toBe(true);
    }
    // The reverse declaration order (EVENT after VOD) fails closed as well.
    expect(decodeMediaPlaylist(build('EVENT', 'VOD'), MEDIA_BASE).ok).toBe(false);
  });

  it('malformed-manifest-required-field: conflicting duplicate EXT-X-MEDIA-SEQUENCE fails closed (P2-1)', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-MEDIA-SEQUENCE:5',
      '#EXTINF:4.0,',
      'seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = decodeMediaPlaylist(text, MEDIA_BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === 'MALFORMED_REQUIRED_FIELD' &&
            d.path === 'mediaPlaylist.EXT-X-MEDIA-SEQUENCE' &&
            d.message.includes('conflicting duplicate'),
        ),
      ).toBe(true);
    }
  });

  it('malformed-manifest-required-field: malformed EXT-X-PROGRAM-DATE-TIME value fails closed (P2-2)', () => {
    const build = (value: string): string =>
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        `#EXT-X-PROGRAM-DATE-TIME:${value}`,
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
    const notIso = decodeMediaPlaylist(build('yesterday-ish'), MEDIA_BASE);
    expect(notIso.ok).toBe(false);
    if (!notIso.ok) {
      expect(notIso.diagnostics[0]?.code).toBe('MALFORMED_REQUIRED_FIELD');
      expect(notIso.diagnostics[0]?.path).toBe('mediaPlaylist.EXT-X-PROGRAM-DATE-TIME');
      expect(notIso.diagnostics[0]?.invariant).toBe('RFC8216');
    }
    // Structurally ISO-like but not a valid calendar date-time.
    expect(decodeMediaPlaylist(build('2020-13-45T99:00:00Z'), MEDIA_BASE).ok).toBe(false);
    expect(decodeMediaPlaylist(build('2020-02-31T00:00:00Z'), MEDIA_BASE).ok).toBe(false);
    // Missing time zone is malformed per RFC 8216 §4.3.2.6.
    expect(decodeMediaPlaylist(build('2020-02-19T14:54:23'), MEDIA_BASE).ok).toBe(false);
  });

  it('malformed-manifest-required-field: malformed EXT-X-DISCONTINUITY-SEQUENCE value fails closed (P2-2)', () => {
    const build = (value: string): string =>
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        `#EXT-X-DISCONTINUITY-SEQUENCE:${value}`,
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
    const negative = decodeMediaPlaylist(build('-1'), MEDIA_BASE);
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.diagnostics[0]?.code).toBe('MALFORMED_REQUIRED_FIELD');
      expect(negative.diagnostics[0]?.path).toBe('mediaPlaylist.EXT-X-DISCONTINUITY-SEQUENCE');
    }
    expect(decodeMediaPlaylist(build('not-a-number'), MEDIA_BASE).ok).toBe(false);
  });

  it('positive control: well-formed whitelisted-but-ignored tags still decode and stay non-authoritative (P2-2)', () => {
    const result = decodeMediaPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXT-X-DISCONTINUITY-SEQUENCE:2',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-PROGRAM-DATE-TIME:2010-02-19T14:54:23.031+08:00',
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      MEDIA_BASE,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mediaSequence).toBe(7);
      expect(result.value.playlistType).toBe('VOD');
      expect(result.value.segments).toHaveLength(1);
    }
  });
});
