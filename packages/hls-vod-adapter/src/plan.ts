/**
 * T009 — provenance-bound segment plan.
 *
 * Every segment locator is derived from the bound media playlist locator
 * through canonical provenance transitions (frozen L2 invariant 4); the plan
 * never accepts a locator that does not descend from the selected manifest
 * provenance as the same logical target. The plan is a frozen representation
 * of the bound rendition only — retry/resume operate on it, never on a
 * re-derived scope.
 */

import {
  assertLocatorTransitionPreservesTarget,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import type { HlsRenditionBinding } from './bind.ts';
import type { MediaPlaylist, MediaSegment } from './playlist.ts';

export interface SegmentPlanEntry {
  readonly position: number;
  readonly sequence: number;
  readonly durationSeconds: number;
  /** Canonical segment identity: rendition + playlist position + resolved locator identity. */
  readonly identity: string;
  readonly locator: LocatorBinding<LogicalTargetId>;
  readonly byterange?: { readonly length: number; readonly offset: number };
}

export interface SegmentPlan {
  readonly kind: 'hls-segment-plan';
  readonly binding: HlsRenditionBinding;
  /** Provenance-bound media playlist locator this plan descends from. */
  readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
  readonly entries: readonly SegmentPlanEntry[];
}

function byterangeKey(byterange: SegmentPlanEntry['byterange']): string {
  return byterange === undefined ? '' : `#${byterange.offset}:${byterange.length}`;
}

/**
 * Plan segment acquisition for a bound rendition. The media playlist locator
 * must provenance-descend from the binding's rendition locator (a
 * manifest-to-CDN locator transition is allowed and preserves the logical
 * target; an unrelated locator is rejected). Segment locators are then
 * derived exclusively from that media playlist locator.
 */
export function planSegmentsFromMediaPlaylist(input: {
  readonly binding: HlsRenditionBinding;
  readonly mediaPlaylist: MediaPlaylist;
  readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
}): DomainValidationResult<SegmentPlan> {
  const { binding, mediaPlaylist, mediaPlaylistLocator } = input;
  if (mediaPlaylistLocator.identity !== binding.logicalTargetId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'mediaPlaylistLocator.identity',
        `media playlist locator is bound to identity '${mediaPlaylistLocator.identity}' but the frozen binding targets '${binding.logicalTargetId}'`,
      ),
    ]);
  }
  // The candidate media playlist locator is either the frozen rendition
  // locator instance itself or a provenance-bound transition descending from
  // it; an unrelated locator (origin elsewhere) can never silently become the
  // same target.
  const sameLocatorInstance =
    mediaPlaylistLocator.locator.uri === binding.renditionLocator.locator.uri &&
    mediaPlaylistLocator.provenance.originLocatorUri ===
      binding.renditionLocator.provenance.originLocatorUri;
  let effectiveMediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
  if (sameLocatorInstance) {
    effectiveMediaPlaylistLocator = binding.renditionLocator;
  } else {
    const renditionTransition = assertLocatorTransitionPreservesTarget(
      binding.renditionLocator,
      { kind: 'direct', uri: mediaPlaylistLocator.locator.uri },
      mediaPlaylistLocator.provenance,
    );
    if (!renditionTransition.ok) {
      return renditionTransition;
    }
    effectiveMediaPlaylistLocator = renditionTransition.value;
  }
  const entries: SegmentPlanEntry[] = [];
  for (const segment of mediaPlaylist.segments) {
    const entry = planSegmentEntry(binding, effectiveMediaPlaylistLocator, segment);
    if (!entry.ok) {
      return entry;
    }
    entries.push(entry.value);
  }
  return ok(
    deepFreeze({
      kind: 'hls-segment-plan' as const,
      binding,
      mediaPlaylistLocator: effectiveMediaPlaylistLocator,
      entries: deepFreeze(entries),
    }),
  );
}

function planSegmentEntry(
  binding: HlsRenditionBinding,
  mediaPlaylistLocator: LocatorBinding<LogicalTargetId>,
  segment: MediaSegment,
): DomainValidationResult<SegmentPlanEntry> {
  const locator = assertLocatorTransitionPreservesTarget(
    mediaPlaylistLocator,
    { kind: 'direct', uri: segment.uri },
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: mediaPlaylistLocator.locator.uri,
    },
  );
  if (!locator.ok) {
    return locator;
  }
  return ok(
    deepFreeze({
      position: segment.position,
      sequence: segment.sequence,
      durationSeconds: segment.durationSeconds,
      identity: `${binding.renditionId}#${segment.position}#${segment.uri}${byterangeKey(segment.byterange)}`,
      locator: locator.value,
      byterange: segment.byterange,
    }),
  );
}
