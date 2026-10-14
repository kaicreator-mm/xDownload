/**
 * One S4 selected-rendition admission path into the EXISTING Core flow.
 *
 * No scheduler, transfer, truth or journal duplication: the preflight checks
 * the frozen selected HLS master/rendition/media facts BEFORE any Core effect.
 * The authorized fetcher and final Media-probe capabilities remain supplied
 * by the already trusted host; this is not a publicly exposed seam command.
 */
import {
  diagnostic,
  makeContractId,
  makeSnapshotId,
  unwrapOrThrow,
  type SnapshotId,
} from '@xdownload/domain-contracts';
import {
  preflightSelectedHlsVod,
  executeHlsVodAcquisitionAsync,
  type AsyncSegmentFetcherPort,
  type MediaAssemblyPort,
  type SegmentFetcherPort,
  type SelectedHlsPreflightInput,
} from '@xdownload/hls-vod-adapter';
import {
  CoreRuntimeFlowError,
  beginHlsAcquisition,
  executeHlsAcquisition,
  finishHlsAcquisition,
  type FlowRuntime,
  type HlsFlowOutcome,
  type LineageSeed,
} from './flow.ts';

import { schedulerHlsTransferLedger } from './budget-bridge.ts';

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

/**
 * Selected HLS + Core's ONE durable async transfer path.
 * Selection preflight precedes lineage journal and effect budget; the
 * first async segment is fetched only AFTER the Core attempt is committed.
 * Reopen/replayed attempt returns durable truth without a second network call.
 */
export type AsyncSelectedHlsFlowInput = Omit<SelectedHlsFlowInput, 'fetcher'> & {
  readonly fetcher: AsyncSegmentFetcherPort;
};

export async function executeSelectedHlsAcquisitionAsync(
  runtime: FlowRuntime,
  input: AsyncSelectedHlsFlowInput,
): Promise<HlsFlowOutcome> {
  if (input.seed.targetId !== input.selection.logicalTargetId) {
    throw new CoreRuntimeFlowError('selected-hls-target', undefined, [
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'targetId',
        'S4 frozen manifest target differs from Core lineage target',
      ),
    ]);
  }
  const selected = preflightSelectedHlsVod(input.selection);
  if (!selected.ok) {
    throw new CoreRuntimeFlowError('selected-hls-preflight', undefined, selected.diagnostics);
  }

  const started = beginHlsAcquisition(runtime, {
    ...input.seed,
    commandId: input.commandId,
    memberId: input.memberId,
  });
  if (started.kind === 'REPLAY') return started.outcome;

  const snapshotId: SnapshotId | undefined =
    input.seed.snapshotId === ''
      ? undefined
      : unwrapOrThrow(makeSnapshotId(input.seed.snapshotId));
  const pipeline = await executeHlsVodAcquisitionAsync({
    contractId: unwrapOrThrow(makeContractId(input.seed.contractId)),
    snapshotId,
    binding: selected.value.binding,
    master: selected.value.master,
    mediaPlaylist: selected.value.media,
    mediaPlaylistLocator: selected.value.binding.renditionLocator,
    ledger: schedulerHlsTransferLedger(runtime, started.lineageKey),
    fetcher: input.fetcher,
    assemblyPort: input.assemblyPort,
    recordedAt: input.recordedAt,
  });
  if (!pipeline.ok) {
    throw new CoreRuntimeFlowError('hls-async-pipeline', undefined, pipeline.diagnostics);
  }
  return finishHlsAcquisition(
    runtime,
    { artifactId: input.artifactId, binding: selected.value.binding },
    started,
    pipeline.value,
  );
}
