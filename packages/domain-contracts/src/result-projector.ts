/**
 * T007 deterministic ResultProjector (frozen L2 §6.7/D4, ADR-009, PRD §16–§19).
 *
 * One Core component derives the six Frozen dimensions from canonical
 * ledger/validation/accounting facts. Same facts -> same terminal result:
 * projection discovers no facts of its own and contains no randomness, no
 * clock and no success boolean. Forbidden combinations are refused with the
 * violated rule identified — never clamped into the nearest legal status.
 *
 * Cancellation follows the L2 §11.1 durable-acceptance cutoff: USER_CANCELLED
 * only when cancellation is why remaining work stopped; CANCELLED/PARTIAL/
 * COMPLETE acquisition strictly per durable acceptance facts; staged or
 * validated bytes can never auto-accept across the cutoff; late cancellation
 * never rewrites terminal truth.
 */

import { deepFreeze, diagnostic, fail, ok, type DomainValidationResult } from './diagnostics.ts';
import {
  buildTerminalResult,
  validateTerminalResult,
  type CoverageEvidence,
  type CoverageStatus,
  type RequestFulfillmentStatus,
  type SelectedMemberValidationOutcome,
  type StopReason,
  type TargetResolutionStatus,
  type SelectionAcquisitionStatus,
  type TerminalResult,
  type TerminalResultContext,
  type ValidationSummary,
  type ValidationSummaryStatus,
} from './result.ts';
import { projectForSurface, type TerminalResultProjection } from './ports.ts';
import type { ContractIntentType } from './contract.ts';
import type { ContractId, MemberId, SnapshotId } from './ids.ts';
import type { ScopePrimitive } from './scope.ts';
import { requestedScopeFullyAccounted, type CoverageAccounting } from './coverage-accounting.ts';
import type { MemberRequiredValidation, ValidationRegistry } from './validation-record.ts';
import { requiredValidationOutcomes } from './validation-record.ts';
import type { ValidationLayer } from './evidence.ts';

/** Why enumeration/coverage did or did not close (PRD §10.2/§19). */
export type EnumerationClosure =
  | { readonly kind: 'NOT_APPLICABLE' }
  | { readonly kind: 'NATURAL_END_VALIDATED' }
  | { readonly kind: 'CONTINUATION_CLOSED' }
  | { readonly kind: 'USER_SCOPE_REACHED' }
  | { readonly kind: 'USER_SELECTION_COMPLETE' }
  | { readonly kind: 'UNPROVEN_EMPTY' }
  | {
      readonly kind: 'TRUNCATED';
      readonly by:
        | 'SAFETY_CAP'
        | 'PAGE_LIMIT'
        | 'TIMEOUT'
        | 'DISCOVERY_BUDGET'
        | 'TRANSFER_BUDGET'
        | 'GLOBAL_SAFETY';
    }
  | {
      readonly kind: 'INCOMPLETE_UNKNOWN';
      readonly reason:
        'FAILED_NEXT_PAGE' | 'MISSING_NEXT_CONTROL' | 'PAGINATION_LOOP' | 'NOT_EXERCISED';
    };

/** Facts about why the lifecycle stopped, as supplied by canonical lanes. */
export interface StopFacts {
  readonly authFailed?: boolean;
  readonly authRequired?: boolean;
  readonly unsupported?: boolean;
  readonly validationFailed?: boolean;
  readonly targetChanged?: boolean;
  readonly collectionChanged?: boolean;
  readonly noProgress?: boolean;
  readonly discoveryBudgetExhausted?: boolean;
  readonly transferBudgetExhausted?: boolean;
  readonly globalSafetyLimit?: boolean;
}

/**
 * Durable cancellation authority (L2 §11.1). `acceptedBeforeCutoff` lists the
 * selected members whose acceptance was durably committed before the cutoff.
 * Any other acceptance in `acceptedSelectedMemberIds` after cancellation
 * became authoritative is a cutoff violation and rejects the projection.
 * Staged, completed or validated bytes without pre-cancel acceptance stay
 * unaccepted (counterexample normalization).
 */
