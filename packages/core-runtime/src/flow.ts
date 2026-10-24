/**
 * T015 canonical flow composition — the wiring that sequences
 *
 *   seam command → scheduler control → adapter execution (S1/S3/S4) →
 *   validate chain → single-writer persistence → projection
 *
 * for one frozen lineage. Glue decides composition ORDER only, never
 * outcomes: every step's verdict is the verbatim upstream result, and any
 * typed rejection/exception propagates without normalization (fail closed
 * at every composition boundary, REFERENCE_PACK §3.5).
 *
 * The flow is not a domain layer: it introduces no status, no budget, no
 * membership and no validation semantics of its own.
 */

import {
  acceptanceCutoff,
  canonicalEffectId,
  effectiveCancellation,
  type AcceptanceOutcome,
  type AttemptRecord,
  type CancelSource,
  type ControlResult,
  type EffectOutcome,
  type LineageBinding,
  type LineageKey,
  type LineageSubmission,
  type LineageSubmitInput,
  type OutcomeRecord,
  type ResumeOutcome,
  type ResumeRequest,
} from '@xdownload/core-scheduler';
import {
  diagnostic,
  fail,
  makeContractId,
  makeMemberId,
  makeSnapshotId,
  unwrapOrThrow,
  makeLogicalTargetId,
  type CoverageAccounting,
  type EvidenceLedger,
  type CoverageEvidence,
  type DomainValidationResult,
  type EnumerationClosure,
  type EffectId,
  type LocatorBinding,
  type LogicalTargetId,
  type MemberId,
  type MemberRequiredValidation,
  type ProjectionFacts,
  type ProjectedTerminalResult,
  projectResult,
  type ResolutionFacts,
  type SnapshotId,
  type StopFacts,
  type ValidationDiagnostic,
  type ValidationLayer,
} from '@xdownload/domain-contracts';
import {
  DirectHttpAdapter,
  targetCertaintyOf,
  type PinnedPublicMediaSourcePolicy,
  type DirectTransferOutcome,
  type DirectTransferRequest,
} from '@xdownload/direct-acquisition';
import {
  executeHlsVodAcquisition,
  type HlsRenditionBinding,
  type HlsVodPipelineOutcome,
  type MasterPlaylist,
  type MediaAssemblyPort,
  type MediaPlaylist,
  type SegmentAcquisitionOutcome,
  type SegmentFetcherPort,
} from '@xdownload/hls-vod-adapter';
import type {
  AcceptArtifactOutcome,
  AcceptanceValidation,
  PersistenceError,
  RecoveryClassification,
} from '@xdownload/persistence-ledger';
import type { CoreRuntime } from './runtime.ts';

/**
 * Structural runtime subsets the flows actually consume (#95): the S2
 * delivered-acquisition executor is composed BEFORE the seam server exists
 * (journal replay inside `createCoreSeamServer` may already execute S2
 * commands over the durable pieces), so flow functions accept the pieces
 * they use instead of the fully composed runtime.
 */
export type FlowRuntime = Pick<
  CoreRuntime,
  'scheduler' | 'writer' | 'store' | 'recovery' | 'terminalStore'
>;
export type ProjectionRuntime = FlowRuntime & { readonly seam?: CoreRuntime['seam'] };
import {
  CoreRuntimeBudgetBridge,
  schedulerHlsTransferLedger,
  schedulerTransferBudgetPort,
} from './budget-bridge.ts';

/** Typed composition failure carrying the verbatim upstream rejection. */
export class CoreRuntimeFlowError extends Error {
  /** The composition step at which the flow stopped. */
  readonly step: string;
  /** Verbatim scheduler control rejection, when the step produced one. */
  readonly rejection?: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
  };
  /** Verbatim domain diagnostics, when the step produced them. */
  readonly diagnostics?: readonly ValidationDiagnostic[];

  constructor(
    step: string,
    rejection?: { readonly code: string; readonly message: string; readonly detail?: string },
    diagnostics?: readonly ValidationDiagnostic[],
  ) {
    const cause = rejection !== undefined ? `${rejection.code}: ${rejection.message}` : step;
    super(`core runtime flow stopped at '${step}': ${cause}`);
    this.name = 'CoreRuntimeFlowError';
    this.step = step;
    this.rejection = rejection;
    this.diagnostics = diagnostics;
  }
}

function must<T>(step: string, result: ControlResult<T>): T {
  if (!result.ok) {
    throw new CoreRuntimeFlowError(step, result.rejection);
  }
  return result.value;
}

function mustDomain<T>(step: string, result: DomainValidationResult<T>): T {
  if (!result.ok) {
    throw new CoreRuntimeFlowError(step, undefined, result.diagnostics);
  }
  return result.value;
}

