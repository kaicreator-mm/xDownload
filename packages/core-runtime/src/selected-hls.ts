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
  acquireSelectedHlsManifests,
  executeHlsVodAcquisitionAsync,
  type AuthorizedHlsManifestPort,
  type AsyncSegmentFetcherPort,
  type MediaAssemblyPort,
  type SegmentFetcherPort,
  type SelectedHlsPreflightInput,
  type SelectedHlsPreflight,
  type TransferLedger,
} from '@xdownload/hls-vod-adapter';
import {
  CoreRuntimeFlowError,
  beginHlsAcquisition,
  executeHlsAcquisition,
  finishHlsAcquisition,
  stopHlsAcquisition,
  type FlowRuntime,
  type HlsFlowStarted,
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

  return finishSelectedAsyncAfterCoreStart(
    runtime,
    input,
    started,
    selected.value,
    schedulerHlsTransferLedger(runtime, started.lineageKey),
    false,
  );
}

/**
 * S4 durable selected-manifest HTTP path: the first manifest fetch happens
 * only AFTER the single Core scheduler/writer has accepted the effect start.
 * This is host-private, not an unreviewed public Core command or browser
 * authorization bypass. The trusted host supplies the frozen selection and
 * approved manifest/segment ports.
 */
export type HttpSelectedHlsFlowInput = Omit<AsyncSelectedHlsFlowInput, 'selection'> & {
  readonly selection: Pick<
    SelectedHlsPreflightInput,
    'logicalTargetId' | 'manifestLocator' | 'selectedRenditionUri'
  >;
  readonly manifestPort: AuthorizedHlsManifestPort;
};

export async function executeSelectedHlsFromAuthorizedManifestsAsync(
  runtime: FlowRuntime,
  input: HttpSelectedHlsFlowInput,
): Promise<HlsFlowOutcome> {
  if (
    input.seed.targetId !== input.selection.logicalTargetId ||
    input.selection.manifestLocator.identity !== input.selection.logicalTargetId
  ) {
    throw new CoreRuntimeFlowError('selected-hls-target', undefined, [
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'manifestLocator.identity',
        'S4 frozen target and selected manifest must match before Core effects',
      ),
    ]);
  }

  const started = beginHlsAcquisition(runtime, {
    ...input.seed,
    commandId: input.commandId,
    memberId: input.memberId,
  });
  if (started.kind === 'REPLAY') return started.outcome;

  const ledger = schedulerHlsTransferLedger(runtime, started.lineageKey);
  let manifestRequestIssued = false;
  // The trusted port is invoked ONLY by T009 after its per-request budget
  // admission. Mark observation before entering the port so throwing or
  // network-failed reads cannot leave an unrecorded started effect.
  const trackedPort: AuthorizedHlsManifestPort = {
    maxResponseBytes: input.manifestPort.maxResponseBytes,
    async fetchManifest(uri) {
      manifestRequestIssued = true;
      return input.manifestPort.fetchManifest(uri);
    },
  };
  let selected: Awaited<ReturnType<typeof acquireSelectedHlsManifests>>;
  try {
    selected = await acquireSelectedHlsManifests({
      ...input.selection,
      ledger,
      port: trackedPort,
    });
  } catch {
    // Do not persist thrown URL/credential text or expose it as truth.
    const failure = 'HLS_MANIFEST_FETCH_FAILED';
    return stopHlsAcquisition(runtime, started, failure, manifestRequestIssued);
  }
  if (!selected.ok) {
    const failure = 'HLS_MANIFEST_ADMISSION_FAILED';
    return stopHlsAcquisition(runtime, started, failure, manifestRequestIssued);
  }

  return finishSelectedAsyncAfterCoreStart(
    runtime,
    input,
    started,
    selected.value,
    ledger,
    manifestRequestIssued,
  );
}

/**
 * One fail-closed post-start S4 path for both pre-supplied manifest fixtures
 * and approved real manifest transport. A typed pipeline rejection or thrown
 * media tool is always durably FAILED, never an orphaned effect or COMPLETE.
 */
async function finishSelectedAsyncAfterCoreStart(
  runtime: FlowRuntime,
  input: AsyncSelectedHlsFlowInput,
  started: HlsFlowStarted,
  selected: SelectedHlsPreflight,
  ledger: TransferLedger,
  earlierExternalEffectIssued: boolean,
): Promise<HlsFlowOutcome> {
  let segmentRequestIssued = false;
  const trackedFetcher: AsyncSegmentFetcherPort = {
    fetcherId: input.fetcher.fetcherId,
    maxResponseBytes: input.fetcher.maxResponseBytes,
    async fetch(entry) {
      segmentRequestIssued = true;
      return input.fetcher.fetch(entry);
    },
  };
  const externalEffectIssued = () => earlierExternalEffectIssued || segmentRequestIssued;
  let pipeline: Awaited<ReturnType<typeof executeHlsVodAcquisitionAsync>>;
  try {
    const snapshotId: SnapshotId | undefined =
      input.seed.snapshotId === '' ? undefined : unwrapOrThrow(makeSnapshotId(input.seed.snapshotId));
    pipeline = await executeHlsVodAcquisitionAsync({
      contractId: unwrapOrThrow(makeContractId(input.seed.contractId)),
      snapshotId,
      binding: selected.binding,
      master: selected.master,
      mediaPlaylist: selected.media,
      mediaPlaylistLocator: selected.binding.renditionLocator,
      ledger,
      fetcher: trackedFetcher,
      assemblyPort: input.assemblyPort,
      recordedAt: input.recordedAt,
    });
  } catch {
    const failure = 'HLS_PIPELINE_THROWN';
    return stopHlsAcquisition(runtime, started, failure, externalEffectIssued());
  }
  if (!pipeline.ok) {
    const failure = 'HLS_PIPELINE_VALIDATION_FAILED';
    return stopHlsAcquisition(runtime, started, failure, externalEffectIssued());
  }
  return finishHlsAcquisition(
    runtime,
    { artifactId: input.artifactId, binding: selected.binding },
    started,
    pipeline.value,
  );
}