export interface CancellationFact {
  readonly acceptedBeforeCutoff: readonly MemberId[];
  /** Truthful reconciliation: bytes present but unaccepted across the cutoff. */
  readonly stagedUnaccepted?: readonly MemberId[];
}

/** Facts distinguishing verified-empty from unproven-empty (PRD §18.5/§18.6). */
export interface ResolutionFacts {
  /** Auth/processing failure before any requested target was resolved (C24/C15). */
  readonly blockedBeforeAnyResolution?: {
    readonly reason: 'AUTH_FAILED' | 'AUTH_REQUIRED' | 'UNSUPPORTED';
  };
  /** The requested collection was independently verified empty (needs a sufficient basis). */
  readonly verifiedEmpty?: boolean;
}

/** Canonical input facts. Everything is explicit; nothing is discovered here. */
export interface ProjectionFacts {
  readonly contractId: ContractId;
  readonly snapshotId?: SnapshotId;
  readonly intentType: ContractIntentType;
  readonly scopeKind: ScopePrimitive;
  /** Deterministic timestamp stamped onto the projected result. */
  readonly recordedAt: string;
  /** Immutable requested reference set R (scope identity, never locators). */
  readonly requestedMemberIds: readonly MemberId[];
  /** Durable acceptances for selected members along the frozen lineage. */
  readonly acceptedSelectedMemberIds: readonly MemberId[];
  /** Required requested-scope accounting; mandatory for collection scopes. */
  readonly accounting?: CoverageAccounting;
  /** Coverage evidence classes (PRD §19) grounding VERIFIED_COMPLETE. */
  readonly coverageBasis?: CoverageEvidence;
  /** Required validation layers; mandatory when a validationRegistry is given. */
  readonly requiredLayers?: readonly ValidationLayer[];
  /** Registry whose PASS records satisfy required layers per member. */
  readonly validationRegistry?: ValidationRegistry;
  /** Pre-computed per-member required-validation outcomes (overrides registry). */
  readonly memberValidation?: readonly MemberRequiredValidation[];
  readonly enumeration: EnumerationClosure;
  readonly stopFacts?: StopFacts;
  readonly cancellation?: CancellationFact;
  readonly resolution?: ResolutionFacts;
  /** Known requested members remain unfulfilled because of authorization (§18.7). */
  readonly authorizationLimited?: boolean;
  /**
   * Explicit retry/resume control transition (L2 §11.1): the only authority
   * that may reopen a terminal lineage in the store. Automatic recovery and
   * late cancellation never supersede terminal truth.
   */
  readonly explicitRetryResume?: boolean;
}

/** Deterministic projection output: the terminal result plus its explanations. */
export interface ProjectedTerminalResult {
  readonly result: TerminalResult;
  /** User-visible explanation, e.g. the exact §17.2 auth-limited explanation. */
  readonly explanation?: string;
  /** The requested-scope accounting the projection was derived from (§17.2). */
  readonly accounting?: CoverageAccounting;
}

const BOUNDED_SCOPES: readonly ScopePrimitive[] = [
  'explicit_member_set',
  'selected_collection_members',
  'collection_page_range',
  'current_page',
];

function identitySetEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

function reject(
  code: Parameters<typeof diagnostic>[0],
  message: string,
  invariant: string,
): DomainValidationResult<never> {
  return fail([diagnostic(code, 'projection', message, invariant)]);
}

function blockedReason(
  facts: ProjectionFacts,
): 'AUTH_FAILED' | 'AUTH_REQUIRED' | 'UNSUPPORTED' | undefined {
  return facts.resolution?.blockedBeforeAnyResolution?.reason;
}

function selectedSetOf(facts: ProjectionFacts): readonly MemberId[] {
  if (facts.scopeKind === 'single_resource') {
    return facts.requestedMemberIds;
  }
  return facts.accounting?.selected ?? [];
}