/** Canonical identity inputs every flow shares (frozen work identity). */
export interface LineageSeed {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly targetId: string;
  readonly authorizationContextRef: string;
  /** Raw budget profile; decoded fail-closed by the scheduler and the writer. */
  readonly budgetProfile: unknown;
  /** Frozen member identities of the selection snapshot (retry domain). */
  readonly frozenMemberIds?: readonly string[];
}

function seedToSubmitInput(seed: LineageSeed): LineageSubmitInput {
  return {
    contractId: seed.contractId,
    snapshotId: seed.snapshotId,
    targetId: seed.targetId,
    authorizationContextRef: seed.authorizationContextRef,
    budgetProfile: seed.budgetProfile,
    ...(seed.frozenMemberIds === undefined ? {} : { frozenMemberIds: seed.frozenMemberIds }),
  };
}

/** Register one lineage in BOTH canonical stores (scheduler + durable ledger). */
export function registerLineage(
  runtime: Pick<CoreRuntime, 'scheduler' | 'writer'>,
  seed: LineageSeed,
  options: { readonly commandId: string; readonly memberId: string },
): { readonly submission: LineageSubmission; readonly workItemId: string } {
  const submission = must(
    'submitLineage',
    runtime.scheduler.submitLineage(seedToSubmitInput(seed)),
  );
  const workItemId = `work:${submission.effectId}`;
  runtime.writer.submitAcquisition({
    commandId: options.commandId,
    commandKind: 'ACQUIRE',
    workItemId,
    contractId: seed.contractId,
    snapshotId: seed.snapshotId,
    memberId: options.memberId,
    effectId: submission.effectId,
    authorizationContextRef: seed.authorizationContextRef,
    budgetProfile: seed.budgetProfile,
    artifactProvenance: {
      contractId: seed.contractId,
      snapshotId: seed.snapshotId,
      targetId: seed.targetId,
    },
  });
  return { submission, workItemId };
}

/** Durable `USER_CANCELLED` in both canonical stores (idempotent upstream). */
export function cancelLineage(
  runtime: FlowRuntime,
  lineageKey: LineageKey,
  source: CancelSource,
  workItemId: string,
): void {
  must('cancel', runtime.scheduler.cancel(lineageKey, source));
  runtime.writer.cancel(workItemId);
}

/** Explicit authorized retry/resume in both canonical stores (no automatic reopen). */
export function resumeLineage(
  runtime: FlowRuntime,
  lineageKey: LineageKey,
  workItemId: string,
  request: ResumeRequest & { readonly retryCommandId: string },
): ControlResult<ResumeOutcome> {
  const outcome = runtime.scheduler.resumeLineage(lineageKey, request);
  if (!outcome.ok) {
    return outcome;
  }
  runtime.writer.explicitRetryResume(workItemId, request.retryCommandId);
  return outcome;
}

// ------------------------------------------------------------ direct S1/S3 flow

export interface DirectFlowInput extends LineageSeed {
  /** Idempotent durable command identity for the ledger command record. */
  readonly commandId: string;
  readonly memberId: string;
  readonly artifactId: string;
  /** The canonical direct-transfer request (identity/provenance-bound). */
  readonly transfer: DirectTransferRequest;
}

export interface DirectFlowOutcome {
  readonly lineageKey: LineageKey;
  readonly binding: LineageBinding;
  readonly workItemId: string;
  readonly submission: LineageSubmission;
  readonly attempt: AttemptRecord;
  /** True when the durable attempt already existed: the flow reconciled from
   * durable truth instead of re-executing the external transfer. */
  readonly attemptReplayed: boolean;
  /** Verbatim adapter outcome (S1/S3 execution); undefined on a replay. */
  readonly transfer?: DirectTransferOutcome;
  /** Verbatim scheduler effect-outcome record; undefined on a replay. */
  readonly effectOutcome?: OutcomeRecord;
  /** Writer acceptance outcome when the artifact lifecycle reached acceptance. */
  readonly acceptance?: AcceptArtifactOutcome;
  /** Verbatim typed acceptance rejection (cutoff, digest, validation...). */
  readonly acceptanceError?: PersistenceError;
  /** True when staging reused already-staged identical bytes (idempotent replay). */
  readonly stagingReused: boolean;
  /** Verbatim scheduler cutoff decision point (`tryAccept`). */
  readonly schedulerAcceptance?: ControlResult<AcceptanceOutcome>;
}

/**
 * Map the adapter's canonical terminal truth onto the scheduler's effect
 * vocabulary. This is a translation of upstream facts, never a decision:
 * only an adapter outcome of COMPLETED with all applicable validations
 * passed is SUCCEEDED; everything else is recorded truthfully as FAILED
 * with its failure category.
 */
