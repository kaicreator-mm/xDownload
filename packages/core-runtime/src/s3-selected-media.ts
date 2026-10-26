/**
 * #150 S3 selected-media Core driver behind the two-step 1.2 authority pair
 * (CONFIRM_S3_CANDIDATE → EXECUTE_S3_SELECTED_MEDIA).
 *
 * Mirrors the S1 drive discipline (s1-direct.ts) for the S3 lane:
 * - the seam's synchronous authority apply only registered one durable
 *   execution intent over the ALREADY durably confirmed candidate; this
 *   driver performs the REAL HTTP transfer strictly after the accepted
 *   command journal commit, through the Core-owned supported-profile
 *   MediaPolicy and the mature-client direct port;
 * - reconcile-first: a durable work item for the canonical effect identity
 *   never re-executes the external transfer; the terminal is re-derived from
 *   durable truth only (no re-download of an accepted artifact);
 * - the Target identity basis of this lane is ALWAYS the conservative
 *   REQUESTED_LOCATOR_PROVENANCE/PROBATIVE pair (L2 S3 §3): a user-supplied
 *   byte constraint may reject mismatched bytes but never becomes a
 *   publisher-digest DECISIVE oracle (C34);
 * - a driver failure never invents terminal truth: the intent stays
 *   registered so a later reconcile can re-drive it.
 */

import { effectiveCancellation, lineageKeyOf } from '@xdownload/core-scheduler';
import {
  bindLocator,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  unwrapOrThrow,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type CoreSeamServer,
  type S3CandidateRecord,
  type SeamResult,
  type TargetWitnessReceipt,
} from '@xdownload/core-seam';
import {
  lookupSupportedMediaProfile,
  mediaPolicyOfProfile,
  type DirectTransferOutcome,
} from '@xdownload/direct-acquisition';
import {
  CoreRuntimeFlowError,
  cancelLineage,
  executeS3SelectedMediaAcquisition,
  attemptIdFor,
  projectLineageResult,
  registerLineage,
  type DirectFlowInput,
  type DirectFlowOutcome,
  type FlowRuntime,
  type LineageSeed,
} from './flow.ts';
import type { S1TransferAbortHub } from './s1-transfer-abort.ts';

/** The runtime pieces the S3 driver composes (same ports as the S1 lane). */
export type S3DriveRuntime = FlowRuntime & {
  readonly seam: CoreSeamServer;
  readonly s1TransferAbort?: S1TransferAbortHub;
};

/**
 * The canonical effect/lineage/artifact identity of one S3 selected-media
 * execution: derived identically on every drive so cancel/replay/reconcile
 * land on the same frozen lineage (mirrors the S1 identity derivation). Both
 * canonical ids must fit their 128-char bounds BEFORE any transfer can start.
 */
export function s3EffectIdentity(input: {
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
    const artifactId = `s3artifact:${input.contractId}:${input.snapshotId}:${input.memberId}`;
    if (effectId.length > 128 || artifactId.length > 128) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'identity',
          'the canonical composite S3 identity exceeds the 128-char id bound',
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
        'the S3 execution identity does not form canonical ids',
      ),
    ]);
  }
}

/** Map a truthful adapter failure reason onto projector stop facts. */
function stopFactsOf(outcome: DirectTransferOutcome | undefined): Record<string, boolean> {
  if (outcome === undefined) {
    return {};
  }
  switch (outcome.reason) {
    case 'AUTH_REQUIRED':
      return { authRequired: true };
    case 'TRUNCATED':
    case 'NO_PROGRESS':
      return { noProgress: true };
    case 'TRANSFER_BUDGET_EXHAUSTED':
      return { transferBudgetExhausted: true };
    case 'GLOBAL_SAFETY_EXHAUSTED':
      return { globalSafetyLimit: true };
    case 'COMPLETED':
      return outcome.allApplicableValidationPassed ? {} : { validationFailed: true };
    case 'USER_CANCELLED':
      return {};
    default:
      return { validationFailed: true };
  }
}

function hostOf(uri: string): string | undefined {
  try {
    return new URL(uri).host;
  } catch {
    return undefined;
  }
}