function memberOutcomesFrom(
  facts: ProjectionFacts,
  selected: readonly MemberId[],
): DomainValidationResult<readonly MemberRequiredValidation[]> {
  let memberValidation: readonly MemberRequiredValidation[];
  if (facts.memberValidation !== undefined) {
    memberValidation = facts.memberValidation;
  } else if (facts.validationRegistry !== undefined) {
    const layers = facts.requiredLayers ?? [];
    if (layers.length === 0) {
      return reject(
        'MISSING_REQUIRED_FIELD',
        'validationRegistry projection requires the required validation layers to be named',
        'PRD-§22',
      );
    }
    memberValidation = requiredValidationOutcomes(selected, facts.validationRegistry, layers, {
      snapshotRef: facts.snapshotId,
    });
  } else {
    memberValidation = selected.map((memberId) => ({ memberId, result: 'NOT_VALIDATED' as const }));
  }
  const selectedSet = new Set(selected);
  const escape = memberValidation.filter((outcome) => !selectedSet.has(outcome.memberId));
  if (escape.length > 0) {
    return reject(
      'SCOPE_MUTATION',
      `validation outcomes reference members outside the frozen selected set (${escape.map((o) => o.memberId).join(', ')})`,
      'PRD-§19',
    );
  }
  const seen = new Set<string>();
  for (const outcome of memberValidation) {
    if (seen.has(outcome.memberId)) {
      return reject(
        'DUPLICATE_IDENTITY',
        `duplicate validation outcome for member '${outcome.memberId}'`,
        'PRD-§19',
      );
    }
    seen.add(outcome.memberId);
  }
  return ok(memberValidation);
}

function validationSummaryFrom(
  selected: readonly MemberId[],
  outcomes: readonly MemberRequiredValidation[],
): ValidationSummary {
  const byMember = new Map(outcomes.map((outcome) => [outcome.memberId, outcome.result]));
  let passed = 0;
  let failed = 0;
  let unproven = 0;
  for (const memberId of selected) {
    const result = byMember.get(memberId) ?? 'NOT_VALIDATED';
    if (result === 'VALIDATED') {
      passed += 1;
    } else if (result === 'VALIDATION_FAILED') {
      failed += 1;
    } else {
      unproven += 1;
    }
  }
  let status: ValidationSummaryStatus;
  if (selected.length === 0 || (passed === 0 && failed === 0)) {
    status = 'NOT_PERFORMED';
  } else if (failed > 0) {
    status = passed > 0 ? 'PARTIAL' : 'FAILED';
  } else if (unproven > 0) {
    // Unproven evidence is never converted into success (C22).
    status = 'INSUFFICIENT_EVIDENCE';
  } else {
    status = 'ALL_PASSED';
  }
  return deepFreeze({ status, passedCount: passed, failedCount: failed });
}

type SufficientBasis = Extract<CoverageEvidence, { readonly kind: 'SUFFICIENT' }>['basis'];

function basisMatchesAccounting(
  basis: SufficientBasis,
  accounting: CoverageAccounting,
  facts: ProjectionFacts,
): boolean {
  switch (basis.basis) {
    case 'AUTHORITATIVE_MEMBER_IDENTITY_LIST':
      return identitySetEquals([...basis.identities].sort(), accounting.requested);
    case 'DECLARED_TOTAL_WITH_CLOSURE':
      return (
        basis.declaredTotal === accounting.requested.length &&
        basis.accountedIdentityCount === accounting.accounted.length &&
        (basis.closure === 'NATURAL_END_VALIDATED'
          ? facts.enumeration.kind === 'NATURAL_END_VALIDATED'
          : facts.enumeration.kind === 'CONTINUATION_CLOSED')
      );
    case 'USER_DECLARED_FINITE_SET_FULLY_ACCOUNTED':
      return (
        basis.declaredCount === accounting.requested.length &&
        basis.accountedIdentityCount === accounting.accounted.length
      );
    case 'VALIDATED_COLLECTION_API_COMPLETION':
      return basis.apiRef.length > 0;
    default:
      return false;
  }
}