function directEffectOutcome(outcome: DirectTransferOutcome): {
  readonly outcome: EffectOutcome;
  readonly failureCategory?: string;
} {
  if (outcome.reason === 'COMPLETED' && outcome.allApplicableValidationPassed) {
    return { outcome: 'SUCCEEDED' };
  }
  if (outcome.reason === 'COMPLETED') {
    return { outcome: 'FAILED', failureCategory: 'VALIDATION_FAILED' };
  }
  if (
    outcome.reason === 'TRANSFER_BUDGET_EXHAUSTED' ||
    outcome.reason === 'GLOBAL_SAFETY_EXHAUSTED'
  ) {
    return { outcome: 'FAILED', failureCategory: outcome.reason };
  }
  return { outcome: 'FAILED', failureCategory: outcome.reason };
}

export function attemptIdFor(workItemId: string): string {
  return `${workItemId}#attempt-1`;
}

export function acceptanceValidationOf(
  validations: DirectTransferOutcome['validations'],
): AcceptanceValidation {
  const passed = validations.filter((check) => check.passed).length;
  return {
    passed: validations.length > 0 && passed === validations.length,
    passedCount: passed,
    failedCount: validations.length - passed,
  };
}

/**
 * Execute one direct (S1/S3) acquisition end-to-end through the composed
 * runtime: submit → durable dispatch → budgeted transfer through the
 * canonical port → effect truth → staged/materialized/finalized/accepted
 * artifact → scheduler acceptance at the cutoff decision point.
 */
/**
 * S1 can use the generic direct-file Core pipeline. S3 CANNOT: S3 must pass
 * through an installation-pinned public source profile. Formerly, this
 * generic path silently called DirectHttpAdapter.acquire(S3) without that
 * profile, which would let a caller skip S3's public-only origin/redirect
 * restriction while still receiving durable Core acceptance.
 */
export async function executeDirectAcquisition(
  runtime: FlowRuntime,
  input: DirectFlowInput,
): Promise<DirectFlowOutcome> {
  if (input.transfer.slice !== 'S1') {
    throw new CoreRuntimeFlowError('S3_REQUIRES_CORE_PINNED_MEDIA_SOURCE');
  }
  return executeDirectAcquisitionWithPolicy(runtime, input);
}

/**
 * Core-only S3 entry. The policy is read from the trusted installation
 * composition, never the CLI/browser/Recipe/LLM. This exported composition
 * port is NOT a public S3 wire opcode or a user-confirmation authority.
 * A caller of the untrusted seam cannot pass a pinned policy object.
 */
export async function executePinnedPublicS3Acquisition(
  runtime: FlowRuntime,
  input: DirectFlowInput,
  pinnedSource: PinnedPublicMediaSourcePolicy,
): Promise<DirectFlowOutcome> {
  const transfer = input.transfer;
  if (
    transfer.slice !== 'S3' ||
    transfer.contractId !== input.contractId ||
    transfer.selectedMemberId !== input.memberId ||
    transfer.binding.identity !== input.targetId ||
    transfer.expectedSha256 !== undefined ||
    transfer.locatorRefresher !== undefined ||
    transfer.mediaPolicy?.signatures === undefined ||
    !Array.isArray(transfer.mediaPolicy.signatures) ||
    transfer.mediaPolicy.signatures.length === 0 ||
    transfer.mediaPolicy.signatures.length > 16 ||
    !/^(video|audio)\\/ / u.test(transfer.expectedContentTypePrefix ?? '')
  ) {
    throw new CoreRuntimeFlowError('S3_SELECTED_MEDIA_INTENT_NOT_BOUND');
  }
  // Critically, initial-source admission precedes registerLineage and every
  // persistent scheduler/SQLite record and network request.
  let initialAdmitted = false;
  try {
    initialAdmitted = pinnedSource.admitInitial(transfer.binding.locator.uri).ok;
  } catch {
    // A missing/malformed Core installation policy is never a fallback to S1.
  }
  if (!initialAdmitted) {
    throw new CoreRuntimeFlowError('S3_PUBLIC_MEDIA_SOURCE_NOT_ADMITTED');
  }
  return executeDirectAcquisitionWithPolicy(runtime, input, pinnedSource);
}

