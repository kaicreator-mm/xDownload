/**
 * T009 — applicable validation chain and canonical outcome projection.
 *
 * Frozen L2 invariants 17/18: the adapter emits canonical effect/evidence/
 * validation records and does not invent its own success semantics; accepted
 * artifacts require the applicable manifest/rendition/segment/format/media/
 * target validation chain. Segment-count or byte-total equality alone is
 * never media validity; missing/truncated/failed segments forbid acceptance;
 * confirmation cannot waive validation (PRD §21, C26/C27); insufficient
 * evidence stays insufficient (C22).
 *
 * Terminal outcomes are minted exclusively through the canonical
 * buildTerminalResult + validateTerminalResult semantics — the adapter has
 * no local success projection (an invalid combination fails closed instead
 * of being emitted).
 */

import {
  assertValidatesRequiredLayer,
  buildTerminalResult,
  currentSchemaIdentity,
  deepFreeze,
  diagnostic,
  evidenceRecord,
  fail,
  makeEvidenceId,
  makeMemberId,
  ok,
  unwrapOrThrow,
  validateTerminalResult,
  type ContractId,
  type DomainValidationResult,
  type EvidenceRecord,
  type SnapshotId,
  type StopReason,
  type TerminalResult,
  type ValidationLayer,
  type ValidationSummaryStatus,
} from '@xdownload/domain-contracts';
import type { HlsRenditionBinding } from './bind.ts';
import type { SegmentPlan } from './plan.ts';
import type { AcquisitionRun } from './acquire.ts';
import type { UnsupportedTopologyReason } from './topology.ts';
import type { MediaAssemblyProbeOutcome } from './assemble.ts';

export type LayerStatus = 'PASSED' | 'FAILED' | 'NOT_PERFORMED';

export interface LayerVerdict {
  readonly layer: ValidationLayer;
  readonly status: LayerStatus;
  readonly evidence: EvidenceRecord | undefined;
  readonly detail: string | undefined;
}

export interface HlsValidationChain {
  readonly kind: 'hls-validation-chain';
  readonly target: LayerVerdict;
  readonly transfer: LayerVerdict;
  readonly format: LayerVerdict;
  readonly media: LayerVerdict;
  readonly evidence: readonly EvidenceRecord[];
  /** All applicable layers passed — the precondition for canonical acceptance. */
  readonly accepted: boolean;
  readonly outcomeClass: 'MEDIA_ACCEPTED' | 'VALIDATION_FAILED' | 'INSUFFICIENT_EVIDENCE';
}

const LAYER_DOMAIN = 'SINGLE_RESOURCE_TRANSFER' as const;

function mintLayerEvidence(input: {
  readonly targetId: string;
  readonly evidenceIdSuffix: string;
  readonly claimType: 'RESOURCE_IDENTITY' | 'TRANSFER' | 'FORMAT' | 'MEDIA';
  readonly sourceIdentity: string;
}): EvidenceRecord {
  // Deterministic, pattern-conforming evidence ids; a malformed id here is an
  // adapter invariant violation, surfaced through the canonical typed error.
  const evidenceId = unwrapOrThrow(
    makeEvidenceId(`ev:${input.targetId}:${input.evidenceIdSuffix}`),
  );
  return evidenceRecord({
    evidenceId,
    claimType: input.claimType,
    claimSubject: { kind: 'LOGICAL_TARGET', ref: input.targetId },
    sourceType: input.claimType === 'TRANSFER' ? 'TRANSFER_OBSERVATION' : 'INDEPENDENT_VALIDATOR',
    provenance: {
      sourceIdentity: input.sourceIdentity,
      executionContext: { toolsUsed: [input.sourceIdentity], budgetRefs: [] },
    },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: LAYER_DOMAIN },
    certaintyClass: 'DECISIVE',
  });
}

/**
 * Run the applicable validation chain over a bound plan, an acquisition run
 * and the assembly/probe outcome. The probe outcome carries probe facts
 * only; canonical evidence records are minted here.
 */