function coverageStatusFrom(facts: ProjectionFacts): DomainValidationResult<CoverageStatus> {
  if (facts.scopeKind === 'single_resource') {
    if (facts.accounting !== undefined || facts.coverageBasis !== undefined) {
      return reject(
        'INVALID_RESULT_COMBINATION',
        'direct single-resource results admit no collection coverage accounting (must be NOT_APPLICABLE)',
        'PRD-§18.8',
      );
    }
    return ok('NOT_APPLICABLE');
  }
  if (blockedReason(facts) !== undefined) {
    // Blocked before any resolution: coverage is genuinely unknown (§18.4).
    return ok('UNKNOWN');
  }
  const accounting = facts.accounting;
  if (accounting === undefined) {
    return reject(
      'MISSING_REQUIRED_FIELD',
      'collection-scope projection requires requested-scope coverage accounting bound to the CoverageTarget',
      'PRD-§17',
    );
  }
  const closed =
    facts.enumeration.kind === 'NATURAL_END_VALIDATED' ||
    facts.enumeration.kind === 'CONTINUATION_CLOSED' ||
    facts.enumeration.kind === 'USER_SCOPE_REACHED' ||
    facts.enumeration.kind === 'USER_SELECTION_COMPLETE';
  const basis = facts.coverageBasis;
  if (basis !== undefined && basis.kind === 'SUFFICIENT' && closed) {
    // The basis must name exactly the immutable requested reference set; a
    // basis over a different identity set is substituted truth, rejected
    // outright (C01 — count equality is not identity correspondence).
    if (!basisMatchesAccounting(basis.basis, accounting, facts)) {
      return reject(
        'COVERAGE_EVIDENCE_INSUFFICIENT',
        'coverage basis does not correspond to the requested-scope identity set; count equality is not identity correspondence',
        'C01/PRD-§19',
      );
    }
    const correspondence =
      requestedScopeFullyAccounted(accounting) &&
      identitySetEquals(accounting.resolved, accounting.requested) &&
      identitySetEquals(accounting.validated, accounting.selected);
    const inaccessibleEvidenced = accounting.authInaccessible.every(
      (member) => member.independentlyAccounted,
    );
    if (correspondence && inaccessibleEvidenced) {
      return ok('VERIFIED_COMPLETE');
    }
    // Otherwise degrade consistently (PRD §17.2): requested members the
    // accounting cannot independently account for keep coverage UNKNOWN —
    // never inferred complete from the accessible subset.
  }
  if (facts.enumeration.kind === 'TRUNCATED') {
    return ok('TRUNCATED');
  }
  if (facts.enumeration.kind === 'INCOMPLETE_UNKNOWN') {
    // A failed/missing/looping continuation means enumeration truth is
    // unknown (C03); only an untested-but-intact accounted subset (C17) may
    // count as a verified subset — never as complete.
    if (
      facts.enumeration.reason === 'NOT_EXERCISED' &&
      accounting.accounted.length > 0 &&
      accounting.accounted.every((id) => accounting.validated.includes(id)) &&
      accounting.authInaccessible.every((member) => member.independentlyAccounted)
    ) {
      return ok('VERIFIED_SUBSET');
    }
    return ok('UNKNOWN');
  }
  return ok('UNKNOWN');
}

function resolutionStatusFrom(
  facts: ProjectionFacts,
  accounting: CoverageAccounting | undefined,
): TargetResolutionStatus {
  if (blockedReason(facts) !== undefined) {
    return 'BLOCKED';
  }
  if (facts.requestedMemberIds.length === 0) {
    if (facts.resolution?.verifiedEmpty === true) {
      return 'EMPTY_CONFIRMED';
    }
    if (facts.enumeration.kind === 'UNPROVEN_EMPTY') {
      return 'EMPTY_UNKNOWN';
    }
  }
  if (facts.scopeKind === 'single_resource') {
    return facts.acceptedSelectedMemberIds.length === 1 ? 'RESOLVED' : 'PARTIAL';
  }
  if (accounting === undefined) {
    return 'PARTIAL';
  }
  return identitySetEquals(accounting.resolved, accounting.requested) ? 'RESOLVED' : 'PARTIAL';
}