/** One canonical Core scheduler/ledger/persistence pipeline for S1 and S3. */
async function executeDirectAcquisitionWithPolicy(
  runtime: FlowRuntime,
  input: DirectFlowInput,
  pinnedSource?: PinnedPublicMediaSourcePolicy,
): Promise<DirectFlowOutcome> {
  const { submission, workItemId } = registerLineage(runtime, input, {
    commandId: input.commandId,
    memberId: input.memberId,
  });
  const lineageKey = submission.lineageKey;

  // Durable dispatch intent precedes the external effect (L2 §11 ordering).
  runtime.writer.dispatch({ workItemId, attemptId: attemptIdFor(workItemId) });
  const attempt = must(
    'startEffectAttempt',
    runtime.scheduler.startEffectAttempt(lineageKey, attemptIdFor(workItemId)),
  );

  if (attempt.replayed) {
    // At-least-once replay: the durable attempt already exists, so re-running
    // the transfer would double-execute an external effect and double-charge
    // the budget. The flow reconciles from durable truth only — never
    // re-executes.
    const schedulerAcceptance = runtime.scheduler.tryAccept(lineageKey);
    return {
      lineageKey,
      binding: submission.binding,
      workItemId,
      submission,
      attempt,
      attemptReplayed: true,
      stagingReused: false,
      ...(schedulerAcceptance === undefined ? {} : { schedulerAcceptance }),
    };
  }

  const adapter = new DirectHttpAdapter(schedulerTransferBudgetPort(runtime, lineageKey));
  const acquired =
    pinnedSource === undefined
      ? await adapter.acquire(input.transfer)
      : await adapter.acquirePublicS3(input.transfer, pinnedSource);
  const transfer = mustDomain('transfer', acquired);
  runtime.writer.recordExternalEffectObserved(workItemId);

  const effect = directEffectOutcome(transfer);
  const effectOutcome = must(
    'recordEffectOutcome',
    runtime.scheduler.recordEffectOutcome(lineageKey, {
      attemptId: attempt.attemptId,
      outcome: effect.outcome,
      ...(effect.failureCategory === undefined ? {} : { failureCategory: effect.failureCategory }),
    }),
  );

  let acceptance: AcceptArtifactOutcome | undefined;
  let acceptanceError: PersistenceError | undefined;
  let stagingReused = false;
  let schedulerAcceptance: ControlResult<AcceptanceOutcome> | undefined;
  if (transfer.bytes !== undefined && transfer.bytes.length > 0) {
    // The durable consumption mirror carries exactly what the canonical
    // ledger durably charged (stream charges are capped at the remaining
    // room), never the raw received count.
    const chargedBytes = new CoreRuntimeBudgetBridge(runtime, lineageKey).consumed().transfer.bytes;
    const staged = runtime.writer.stageArtifact({
      workItemId,
      artifactId: input.artifactId,
      bytes: transfer.bytes,
      provenance: {
        locatorChain: transfer.locatorChain.map((hop) => hop.locator.uri),
        observedIdentity: transfer.observedIdentity,
        slice: transfer.slice,
        // #101 P2-2: the accepted artifact's durable provenance carries the
        // secret-free typed Target identity basis + certainty (C34), so the
        // no-digest vs publisher-hash distinction survives restarts in the
        // SQLite record itself.
        targetEvidence: {
          basis: transfer.targetBasis,
          certaintyClass: targetCertaintyOf(transfer.targetBasis),
        },
      },
      consumption: {
        domain: 'transfer',
        limitKey: 'bytes',
        amount: Math.min(transfer.receivedBytes, chargedBytes),
        convergenceKey: `${attempt.attemptId}:bytes`,
      },
    });
    stagingReused = staged.reused;
    const validation = acceptanceValidationOf(transfer.validations);
    const lifecycle = completeArtifactLifecycle(runtime, workItemId, input.artifactId, validation);
    acceptance = lifecycle.acceptance;
    acceptanceError = lifecycle.error;
    if (acceptanceError === undefined) {
      schedulerAcceptance = runtime.scheduler.tryAccept(lineageKey);
    }
  }
  return {
    lineageKey,
    binding: submission.binding,
    workItemId,
    submission,
    attempt,
    attemptReplayed: false,
    transfer,
    effectOutcome,
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(acceptanceError === undefined ? {} : { acceptanceError }),
    stagingReused,
    ...(schedulerAcceptance === undefined ? {} : { schedulerAcceptance }),
  };
}

/**
 * Drive the durable artifact lifecycle (materialize → finalize → accept)
 * from the truthful filesystem phase, never blindly: an identical re-staging
 * (replay/restart) resumes from where the durable truth already is, and the
 * idempotent upstream transitions converge instead of re-executing.
 */
export function completeArtifactLifecycle(
  runtime: Pick<CoreRuntime, 'store' | 'writer'>,
  workItemId: string,
  artifactId: string,
  validation: AcceptanceValidation,
): { readonly acceptance?: AcceptArtifactOutcome; readonly error?: PersistenceError } {
  const phase = runtime.store.observe(artifactId).phase;
  if (phase === 'STAGED') {
    runtime.writer.materializeArtifact(workItemId, artifactId);
  }
  if (phase === 'STAGED' || phase === 'MATERIALIZED') {
    runtime.writer.finalizeArtifact(workItemId, artifactId);
  }
  try {
    return {
      acceptance: runtime.writer.acceptArtifact({
        workItemId,
        artifactId,
        validation,
      }),
    };
  } catch (error) {
    // Typed writer rejection propagates verbatim (cutoff/digest/validation);
    // the flow records the truthful terminal-failure fact and stops.
    const acceptanceError = error as PersistenceError;
    runtime.writer.recordTerminalFailure(workItemId, acceptanceError.code);
    return { error: acceptanceError };
  }
}