const PROVENANCE_UNPROVEN_REASONS: ReadonlySet<string> = new Set([
  'REDIRECT_SCOPE_EXPANSION',
  'LOCATOR_SUBSTITUTION',
]);

interface WitnessInputs {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly effectId: string;
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
}

function witnessBase(
  inputs: WitnessInputs,
  observedRedirectHosts: readonly string[],
): Pick<
  TargetWitnessReceipt,
  | 'snapshotId'
  | 'memberId'
  | 'artifactId'
  | 'effectId'
  | 'locatorUri'
  | 'declaredRedirectHosts'
  | 'observedRedirectHosts'
  | 'transferAttempted'
> {
  return {
    snapshotId: inputs.snapshotId,
    memberId: inputs.memberId,
    artifactId: inputs.artifactId,
    effectId: inputs.effectId,
    locatorUri: inputs.locatorUri,
    declaredRedirectHosts: [...inputs.declaredRedirectHosts],
    observedRedirectHosts,
    transferAttempted: true,
  };
}

/**
 * S3 witness from the ACTUAL transfer truth: bytes arrived through the
 * fail-closed declared delivery graph ⇒ RESOLVED on the conservative
 * provenance basis — the S3 lane NEVER records the DECISIVE publisher-digest
 * pair, even when the user-supplied byte constraint matched (C34 / L2 §3).
 */
function witnessFromTransfer(
  inputs: WitnessInputs,
  outcome: DirectTransferOutcome,
): TargetWitnessReceipt | undefined {
  const bytesArrived = outcome.bytes !== undefined && outcome.bytes.length > 0;
  const observedHosts = [
    ...new Set(
      outcome.locatorChain
        .map((hop) => hostOf(hop.locator.uri))
        .filter((host): host is string => host !== undefined),
    ),
  ];
  if (bytesArrived) {
    return {
      ...witnessBase(inputs, observedHosts),
      status: 'RESOLVED',
      basis: 'REQUESTED_LOCATOR_PROVENANCE',
      certaintyClass: 'PROBATIVE',
    };
  }
  if (PROVENANCE_UNPROVEN_REASONS.has(outcome.reason)) {
    return {
      ...witnessBase(inputs, observedHosts),
      status: 'PROVENANCE_UNPROVEN',
      unprovenReason: outcome.reason,
    };
  }
  return undefined;
}

/** Re-derive the identical S3 witness from durable truth (restart/replay). */
function witnessFromDurableTruth(
  runtime: S3DriveRuntime,
  inputs: WitnessInputs,
  workItemId: string,
  lineageKey: string,
): SeamResult<TargetWitnessReceipt | undefined> {
  const artifact = runtime.writer.reader
    .artifacts(workItemId)
    .find((row) => row.artifactId === inputs.artifactId);
  if (artifact !== undefined) {
    let provenance: {
      readonly locatorChain?: readonly string[];
    };
    try {
      provenance = JSON.parse(artifact.provenanceJson) as typeof provenance;
    } catch (error) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'targetWitness.provenance',
          `the staged artifact provenance is not decodable; no witness can be derived from it: ${String(error)}`,
        ),
      ]);
    }
    const observedHosts = [
      ...new Set(
        (provenance.locatorChain ?? [])
          .map((uri) => hostOf(uri))
          .filter((host): host is string => host !== undefined),
      ),
    ];
    return seamOk({
      ...witnessBase(inputs, observedHosts),
      status: 'RESOLVED',
      basis: 'REQUESTED_LOCATOR_PROVENANCE',
      certaintyClass: 'PROBATIVE',
    });
  }
  const outcome = runtime.scheduler.durableEffectOutcome(lineageKey, attemptIdFor(workItemId));
  const effectReason = outcome?.outcome === 'FAILED' ? outcome.failureCategory : undefined;
  if (effectReason !== undefined && PROVENANCE_UNPROVEN_REASONS.has(effectReason)) {
    const originHost = hostOf(inputs.locatorUri);
    return seamOk({
      ...witnessBase(inputs, originHost === undefined ? [] : [originHost]),
      status: 'PROVENANCE_UNPROVEN',
      unprovenReason: effectReason,
    });
  }
  return seamOk(undefined);
}

