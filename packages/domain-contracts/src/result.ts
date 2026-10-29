/**
 * T002 terminal result model — multidimensional, never one success boolean.
 *
 * Every terminal result exposes RequestFulfillment, TargetResolution,
 * SelectionAcquisition, Coverage, StopReason and ValidationSummary
 * (PRD §16). Forbidden status combinations (PRD §18.8) and count/budget/
 * timeout-based VERIFIED_COMPLETE claims (PRD §19) are rejected here.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { currentSchemaIdentity, decodeSchemaIdentity, type SchemaIdentity } from './version.ts';
import {
  makeContractId,
  makeSnapshotId,
  type ContractId,
  type MemberId,
  type SnapshotId,
} from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireIsoTimestamp,
  requireInteger,
  requireLiteral,
  requireNonEmptyString,
  requireOptionalString,
} from './decode.ts';
import type { ScopePrimitive } from './scope.ts';
import type { ContractIntentType } from './contract.ts';

export type RequestFulfillmentStatus = 'COMPLETE' | 'PARTIAL' | 'UNSATISFIED' | 'UNKNOWN';

export type TargetResolutionStatus =
  'RESOLVED' | 'PARTIAL' | 'EMPTY_CONFIRMED' | 'EMPTY_UNKNOWN' | 'BLOCKED';

export type SelectionAcquisitionStatus =
  'NOT_STARTED' | 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export type CoverageStatus =
  'VERIFIED_COMPLETE' | 'VERIFIED_SUBSET' | 'TRUNCATED' | 'UNKNOWN' | 'NOT_APPLICABLE';

export type StopReason =
  | 'NONE'
  | 'NATURAL_COLLECTION_END'
  | 'USER_SCOPE_REACHED'
  | 'USER_SELECTION_COMPLETE'
  | 'DISCOVERY_BUDGET_EXHAUSTED'
  | 'TRANSFER_BUDGET_EXHAUSTED'
  | 'GLOBAL_SAFETY_LIMIT'
  | 'NO_PROGRESS'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'TARGET_CHANGED'
  | 'COLLECTION_CHANGED'
  | 'UNSUPPORTED'
  | 'USER_CANCELLED'
  | 'VALIDATION_FAILED';

export type ValidationSummaryStatus =
  'ALL_PASSED' | 'PARTIAL' | 'FAILED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_PERFORMED';

export interface ValidationSummary {
  readonly status: ValidationSummaryStatus;
  readonly passedCount: number;
  readonly failedCount: number;
}

export interface TerminalResult {
  readonly schemaIdentity: SchemaIdentity;
  readonly contractId: ContractId;
  readonly snapshotId?: SnapshotId;
  readonly requestFulfillment: RequestFulfillmentStatus;
  readonly targetResolution: TargetResolutionStatus;
  readonly selectionAcquisition: SelectionAcquisitionStatus;
  readonly coverage: CoverageStatus;
  readonly stopReason: StopReason;
  readonly validationSummary: ValidationSummary;
  readonly recordedAt: string;
}

/** Coverage evidence classes that MAY support VERIFIED_COMPLETE (PRD §19). */
export type SufficientCoverageBasis =
  | { readonly basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST'; readonly identities: readonly string[] }
  | {
      readonly basis: 'DECLARED_TOTAL_WITH_CLOSURE';
      readonly declaredTotal: number;
      readonly accountedIdentityCount: number;
      readonly closure: 'NATURAL_END_VALIDATED' | 'CONTINUATION_CLOSED';
    }
  | {
      readonly basis: 'USER_DECLARED_FINITE_SET_FULLY_ACCOUNTED';
      readonly declaredCount: number;
      readonly accountedIdentityCount: number;
    }
  | { readonly basis: 'VALIDATED_COLLECTION_API_COMPLETION'; readonly apiRef: string };

/**
 * Bases that are never sufficient on their own (PRD §19): count equality,
 * limits, timeout, budget exhaustion, failed next page, pagination loop,
 * unproven "no more found".
 */
export type InsufficientCoverageBasis =
  | 'COUNT_EQUALITY'
  | 'MAX_ITEMS_REACHED'
  | 'PAGE_LIMIT_REACHED'
  | 'TIMEOUT'
  | 'BUDGET_EXHAUSTED'
  | 'FAILED_NEXT_PAGE'
  | 'PAGINATION_LOOP'
  | 'NO_MORE_FOUND_WITHOUT_CLOSURE';

export type CoverageEvidence =
  | { readonly kind: 'SUFFICIENT'; readonly basis: SufficientCoverageBasis }
  | { readonly kind: 'INSUFFICIENT'; readonly basis: InsufficientCoverageBasis };

export interface SelectedMemberValidationOutcome {
  readonly memberId: MemberId;
  readonly requiredValidationPassed: boolean;
}

export interface TerminalResultContext {
  readonly intentType: ContractIntentType;
  readonly scopeKind: ScopePrimitive;
  readonly selectedMemberCount: number;
  readonly selectedValidationOutcomes?: readonly SelectedMemberValidationOutcome[];
  readonly coverageEvidence?: CoverageEvidence;
  readonly knownAuthInaccessibleRequestedCount?: number;
}

const RESULT_KEYS: readonly string[] = [
  'schemaIdentity',
  'contractId',
  'snapshotId',
  'requestFulfillment',
  'targetResolution',
  'selectionAcquisition',
  'coverage',
  'stopReason',
  'validationSummary',
  'recordedAt',
];

const VALIDATION_SUMMARY_KEYS: readonly string[] = ['status', 'passedCount', 'failedCount'];

const FULFILLMENT: readonly RequestFulfillmentStatus[] = [
  'COMPLETE',
  'PARTIAL',
  'UNSATISFIED',
  'UNKNOWN',
];
const RESOLUTION: readonly TargetResolutionStatus[] = [
  'RESOLVED',
  'PARTIAL',
  'EMPTY_CONFIRMED',
  'EMPTY_UNKNOWN',
  'BLOCKED',
];
const ACQUISITION: readonly SelectionAcquisitionStatus[] = [
  'NOT_STARTED',
  'COMPLETE',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
];
const COVERAGE: readonly CoverageStatus[] = [
  'VERIFIED_COMPLETE',
  'VERIFIED_SUBSET',
  'TRUNCATED',
  'UNKNOWN',
  'NOT_APPLICABLE',
];
const STOP_REASONS: readonly StopReason[] = [
  'NONE',
  'NATURAL_COLLECTION_END',
  'USER_SCOPE_REACHED',
  'USER_SELECTION_COMPLETE',
  'DISCOVERY_BUDGET_EXHAUSTED',
  'TRANSFER_BUDGET_EXHAUSTED',
  'GLOBAL_SAFETY_LIMIT',
  'NO_PROGRESS',
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'TARGET_CHANGED',
  'COLLECTION_CHANGED',
  'UNSUPPORTED',
  'USER_CANCELLED',
  'VALIDATION_FAILED',
];
const SUMMARY_STATUSES: readonly ValidationSummaryStatus[] = [
  'ALL_PASSED',
  'PARTIAL',
  'FAILED',
  'INSUFFICIENT_EVIDENCE',
  'NOT_PERFORMED',
];

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}