// ------------------------------------------------------------------ HLS S4 flow

export interface HlsFlowInput extends LineageSeed {
  /** Idempotent durable command identity for the ledger command record. */
  readonly commandId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly binding: HlsRenditionBinding;
  readonly master: MasterPlaylist | undefined;
  readonly mediaPlaylist: MediaPlaylist;
  readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
  readonly fetcher: SegmentFetcherPort;
  readonly assemblyPort: MediaAssemblyPort;
  readonly recordedAt: string;
}

export interface HlsFlowOutcome {
  readonly lineageKey: LineageKey;
  readonly workItemId: string;
  readonly submission: LineageSubmission;
  /** True when the durable attempt already existed (no re-execution). */
  readonly attemptReplayed: boolean;
  /** Verbatim pipeline outcome; undefined on a replay. */
  readonly pipeline?: HlsVodPipelineOutcome;
  /** Verbatim scheduler effect-outcome record; undefined on a replay. */
  readonly effectOutcome?: OutcomeRecord;
  readonly acceptance?: AcceptArtifactOutcome;
  readonly acceptanceError?: PersistenceError;
  readonly schedulerAcceptance?: ControlResult<AcceptanceOutcome>;
}

function hlsEffectOutcome(pipeline: HlsVodPipelineOutcome): {
  readonly outcome: EffectOutcome;
  readonly failureCategory?: string;
} {
  switch (pipeline.kind) {
    case 'COMPLETED':
      return { outcome: 'SUCCEEDED' };
    case 'BUDGET_STOPPED':
      return { outcome: 'FAILED', failureCategory: 'TRANSFER_BUDGET_EXHAUSTED' };
    case 'UNSUPPORTED':
      return {
        outcome: 'FAILED',
        failureCategory: pipeline.unsupportedReason ?? 'UNSUPPORTED',
      };
    default:
      return { outcome: 'FAILED', failureCategory: 'VALIDATION_FAILED' };
  }
}

function passedLayerCount(chain: HlsVodPipelineOutcome['chain']): number {
  if (chain === undefined) {
    return 0;
  }
  return [chain.target, chain.transfer, chain.format, chain.media].filter(
    (verdict) => verdict.status === 'PASSED',
  ).length;
}

