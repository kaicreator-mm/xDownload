/**
 * #153 S4 selected-HLS Core drivers behind the three-step 1.2 authority
 * chain (PREVIEW_S4_HLS_VOD → CONFIRM_S4_SELECTION → EXECUTE_S4_SELECTED_HLS_VOD).
 *
 * Two drivers, both journal-before-effect (the seam's synchronous authority
 * apply already durably registered the intent BEFORE these run):
 * - `driveS4Preview`: the bounded master read of one durably admitted PENDING
 *   preview record, publishing the Core-observed variant facts (or the typed
 *   refusal) through the trusted `recordS4PreviewResult` port. The renderable
 *   facts a surface later displays always come from the Core's own
 *   observation through immediate playlist ancestry — never a CLI upload.
 * - `driveS4SelectedHlsExecution`: the real bounded manifest/segment/FFmpeg
 *   acquisition of one durably confirmed selection over the EXISTING T009
 *   engine (`beginHlsAcquisition` → `acquireSelectedHlsManifests` →
 *   `executeHlsVodAcquisitionAsync` → `finishHlsAcquisition`), then the
 *   Core-derived terminal through the T007 projector.
 *
 * Transport is the adopted mature-client HTTP lane (L2 S3/S4 HTTP transport
 * implementation delta #169): ordinary verified TLS through the reviewed
 * bounded manifest/segment ports, exact per-hop origin scoping derived from
 * the journaled selection and the OBSERVED playlist ancestry — no new DNS/TLS
 * pinning infrastructure and no ambient URL fetcher. Redirects are refused by
 * the ports themselves (a new CDN location needs its own reviewed
 * provenance transition).
 *
 * Reconcile-first discipline (mirrors the S1/S3 lanes): a durable work item
 * for the canonical effect identity never re-executes the external transfer;
 * the terminal is re-derived from durable truth only, and a failed drive
 * never invents terminal truth — the intent stays registered for a later
 * reconcile.
 */

import { effectiveCancellation, lineageKeyOf } from '@xdownload/core-scheduler';
import {
  bindLocator,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeSnapshotId,
  unwrapOrThrow,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type CoreSeamServer,
  type SeamResult,
  type S4ConfirmedSelectionRecord,
  type S4PreviewRecord,
  type S4RenditionFact,
  type TargetWitnessReceipt,
} from '@xdownload/core-seam';
import { S4_PUBLIC_MEDIA_PROFILE_ID } from '@xdownload/core-seam';
import {
  acquireSelectedHlsManifests,
  createAuthorizedHlsManifestPort,
  createAuthorizedHttpSegmentFetcher,
  createFfmpegTsMediaAssemblyPort,
  decodeMasterPlaylist,
  executeHlsVodAcquisitionAsync,
} from '@xdownload/hls-vod-adapter';
import {
  cancelLineage,
  registerLineage,
  beginHlsAcquisition,
  finishHlsAcquisition,
  stopHlsAcquisition,
  projectLineageResult,
  attemptIdFor,
  type FlowRuntime,
  type HlsFlowOutcome,
  type LineageSeed,
} from './flow.ts';
import { schedulerHlsTransferLedger } from './budget-bridge.ts';

/** The runtime pieces the S4 drivers compose (same ports as the S1/S3 lanes). */
export type S4DriveRuntime = FlowRuntime & {
  readonly seam: CoreSeamServer;
};

/**
 * Trusted-host HTTP/tool knobs of the S4 mature-client lane. Production uses
 * every default (public HTTPS only, FFmpeg/ffprobe from PATH); the loopback
 * fixture exception exists ONLY for the in-repo deterministic tests and is
 * never set by the installed host composition.
 */
export interface S4HlsHttpOptions {
  readonly allowLoopbackHttpFixture?: boolean;
  readonly ffprobeBinary?: string;
  readonly ffmpegBinary?: string;
}

/** Bounded single-read preview budget (L2 SEAM12 §3 "bounded read"). */
const PREVIEW_MANIFEST_MAX_BYTES = 512 * 1024;
const PREVIEW_MANIFEST_TIMEOUT_MS = 15_000;
/** Per-segment bounds for the execution lane (≤ the port hard caps). */
const SEGMENT_MAX_BYTES = 16 * 1024 * 1024;
const SEGMENT_TIMEOUT_MS = 30_000;
const EXECUTION_MANIFEST_TIMEOUT_MS = 30_000;
/** The reviewed per-port origin-list cap (http-segment/manifest-http). */
const MAX_OBSERVED_ORIGINS = 32;