function pushAll(result: DomainValidationResult<void>, diagnostics: ValidationDiagnostic[]): void {
  if (!result.ok) {
    diagnostics.push(...result.diagnostics);
  }
}

function decodeValidationSummary(value: unknown): DomainValidationResult<ValidationSummary> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'validationSummary'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, VALIDATION_SUMMARY_KEYS, 'validationSummary'), diagnostics);
  const status = unwrap(
    requireLiteral(record, 'status', SUMMARY_STATUSES, 'validationSummary'),
    diagnostics,
  );
  const passedCount = unwrap(
    requireInteger(record, 'passedCount', 'validationSummary'),
    diagnostics,
  );
  const failedCount = unwrap(
    requireInteger(record, 'failedCount', 'validationSummary'),
    diagnostics,
  );
  if (
    diagnostics.length > 0 ||
    status === undefined ||
    passedCount === undefined ||
    failedCount === undefined
  ) {
    return fail(
      diagnostics.length > 0
        ? diagnostics
        : [diagnostic('MALFORMED_REQUIRED_FIELD', 'validationSummary', 'invalid summary')],
    );
  }
  if (passedCount < 0 || failedCount < 0) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'validationSummary', 'counts must be >= 0'),
    ]);
  }
  return ok(deepFreeze({ status, passedCount, failedCount }));
}

