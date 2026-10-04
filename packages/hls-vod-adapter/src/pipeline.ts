/**
 * T009 — bounded end-to-end orchestration of the basic HLS VOD adapter.
 *
 * Order is load-bearing (frozen L2 HLS VOD rules): classify topology BEFORE
 * any transfer; bind before plan; plan before acquisition; assemble/probe
 * only after full transfer; project only through canonical terminal
 * semantics. Budget admission is checked per request (C28).
 */

import {
  type ContractId,
  type DomainValidationResult,
  type LocatorBinding,
  type LogicalTargetId,
  type SnapshotId,
} from '@xdownload/domain-contracts';
import type { HlsRenditionBinding } from './bind.ts';
import type { MasterPlaylist, MediaPlaylist } from './playlist.ts';
import { classifyTopology } from './topology.ts';
import { planSegmentsFromMediaPlaylist, type SegmentPlan } from './plan.ts';
import { acquirePlannedSegments, type AcquisitionRun, type SegmentFetcherPort } from './acquire.ts';
import type { MediaAssemblyPort, MediaAssemblyProbeOutcome } from './assemble.ts';
import type { TransferLedger } from './budget.ts';
import {
  projectHlsAdapterOutcome,
  runHlsValidationChain,
  type HlsAdapterOutcome,
} from './validate.ts';

export interface HlsVodPipelineInput {
  /** Owning AcquisitionContract identity (Core-owned; never invented here). */
  readonly contractId: ContractId;
  readonly snapshotId: SnapshotId | undefined;
  readonly binding: HlsRenditionBinding;
  readonly master: MasterPlaylist | undefined;
  readonly mediaPlaylist: MediaPlaylist;
  readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
  readonly ledger: TransferLedger;
  readonly fetcher: SegmentFetcherPort;
  readonly assemblyPort: MediaAssemblyPort;
  readonly recordedAt: string;
}

export interface HlsVodPipelineOutcome extends HlsAdapterOutcome {
  readonly plan: SegmentPlan | undefined;
  readonly run: AcquisitionRun | undefined;
}

/**
 * Execute the bounded S4 pipeline for an already-bound rendition. Plan-level
 * rejections (identity/locator violations) return typed failures; terminal
 * outcomes are always canonical and validated.
 */
export function executeHlsVodAcquisition(
  input: HlsVodPipelineInput,
): DomainValidationResult<HlsVodPipelineOutcome> {
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
    if (!outcome.ok) {
      return outcome;
    }
    return {
      ok: true,
      value: { ...outcome.value, plan: undefined, run: undefined },
    };
  }
  const planned = planSegmentsFromMediaPlaylist({
    binding: input.binding,
    mediaPlaylist: input.mediaPlaylist,
    mediaPlaylistLocator: input.mediaPlaylistLocator,
  });
  if (!planned.ok) {
    return planned;
  }
  const plan = planned.value;
  const run = acquirePlannedSegments(plan, input.ledger, input.fetcher);
  // Assembly/probe runs only after full transfer. A port-level typed
  // rejection is classified INSUFFICIENT_EVIDENCE (fail closed, C22) — it is
  // never a skip and never converted into a passing gate.
  let probe: MediaAssemblyProbeOutcome | undefined;
  if (run.stop.kind === 'ALL_SEGMENTS_TRANSFERRED') {
    const attempted = input.assemblyPort.assembleAndProbe({
      binding: input.binding,
      plan,
      transferred: run.transferred.map((outcome) => ({
        entry: outcome.entry,
        bytes: outcome.result.ok ? outcome.result.bytes : new Uint8Array(),
      })),
    });
    probe = attempted.ok
      ? attempted.value
      : {
          kind: 'INSUFFICIENT_EVIDENCE',
          detail: `assembly/probe tool rejected the request (${attempted.diagnostics.map((d) => d.code).join(', ')})`,
        };
  }
  const chain = runHlsValidationChain({
    binding: input.binding,
    plan,
    run,
    probe,
    probeToolId: input.assemblyPort.toolId,
  });
  const transferredByteCount = run.transferred.reduce(
    (total, outcome) => total + (outcome.result.ok ? outcome.result.bytes.length : 0),
    0,
  );
  const outcome = projectHlsAdapterOutcome({
    contractId: input.contractId,
    snapshotId: input.snapshotId,
    binding: input.binding,
    chain,
    run,
    unsupportedReason: undefined,
    transferredByteCount,
    recordedAt: input.recordedAt,
  });
  if (!outcome.ok) {
    return outcome;
  }
  return {
    ok: true,
    value: { ...outcome.value, plan, run },
  };
}

/** Typed accessor for the stop reason of a pipeline run (test/debug evidence). */
export type PipelineStopKind = AcquisitionRun['stop']['kind'];

export function acquisitionStopKind(run: AcquisitionRun): PipelineStopKind {
  return run.stop.kind;
}