function selectionAcquisitionFrom(
  facts: ProjectionFacts,
  selected: readonly MemberId[],
  outcomes: readonly MemberRequiredValidation[],
): SelectionAcquisitionStatus {
  if (selected.length === 0) {
    // No vacuous success for an empty selected set (PRD §16.3).
    return 'NOT_STARTED';
  }
  const accepted = new Set(
    facts.cancellation ? facts.cancellation.acceptedBeforeCutoff : facts.acceptedSelectedMemberIds,
  );
  const outcomeByMember = new Map(outcomes.map((outcome) => [outcome.memberId, outcome.result]));
  const anyFailed = selected.some((id) => outcomeByMember.get(id) === 'VALIDATION_FAILED');
  const allAccepted = selected.every((id) => accepted.has(id));
  const allPassed = selected.every((id) => outcomeByMember.get(id) === 'VALIDATED');
  const anyAccepted = selected.some((id) => accepted.has(id));

  if (anyFailed) {
    // A failed required validation is terminal member truth; confirmation can
    // never waive it into COMPLETE (C27).
    return 'FAILED';
  }
  if (facts.cancellation !== undefined) {
    if (allAccepted && allPassed) {
      // Acceptance committed before cancellation is not retroactively revoked.
      return 'COMPLETE';
    }
    return anyAccepted ? 'PARTIAL' : 'CANCELLED';
  }
  return allAccepted && allPassed ? 'COMPLETE' : anyAccepted ? 'PARTIAL' : 'NOT_STARTED';
}

function requestFulfillmentFrom(
  facts: ProjectionFacts,
  coverage: CoverageStatus,
  selection: SelectionAcquisitionStatus,
  outcomes: readonly MemberRequiredValidation[],
): RequestFulfillmentStatus {
  if (blockedReason(facts) !== undefined) {
    return 'UNSATISFIED';
  }
  if (facts.requestedMemberIds.length === 0) {
    if (facts.resolution?.verifiedEmpty === true && coverage === 'VERIFIED_COMPLETE') {
      return 'COMPLETE';
    }
    return 'UNKNOWN';
  }
  // Fulfillment truth is durable: only members durably accepted AND passing
  // required validation count as fulfilled. Validated-but-unaccepted bytes
  // are never fulfillment (L2 §11.1).
  const acceptedSet = new Set(
    facts.cancellation ? facts.cancellation.acceptedBeforeCutoff : facts.acceptedSelectedMemberIds,
  );
  const fulfilledSet = new Set(
    outcomes
      .filter((outcome) => outcome.result === 'VALIDATED' && acceptedSet.has(outcome.memberId))
      .map((outcome) => outcome.memberId),
  );
  const fulfilled = facts.requestedMemberIds.filter((id) => fulfilledSet.has(id));
  if (fulfilled.length === facts.requestedMemberIds.length) {
    // Entire-collection scope completes only on verified requested-scope
    // coverage; accessible-subset success never substitutes (PRD §18.7/§19).
    if (facts.scopeKind === 'entire_supported_collection' && coverage !== 'VERIFIED_COMPLETE') {
      return 'PARTIAL';
    }
    return 'COMPLETE';
  }
  if (fulfilled.length > 0) {
    return 'PARTIAL';
  }
  if (selection === 'FAILED' || facts.stopFacts?.validationFailed === true) {
    return 'UNSATISFIED';
  }
  if (facts.stopFacts?.unsupported === true) {
    return 'UNSATISFIED';
  }
  if (facts.cancellation !== undefined) {
    // Cancellation stops the lifecycle with nothing achieved: the request is
    // known not fulfilled and never fabricated into success (L2 §11.1).
    return 'UNSATISFIED';
  }
  return 'UNKNOWN';
}