/** Decode a terminal result from untrusted input; the six dimensions are all required. */
export function decodeTerminalResult(value: unknown): DomainValidationResult<TerminalResult> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'result'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'result'), diagnostics);
  pushAll(rejectUnknownFields(record, RESULT_KEYS, 'result'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const contractIdRaw = unwrap(requireNonEmptyString(record, 'contractId', 'result'), diagnostics);
  const contractId =
    contractIdRaw === undefined ? undefined : unwrap(makeContractId(contractIdRaw), diagnostics);
  let snapshotId: SnapshotId | undefined;
  const snapshotRaw = unwrap(requireOptionalString(record, 'snapshotId', 'result'), diagnostics);
  if (snapshotRaw !== undefined) {
    snapshotId = unwrap(makeSnapshotId(snapshotRaw), diagnostics);
  }
  const requestFulfillment = unwrap(
    requireLiteral(record, 'requestFulfillment', FULFILLMENT, 'result'),
    diagnostics,
  );
  const targetResolution = unwrap(
    requireLiteral(record, 'targetResolution', RESOLUTION, 'result'),
    diagnostics,
  );
  const selectionAcquisition = unwrap(
    requireLiteral(record, 'selectionAcquisition', ACQUISITION, 'result'),
    diagnostics,
  );
  const coverage = unwrap(requireLiteral(record, 'coverage', COVERAGE, 'result'), diagnostics);
  const stopReason = unwrap(
    requireLiteral(record, 'stopReason', STOP_REASONS, 'result'),
    diagnostics,
  );
  const validationSummary = unwrap(
    decodeValidationSummary(record['validationSummary']),
    diagnostics,
  );
  const recordedAt = unwrap(requireIsoTimestamp(record, 'recordedAt', 'result'), diagnostics);
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const result: TerminalResult = {
    schemaIdentity: schemaIdentity!,
    contractId: contractId!,
    snapshotId,
    requestFulfillment: requestFulfillment!,
    targetResolution: targetResolution!,
    selectionAcquisition: selectionAcquisition!,
    coverage: coverage!,
    stopReason: stopReason!,
    validationSummary: validationSummary!,
    recordedAt: recordedAt!,
  };
  return ok(deepFreeze(result));
}

function isSufficientBasisConsistent(basis: SufficientCoverageBasis): boolean {
  switch (basis.basis) {
    case 'AUTHORITATIVE_MEMBER_IDENTITY_LIST':
      return new Set(basis.identities).size === basis.identities.length;
    case 'DECLARED_TOTAL_WITH_CLOSURE':
      return basis.declaredTotal >= 0 && basis.accountedIdentityCount === basis.declaredTotal;
    case 'USER_DECLARED_FINITE_SET_FULLY_ACCOUNTED':
      return basis.declaredCount >= 0 && basis.accountedIdentityCount === basis.declaredCount;
    case 'VALIDATED_COLLECTION_API_COMPLETION':
      return basis.apiRef.length > 0;
    default:
      return false;
  }
}

/**
 * Legal-combination validation (PRD §18.8 + frozen Product counterexamples).
 * Structural decode alone is never enough: cross-field semantic invariants
 * are enforced here and invalid states are never normalized into success.
 */
export function validateTerminalResult(
  result: TerminalResult,
  context: TerminalResultContext,
): DomainValidationResult<void> {
  const diagnostics: ValidationDiagnostic[] = [];
  const reject = (message: string, invariant: string): void => {
    diagnostics.push(diagnostic('INVALID_RESULT_COMBINATION', 'result', message, invariant));
  };

  // No empty-set vacuous acquisition success (PRD §16.3).
  if (context.selectedMemberCount === 0 && result.selectionAcquisition === 'COMPLETE') {
    reject('empty selected set cannot be vacuous acquisition success', 'PRD-§16.3');
  }

  // Completeness contract: COMPLETE requires exactly one passing required
  // validation outcome per selected member (PRD §19, counterexample C27).
  if (result.selectionAcquisition === 'COMPLETE') {
    const outcomes = context.selectedValidationOutcomes ?? [];
    const identitySet = new Set<string>();
    for (const outcome of outcomes) {
      identitySet.add(outcome.memberId);
    }
    if (outcomes.length !== context.selectedMemberCount || identitySet.size !== outcomes.length) {
      reject(
        'selection COMPLETE requires exactly one validation outcome per selected member',
        'PRD-§19',
      );
    }
    if (outcomes.some((outcome) => !outcome.requiredValidationPassed)) {
      reject(
        'selection COMPLETE is forbidden when required selected targets failed validation',
        'C27',
      );
    }
    if (result.validationSummary.status === 'INSUFFICIENT_EVIDENCE') {
      reject('selection COMPLETE cannot rest on insufficient-evidence validation', 'C22');
    }
  }

  // VERIFIED_COMPLETE requires independent identity/closure evidence
  // (PRD §19, counterexamples C01/C03/C04).
  if (result.coverage === 'VERIFIED_COMPLETE') {
    const evidence = context.coverageEvidence;
    if (evidence === undefined) {
      diagnostics.push(
        diagnostic(
          'COVERAGE_EVIDENCE_INSUFFICIENT',
          'result.coverage',
          'VERIFIED_COMPLETE requires coverage evidence',
          'PRD-§19',
        ),
      );
    } else if (evidence.kind === 'INSUFFICIENT') {
      diagnostics.push(
        diagnostic(
          'COVERAGE_EVIDENCE_INSUFFICIENT',
          'result.coverage',
          `coverage basis '${evidence.basis}' is never sufficient alone`,
          'PRD-§19',
        ),
      );
    } else if (!isSufficientBasisConsistent(evidence.basis)) {
      diagnostics.push(
        diagnostic(
          'COVERAGE_EVIDENCE_INSUFFICIENT',
          'result.coverage',
          'coverage evidence does not establish full requested-scope accounting',
          'C01',
        ),
      );
    } else if (evidence.basis.basis === 'AUTHORITATIVE_MEMBER_IDENTITY_LIST') {
      // Identity correspondence, never count-only (PRD §11, counterexample C01):
      // every validated outcome must be in the accounted identity list, and the
      // accounted list is exactly the validated set plus independently known
      // authorization-inaccessible requested members.
      const outcomes = context.selectedValidationOutcomes ?? [];
      const accounted = new Set(evidence.basis.identities);
      const allValidatedIncluded = outcomes.every((outcome) => accounted.has(outcome.memberId));
      const countsCorrespond =
        outcomes.length + (context.knownAuthInaccessibleRequestedCount ?? 0) === accounted.size;
      if (!allValidatedIncluded || !countsCorrespond) {
        diagnostics.push(
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            'result.coverage',
            'coverage identity list does not correspond to the validated member identity set (count equality is not correspondence)',
            'C01',
          ),
        );
      }
    }
  }

  // Forbidden: TargetResolution PARTIAL + Coverage VERIFIED_COMPLETE (PRD §18.8).
  if (result.targetResolution === 'PARTIAL' && result.coverage === 'VERIFIED_COMPLETE') {
    reject(
      'TargetResolution PARTIAL forbids requested-scope Coverage VERIFIED_COMPLETE',
      'PRD-§18.8',
    );
  }

  // Forbidden: EMPTY_UNKNOWN resolution + COMPLETE fulfillment (PRD §18.8).
  if (result.targetResolution === 'EMPTY_UNKNOWN' && result.requestFulfillment === 'COMPLETE') {
    reject('EMPTY_UNKNOWN resolution cannot complete the request', 'PRD-§18.8');
  }

  // Direct single-resource results only admit NOT_APPLICABLE coverage (PRD §18.1).
  if (context.scopeKind === 'single_resource' && result.coverage !== 'NOT_APPLICABLE') {
    reject('direct single-resource coverage must be NOT_APPLICABLE', 'PRD-§18.8');
  }

  // Authorization-limited whole-collection requests cannot be COMPLETE while
  // known requested members remain unfulfilled (PRD §18.7, counterexample C10).
  if (
    context.scopeKind === 'entire_supported_collection' &&
    (context.knownAuthInaccessibleRequestedCount ?? 0) > 0 &&
    result.requestFulfillment === 'COMPLETE'
  ) {
    reject(
      'whole-collection request cannot be COMPLETE while known requested members are inaccessible under the current authorization',
      'C10/PRD-§18.7',
    );
  }

  // Budget/limit exhaustion is never user-scope completion (PRD §10.2/§15.4, C02).
  if (
    (result.stopReason === 'DISCOVERY_BUDGET_EXHAUSTED' ||
      result.stopReason === 'TRANSFER_BUDGET_EXHAUSTED' ||
      result.stopReason === 'GLOBAL_SAFETY_LIMIT') &&
    result.requestFulfillment === 'COMPLETE'
  ) {
    reject('budget exhaustion cannot be reinterpreted as the end of user scope', 'C02/PRD-§15.4');
  }
  if (
    result.stopReason === 'TRANSFER_BUDGET_EXHAUSTED' &&
    result.selectionAcquisition === 'COMPLETE'
  ) {
    reject('transfer budget exhaustion forbids acquisition completion claims', 'PRD-§15.4');
  }

  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/** Build a terminal result inside the package boundary (fixture/adapter helper). */
export function buildTerminalResult(
  fields: Omit<TerminalResult, 'schemaIdentity'> & { schemaIdentity?: SchemaIdentity },
): DomainValidationResult<TerminalResult> {
  const { schemaIdentity, ...rest } = fields;
  const candidate: TerminalResult = {
    schemaIdentity: schemaIdentity ?? currentSchemaIdentity(),
    ...rest,
  };
  return decodeTerminalResult(candidate);
}