export function runHlsValidationChain(input: {
  readonly binding: HlsRenditionBinding;
  readonly plan: SegmentPlan;
  readonly run: AcquisitionRun;
  readonly probe: MediaAssemblyProbeOutcome | undefined;
  readonly probeToolId: string | undefined;
}): HlsValidationChain {
  const { binding, plan, run, probe } = input;
  const targetId = binding.logicalTargetId;

  // Target layer: the frozen binding is intact and every planned locator
  // provenance-descends from the selected manifest (enforced at bind/plan).
  const targetEvidence = mintLayerEvidence({
    targetId,
    evidenceIdSuffix: 'target',
    claimType: 'RESOURCE_IDENTITY',
    sourceIdentity: 'hls-vod-adapter/target-binding',
  });
  const targetVerdict: LayerVerdict =
    assertValidatesRequiredLayer(targetEvidence, 'target').ok &&
    plan.binding.logicalTargetId === targetId
      ? { layer: 'target', status: 'PASSED', evidence: targetEvidence, detail: undefined }
      : {
          layer: 'target',
          status: 'FAILED',
          evidence: targetEvidence,
          detail: 'binding/plan identity correspondence failed',
        };

  // Transfer layer: every planned segment transferred on this lineage.
  const allTransferred = run.stop.kind === 'ALL_SEGMENTS_TRANSFERRED';
  const transferEvidence = mintLayerEvidence({
    targetId,
    evidenceIdSuffix: 'transfer',
    claimType: 'TRANSFER',
    sourceIdentity: 'hls-vod-adapter/segment-acquisition',
  });
  const transferVerdict: LayerVerdict = allTransferred
    ? { layer: 'transfer', status: 'PASSED', evidence: transferEvidence, detail: undefined }
    : {
        layer: 'transfer',
        status: 'FAILED',
        evidence: transferEvidence,
        detail: `acquisition stopped: ${run.stop.kind}`,
      };

  // Format/media layers: typed probe facts through the assembly port.
  if (probe === undefined) {
    const formatVerdict: LayerVerdict = {
      layer: 'format',
      status: 'NOT_PERFORMED',
      evidence: undefined,
      detail: 'assembly/probe did not run (acquisition incomplete)',
    };
    const mediaVerdict: LayerVerdict = {
      layer: 'media',
      status: 'NOT_PERFORMED',
      evidence: undefined,
      detail: 'assembly/probe did not run (acquisition incomplete)',
    };
    return assembleChain({
      targetVerdict,
      transferVerdict,
      formatVerdict,
      mediaVerdict,
      outcomeClass: 'VALIDATION_FAILED',
    });
  }
  if (probe.kind === 'INSUFFICIENT_EVIDENCE') {
    // C22: no post-hoc conversion of missing evidence into PASS.
    const formatVerdict: LayerVerdict = {
      layer: 'format',
      status: 'NOT_PERFORMED',
      evidence: undefined,
      detail: `probe produced insufficient evidence: ${probe.detail}`,
    };
    const mediaVerdict: LayerVerdict = {
      layer: 'media',
      status: 'NOT_PERFORMED',
      evidence: undefined,
      detail: `probe produced insufficient evidence: ${probe.detail}`,
    };
    return assembleChain({
      targetVerdict,
      transferVerdict,
      formatVerdict,
      mediaVerdict,
      outcomeClass: 'INSUFFICIENT_EVIDENCE',
    });
  }
  const report = probe.report;
  const probeTool = input.probeToolId ?? 'unknown-media-tool';
  const formatChecksPassed =
    report.containerMarkersPresent && report.matchesDeclaredRendition && report.allSegmentsValid;
  const formatEvidence = mintLayerEvidence({
    targetId,
    evidenceIdSuffix: 'format',
    claimType: 'FORMAT',
    sourceIdentity: probeTool,
  });
  const formatLayerOk = assertValidatesRequiredLayer(formatEvidence, 'format').ok;
  const formatVerdict: LayerVerdict =
    formatChecksPassed && formatLayerOk
      ? { layer: 'format', status: 'PASSED', evidence: formatEvidence, detail: undefined }
      : {
          layer: 'format',
          status: 'FAILED',
          evidence: formatEvidence,
          detail: `format validation failed: ${report.checks.join(', ')}`,
        };
  const mediaChecksPassed =
    report.observedIdentitySetMatchesPlan &&
    report.allSegmentsValid &&
    report.durationConsistent &&
    report.containerMarkersPresent;
  const mediaEvidence = mintLayerEvidence({
    targetId,
    evidenceIdSuffix: 'media',
    claimType: 'MEDIA',
    sourceIdentity: probeTool,
  });
  const mediaLayerOk = assertValidatesRequiredLayer(mediaEvidence, 'media').ok;
  const mediaVerdict: LayerVerdict =
    mediaChecksPassed && mediaLayerOk
      ? { layer: 'media', status: 'PASSED', evidence: mediaEvidence, detail: undefined }
      : {
          layer: 'media',
          status: 'FAILED',
          evidence: mediaEvidence,
          detail: `media validation failed: ${report.checks.join(', ')}`,
        };
  return assembleChain({
    targetVerdict,
    transferVerdict,
    formatVerdict,
    mediaVerdict,
    outcomeClass: formatChecksPassed && mediaChecksPassed ? 'MEDIA_ACCEPTED' : 'VALIDATION_FAILED',
  });
}

