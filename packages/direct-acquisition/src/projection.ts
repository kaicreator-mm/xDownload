/**
 * T008 canonical result/evidence projection.
 *
 * Transfer outcomes project into the T002 canonical multidimensional
 * TerminalResult plus typed Evidence records — never an adapter-local
 * success boolean (frozen L2 invariants 9/17). Layer evidence is typed so
 * `assertValidatesRequiredLayer` can gate acceptance, and confirmation can
 * never satisfy Transfer/Format/Media validation (PRD §21, C27).
 */

import {
  assertValidatesRequiredLayer,
  buildTerminalResult,
  diagnostic,
  evidenceRecord,
  fail,
  makeContractId,
  makeEvidenceId,
  ok,
  unwrapOrThrow,
  type DomainValidationResult,
  type EvidenceId,
  type EvidenceRecord,
  type TerminalResult,
  type ValidationDiagnostic,
  type ValidationLayer,
} from '@xdownload/domain-contracts';
import type {
  DirectTransferRequest,
  DirectTransferTerminalReason,
  ValidationLayerOutcome,
} from './port.ts';

export interface ProjectionInput {
  readonly request: DirectTransferRequest;
  readonly reason: DirectTransferTerminalReason;
  readonly validations: readonly ValidationLayerOutcome[];
  readonly bytesReceived: number;
  readonly targetResolved: boolean;
  readonly locatorChainLength: number;
}

export interface DirectTransferProjection {
  readonly terminalResult: TerminalResult;
  readonly evidence: readonly EvidenceRecord[];
  readonly allApplicableValidationPassed: boolean;
}

/**
 * Project one finished attempt into the canonical terminal result. The
 * projection always passes through `validateTerminalResult` semantics via
 * `buildTerminalResult`, so illegal combinations (truncated → COMPLETE,
 * budget-exhausted → COMPLETE) fail closed structurally.
 */
export function projectOutcome(
  input: ProjectionInput,
): DomainValidationResult<DirectTransferProjection> {
  const { request } = input;
  const applicable = applicableLayers(request);
  const layerEvidence = typedLayerEvidence(input);
  const allPassed =
    input.reason === 'COMPLETED' &&
    applicable.every(
      (layer) => input.validations.find((check) => check.layer === layer)?.passed === true,
    );

  const diagnostics: ValidationDiagnostic[] = [];
  const summary = validationSummary(input.validations, applicable);
  const completed = input.reason === 'COMPLETED';

  let requestFulfillment: TerminalResult['requestFulfillment'];
  let selectionAcquisition: TerminalResult['selectionAcquisition'];
  let stopReason: TerminalResult['stopReason'];
  switch (input.reason) {
    case 'COMPLETED':
      requestFulfillment = 'COMPLETE';
      selectionAcquisition = 'COMPLETE';
      stopReason = 'NONE';
      break;
    case 'TRUNCATED':
      requestFulfillment = input.bytesReceived > 0 ? 'PARTIAL' : 'UNSATISFIED';
      selectionAcquisition = input.bytesReceived > 0 ? 'PARTIAL' : 'FAILED';
      stopReason = 'VALIDATION_FAILED';
      break;
    case 'TRANSFER_BUDGET_EXHAUSTED':
      requestFulfillment = input.bytesReceived > 0 ? 'PARTIAL' : 'UNSATISFIED';
      selectionAcquisition = input.bytesReceived > 0 ? 'PARTIAL' : 'FAILED';
      stopReason = 'TRANSFER_BUDGET_EXHAUSTED';
      break;
    case 'GLOBAL_SAFETY_EXHAUSTED':
      requestFulfillment = input.bytesReceived > 0 ? 'PARTIAL' : 'UNSATISFIED';
      selectionAcquisition = input.bytesReceived > 0 ? 'PARTIAL' : 'FAILED';
      stopReason = 'GLOBAL_SAFETY_LIMIT';
      break;
    case 'LOCATOR_SUBSTITUTION':
    case 'REDIRECT_SCOPE_EXPANSION':
    case 'SIGNED_LOCATOR_REFRESH_FAILED':
      requestFulfillment = 'UNSATISFIED';
      selectionAcquisition = 'FAILED';
      stopReason = 'TARGET_CHANGED';
      break;
    case 'AUTH_REQUIRED':
      requestFulfillment = 'UNSATISFIED';
      selectionAcquisition = 'FAILED';
      stopReason = 'AUTH_REQUIRED';
      break;
    case 'UNSUPPORTED_RESPONSE':
    case 'NO_PROGRESS':
      requestFulfillment = 'UNSATISFIED';
      selectionAcquisition = 'FAILED';
      stopReason = 'NO_PROGRESS';
      break;
    default:
      // Integrity failures: transfer finished but validation rejected.
      requestFulfillment = 'UNSATISFIED';
      selectionAcquisition = 'FAILED';
      stopReason = 'VALIDATION_FAILED';
      break;
  }

  const candidate = buildTerminalResult({
    contractId: unwrapOrThrow(makeContractId(request.contractId)),
    requestFulfillment,
    targetResolution: completed || input.targetResolved ? 'RESOLVED' : 'BLOCKED',
    selectionAcquisition,
    coverage: 'NOT_APPLICABLE',
    stopReason,
    validationSummary: summary,
    recordedAt: new Date().toISOString(),
  });
  if (!candidate.ok) {
    diagnostics.push(...candidate.diagnostics);
    return fail(diagnostics);
  }

  // Acceptance gating: each executed layer must be satisfied by oracle-grade
  // evidence of that same layer (confirmation can never substitute, C27).
  const evidence: EvidenceRecord[] = [];
  evidence.push(transferObservationEvidence(input));
  for (const typed of layerEvidence) {
    const gate = assertValidatesRequiredLayer(typed.record, typed.layer);
    if (!gate.ok) {
      return gate;
    }
    evidence.push(typed.record);
  }
  if (input.locatorChainLength > 1) {
    evidence.push(locatorChainEvidence(input));
  }

  return ok({
    terminalResult: candidate.value,
    evidence,
    allApplicableValidationPassed: allPassed,
  });
}