function stopReasonFrom(
  facts: ProjectionFacts,
  selection: SelectionAcquisitionStatus,
  fulfillment: RequestFulfillmentStatus,
  outcomes: readonly MemberRequiredValidation[],
): StopReason {
  const cancellation = facts.cancellation;
  if (cancellation !== undefined) {
    const selected = selectedSetOf(facts);
    const accepted = new Set(cancellation.acceptedBeforeCutoff);
    const selectedFullyDone =
      selected.length > 0 &&
      selected.every((id) => accepted.has(id)) &&
      outcomes.every((outcome) => outcome.result === 'VALIDATED');
    const workAlreadyComplete = selectedFullyDone && fulfillment === 'COMPLETE';
    // USER_CANCELLED only when cancellation is why remaining work stopped.
    if (!workAlreadyComplete) {
      return 'USER_CANCELLED';
    }
  }
  const stop = facts.stopFacts ?? {};
  const blocked = blockedReason(facts);
  if (stop.authFailed === true || blocked === 'AUTH_FAILED') {
    return 'AUTH_FAILED';
  }
  if (blocked === 'AUTH_REQUIRED') {
    return 'AUTH_REQUIRED';
  }
  if (stop.unsupported === true || blocked === 'UNSUPPORTED') {
    return 'UNSUPPORTED';
  }
  if (stop.validationFailed === true) {
    return 'VALIDATION_FAILED';
  }
  if (stop.targetChanged === true) {
    return 'TARGET_CHANGED';
  }
  if (stop.collectionChanged === true) {
    return 'COLLECTION_CHANGED';
  }
  if (facts.enumeration.kind === 'TRUNCATED') {
    switch (facts.enumeration.by) {
      case 'DISCOVERY_BUDGET':
        return 'DISCOVERY_BUDGET_EXHAUSTED';
      case 'TRANSFER_BUDGET':
        return 'TRANSFER_BUDGET_EXHAUSTED';
      case 'GLOBAL_SAFETY':
      case 'SAFETY_CAP':
        return 'GLOBAL_SAFETY_LIMIT';
      case 'PAGE_LIMIT':
      case 'TIMEOUT':
        return 'NO_PROGRESS';
    }
  }
  if (stop.authRequired === true) {
    return 'AUTH_REQUIRED';
  }
  if (stop.discoveryBudgetExhausted === true) {
    return 'DISCOVERY_BUDGET_EXHAUSTED';
  }
  if (stop.transferBudgetExhausted === true) {
    return 'TRANSFER_BUDGET_EXHAUSTED';
  }
  if (stop.globalSafetyLimit === true) {
    return 'GLOBAL_SAFETY_LIMIT';
  }
  if (selection === 'FAILED') {
    return 'VALIDATION_FAILED';
  }
  if (facts.enumeration.kind === 'INCOMPLETE_UNKNOWN' || stop.noProgress === true) {
    return 'NO_PROGRESS';
  }
  if (fulfillment === 'COMPLETE') {
    if (
      facts.enumeration.kind === 'USER_SELECTION_COMPLETE' ||
      facts.scopeKind === 'selected_collection_members'
    ) {
      return 'USER_SELECTION_COMPLETE';
    }
    if (
      facts.enumeration.kind === 'USER_SCOPE_REACHED' ||
      BOUNDED_SCOPES.includes(facts.scopeKind)
    ) {
      return 'USER_SCOPE_REACHED';
    }
    if (
      facts.enumeration.kind === 'NATURAL_END_VALIDATED' ||
      facts.enumeration.kind === 'CONTINUATION_CLOSED'
    ) {
      return 'NATURAL_COLLECTION_END';
    }
    return 'NONE';
  }
  if (facts.requestedMemberIds.length === 0 && facts.enumeration.kind === 'UNPROVEN_EMPTY') {
    return 'NO_PROGRESS';
  }
  return 'NONE';
}

function authLimitedExplanation(accounting: CoverageAccounting): string {
  const validated = accounting.counts.validated;
  const requested = accounting.counts.requested;
  const inaccessible = accounting.counts.authInaccessible;
  return (
    `${validated} of ${requested} requested members were acquired and validated. ` +
    `The requested scope remains all ${requested} members. ` +
    `${inaccessible} known requested members are inaccessible under the current authorization context; ` +
    'no unauthorized access was attempted.'
  );
}

