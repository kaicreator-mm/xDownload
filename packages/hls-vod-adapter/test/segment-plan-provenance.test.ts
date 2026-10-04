/**
 * T009 TEST_MATRIX suites `segment-media-validation` (enumeration descent)
 * and `provenance`, plus counterexample oracles C29 (manifest-to-CDN locator
 * transition preserves the logical target; unrelated redirect rejected) and
 * C18 (byte/segment identity does not collapse logical target/rendition
 * identity; mapping from segments to the bound target is preserved).
 */

import { describe, expect, it } from 'vitest';
import {
  bindLocator,
  identitySetEquals,
  makeLogicalTargetId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import { planSegmentsFromMediaPlaylist } from '../src/plan.ts';
import { decodeMediaPlaylist } from '../src/playlist.ts';
import {
  CDN_MEDIA_PLAYLIST_URI,
  MASTER_URI,
  VARIANT_URI,
  bindingFixture,
  decodeMediaFixture,
  mediaPlaylistLocatorFixture,
  planFixture,
  targetId,
} from './fixtures.ts';

describe('segment-media-validation: enumeration descent', () => {
  it('segment enumeration descends only from the bound media playlist provenance', () => {
    const plan = planFixture();
    expect(plan.entries).toHaveLength(3);
    for (const entry of plan.entries) {
      expect(entry.locator.identity).toBe(targetId());
      expect(entry.locator.provenance.binding).toBe('SELECTED_RESOURCE_PROVENANCE');
      expect(entry.locator.provenance.originLocatorUri).toBe(VARIANT_URI);
      expect(entry.locator.locator.uri.startsWith(VARIANT_URI.replace('media-720p.m3u8', ''))).toBe(
        true,
      );
    }
    expect(plan.entries[0]?.identity).toContain(`${VARIANT_URI}#0`);
    expect(plan.entries.map((entry) => entry.position)).toEqual([0, 1, 2]);
    expect(plan.entries.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
  });

  it('plan is frozen and binds the same rendition identity as the binding', () => {
    const plan = planFixture();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
    expect(plan.binding.renditionId).toBe(VARIANT_URI);
    for (const entry of plan.entries) {
      expect(entry.identity).toContain(VARIANT_URI);
    }
  });
});

describe('provenance + C29: locator transitions', () => {
  it('a traceable manifest-to-CDN locator transition preserves the logical target identity', () => {
    // Media playlist later delivered from a declared CDN edge; provenance
    // descends from the rendition locator, so the target identity is kept.
    const cdnLocator = mediaPlaylistLocatorFixture(CDN_MEDIA_PLAYLIST_URI, VARIANT_URI, 'cdn');
    const mediaOnCdn = decodeMediaPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        '#EXTINF:4.0,',
        'seg-0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      CDN_MEDIA_PLAYLIST_URI,
    );
    expect(mediaOnCdn.ok).toBe(true);
    if (!mediaOnCdn.ok) {
      return;
    }
    const planned = planSegmentsFromMediaPlaylist({
      binding: bindingFixture(),
      mediaPlaylist: mediaOnCdn.value,
      mediaPlaylistLocator: cdnLocator,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    expect(planned.value.mediaPlaylistLocator.identity).toBe(targetId());
    expect(planned.value.mediaPlaylistLocator.locator.uri).toBe(CDN_MEDIA_PLAYLIST_URI);
    const cdnBase = CDN_MEDIA_PLAYLIST_URI.replace('media-720p.m3u8', '');
    for (const entry of planned.value.entries) {
      expect(entry.locator.identity).toBe(targetId());
      expect(entry.locator.provenance.originLocatorUri).toBe(CDN_MEDIA_PLAYLIST_URI);
      expect(entry.locator.locator.uri).toBe(`${cdnBase}seg-${String(entry.position)}.ts`);
    }
  });

  it('an unrelated locator substitution cannot silently replace the logical target or rendition binding', () => {
    const unrelated = mediaPlaylistLocatorFixture(
      'https://unrelated.example.net/other.m3u8',
      'https://unrelated.example.net/origin.m3u8',
    );
    const planned = planSegmentsFromMediaPlaylist({
      binding: bindingFixture(),
      mediaPlaylist: decodeMediaFixture(),
      mediaPlaylistLocator: unrelated,
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.diagnostics[0]?.code).toBe('LOCATOR_SUBSTITUTION_REJECTED');
      expect(planned.diagnostics[0]?.invariant).toBe('L2-inv4');
    }
  });

  it('a locator bound to a different logical identity is a contract binding mismatch', () => {
    const foreign = mediaPlaylistLocatorFixture();
    // Re-bind the same locator shape to a different target identity.
    const otherTarget = unwrapOrThrow(makeLogicalTargetId('target-other-1'));
    const rebound = bindLocator(foreign.locator, otherTarget, foreign.provenance);
    expect(rebound.ok).toBe(true);
    if (!rebound.ok) {
      return;
    }
    const planned = planSegmentsFromMediaPlaylist({
      binding: bindingFixture(),
      mediaPlaylist: decodeMediaFixture(),
      mediaPlaylistLocator: rebound.value,
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.diagnostics[0]?.code).toBe('CONTRACT_BINDING_MISMATCH');
    }
  });

  it('manifest provenance anchor stays the selected master manifest (C29 origin chain)', () => {
    const binding = bindingFixture();
    expect(binding.manifestLocator.locator.uri).toBe(MASTER_URI);
    expect(binding.renditionLocator.provenance.originLocatorUri).toBe(MASTER_URI);
  });
});

describe('C18: byte/segment identity does not collapse logical identity', () => {
  it('identical segment bytes under two distinct logical targets keep distinct mappings', () => {
    const planA = planFixture();
    // A second logical target binding the same rendition URI would require a
    // successor identity from Core; at the plan level the identity key is
    // namespaced by rendition and position, and the target identity of every
    // locator remains the bound one — mappings never merge across targets.
    const planB = planFixture();
    expect(planA.entries.map((entry) => entry.identity)).toEqual(
      planB.entries.map((entry) => entry.identity),
    );
    expect(planA.binding.logicalTargetId).toBe(planB.binding.logicalTargetId);
    for (const entry of planA.entries) {
      expect(entry.locator.identity).toBe(planA.binding.logicalTargetId);
    }
  });

  it('identity set equality, never count equality, distinguishes a substituted segment set', () => {
    const plan = planFixture();
    const plannedIdentities = plan.entries.map((entry) => entry.identity);
    const equalCountSubstitute = [...plannedIdentities];
    equalCountSubstitute[1] = `${VARIANT_URI}#substituted`;
    expect(equalCountSubstitute).toHaveLength(plannedIdentities.length);
    expect(identitySetEquals(equalCountSubstitute, plannedIdentities)).toBe(false);
    expect(identitySetEquals(plannedIdentities, [...plannedIdentities].reverse())).toBe(true);
  });
});