function applicableLayers(
  request: DirectTransferRequest,
): readonly ('transfer' | 'format' | 'target' | 'media')[] {
  return request.slice === 'S3'
    ? (['transfer', 'format', 'target', 'media'] as const)
    : (['transfer', 'format', 'target'] as const);
}

function validationSummary(
  validations: readonly ValidationLayerOutcome[],
  applicable: readonly ('transfer' | 'format' | 'target' | 'media')[],
): TerminalResult['validationSummary'] {
  let passed = 0;
  let failedCount = 0;
  for (const layer of applicable) {
    const outcome = validations.find((check) => check.layer === layer);
    if (outcome === undefined) {
      continue;
    }
    if (outcome.passed) {
      passed += 1;
    } else {
      failedCount += 1;
    }
  }
  if (failedCount > 0) {
    return { status: 'FAILED', passedCount: passed, failedCount };
  }
  if (passed === applicable.length && applicable.length > 0) {
    return { status: 'ALL_PASSED', passedCount: passed, failedCount: 0 };
  }
  return { status: 'INSUFFICIENT_EVIDENCE', passedCount: passed, failedCount: 0 };
}

/**
 * Transfer observation evidence (TRANSFER claim, effect subject) emitted for
 * every executed attempt. Provenance carries the adapter identity only — no
 * raw locator/secret material ever enters canonical evidence.
 */
function transferObservationEvidence(input: ProjectionInput): EvidenceRecord {
  const { request } = input;
  return evidenceRecord({
    evidenceId: mintEvidenceId(`evidence-transfer-${request.effectId}-${String(request.attempt)}`),
    claimType: 'TRANSFER',
    claimSubject: { kind: 'EFFECT', ref: request.effectId },
    sourceType: 'TRANSFER_OBSERVATION',
    provenance: { sourceIdentity: 'xdownload/direct-http-adapter' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'SINGLE_RESOURCE_TRANSFER', contractRef: request.contractId },
    certaintyClass: 'DECISIVE',
  });
}

/**
 * Typed independent-validator evidence for each executed non-transfer layer.
 * These are INDEPENDENT_VALIDATOR sources so the canonical layer rule accepts
 * them for format/target/media; a USER_CONFIRMATION record would be rejected
 * by `assertValidatesRequiredLayer` (C27 oracle at the seam).
 */
function typedLayerEvidence(
  input: ProjectionInput,
): readonly { readonly record: EvidenceRecord; readonly layer: ValidationLayer }[] {
  const records: { record: EvidenceRecord; layer: ValidationLayer }[] = [];
  for (const outcome of input.validations) {
    if (!outcome.passed || outcome.layer === 'transfer') {
      continue;
    }
    const claimType: EvidenceRecord['claimType'] =
      outcome.layer === 'format'
        ? 'FORMAT'
        : outcome.layer === 'media'
          ? 'MEDIA'
          : 'RESOURCE_IDENTITY';
    records.push({
      layer: outcome.layer,
      record: evidenceRecord({
        evidenceId: mintEvidenceId(
          `evidence-${outcome.layer}-${input.request.effectId}-${String(input.request.attempt)}`,
        ),
        claimType,
        claimSubject: { kind: 'LOGICAL_TARGET', ref: input.request.binding.identity },
        sourceType: 'INDEPENDENT_VALIDATOR',
        provenance: { sourceIdentity: `xdownload/${outcome.layer}-validator` },
        independenceFromDiscovery: 'INDEPENDENT',
        scope: { domain: 'SINGLE_RESOURCE_TRANSFER', contractRef: input.request.contractId },
        certaintyClass: 'DECISIVE',
      }),
    });
  }
  return records;
}

/**
 * Provenance-bound locator-chain evidence: emitted whenever delivery moved
 * through redirect/CDN/refresh hops so the binding stays auditable against
 * the frozen logical target (ADR-011, frozen L2 invariant 4).
 */
function locatorChainEvidence(input: ProjectionInput): EvidenceRecord {
  const { request } = input;
  return evidenceRecord({
    evidenceId: mintEvidenceId(`evidence-locator-${request.effectId}-${String(request.attempt)}`),
    claimType: 'RESOURCE_IDENTITY',
    claimSubject: { kind: 'LOGICAL_TARGET', ref: request.binding.identity },
    sourceType: 'TRANSFER_OBSERVATION',
    provenance: { sourceIdentity: 'xdownload/direct-http-adapter' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'SINGLE_RESOURCE_TRANSFER', contractRef: request.contractId },
    certaintyClass: 'DECISIVE',
  });
}

/**
 * Mint a canonical EvidenceId for an adapter-generated record. Ids are built
 * from already-validated identifiers, so minting cannot fail for well-formed
 * requests (guarded again by the request-shape validation).
 */
function mintEvidenceId(raw: string): EvidenceId {
  return unwrapOrThrow(makeEvidenceId(raw));
}

/** Request-shape rejection before any transfer happens (typed, fail-closed). */
export function rejectRequest(
  code: 'MEMBERSHIP_DRIFT' | 'MALFORMED_REQUIRED_FIELD',
  path: string,
  message: string,
  invariant?: string,
): DomainValidationResult<never> {
  return fail([diagnostic(code, path, message, invariant)]);
}