function project(facts: ProjectionFacts): DomainValidationResult<ProjectedTerminalResult> {
  // --- cutoff order validity (L2 §11.1 / invariant 20) ---
  if (facts.cancellation !== undefined) {
    const cutoffSet = new Set(facts.cancellation.acceptedBeforeCutoff);
    const acrossCutoff = facts.acceptedSelectedMemberIds.filter((id) => !cutoffSet.has(id));
    if (acrossCutoff.length > 0) {
      return reject(
        'CANCELLATION_CUTOFF_VIOLATION',
        `acceptance committed after the durable cancellation cutoff for (${acrossCutoff.join(', ')}); staged/validated bytes can never auto-accept across the cutoff`,
        'L2-§11.1-inv20',
      );
    }
    const unknownCutoff = facts.cancellation.acceptedBeforeCutoff.filter(
      (id) => !facts.acceptedSelectedMemberIds.includes(id),
    );
    if (unknownCutoff.length > 0) {
      return reject(
        'CANCELLATION_CUTOFF_VIOLATION',
        `cutoff facts list acceptances absent from the durable acceptance facts (${unknownCutoff.join(', ')})`,
        'L2-§11.1',
      );
    }
  }

  const selected = selectedSetOf(facts);

  if (facts.scopeKind === 'single_resource' && facts.requestedMemberIds.length !== 1) {
    return reject(
      'MALFORMED_REQUIRED_FIELD',
      'single-resource projection requires exactly one requested target identity',
      'PRD-§16.1',
    );
  }

  if (
    facts.scopeKind !== 'single_resource' &&
    blockedReason(facts) === undefined &&
    facts.accounting === undefined
  ) {
    return reject(
      'MISSING_REQUIRED_FIELD',
      'collection-scope projection requires requested-scope coverage accounting bound to the CoverageTarget',
      'PRD-§17',
    );
  }

  if (facts.resolution?.verifiedEmpty === true) {
    if (facts.requestedMemberIds.length !== 0) {
      return reject(
        'INVALID_RESULT_COMBINATION',
        'verified-empty resolution contradicts a non-empty requested reference set',
        'PRD-§18.5',
      );
    }
    if (facts.coverageBasis === undefined || facts.coverageBasis.kind !== 'SUFFICIENT') {
      return reject(
        'INSUFFICIENT_EVIDENCE',
        'verified-empty requires independent closure evidence; unproven emptiness cannot be projected verified',
        'PRD-§18.5',
      );
    }
  }

  const outcomes = memberOutcomesFrom(facts, selected);
  if (!outcomes.ok) {
    return outcomes;
  }
  const memberOutcomes = outcomes.value;

  const coverage = coverageStatusFrom(facts);
  if (!coverage.ok) {
    return coverage;
  }
  const coverageStatus = coverage.value;

  const resolution = resolutionStatusFrom(facts, facts.accounting);
  const selection = selectionAcquisitionFrom(facts, selected, memberOutcomes);
  const fulfillment = requestFulfillmentFrom(facts, coverageStatus, selection, memberOutcomes);
  const stopReason = stopReasonFrom(facts, selection, fulfillment, memberOutcomes);
  const summary = validationSummaryFrom(selected, memberOutcomes);

  // Forbidden-tuple refusals with the violated rule identified (PRD §18.8).
  if (resolution === 'EMPTY_UNKNOWN' && fulfillment === 'COMPLETE') {
    return reject(
      'INVALID_RESULT_COMBINATION',
      'TargetResolution EMPTY_UNKNOWN cannot complete the request',
      'PRD-§18.8',
    );
  }
  if (resolution === 'PARTIAL' && coverageStatus === 'VERIFIED_COMPLETE') {
    return reject(
      'INVALID_RESULT_COMBINATION',
      'TargetResolution PARTIAL forbids requested-scope Coverage VERIFIED_COMPLETE for the same CoverageTarget',
      'PRD-§18.8',
    );
  }
  if (selection === 'COMPLETE' && selected.length === 0) {
    return reject(
      'EMPTY_SET_NOT_SUCCESS',
      'empty selected set is never vacuous acquisition success',
      'PRD-§16.3',
    );
  }
  if (facts.authorizationLimited === true && fulfillment === 'COMPLETE') {
    return reject(
      'INVALID_RESULT_COMBINATION',
      'whole-collection request cannot be COMPLETE while known requested members remain unfulfilled because of authorization',
      'C10/PRD-§18.7',
    );
  }

  const t002Outcomes: readonly SelectedMemberValidationOutcome[] = selected.map((memberId) => {
    const result = memberOutcomes.find((outcome) => outcome.memberId === memberId)?.result;
    return { memberId, requiredValidationPassed: result === 'VALIDATED' };
  });

  const context: TerminalResultContext = {
    intentType: facts.intentType,
    scopeKind: facts.scopeKind,
    selectedMemberCount: selected.length,
    selectedValidationOutcomes: t002Outcomes,
    coverageEvidence: facts.coverageBasis,
    knownAuthInaccessibleRequestedCount: facts.accounting?.counts.authInaccessible,
  };

  const built = buildTerminalResult({
    contractId: facts.contractId,
    snapshotId: facts.snapshotId,
    requestFulfillment: fulfillment,
    targetResolution: resolution,
    selectionAcquisition: selection,
    coverage: coverageStatus,
    stopReason,
    validationSummary: summary,
    recordedAt: facts.recordedAt,
  });
  if (!built.ok) {
    return built;
  }
  // Second fail-closed gate: the frozen T002 legal-combination rules must
  // accept the derived result. Refusal, never normalization.
  const legal = validateTerminalResult(built.value, context);
  if (!legal.ok) {
    return legal;
  }

  const explanation =
    facts.authorizationLimited === true &&
    fulfillment === 'PARTIAL' &&
    facts.accounting !== undefined
      ? authLimitedExplanation(facts.accounting)
      : undefined;

  return ok(
    deepFreeze({
      result: built.value,
      explanation,
      accounting: facts.accounting,
    }),
  );
}