function seedOf(
  contract: AcquisitionContract,
  candidate: S3CandidateRecord,
  memberId: string,
): LineageSeed {
  return {
    contractId: contract.contractId,
    snapshotId: candidate.snapshotId,
    targetId: contract.requestedTarget,
    authorizationContextRef: contract.authorizationContextRef,
    budgetProfile: contract.budgetProfile,
    frozenMemberIds: [memberId],
  };
}

function seamLineageStatus(
  runtime: S3DriveRuntime,
  aggregateId: string,
): 'ACTIVE' | 'CANCELLED' | 'TERMINAL' | undefined {
  return runtime.seam.inspectProjection(aggregateId)?.lineage.status;
}

function workItemCreatedAt(runtime: S3DriveRuntime, workItemId: string): string {
  return (
    runtime.writer.reader.workItems().find((item) => item.workItemId === workItemId)?.createdAt ??
    new Date().toISOString()
  );
}

/**
 * Drive one registered S3 selected-media execution to a Core-derived
 * terminal (see the module header; the S1 discipline applies verbatim).
 */
export async function driveS3SelectedMediaExecution(
  runtime: S3DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly candidate: S3CandidateRecord;
  },
): Promise<SeamResult<void>> {
  const candidate = input.candidate;
  if (input.contract.intentType !== 'SINGLE_RESOURCE') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S3 selected-media driver serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S3',
      ),
    ]);
  }
  const profile = lookupSupportedMediaProfile(candidate.mediaProfileId);
  if (profile === undefined) {
    return seamFail([
      seamDiagnostic(
        'MEDIA_POLICY_REQUIRED',
        'candidate.mediaProfileId',
        'the confirmed candidate names a media profile absent from the current Core registry; execution fails closed',
        'L2-S3-§2.4',
      ),
    ]);
  }
  const identity = s3EffectIdentity({
    contractId: input.contract.contractId,
    snapshotId: candidate.snapshotId,
    targetId: input.contract.requestedTarget,
    memberId: candidate.memberId,
  });
  if (!identity.ok) {
    return identity;
  }
  const { effectId, lineageKey, artifactId } = identity.value;
  const commandId = `s3-media:${input.contract.contractId}:${candidate.snapshotId}:${candidate.memberId}`;
  const witnessInputs: WitnessInputs = {
    snapshotId: candidate.snapshotId,
    memberId: candidate.memberId,
    artifactId,
    effectId,
    locatorUri: candidate.locatorUri,
    declaredRedirectHosts: candidate.declaredRedirectHosts,
  };

  // Replay/restart reconcile: the durable ledger already carries this
  // effect — re-derive the identical terminal from durable truth only.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    const witness = witnessFromDurableTruth(
      runtime,
      witnessInputs,
      existing.workItemId,
      lineageKey,
    );
    if (!witness.ok) {
      return witness;
    }
    const recorded = recordWitnessBeforeTerminal(runtime, input.aggregateId, witness.value);
    if (!recorded.ok) {
      return recorded;
    }
    if (
      witness.value?.status === 'PROVENANCE_UNPROVEN' &&
      seamLineageStatus(runtime, input.aggregateId) !== 'CANCELLED' &&
      runtime.recovery.classify(existing.workItemId).lifecycleClass !== 'ACCEPTED'
    ) {
      const unprovenReason = witness.value.unprovenReason;
      if (unprovenReason === undefined) {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'targetWitness.unprovenReason',
            'an unproven Target witness has no durable failure reason',
          ),
        ]);
      }
      runtime.writer.recordTerminalFailure(existing.workItemId, unprovenReason);
      const failed = runtime.seam.recordFailedMembers(input.aggregateId, [candidate.memberId]);
      if (!failed.ok) return failed;
    }
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey,
      contract: input.contract,
      candidate,
      workItemId: existing.workItemId,
      recordedAt: existing.createdAt,
      memberValidated:
        runtime.recovery.classify(existing.workItemId).lifecycleClass === 'ACCEPTED' &&
        runtime.recovery.classify(existing.workItemId).bytesVerified,
      stopFacts: {},
      artifactId,
    });
  }

  // Cancellation checkpoint before dispatch (no transfer, no socket).
  if (seamLineageStatus(runtime, input.aggregateId) === 'CANCELLED') {
    const registered = registerLineage(
      runtime,
      seedOf(input.contract, candidate, candidate.memberId),
      { commandId, memberId: candidate.memberId },
    );
    cancelLineage(runtime, lineageKey, 'CORE_POLICY', registered.workItemId);
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey,
      contract: input.contract,
      candidate,
      workItemId: registered.workItemId,
      recordedAt: new Date().toISOString(),
      memberValidated: false,
      stopFacts: {},
      artifactId,
    });
  }

  const bound = bindLocator(
    { kind: 'direct', uri: candidate.locatorUri },
    input.contract.requestedTarget,
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: candidate.locatorUri,
    },
  );
  if (!bound.ok) {
    return seamFail(
      bound.diagnostics.map((d) => seamDiagnostic(d.code, d.path, d.message, d.invariant)),
    );
  }
  // The delivery graph the adapter may traverse: the selected locator's own
  // host (with its explicit port, if any) plus the declared redirect hosts.
  const locatorHost = hostOf(candidate.locatorUri);
  const allowedRedirectHosts = [
    ...(locatorHost === undefined ? [] : [locatorHost]),
    ...candidate.declaredRedirectHosts.filter((host) => host !== locatorHost),
  ];
  const signal = runtime.s1TransferAbort?.register(input.aggregateId);
  let flow: DirectFlowOutcome;
  try {
    const transferInput = {
      effectId: unwrapOrThrow(makeEffectId(effectId)),
      contractId: input.contract.contractId,
      slice: 'S3' as const,
      selectedMemberId: unwrapOrThrow(makeMemberId(candidate.memberId)),
      binding: bound.value,
      mediaPolicy: mediaPolicyOfProfile(profile),
      ...(candidate.byteConstraintSha256 === undefined
        ? {}
        : { byteConstraintSha256: candidate.byteConstraintSha256 }),
      ...(candidate.expectedContentTypePrefix === undefined
        ? {}
        : { expectedContentTypePrefix: candidate.expectedContentTypePrefix }),
      ...(candidate.expectedTotalBytes === undefined
        ? {}
        : { expectedTotalBytes: candidate.expectedTotalBytes }),
      allowedRedirectHosts,
      attempt: 0,
      ...(signal === undefined ? {} : { signal }),
    };
    const flowInput = {
      contractId: input.contract.contractId,
      snapshotId: candidate.snapshotId,
      targetId: input.contract.requestedTarget,
      authorizationContextRef: input.contract.authorizationContextRef,
      budgetProfile: input.contract.budgetProfile,
      frozenMemberIds: [candidate.memberId],
      commandId,
      memberId: candidate.memberId,
      artifactId,
      transfer: transferInput,
    } as unknown as DirectFlowInput;
    flow = await executeS3SelectedMediaAcquisition(runtime, flowInput);
  } catch (error) {
    if (error instanceof CoreRuntimeFlowError) {
      return seamFail([seamDiagnostic('ADMISSION_REJECTED', 'flow', error.message, 'L2-§6.3')]);
    }
    throw error;
  } finally {
    if (signal !== undefined) {
      runtime.s1TransferAbort?.release(input.aggregateId);
    }
  }

  // Immutable target witness from the actual transfer truth BEFORE any
  // terminal authority handover (identical discipline to the S1 lane).
  const witnessResult =
    flow.transfer === undefined
      ? witnessFromDurableTruth(runtime, witnessInputs, flow.workItemId, lineageKey)
      : seamOk(witnessFromTransfer(witnessInputs, flow.transfer));
  if (!witnessResult.ok) {
    return witnessResult;
  }
  const recordedWitness = recordWitnessBeforeTerminal(
    runtime,
    input.aggregateId,
    witnessResult.value,
  );
  if (!recordedWitness.ok) {
    return recordedWitness;
  }

  // Cancellation checkpoint after the transfer: the user's cancel is
  // authoritative; no failure accounting crosses the cutoff.
  const cancelledView = runtime.scheduler.lineageView(flow.lineageKey);
  const cancelled =
    seamLineageStatus(runtime, input.aggregateId) === 'CANCELLED' ||
    (cancelledView !== undefined && effectiveCancellation(cancelledView) !== undefined);
  if (cancelled) {
    cancelLineage(runtime, flow.lineageKey, 'CORE_POLICY', flow.workItemId);
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey: flow.lineageKey,
      contract: input.contract,
      candidate,
      workItemId: flow.workItemId,
      recordedAt: workItemCreatedAt(runtime, flow.workItemId),
      memberValidated:
        runtime.recovery.classify(flow.workItemId).lifecycleClass === 'ACCEPTED' &&
        runtime.recovery.classify(flow.workItemId).bytesVerified,
      stopFacts: {},
      artifactId,
    });
  }

  // Truthful failure accounting (identical to S1).
  const classification = runtime.recovery.classify(flow.workItemId);
  const memberValidated =
    classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
  if (!memberValidated) {
    runtime.writer.recordTerminalFailure(
      flow.workItemId,
      flow.transfer?.reason ?? flow.acceptanceError?.code ?? 'NETWORK_FAILURE',
    );
    runtime.seam.recordFailedMembers(input.aggregateId, [candidate.memberId]);
  }
  return projectAndRecord(runtime, {
    aggregateId: input.aggregateId,
    lineageKey: flow.lineageKey,
    contract: input.contract,
    candidate,
    workItemId: flow.workItemId,
    recordedAt: workItemCreatedAt(runtime, flow.workItemId),
    memberValidated,
    stopFacts: stopFactsOf(flow.transfer),
    artifactId,
  });
}