function assembleChain(input: {
  readonly targetVerdict: LayerVerdict;
  readonly transferVerdict: LayerVerdict;
  readonly formatVerdict: LayerVerdict;
  readonly mediaVerdict: LayerVerdict;
  readonly outcomeClass: HlsValidationChain['outcomeClass'];
}): HlsValidationChain {
  const evidence = [
    input.targetVerdict,
    input.transferVerdict,
    input.formatVerdict,
    input.mediaVerdict,
  ]
    .map((verdict) => verdict.evidence)
    .filter((record): record is EvidenceRecord => record !== undefined);
  const accepted =
    input.targetVerdict.status === 'PASSED' &&
    input.transferVerdict.status === 'PASSED' &&
    input.formatVerdict.status === 'PASSED' &&
    input.mediaVerdict.status === 'PASSED';
  return deepFreeze({
    kind: 'hls-validation-chain' as const,
    target: input.targetVerdict,
    transfer: input.transferVerdict,
    format: input.formatVerdict,
    media: input.mediaVerdict,
    evidence,
    accepted,
    outcomeClass: accepted ? 'MEDIA_ACCEPTED' : input.outcomeClass,
  });
}

export interface HlsAdapterOutcome {
  readonly kind: 'COMPLETED' | 'FAILED' | 'BUDGET_STOPPED' | 'UNSUPPORTED';
  readonly chain: HlsValidationChain | undefined;
  readonly unsupportedReason: UnsupportedTopologyReason | undefined;
  readonly terminal: TerminalResult;
  readonly evidence: readonly EvidenceRecord[];
}

export interface OutcomeProjectionInput {
  /** Owning AcquisitionContract identity (Core-owned; the adapter never invents one). */
  readonly contractId: ContractId;
  readonly snapshotId: SnapshotId | undefined;
  readonly binding: HlsRenditionBinding;
  readonly chain: HlsValidationChain | undefined;
  readonly run: AcquisitionRun | undefined;
  readonly unsupportedReason: UnsupportedTopologyReason | undefined;
  readonly transferredByteCount: number;
  readonly recordedAt: string;
}

/**
 * Project the adapter outcome into the canonical terminal vocabulary. Every
 * produced combination is re-validated through validateTerminalResult with
 * its canonical context; an illegal combination fails closed and is never
 * emitted (no adapter-local truth).
 */
