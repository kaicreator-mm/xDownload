/**
 * T009 S4 asynchronous real-segment pipeline — a single validation truth path.
 *
 * Core must journal the accepted effect and install the authoritative
 * TransferLedger before calling this function; it does not create tasks.
 */
import type { DomainValidationResult } from '@xdownload/domain-contracts';
import { acquirePlannedSegmentsAsync } from './acquire-async.ts';
import type { AsyncSegmentFetcherPort } from './http-segment.ts';
import { planSegmentsFromMediaPlaylist } from './plan.ts';
import {
  completeHlsPipelineRun,
  type HlsVodPipelineInput,
  type HlsVodPipelineOutcome,
} from './pipeline.ts';
import { classifyTopology } from './topology.ts';
import { projectHlsAdapterOutcome } from './validate.ts';

export interface AsyncHlsVodPipelineInput extends Omit<HlsVodPipelineInput, 'fetcher'> {
  readonly fetcher: AsyncSegmentFetcherPort;
}

/** All normal and exceptional media outcomes use the same T009 projector. */
export async function executeHlsVodAcquisitionAsync(
  input: AsyncHlsVodPipelineInput,
): Promise<DomainValidationResult<HlsVodPipelineOutcome>> {
  const topology = classifyTopology(input.master, input.mediaPlaylist);
  if (!topology.supported) {
    const outcome = projectHlsAdapterOutcome({
      contractId: input.contractId,
      snapshotId: input.snapshotId,
      binding: input.binding,
      chain: undefined,
      run: undefined,
      unsupportedReason: topology.reason,
      transferredByteCount: 0,
      recordedAt: input.recordedAt,
    });
    if (!outcome.ok) return outcome;
    return { ok: true, value: { ...outcome.value, plan: undefined, run: undefined } };
  }

  const planned = planSegmentsFromMediaPlaylist({
    binding: input.binding,
    mediaPlaylist: input.mediaPlaylist,
    mediaPlaylistLocator: input.mediaPlaylistLocator,
  });
  if (!planned.ok) return planned;

  // The asynchronous T009 adapter checks the Core-ledger reservation before
  // *each* HTTP fetch, including a restart retry of the same frozen plan.
  const run = await acquirePlannedSegmentsAsync(planned.value, input.ledger, input.fetcher);
  return completeHlsPipelineRun(input, planned.value, run);
}