function hostOf(uri: string): string | undefined {
  try {
    return new URL(uri).host;
  } catch {
    return undefined;
  }
}

function originOf(uri: string): string | undefined {
  try {
    return new URL(uri).origin;
  } catch {
    return undefined;
  }
}

/**
 * The canonical effect/lineage/artifact identity of one S4 selected-HLS
 * execution: derived identically on every drive so cancel/replay/reconcile
 * land on the same frozen lineage (mirrors the S3 identity derivation). All
 * composite ids must fit their 128-char bounds BEFORE any transfer starts
 * (the seam apply already refused otherwise; this is the defense in depth).
 */
export function s4EffectIdentity(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly targetId: string;
  readonly memberId: string;
}): SeamResult<{
  readonly effectId: string;
  readonly lineageKey: string;
  readonly artifactId: string;
}> {
  try {
    const effectId = `effect:${input.contractId}:${input.snapshotId}:${input.targetId}`;
    const artifactId = `s4artifact:${input.contractId}:${input.snapshotId}:${input.memberId}`;
    if (effectId.length > 128 || artifactId.length > 128) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'identity',
          'the canonical composite S4 identity exceeds the 128-char id bound',
        ),
      ]);
    }
    return seamOk({
      effectId,
      artifactId,
      lineageKey: lineageKeyOf({
        contractId: unwrapOrThrow(makeContractId(input.contractId)),
        snapshotId: unwrapOrThrow(makeSnapshotId(input.snapshotId)),
        targetId: unwrapOrThrow(makeLogicalTargetId(input.targetId)),
        effectId: unwrapOrThrow(makeEffectId(effectId)),
      }),
    });
  } catch {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'identity',
        'the S4 execution identity does not form canonical ids',
      ),
    ]);
  }
}

const PREVIEW_FAILURE_OF_FETCH: Readonly<Record<string, string>> = {
  UNSUPPORTED: 'MANIFEST_UNSUPPORTED',
  UNREACHABLE: 'MANIFEST_UNREACHABLE',
  OVERSIZE: 'MANIFEST_OVERSIZE',
  INVALID_MANIFEST: 'MANIFEST_INVALID',
};

/**
 * Drive one durably admitted PENDING preview to its Core-observed result:
 * one bounded credential-free HTTPS read of the exact journaled manifest URI
 * (single origin — the preview bootstrap of the adopted transport delta),
 * decoded by the bounded T009 master parser into the renderable secret-free
 * variant facts. Every outcome — including the typed refusal — is published
 * through the trusted Core-internal receipt port and journaled.
 */
export async function driveS4Preview(
  runtime: S4DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly preview: S4PreviewRecord;
  },
  options: S4HlsHttpOptions = {},
): Promise<SeamResult<void>> {
  const preview = input.preview;
  if (preview.status !== 'PENDING') {
    return seamOk(undefined);
  }
  const expiresAtMs = Date.parse(preview.expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    return publishPreviewResult(runtime, input.aggregateId, {
      ...preview,
      status: 'FAILED',
      failureReason: 'PREVIEW_EXPIRED',
    });
  }
  const manifestOrigin = originOf(preview.manifestUri);
  if (manifestOrigin === undefined) {
    return publishPreviewResult(runtime, input.aggregateId, {
      ...preview,
      status: 'FAILED',
      failureReason: 'MANIFEST_UNSUPPORTED',
    });
  }
  let port;
  try {
    port = createAuthorizedHlsManifestPort({
      allowedOrigins: [manifestOrigin],
      maxBytes: PREVIEW_MANIFEST_MAX_BYTES,
      timeoutMs: PREVIEW_MANIFEST_TIMEOUT_MS,
      allowLoopbackHttpFixture: options.allowLoopbackHttpFixture === true,
    });
  } catch {
    return publishPreviewResult(runtime, input.aggregateId, {
      ...preview,
      status: 'FAILED',
      failureReason: 'MANIFEST_UNSUPPORTED',
    });
  }
  const fetched = await port.fetchManifest(preview.manifestUri);
  if (!fetched.ok) {
    return publishPreviewResult(runtime, input.aggregateId, {
      ...preview,
      status: 'FAILED',
      failureReason: PREVIEW_FAILURE_OF_FETCH[fetched.reason] ?? 'MANIFEST_UNREACHABLE',
    });
  }
  const master = decodeMasterPlaylist(fetched.text, preview.manifestUri);
  if (!master.ok) {
    return publishPreviewResult(runtime, input.aggregateId, {
      ...preview,
      status: 'FAILED',
      failureReason: 'MANIFEST_INVALID',
    });
  }
  const variants: S4RenditionFact[] = master.value.variants.map((variant, index) => ({
    key: `rend-${String(index)}`,
    uri: variant.uri,
    bandwidth: variant.bandwidth,
    ...(variant.codecs.length === 0 ? {} : { codecs: variant.codecs.join(',') }),
    ...(variant.resolution === undefined
      ? {}
      : { width: variant.resolution.width, height: variant.resolution.height }),
  }));
  return publishPreviewResult(runtime, input.aggregateId, {
    ...preview,
    status: 'AVAILABLE',
    variants,
  });
}

