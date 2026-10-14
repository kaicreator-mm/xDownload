/**
 * S4 Core-composition preflight for a selected basic HLS VOD rendition.
 *
 * Joins existing T009 parse/bind/topology/segment-plan ports using one frozen
 * manifest locator and an exact user-selected rendition URI. This is a
 * side-effect-free PRE-TRANSFER stage; it has no HTTP/authorization/terminal
 * authority. The Core must supply bytes from a provenance-verified fetcher.
 */
import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import { bindRenditionToTarget, type HlsRenditionBinding } from './bind.ts';
import {
  decodeMasterPlaylist,
  decodeMediaPlaylist,
  type MasterPlaylist,
  type MediaPlaylist,
} from './playlist.ts';
import { planSegmentsFromMediaPlaylist, type SegmentPlan } from './plan.ts';
import { classifyTopology } from './topology.ts';

export interface SelectedHlsPreflightInput {
  readonly logicalTargetId: LogicalTargetId;
  /** Already Core-authorized, frozen selected manifest locator. */
  readonly manifestLocator: LocatorBinding<LogicalTargetId>;
  /** Bytes of the manifest delivered by the authorized manifest fetch port. */
  readonly masterText: string;
  /** Exact selected rendition URI from the displayed confirmed choice. */
  readonly selectedRenditionUri: string;
  /** Bytes delivered by the authorized selected-rendition fetch port. */
  readonly mediaText: string;
}

export interface SelectedHlsPreflight {
  readonly kind: 'selected-hls-vod-preflight';
  readonly master: MasterPlaylist;
  readonly media: MediaPlaylist;
  readonly binding: HlsRenditionBinding;
  readonly segmentPlan: SegmentPlan;
}

/** No transfer occurs until every required identity and topology check passes. */
export function preflightSelectedHlsVod(
  input: SelectedHlsPreflightInput,
): DomainValidationResult<SelectedHlsPreflight> {
  if (input.manifestLocator.identity !== input.logicalTargetId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'manifestLocator.identity',
        'manifest locator must bind the frozen logical target',
      ),
    ]);
  }
  const master = decodeMasterPlaylist(input.masterText, input.manifestLocator.locator.uri);
  if (!master.ok) return master;

  // Choose by an exact URI declared in the manifest, never an ordinal,
  // bandwidth heuristic, untrusted redirect or model-generated substitute.
  const variants = master.value.variants.filter(
    (variant) => variant.uri === input.selectedRenditionUri,
  );
  if (variants.length !== 1) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'selectedRenditionUri',
        'the selected rendition must correspond to exactly one frozen manifest variant',
      ),
    ]);
  }
  const variant = variants[0]!;
  const binding = bindRenditionToTarget({
    logicalTargetId: input.logicalTargetId,
    manifestLocator: input.manifestLocator,
    master: master.value,
    selectedVariant: variant,
  });
  if (!binding.ok) return binding;

  const media = decodeMediaPlaylist(input.mediaText, binding.value.renditionLocator.locator.uri);
  if (!media.ok) return media;

  const topology = classifyTopology(master.value, media.value);
  if (!topology.supported) {
    return fail([
      diagnostic('ADMISSION_REJECTED', 'mediaPlaylist.topology', topology.detail),
    ]);
  }
  // Never follow arbitrary segment URIs here: the T009 planner derives the
  // provenance-bound plan from the single frozen selected rendition.
  const plan = planSegmentsFromMediaPlaylist({
    binding: binding.value,
    mediaPlaylist: media.value,
    mediaPlaylistLocator: binding.value.renditionLocator,
  });
  if (!plan.ok) return plan;

  return ok(
    deepFreeze({
      kind: 'selected-hls-vod-preflight' as const,
      master: master.value,
      media: media.value,
      binding: binding.value,
      segmentPlan: plan.value,
    }),
  );
}