function recordWitnessBeforeTerminal(
  runtime: S3DriveRuntime,
  aggregateId: string,
  witness: TargetWitnessReceipt | undefined,
): SeamResult<void> {
  if (witness === undefined) {
    return seamOk(undefined);
  }
  const existing = runtime.seam.targetWitnessFor(aggregateId);
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(witness)) {
    return seamOk(undefined);
  }
  const recorded = runtime.seam.recordTargetWitness(aggregateId, witness);
  return recorded.ok ? seamOk(undefined) : recorded;
}

/**
 * Derive the terminal through the T007 projector and hand it to the seam
 * (ACTIVE → recordExecutedTerminal; CANCELLED → the ADR-013 cutoff closure;
 * TERMINAL → converge). The S3 Target evidence receipt is ALWAYS the
 * conservative provenance basis (PROBATIVE) — this lane has no
 * publisher-digest anchor (L2 S3 §3).
 */
function projectAndRecord(
  runtime: S3DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly lineageKey: string;
    readonly contract: AcquisitionContract;
    readonly candidate: S3CandidateRecord;
    readonly workItemId: string;
    readonly recordedAt: string;
    readonly memberValidated: boolean;
    readonly stopFacts: Record<string, boolean>;
    readonly artifactId: string;
  },
): SeamResult<void> {
  const status = seamLineageStatus(runtime, input.aggregateId);
  if (status === 'TERMINAL') {
    return seamOk(undefined);
  }
  if (status === 'CANCELLED') {
    cancelLineage(runtime, input.lineageKey, 'CORE_POLICY', input.workItemId);
  }
  if (input.memberValidated) {
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
    const recorded = runtime.seam.recordTargetEvidence(input.aggregateId, {
      artifactId: input.artifactId,
      effectId: `effect:${input.contract.contractId}:${input.candidate.snapshotId}:${input.contract.requestedTarget}`,
      artifactSha256: digest,
      basis: 'REQUESTED_LOCATOR_PROVENANCE',
      certaintyClass: 'PROBATIVE',
    });
    if (!recorded.ok) {
      return recorded;
    }
  }
  const projected = projectLineageResult(runtime, {
    lineageKey: input.lineageKey,
    contractId: input.contract.contractId,
    snapshotId: input.candidate.snapshotId,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [input.candidate.memberId],
    recordedAt: input.recordedAt,
    enumeration: { kind: 'NOT_APPLICABLE' },
    ...(Object.keys(input.stopFacts).length === 0 ? {} : { stopFacts: input.stopFacts }),
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