function publishPreviewResult(
  runtime: S4DriveRuntime,
  aggregateId: string,
  record: S4PreviewRecord,
): SeamResult<void> {
  const published = runtime.seam.recordS4PreviewResult(aggregateId, record);
  return published.ok ? seamOk(undefined) : published;
}

/** Truthful stop-facts of one S4 execution outcome for the projector. */
function stopFactsOf(failureCategory: string | undefined): Record<string, boolean> {
  if (failureCategory === undefined) {
    return {};
  }
  if (failureCategory === 'TRANSFER_BUDGET_EXHAUSTED') {
    return { transferBudgetExhausted: true };
  }
  if (failureCategory === 'GLOBAL_SAFETY_LIMIT') {
    return { globalSafetyLimit: true };
  }
  return { validationFailed: true };
}

/**
 * Drive one registered S4 selected-HLS execution to a Core-derived terminal:
 * the T009 engine over the mature-client bounded ports, reconcile-first,
 * with cancellation checkpoints before dispatch and after the flow (a
 * mid-flight socket abort is not wired on this lane — cancellation wins at
 * the durable checkpoints and through the post-cancel re-drive).
 */
export async function driveS4SelectedHlsExecution(
  runtime: S4DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly selection: S4ConfirmedSelectionRecord;
  },
  options: S4HlsHttpOptions = {},
): Promise<SeamResult<void>> {
  const selection = input.selection;
  if (input.contract.intentType !== 'SINGLE_RESOURCE') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S4 selected-HLS driver serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S4',
      ),
    ]);
  }
  if (selection.mediaProfileId !== S4_PUBLIC_MEDIA_PROFILE_ID) {
    return seamFail([
      seamDiagnostic(
        'MEDIA_POLICY_REQUIRED',
        'selection.mediaProfileId',
        'the confirmed selection names a media profile other than the closed basic public HLS VOD profile; execution fails closed',
        'L2-S4-§2',
      ),
    ]);
  }
  const identity = s4EffectIdentity({
    contractId: input.contract.contractId,
    snapshotId: selection.snapshotId,
    targetId: input.contract.requestedTarget,
    memberId: selection.memberId,
  });
  if (!identity.ok) {
    return identity;
  }
  const { effectId, lineageKey, artifactId } = identity.value;
  const seed: LineageSeed = {
    contractId: input.contract.contractId,
    snapshotId: selection.snapshotId,
    targetId: input.contract.requestedTarget,
    authorizationContextRef: input.contract.authorizationContextRef,
    budgetProfile: input.contract.budgetProfile,
    frozenMemberIds: [selection.memberId],
  };
  const commandId = `s4-hls:${input.contract.contractId}:${selection.snapshotId}:${selection.memberId}`;

  // Replay/restart reconcile: the durable ledger already carries this
  // effect — re-derive the identical terminal from durable truth only.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    return deriveAndRecordTerminal(runtime, {
      aggregateId: input.aggregateId,
      contract: input.contract,
      selection,
      lineageKey,
      workItemId: existing.workItemId,
      recordedAt: existing.createdAt,
      flow: undefined,
      artifactId,
    });
  }

  // Cancellation checkpoint before dispatch (no transfer, no socket).
  if (seamLineageStatus(runtime, input.aggregateId) === 'CANCELLED') {
    const registered = registerLineage(runtime, seed, {
      commandId,
      memberId: selection.memberId,
    });
    cancelLineage(runtime, lineageKey, 'CORE_POLICY', registered.workItemId);
    return deriveAndRecordTerminal(runtime, {
      aggregateId: input.aggregateId,
      contract: input.contract,
      selection,
      lineageKey,
      workItemId: registered.workItemId,
      recordedAt: new Date().toISOString(),
      flow: undefined,
      artifactId,
    });
  }

  // The single durable T009 admission (registerLineage + dispatch + attempt).
  const started = beginHlsAcquisition(runtime, {
    ...seed,
    commandId,
    memberId: selection.memberId,
  });
  if (started.kind === 'REPLAY') {
    return deriveAndRecordTerminal(runtime, {
      aggregateId: input.aggregateId,
      contract: input.contract,
      selection,
      lineageKey,
      workItemId: started.outcome.workItemId,
      recordedAt: workItemCreatedAt(runtime, started.outcome.workItemId),
      flow: started.outcome,
      artifactId,
    });
  }

  const manifestOrigin = originOf(selection.manifestUri);
  if (manifestOrigin === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'selection.manifestUri',
        'the confirmed manifest source does not form a canonical origin',
        'L2-S4-§5',
      ),
    ]);
  }
  const manifestLocator = bindLocator(
    { kind: 'direct', uri: selection.manifestUri },
    input.contract.requestedTarget,
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: selection.manifestUri,
    },
  );
  if (!manifestLocator.ok) {
    return seamFail(
      manifestLocator.diagnostics.map((d) =>
        seamDiagnostic(d.code, d.path, d.message, d.invariant),
      ),
    );
  }

  const ledger = schedulerHlsTransferLedger(runtime, started.lineageKey);
  const manifestPort = createAuthorizedHlsManifestPort({
    allowedOrigins: [manifestOrigin],
    maxBytes: PREVIEW_MANIFEST_MAX_BYTES,
    timeoutMs: EXECUTION_MANIFEST_TIMEOUT_MS,
    allowLoopbackHttpFixture: options.allowLoopbackHttpFixture === true,
  });

  // The selected rendition is re-observed through immediate playlist
  // ancestry at execute time: it must still be declared exactly once in the
  // fetched master, and both manifest reads are budget-admitted.
  let selected: Awaited<ReturnType<typeof acquireSelectedHlsManifests>>;
  try {
    selected = await acquireSelectedHlsManifests({
      logicalTargetId: unwrapOrThrow(makeLogicalTargetId(input.contract.requestedTarget)),
      manifestLocator: manifestLocator.value,
      selectedRenditionUri: selection.renditionUri,
      ledger,
      port: manifestPort,
    });
  } catch {
    return finishFlow(
      runtime,
      input.aggregateId,
      stopHlsAcquisition(runtime, started, 'HLS_MANIFEST_FETCH_FAILED', true),
      { contract: input.contract, selection, artifactId },
    );
  }
  if (!selected.ok) {
    const external = selected.diagnostics.some((d) => d.path.includes('anifest'));
    return finishFlow(
      runtime,
      input.aggregateId,
      stopHlsAcquisition(runtime, started, 'HLS_MANIFEST_ADMISSION_FAILED', external),
      { contract: input.contract, selection, artifactId },
    );
  }

  // Exact per-hop origin scoping from the OBSERVED frozen plan: the segment
  // fetcher admits only the origins the selected media playlist itself
  // declared (immediate playlist ancestry — never a caller-supplied list).
  const observedOrigins = new Set<string>();
  for (const entry of selected.value.segmentPlan.entries) {
    const origin = originOf(entry.locator.locator.uri);
    const schemeAdmitted =
      origin !== undefined &&
      (origin.startsWith('https://') ||
        (options.allowLoopbackHttpFixture === true && origin.startsWith('http://127.0.0.1')));
    if (!schemeAdmitted) {
      return finishFlow(
        runtime,
        input.aggregateId,
        stopHlsAcquisition(runtime, started, 'HLS_PIPELINE_VALIDATION_FAILED', true),
        { contract: input.contract, selection, artifactId },
      );
    }
    observedOrigins.add(origin);
  }
  if (observedOrigins.size === 0 || observedOrigins.size > MAX_OBSERVED_ORIGINS) {
    return finishFlow(
      runtime,
      input.aggregateId,
      stopHlsAcquisition(runtime, started, 'HLS_PIPELINE_VALIDATION_FAILED', true),
      { contract: input.contract, selection, artifactId },
    );
  }
  const fetcher = createAuthorizedHttpSegmentFetcher({
    allowedOrigins: [...observedOrigins],
    maxBytes: SEGMENT_MAX_BYTES,
    timeoutMs: SEGMENT_TIMEOUT_MS,
    allowLoopbackHttpFixture: options.allowLoopbackHttpFixture === true,
  });
  const assemblyPort = createFfmpegTsMediaAssemblyPort({
    ...(options.ffprobeBinary === undefined ? {} : { ffprobeBinary: options.ffprobeBinary }),
    ...(options.ffmpegBinary === undefined ? {} : { ffmpegBinary: options.ffmpegBinary }),
  });

  let pipeline: Awaited<ReturnType<typeof executeHlsVodAcquisitionAsync>>;
  try {
    const snapshotId =
      selection.snapshotId === '' ? undefined : unwrapOrThrow(makeSnapshotId(selection.snapshotId));
    pipeline = await executeHlsVodAcquisitionAsync({
      contractId: unwrapOrThrow(makeContractId(input.contract.contractId)),
      snapshotId,
      binding: selected.value.binding,
      master: selected.value.master,
      mediaPlaylist: selected.value.media,
      mediaPlaylistLocator: selected.value.binding.renditionLocator,
      ledger,
      fetcher,
      assemblyPort,
      recordedAt: new Date().toISOString(),
    });
  } catch {
    return finishFlow(
      runtime,
      input.aggregateId,
      stopHlsAcquisition(runtime, started, 'HLS_PIPELINE_THROWN', true),
      { contract: input.contract, selection, artifactId },
    );
  }
  if (!pipeline.ok) {
    return finishFlow(
      runtime,
      input.aggregateId,
      stopHlsAcquisition(runtime, started, 'HLS_PIPELINE_VALIDATION_FAILED', true),
      { contract: input.contract, selection, artifactId },
    );
  }
  return finishFlow(
    runtime,
    input.aggregateId,
    finishHlsAcquisition(
      runtime,
      { artifactId, binding: selected.value.binding },
      started,
      pipeline.value,
    ),
    { contract: input.contract, selection, artifactId },
  );
}