function concatenateTransferredBytes(
  transferred: readonly SegmentAcquisitionOutcome[],
): Uint8Array {
  const chunks = transferred
    .map((outcome) => (outcome.result.ok ? outcome.result.bytes : undefined))
    .filter((bytes): bytes is Uint8Array => bytes !== undefined);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * BEGIN for both S4 transport modes: a single durable scheduler/ledger
 * admission. A duplicate attempt NEVER reaches any external async or sync
 * fetch capability, including after a crash/reopen.
 */
export interface HlsFlowStarted {
  readonly kind: 'STARTED';
  readonly submission: LineageSubmission;
  readonly workItemId: string;
  readonly lineageKey: LineageKey;
  readonly attempt: AttemptRecord;
}

export interface HlsFlowReplayed {
  readonly kind: 'REPLAY';
  readonly outcome: HlsFlowOutcome;
}

export type HlsFlowStart = HlsFlowStarted | HlsFlowReplayed;

export function beginHlsAcquisition(
  runtime: FlowRuntime,
  input: LineageSeed & { readonly commandId: string; readonly memberId: string },
): HlsFlowStart {
  const { submission, workItemId } = registerLineage(runtime, input, {
    commandId: input.commandId,
    memberId: input.memberId,
  });
  const lineageKey = submission.lineageKey;
  runtime.writer.dispatch({ workItemId, attemptId: attemptIdFor(workItemId) });
  const attempt = must(
    'startEffectAttempt',
    runtime.scheduler.startEffectAttempt(lineageKey, attemptIdFor(workItemId)),
  );

  if (attempt.replayed) {
    const schedulerAcceptance = runtime.scheduler.tryAccept(lineageKey);
    return {
      kind: 'REPLAY',
      outcome: {
        lineageKey,
        workItemId,
        submission,
        attemptReplayed: true,
        ...(schedulerAcceptance === undefined ? {} : { schedulerAcceptance }),
      },
    };
  }
  return { kind: 'STARTED', submission, workItemId, lineageKey, attempt };
}

/**
 * Persist a truthful failure after an S4 attempt has already been durably
 * started, even if manifest admission fails before Media probing.
 *
 * Only mark external effect observed when an approved fetch port was
 * actually invoked; budget denial before any HTTP is not an observation.
 * A failed control outcome can never be promoted to artifact acceptance.
 */
export function stopHlsAcquisition(
  runtime: FlowRuntime,
  started: HlsFlowStarted,
  failureCategory:
    | 'HLS_MANIFEST_ADMISSION_FAILED'
    | 'HLS_MANIFEST_FETCH_FAILED'
    | 'HLS_PIPELINE_VALIDATION_FAILED'
    | 'HLS_PIPELINE_THROWN',
  externalEffectIssued: boolean,
): HlsFlowOutcome {
  if (externalEffectIssued) {
    runtime.writer.recordExternalEffectObserved(started.workItemId);
  }
  const effectOutcome = must(
    'recordEffectOutcome',
    runtime.scheduler.recordEffectOutcome(started.lineageKey, {
      attemptId: started.attempt.attemptId,
      outcome: 'FAILED',
      failureCategory,
    }),
  );
  return {
    lineageKey: started.lineageKey,
    workItemId: started.workItemId,
    submission: started.submission,
    attemptReplayed: false,
    effectOutcome,
  };
}

/** Canonical post-effect truth/persistence logic for both S4 delivery modes. */
export function finishHlsAcquisition(
  runtime: FlowRuntime,
  input: Pick<HlsFlowInput, 'artifactId' | 'binding'>,
  started: HlsFlowStarted,
  pipeline: HlsVodPipelineOutcome,
): HlsFlowOutcome {
  const { submission, workItemId, lineageKey, attempt } = started;
  runtime.writer.recordExternalEffectObserved(workItemId);

  const effect = hlsEffectOutcome(pipeline);
  const effectOutcome = must(
    'recordEffectOutcome',
    runtime.scheduler.recordEffectOutcome(lineageKey, {
      attemptId: attempt.attemptId,
      outcome: effect.outcome,
      ...(effect.failureCategory === undefined ? {} : { failureCategory: effect.failureCategory }),
    }),
  );

  let acceptance: AcceptArtifactOutcome | undefined;
  let acceptanceError: PersistenceError | undefined;
  let schedulerAcceptance: ControlResult<AcceptanceOutcome> | undefined;
  const chain = pipeline.chain;
  if (chain !== undefined && chain.accepted && pipeline.run !== undefined) {
    const bytes = concatenateTransferredBytes(pipeline.run.transferred);
    if (bytes.length > 0) {
      runtime.writer.stageArtifact({
        workItemId,
        artifactId: input.artifactId,
        bytes,
        provenance: {
          renditionId: input.binding.renditionId,
          segmentCount: pipeline.run.transferred.length,
          transferredByteCount: bytes.length,
        },
        consumption: {
          domain: 'transfer',
          limitKey: 'segments',
          amount: pipeline.run.transferred.length,
          convergenceKey: `${attempt.attemptId}:segments`,
        },
      });
      const lifecycle = completeArtifactLifecycle(runtime, workItemId, input.artifactId, {
        passed: chain.accepted,
        passedCount: passedLayerCount(chain),
        failedCount: 4 - passedLayerCount(chain),
      });
      acceptance = lifecycle.acceptance;
      acceptanceError = lifecycle.error;
      if (acceptanceError === undefined) {
        schedulerAcceptance = runtime.scheduler.tryAccept(lineageKey);
      }
    }
  }
  return {
    lineageKey,
    workItemId,
    submission,
    attemptReplayed: false,
    pipeline,
    effectOutcome,
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(acceptanceError === undefined ? {} : { acceptanceError }),
    ...(schedulerAcceptance === undefined ? {} : { schedulerAcceptance }),
  };
}

/**
 * Synchronous fixture/provider mode retains the same Core durability and
 * result path. Real HTTP uses the new async selected-HLS path instead.
 */
export function executeHlsAcquisition(runtime: FlowRuntime, input: HlsFlowInput): HlsFlowOutcome {
  const started = beginHlsAcquisition(runtime, input);
  if (started.kind === 'REPLAY') return started.outcome;

  const snapshotId: SnapshotId | undefined =
    input.snapshotId === '' ? undefined : unwrapOrThrow(makeSnapshotId(input.snapshotId));
  const pipeline = mustDomain(
    'hls-pipeline',
    executeHlsVodAcquisition({
      contractId: unwrapOrThrow(makeContractId(input.contractId)),
      snapshotId,
      binding: input.binding,
      master: input.master,
      mediaPlaylist: input.mediaPlaylist,
      mediaPlaylistLocator: input.mediaPlaylistLocator,
      ledger: schedulerHlsTransferLedger(runtime, started.lineageKey),
      fetcher: input.fetcher,
      assemblyPort: input.assemblyPort,
      recordedAt: input.recordedAt,
    }),
  );
  return finishHlsAcquisition(runtime, input, started, pipeline);
}

// ------------------------------------------------------------------- projection

export interface LineageProjectionInput {
  readonly lineageKey: LineageKey;
  readonly contractId: string;
  readonly snapshotId?: string;
  readonly intentType: ProjectionFacts['intentType'];
  readonly scopeKind: ProjectionFacts['scopeKind'];
  readonly requestedMemberIds: readonly string[];
  readonly recordedAt: string;
  readonly enumeration: EnumerationClosure;
  readonly stopFacts?: StopFacts;
  /**
   * Caller-supplied resolution facts. The S1 target fact (`s1Target`) is
   * deliberately absent: it is derived ONLY from the Core's own durable
   * target-witness receipt (verified identity/provenance/attempt) — a
   * caller-supplied evidence string can never pretend proof (#113).
   */
  readonly resolution?: Omit<ResolutionFacts, 's1Target'>;
  /** Canonical coverage accounting built through the domain-contracts API. */
  readonly accounting?: CoverageAccounting;
  /** Independent canonical evidence ledger for persisted authorization witnesses. */
  readonly evidenceLedger?: EvidenceLedger;
  readonly coverageBasis?: CoverageEvidence;
  readonly requiredLayers?: readonly ValidationLayer[];
}

/**
 * The canonical S1 target-resolution fact source (#113): the Core's own
 * durable target witness, admitted only after verifying its exact ownership
 * binding (same aggregate, frozen snapshot, sole requested member, canonical
 * effect identity). The evidence ref resolves back to that exact witness —
 * never a caller-supplied string. Returns undefined (no fact) when no
 * verified witness exists, so auth/unsupported/cancel/collection truths are
 * untouched by construction.
 */
function verifiedS1TargetFact(
  runtime: ProjectionRuntime,
  input: LineageProjectionInput,
): ResolutionFacts['s1Target'] {
  if (runtime.seam === undefined) {
    return undefined;
  }
  if (input.intentType !== 'SINGLE_RESOURCE' || input.scopeKind !== 'single_resource') {
    return undefined;
  }
  if (input.requestedMemberIds.length !== 1) {
    return undefined;
  }
  const witness = runtime.seam.targetWitnessFor(input.contractId);
  if (witness === undefined) {
    return undefined;
  }
  if (input.snapshotId !== undefined && witness.snapshotId !== input.snapshotId) {
    return undefined;
  }
  if (witness.memberId !== input.requestedMemberIds[0]) {
    return undefined;
  }
  if (!witness.effectId.startsWith(`effect:${input.contractId}:`)) {
    return undefined;
  }
  const member = makeMemberId(witness.memberId);
  if (!member.ok) {
    return undefined;
  }
  return {
    memberId: member.value,
    evidenceRef: `target-witness:${input.contractId}:${witness.effectId}`,
    status: witness.status,
    transferAttempted: witness.transferAttempted,
  };
}

/**
 * Project one lineage's terminal result from canonical state only. The
 * runtime derives the projection facts from the scheduler's durable views,
 * the recovery classification and the budget stop projection — and terminal
 * truth is produced exclusively by the domain-contracts result projector
 * (never by glue).
 */
export function projectLineageResult(
  runtime: ProjectionRuntime,
  input: LineageProjectionInput,
): DomainValidationResult<ProjectedTerminalResult> {
  const view = runtime.scheduler.lineageView(input.lineageKey);
  if (view === undefined) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'lineageKey',
        'no durable control facts exist for this lineage; nothing to project',
      ),
    ]);
  }
  const workItems = runtime.writer.reader
    .workItems()
    .filter((workItem) => workItem.contractId === input.contractId);
  const acceptedMemberIds: MemberId[] = [];
  // Per-member required-validation outcomes derived from durable recovery
  // truth only: accepted+bytesVerified is VALIDATED (the writer gated
  // acceptance on the adapters' validate chains), an explicit terminal
  // failure is VALIDATION_FAILED, everything else stays NOT_VALIDATED.
  const classificationByMember = new Map<string, RecoveryClassification>();
  for (const workItem of workItems) {
    const classification = runtime.recovery.classify(workItem.workItemId);
    classificationByMember.set(workItem.memberId, classification);
    if (classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified) {
      const member = makeMemberId(workItem.memberId);
      if (member.ok) {
        acceptedMemberIds.push(member.value);
      }
    }
  }
  // The outcomes cover the frozen SELECTED set: for single-resource scopes
  // the requested set itself, for collections the accounting's selected set.
  const selectedSet: readonly string[] =
    input.scopeKind === 'single_resource' || input.accounting === undefined
      ? input.requestedMemberIds
      : (input.accounting.selected as readonly string[]);
  const memberValidation = selectedSet.map((raw) => {
    const member = unwrapOrThrow(makeMemberId(raw));
    const classification = classificationByMember.get(raw);
    const result: MemberRequiredValidation['result'] =
      classification === undefined
        ? 'NOT_VALIDATED'
        : classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified
          ? 'VALIDATED'
          : classification.lifecycleClass === 'TERMINAL_FAILED'
            ? 'VALIDATION_FAILED'
            : 'NOT_VALIDATED';
    return { memberId: member, result };
  });

  const budgetStop = must(
    'projectBudgetStop',
    runtime.scheduler.projectBudgetStop(input.lineageKey),
  );
  // StopFacts is readonly; budget-truth flags from the canonical stop
  // projection are merged without rewriting caller-supplied facts.
  const stopFacts: StopFacts = {
    ...input.stopFacts,
    ...(budgetStop.exhaustedDomains.includes('discovery')
      ? { discoveryBudgetExhausted: true }
      : {}),
    ...(budgetStop.exhaustedDomains.includes('transfer') ? { transferBudgetExhausted: true } : {}),
    ...(budgetStop.exhaustedDomains.includes('global_safety') ? { globalSafetyLimit: true } : {}),
  };

  const cancelAt = effectiveCancellation(view);
  const acceptedAt = view.acceptedAt;
  const cancellation =
    cancelAt === undefined
      ? undefined
      : {
          // ADR-013 cutoff from the single durable order: acceptance committed
          // before the cancellation authority stands; anything else stays
          // unaccepted across the cutoff.
          acceptedBeforeCutoff:
            acceptedAt !== undefined &&
            acceptanceCutoff(cancelAt, acceptedAt) === 'ACCEPTANCE_STANDS'
              ? acceptedMemberIds
              : [],
        };

  // #113: the S1 target fact is joined from the Core's own durable witness
  // (verified binding) — the single canonical source for both the S1 driver
  // and every other projection consumer. A caller-supplied value is
  // unrepresentable at this boundary (type-level) and never synthesized.
  const s1Target = verifiedS1TargetFact(runtime, input);
  const resolution: ResolutionFacts | undefined =
    input.resolution === undefined && s1Target === undefined
      ? undefined
      : {
          ...(input.resolution ?? {}),
          ...(s1Target === undefined ? {} : { s1Target }),
        };

  const facts: ProjectionFacts = {
    contractId: unwrapOrThrow(makeContractId(input.contractId)),
    ...(input.snapshotId === undefined
      ? {}
      : { snapshotId: unwrapOrThrow(makeSnapshotId(input.snapshotId)) }),
    intentType: input.intentType,
    scopeKind: input.scopeKind,
    recordedAt: input.recordedAt,
    requestedMemberIds: input.requestedMemberIds.map((raw) => unwrapOrThrow(makeMemberId(raw))),
    acceptedSelectedMemberIds: acceptedMemberIds,
    memberValidation,
    ...(input.accounting === undefined ? {} : { accounting: input.accounting }),
    ...(input.coverageBasis === undefined ? {} : { coverageBasis: input.coverageBasis }),
    ...(input.requiredLayers === undefined ? {} : { requiredLayers: input.requiredLayers }),
    enumeration: input.enumeration,
    stopFacts,
    ...(cancellation === undefined ? {} : { cancellation }),
    ...(resolution === undefined ? {} : { resolution }),
  };
  // Validate without mutating terminal-store authority. A seam receipt failure
  // cannot leave behind a published in-memory terminal result.
  const checked = projectResult(facts);
  if (!checked.ok) return checked;
  if (
    input.accounting !== undefined &&
    runtime.seam !== undefined &&
    runtime.seam.inspectProjection(input.contractId) !== undefined
  ) {
    // Only an already registered Core seam lineage is eligible for a
    // persistent receipt; unrelated internal projection consumers remain
    // backward-compatible and never fabricate a surface lineage.
    const recorded = runtime.seam.recordCoverageAccounting(
      input.contractId,
      input.accounting,
      input.evidenceLedger,
    );
    if (!recorded.ok) {
      return fail(
        recorded.diagnostics.map((item) =>
          diagnostic('ADMISSION_REJECTED', item.path, item.message),
        ),
      );
    }
  }
  return runtime.terminalStore.project(facts);
}

/** Convenience: the canonical effect identity for a frozen work triple. */
export function effectIdFor(
  contractId: string,
  snapshotId: string,
  targetId: string,
): DomainValidationResult<EffectId> {
  const contract = makeContractId(contractId);
  if (!contract.ok) return contract;
  const snapshot = makeSnapshotId(snapshotId);
  if (!snapshot.ok) return snapshot;
  const target = makeLogicalTargetId(targetId);
  if (!target.ok) return target;
  return canonicalEffectId(contract.value, snapshot.value, target.value);
}