/**
 * Deterministic, stateless projection from canonical facts. Identical facts
 * always yield a deep-equal terminal result.
 */
export function projectResult(
  facts: ProjectionFacts,
): DomainValidationResult<ProjectedTerminalResult> {
  return project(facts);
}

/**
 * Terminal-result store: one immutable terminal result per contract/snapshot
 * lineage. Once projected, later facts (including a late cancellation) never
 * rewrite the terminal truth (L2 §11.1; negative coverage
 * post-terminal-mutation-of-projected-result).
 */
export interface TerminalResultStore {
  readonly project: (facts: ProjectionFacts) => DomainValidationResult<ProjectedTerminalResult>;
  readonly terminalFor: (
    contractId: string,
    snapshotId?: string,
  ) => ProjectedTerminalResult | undefined;
  /** Thin, non-authoritative read projection for surfaces (L2 invariant 2). */
  readonly surfaceView: (
    contractId: string,
    snapshotId?: string,
  ) => TerminalResultProjection | undefined;
}

export function createTerminalResultStore(): TerminalResultStore {
  const terminalByKey = new Map<string, ProjectedTerminalResult>();
  const keyOf = (contractId: string, snapshotId?: string): string =>
    `${contractId}#${snapshotId ?? '-'}`;

  return deepFreeze({
    project(facts) {
      const key = keyOf(facts.contractId, facts.snapshotId);
      const existing = terminalByKey.get(key);
      if (existing !== undefined) {
        if (facts.explicitRetryResume === true) {
          // Explicit retry/resume is the one authorized control transition
          // that reopens the frozen lineage; its terminal supersedes the old.
          const reopened = project(facts);
          if (!reopened.ok) {
            return reopened;
          }
          terminalByKey.set(key, reopened.value);
          return reopened;
        }
        // Post-terminal mutation is impossible: the recorded terminal result
        // is returned unchanged; late events never rewrite it.
        return ok(existing);
      }
      const projected = project(facts);
      if (!projected.ok) {
        return projected;
      }
      terminalByKey.set(key, projected.value);
      return projected;
    },
    terminalFor(contractId, snapshotId) {
      return terminalByKey.get(keyOf(contractId, snapshotId));
    },
    surfaceView(contractId, snapshotId) {
      const terminal = terminalByKey.get(keyOf(contractId, snapshotId));
      // Thin read projection, frozen so no surface can mutate canonical truth
      // through it (L2 invariant 2).
      return terminal === undefined ? undefined : deepFreeze(projectForSurface(terminal.result));
    },
  });
}