export function projectHlsAdapterOutcome(
  input: OutcomeProjectionInput,
): DomainValidationResult<HlsAdapterOutcome> {
  const { binding, chain, run, unsupportedReason } = input;
  const targetId = binding.logicalTargetId;
  let kind: HlsAdapterOutcome['kind'];
  let requestFulfillment: 'COMPLETE' | 'PARTIAL' | 'UNSATISFIED';
  let selectionAcquisition: 'COMPLETE' | 'FAILED';
  let stopReason: StopReason;
  let summaryStatus: ValidationSummaryStatus;
  let passedCount = 0;
  let failedCount = 0;
  if (unsupportedReason !== undefined) {
    kind = 'UNSUPPORTED';
    requestFulfillment = 'UNSATISFIED';
    selectionAcquisition = 'FAILED';
    stopReason = 'UNSUPPORTED';
    summaryStatus = 'NOT_PERFORMED';
  } else if (chain === undefined) {
    return fail([
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        'outcome.chain',
        'outcome projection requires a validation chain unless the topology was classified unsupported',
      ),
    ]);
  } else if (chain.accepted) {
    kind = 'COMPLETED';
    requestFulfillment = 'COMPLETE';
    selectionAcquisition = 'COMPLETE';
    stopReason = 'NONE';
    summaryStatus = 'ALL_PASSED';
    passedCount = 4;
  } else {
    const budgetStop =
      run?.stop.kind === 'TRANSFER_BUDGET_EXHAUSTED' || run?.stop.kind === 'GLOBAL_SAFETY_LIMIT';
    kind = budgetStop ? 'BUDGET_STOPPED' : 'FAILED';
    requestFulfillment = input.transferredByteCount > 0 ? 'PARTIAL' : 'UNSATISFIED';
    selectionAcquisition = 'FAILED';
    stopReason =
      run?.stop.kind === 'TRANSFER_BUDGET_EXHAUSTED'
        ? 'TRANSFER_BUDGET_EXHAUSTED'
        : run?.stop.kind === 'GLOBAL_SAFETY_LIMIT'
          ? 'GLOBAL_SAFETY_LIMIT'
          : 'VALIDATION_FAILED';
    for (const verdict of [chain.target, chain.transfer, chain.format, chain.media]) {
      if (verdict.status === 'PASSED') {
        passedCount += 1;
      } else if (verdict.status === 'FAILED') {
        failedCount += 1;
      }
    }
    summaryStatus =
      chain.outcomeClass === 'INSUFFICIENT_EVIDENCE'
        ? 'INSUFFICIENT_EVIDENCE'
        : passedCount > 0 && failedCount === 0
          ? 'PARTIAL'
          : 'FAILED';
  }
  const memberId = makeMemberId(targetId);
  if (!memberId.ok) {
    return fail(memberId.diagnostics);
  }
  const projected = buildTerminalResult({
    schemaIdentity: currentSchemaIdentity(),
    contractId: input.contractId,
    snapshotId: input.snapshotId,
    requestFulfillment,
    targetResolution: 'RESOLVED',
    selectionAcquisition,
    coverage: 'NOT_APPLICABLE',
    stopReason,
    validationSummary: { status: summaryStatus, passedCount, failedCount },
    recordedAt: input.recordedAt,
  });
  if (!projected.ok) {
    return projected;
  }
  const legal = validateTerminalResult(projected.value, {
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    selectedMemberCount: 1,
    selectedValidationOutcomes: [
      { memberId: memberId.value, requiredValidationPassed: selectionAcquisition === 'COMPLETE' },
    ],
    coverageEvidence: undefined,
  });
  if (!legal.ok) {
    return fail(legal.diagnostics);
  }
  return ok(
    deepFreeze({
      kind,
      chain,
      unsupportedReason,
      terminal: projected.value,
      evidence: chain?.evidence ?? [],
    }),
  );
}