function finishFlow(
  runtime: S4DriveRuntime,
  aggregateId: string,
  flow: HlsFlowOutcome,
  context: {
    readonly contract: AcquisitionContract;
    readonly selection: S4ConfirmedSelectionRecord;
    readonly artifactId: string;
  },
): SeamResult<void> {
  return deriveAndRecordTerminal(runtime, {
    aggregateId,
    contract: context.contract,
    selection: context.selection,
    lineageKey: flow.lineageKey,
    workItemId: flow.workItemId,
    recordedAt: workItemCreatedAt(runtime, flow.workItemId),
    flow,
    artifactId: context.artifactId,
  });
}

function seamLineageStatus(
  runtime: S4DriveRuntime,
  aggregateId: string,
): 'ACTIVE' | 'CANCELLED' | 'TERMINAL' | undefined {
  return runtime.seam.inspectProjection(aggregateId)?.lineage.status;
}

function workItemCreatedAt(runtime: S4DriveRuntime, workItemId: string): string {
  return (
    runtime.writer.reader.workItems().find((item) => item.workItemId === workItemId)?.createdAt ??
    new Date().toISOString()
  );
}

/**
 * Derive the S4 terminal through the T007 projector and hand it to the seam
 * (ACTIVE → recordExecutedTerminal; CANCELLED → the ADR-013 cutoff closure;
 * TERMINAL → converge). The S4 Target evidence is always the conservative
 * provenance basis (PROBATIVE) — this lane has no publisher-digest anchor.
 */
