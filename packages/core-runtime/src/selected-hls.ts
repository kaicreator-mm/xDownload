/**
 * One S4 selected-rendition admission path into the EXISTING Core flow.
 *
 * No scheduler, transfer, truth or journal duplication: the preflight checks
 * the frozen selected HLS master/rendition/media facts BEFORE any Core effect.
 * The authorized fetcher and final Media-probe capabilities remain supplied
 * by the already trusted host; this is not a publicly exposed seam command.
 */
import { diagnostic } from '@xdownload/domain-contracts';
import {
  preflightSelectedHlsVod,
  type MediaAssemblyPort,
  type SegmentFetcherPort,
  type SelectedHlsPreflightInput,
} from '@xdownload/hls-vod-adapter';
import {
  CoreRuntimeFlowError,
  executeHlsAcquisition,
  type FlowRuntime,
  type HlsFlowOutcome,
  type LineageSeed,
} from './flow.ts';

export interface SelectedHlsFlowInput {
  readonly seed: LineageSeed;
  readonly commandId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly selection: SelectedHlsPreflightInput;
  readonly fetcher: SegmentFetcherPort;
  readonly assemblyPort: MediaAssemblyPort;
  readonly recordedAt: string;
}

/** Selection and lineage checks MUST precede registerLineage/HTTP/budget. */
export function executeSelectedHlsAcquisition(
  runtime: FlowRuntime,
  input: SelectedHlsFlowInput,
): HlsFlowOutcome {
  if (input.seed.targetId !== input.selection.logicalTargetId) {
    const mismatch = diagnostic(
      'CONTRACT_BINDING_MISMATCH',
      'targetId',
      'S4 frozen manifest target differs from Core lineage target',
    );
    throw new CoreRuntimeFlowError('selected-hls-target', undefined, [mismatch]);
  }
  const preflight = preflightSelectedHlsVod(input.selection);
  if (!preflight.ok) {
    throw new CoreRuntimeFlowError('selected-hls-preflight', undefined, preflight.diagnostics);
  }
  const selected = preflight.value;
  return executeHlsAcquisition(runtime, {
    ...input.seed,
    commandId: input.commandId,
    memberId: input.memberId,
    artifactId: input.artifactId,
    binding: selected.binding,
    master: selected.master,
    mediaPlaylist: selected.media,
    mediaPlaylistLocator: selected.binding.renditionLocator,
    fetcher: input.fetcher,
    assemblyPort: input.assemblyPort,
    recordedAt: input.recordedAt,
  });
}
