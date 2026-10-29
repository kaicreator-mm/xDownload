/**
 * T009 — supported/unsupported topology classification (fail closed).
 *
 * Frozen PRD S4 / L2 A6: S4 is a basic non-DRM, simple-topology adapter.
 * Unsupported encryption/DRM markers, initialization-section (fMP4 init
 * segment) topology, discontinuity/ad-splice playlists, separate
 * audio/subtitle rendition tracks, EVENT (non-VOD) playlist types and
 * unclosed (live/unbounded) playlists are classified BEFORE any transfer is
 * attempted and must exit as truthful UNSUPPORTED — never silently degrade
 * to a generic byte transfer that would pretend HLS correctness.
 */

import { deepFreeze } from '@xdownload/domain-contracts';
import type { MasterPlaylist, MediaPlaylist } from './playlist.ts';

export type UnsupportedTopologyReason =
  | 'ENCRYPTED_SEGMENTS'
  | 'DRM_MARKER'
  | 'INITIALIZATION_SECTION_TOPOLOGY'
  | 'DISCONTINUITY_AD_SPLICE'
  | 'SEPARATE_RENDITION_TRACKS'
  | 'EVENT_PLAYLIST_TYPE'
  | 'UNCLOSED_PLAYLIST';

export type TopologyClassification =
  | { readonly supported: true }
  | {
      readonly supported: false;
      readonly reason: UnsupportedTopologyReason;
      readonly detail: string;
    };

/** Deterministic classification with a fixed precedence order. */
function classify(classification: TopologyClassification): TopologyClassification {
  return deepFreeze(classification);
}
export function classifyTopology(
  master: MasterPlaylist | undefined,
  media: MediaPlaylist,
): TopologyClassification {
  const aesKey = media.keys.find((key) => key.method === 'AES-128');
  if (aesKey !== undefined) {
    return classify({
      supported: false,
      reason: 'ENCRYPTED_SEGMENTS',
      detail: `segment encryption declared (EXT-X-KEY METHOD=AES-128 at index ${aesKey.index}); basic S4 is non-DRM and never attempts decryption`,
    });
  }
  const sampleAesKey = media.keys.find((key) => key.method === 'SAMPLE-AES');
  if (sampleAesKey !== undefined) {
    return classify({
      supported: false,
      reason: 'DRM_MARKER',
      detail:
        'EXT-X-KEY METHOD=SAMPLE-AES declares a DRM/protected topology; fail closed without bypass',
    });
  }
  if (media.hasInitializationSection) {
    return classify({
      supported: false,
      reason: 'INITIALIZATION_SECTION_TOPOLOGY',
      detail: 'EXT-X-MAP initialization-section topology is outside basic S4',
    });
  }
  if (media.hasDiscontinuity) {
    return classify({
      supported: false,
      reason: 'DISCONTINUITY_AD_SPLICE',
      detail:
        'EXT-X-DISCONTINUITY indicates spliced/ad-mixed content; the basic adapter must not silently stitch it',
    });
  }
  if (master !== undefined && master.mediaRenditionCount > 0) {
    return classify({
      supported: false,
      reason: 'SEPARATE_RENDITION_TRACKS',
      detail: `master declares ${master.mediaRenditionCount} separate media rendition track(s) (EXT-X-MEDIA); separate A/V / subtitle topology requires muxing that basic S4 does not promise`,
    });
  }
  if (media.playlistType === 'EVENT') {
    return classify({
      supported: false,
      reason: 'EVENT_PLAYLIST_TYPE',
      detail: 'EVENT playlist type is not a completed VOD',
    });
  }
  if (!media.closed) {
    return classify({
      supported: false,
      reason: 'UNCLOSED_PLAYLIST',
      detail:
        'media playlist lacks EXT-X-ENDLIST; an unbounded/unterminated playlist cannot be planned as a complete VOD',
    });
  }
  return classify({ supported: true });
}