function deriveAndRecordTerminal(
  runtime: S4DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly selection: S4ConfirmedSelectionRecord;
    readonly lineageKey: string;
    readonly workItemId: string;
    readonly recordedAt: string;
    readonly flow: HlsFlowOutcome | undefined;
    readonly artifactId: string;
  },
): SeamResult<void> {
  const status = seamLineageStatus(runtime, input.aggregateId);
  if (status === 'TERMINAL') {
    return seamOk(undefined);
  }
  const classification = runtime.recovery.classify(input.workItemId);
  const memberValidated =
    classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
  const durableOutcome = runtime.scheduler.durableEffectOutcome(
    input.lineageKey,
    attemptIdFor(input.workItemId),
  );
  const failureCategory =
    durableOutcome?.outcome === 'FAILED' ? durableOutcome.failureCategory : undefined;

  // Cancellation checkpoint after the flow: the user's cancel is
  // authoritative; no failure accounting crosses the cutoff.
  const cancelledView = runtime.scheduler.lineageView(input.lineageKey);
  const cancelled =
    status === 'CANCELLED' ||
    (cancelledView !== undefined && effectiveCancellation(cancelledView) !== undefined);
  if (cancelled) {
    cancelLineage(runtime, input.lineageKey, 'CORE_POLICY', input.workItemId);
  } else if (!memberValidated) {
    runtime.writer.recordTerminalFailure(
      input.workItemId,
      failureCategory ?? input.flow?.acceptanceError?.code ?? 'NETWORK_FAILURE',
    );
    const failed = runtime.seam.recordFailedMembers(input.aggregateId, [input.selection.memberId]);
    if (!failed.ok) return failed;
  }

  if (memberValidated) {
    // Immutable Target witness + evidence from the actual observed truth
    // BEFORE any terminal authority handover (S1/S3 discipline).
    const digest = runtime.store.observe(input.artifactId).observedDigest;
    if (digest === undefined) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'targetEvidence.artifactSha256',
          'a validated member has no observable digest-bound bytes; the target evidence receipt cannot be established',
        ),
      ]);
    }
    const effectId = `effect:${input.contract.contractId}:${input.selection.snapshotId}:${input.contract.requestedTarget}`;
    const manifestHost = hostOf(input.selection.manifestUri);
    const renditionHost = hostOf(input.selection.renditionUri);
    const witness: TargetWitnessReceipt = {
      snapshotId: input.selection.snapshotId,
      memberId: input.selection.memberId,
      artifactId: input.artifactId,
      effectId,
      locatorUri: input.selection.renditionUri,
      declaredRedirectHosts: [...new Set([manifestHost, renditionHost].filter(isString))],
      observedRedirectHosts: [...new Set([manifestHost, renditionHost].filter(isString))],
      transferAttempted: true,
      status: 'RESOLVED',
      basis: 'REQUESTED_LOCATOR_PROVENANCE',
      certaintyClass: 'PROBATIVE',
    };
    const existingWitness = runtime.seam.targetWitnessFor(input.aggregateId);
    if (
      existingWitness === undefined ||
      JSON.stringify(existingWitness) !== JSON.stringify(witness)
    ) {
      const recordedWitness = runtime.seam.recordTargetWitness(input.aggregateId, witness);
      if (!recordedWitness.ok) return recordedWitness;
    }
    const recordedEvidence = runtime.seam.recordTargetEvidence(input.aggregateId, {
      artifactId: input.artifactId,
      effectId,
      artifactSha256: digest,
      basis: 'REQUESTED_LOCATOR_PROVENANCE',
      certaintyClass: 'PROBATIVE',
    });
    if (!recordedEvidence.ok) {
      return recordedEvidence;
    }
  }

  const projected = projectLineageResult(runtime, {
    lineageKey: input.lineageKey,
    contractId: input.contract.contractId,
    snapshotId: input.selection.snapshotId,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [input.selection.memberId],
    recordedAt: input.recordedAt,
    enumeration: { kind: 'NOT_APPLICABLE' },
    ...(Object.keys(stopFactsOf(failureCategory)).length === 0
      ? {}
      : { stopFacts: stopFactsOf(failureCategory) }),
  });
  if (!projected.ok) {
    return seamFail(
      projected.diagnostics.map((d) => seamDiagnostic(d.code, d.path, d.message, d.invariant)),
    );
  }
  if (status === 'CANCELLED') {
    return runtime.seam.closeCancelledLineage(input.aggregateId, projected.value.result);
  }
  return runtime.seam.recordExecutedTerminal(input.aggregateId, projected.value.result);
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
