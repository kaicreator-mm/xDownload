/**
 * T003 successor Critical Journey oracle protocol (#91).
 *
 * This module is additive by design: the frozen/historical CJ-01..CJ-09
 * registry remains byte-identical. A fresh Phase-B run freezes one successor
 * oracle per task before exposure. CJ-08 is evaluated as fail-closed behavior
 * because the historical BLOCKED + NO_PROGRESS terminal tuple is not
 * representable by the canonical projector.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { stableDigest } from './canonical-json.ts';
import type { ExpectedTerminalStatusTuple } from './canonical-probe.ts';
import type { JourneyDefinition } from './journeys.ts';

export const T003_SUCCESSOR_ORACLE_PROTOCOL_ID = 't003-successor-oracle/v0.1.0-r1';

const PROTOCOL_RULES = deepFreeze({
  protocolId: T003_SUCCESSOR_ORACLE_PROTOCOL_ID,
  authority: {
    sourceIssue: '#80',
    executionIssue: '#91',
    authorityReviewPr: '#83',
    authorityMergeCommit: '0ac0b8ab8e66ec1b4f761a67f10875d13260afcd',
    productReopenRequired: false,
    l2AmendmentRequired: false,
  },
  phaseBIsolation: {
    priorRunRescoringAllowed: false,
    freshTaskIdentitiesRequired: true,
    freezeBeforeExposureRequired: true,
  },
  cj08: {
    mode: 'BEHAVIORAL_PRE_TERMINAL',
    terminalTupleRequired: false,
    requiredPredicates: [
      'STALE_ASSUMPTION_REJECTED',
      'NO_SILENT_STALE_TARGET_REUSE',
      'NO_SILENT_STALE_MEMBERSHIP_REUSE',
      'NO_ACQUISITION_BEFORE_REPAIR_OR_CONFIRMATION',
      'BOUNDED_REPAIR_OR_USER_CONFIRMATION',
    ],
  },
  memberValidation: {
    identitySource: 'PRE_REGISTERED_SELECTED_MEMBER_IDENTITIES',
    countUnit: 'SELECTED_MEMBER',
    expectedResultVocabulary: ['VALIDATED', 'VALIDATION_FAILED', 'NOT_VALIDATED'],
  },
});

export const T003_SUCCESSOR_ORACLE_PROTOCOL = PROTOCOL_RULES;
export const T003_SUCCESSOR_ORACLE_PROTOCOL_DIGEST = stableDigest(PROTOCOL_RULES);

export type ExpectedMemberValidationResult = 'VALIDATED' | 'VALIDATION_FAILED' | 'NOT_VALIDATED';

export interface ExpectedMemberValidation {
  readonly memberId: string;
  readonly expectedResult: ExpectedMemberValidationResult;
}

export interface SuccessorJourneyOracleInput {
  /** Fresh, pre-exposure identity for this exact Phase-B task oracle. */
  readonly oracleId: string;
  readonly journeyId: string;
  readonly taskCaseId: string;
  /** Exact selected identity set frozen before Phase-B exposure. */
  readonly selectedMemberIds: readonly string[];
  /** Exactly one pre-registered truth expectation per selected member. */
  readonly expectedMemberValidation: readonly ExpectedMemberValidation[];
}

export interface FrozenSuccessorJourneyOracle {
  readonly oracleId: string;
  readonly protocolId: typeof T003_SUCCESSOR_ORACLE_PROTOCOL_ID;
  readonly protocolDigest: string;
  readonly journeyId: string;
  readonly taskCaseId: string;
  readonly selectedMemberIds: readonly string[];
  readonly expectedMemberValidation: readonly ExpectedMemberValidation[];
  /**
   * Absent for CJ-08: its pre-terminal stale-assumption path is judged by
   * behavioral predicates, not by fabricating an impossible terminal tuple.
   */
  readonly expectedTerminal?: ExpectedTerminalStatusTuple;
  readonly cj08BehavioralOracle?: typeof PROTOCOL_RULES.cj08;
  readonly oracleDigest: string;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function validationSummaryFromExpectation(
  selectedMemberIds: readonly string[],
  expectations: readonly ExpectedMemberValidation[],
): ExpectedTerminalStatusTuple['validationSummary'] {
  const byMember = new Map(expectations.map((item) => [item.memberId, item.expectedResult]));
  let passed = 0;
  let failed = 0;
  let unproven = 0;
  for (const memberId of selectedMemberIds) {
    const expected = byMember.get(memberId) ?? 'NOT_VALIDATED';
    if (expected === 'VALIDATED') {
      passed += 1;
    } else if (expected === 'VALIDATION_FAILED') {
      failed += 1;
    } else {
      unproven += 1;
    }
  }

  const status =
    selectedMemberIds.length === 0 || (passed === 0 && failed === 0)
      ? 'NOT_PERFORMED'
      : failed > 0
        ? passed > 0
          ? 'PARTIAL'
          : 'FAILED'
        : unproven > 0
          ? 'INSUFFICIENT_EVIDENCE'
          : 'ALL_PASSED';

  return deepFreeze({ status, passedCount: passed, failedCount: failed });
}

function validateInput(
  input: SuccessorJourneyOracleInput,
  historical: JourneyDefinition,
): DomainValidationResult<void> {
  if (!nonEmpty(input.oracleId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'successorOracle.oracleId',
        'oracleId must be non-empty and frozen before Phase-B exposure',
        'PRD-§32.1/C33',
      ),
    ]);
  }
  if (input.journeyId !== historical.journeyId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'successorOracle.journeyId',
        `successor oracle journey '${input.journeyId}' does not match historical journey '${historical.journeyId}'`,
        'PRD-§31',
      ),
    ]);
  }
  if (input.taskCaseId !== historical.corpusRef.taskCaseId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'successorOracle.taskCaseId',
        `task case '${input.taskCaseId}' does not match historical corpus binding '${historical.corpusRef.taskCaseId}'`,
        'PRD-§31',
      ),
    ]);
  }

  const selected = new Set<string>();
  for (const [index, memberId] of input.selectedMemberIds.entries()) {
    if (!nonEmpty(memberId)) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `successorOracle.selectedMemberIds[${index}]`,
          'selected member identity must be non-empty',
          'PRD-§19',
        ),
      ]);
    }
    if (selected.has(memberId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          `successorOracle.selectedMemberIds[${index}]`,
          `selected member identity '${memberId}' is duplicated`,
          'PRD-§19',
        ),
      ]);
    }
    selected.add(memberId);
  }

  const expected = new Set<string>();
  for (const [index, item] of input.expectedMemberValidation.entries()) {
    if (!nonEmpty(item.memberId)) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `successorOracle.expectedMemberValidation[${index}].memberId`,
          'expected member identity must be non-empty',
          'PRD-§19',
        ),
      ]);
    }
    if (expected.has(item.memberId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          `successorOracle.expectedMemberValidation[${index}].memberId`,
          `member validation expectation for '${item.memberId}' is duplicated`,
          'PRD-§19',
        ),
      ]);
    }
    if (!selected.has(item.memberId)) {
      return fail([
        diagnostic(
          'SCOPE_MUTATION',
          `successorOracle.expectedMemberValidation[${index}].memberId`,
          `member '${item.memberId}' is outside the pre-registered selected identity set`,
          'PRD-§19',
        ),
      ]);
    }
    if (
      item.expectedResult !== 'VALIDATED' &&
      item.expectedResult !== 'VALIDATION_FAILED' &&
      item.expectedResult !== 'NOT_VALIDATED'
    ) {
      return fail([
        diagnostic(
          'UNKNOWN_ENUM_VALUE',
          `successorOracle.expectedMemberValidation[${index}].expectedResult`,
          `unknown expected validation result '${String(item.expectedResult)}'`,
          'PRD-§19',
        ),
      ]);
    }
    expected.add(item.memberId);
  }

  if (expected.size !== selected.size) {
    const missing = input.selectedMemberIds.filter((id) => !expected.has(id));
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'successorOracle.expectedMemberValidation',
        `every selected identity must have one pre-registered validation expectation; missing: ${missing.join(', ')}`,
        'PRD-§19/C22',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Freeze a run-specific successor oracle before Phase-B exposure.
 *
 * The digest includes exact selected identities and expected independent truth,
 * so observed counts cannot be written back into the oracle after execution.
 */
export function freezeSuccessorJourneyOracle(
  input: SuccessorJourneyOracleInput,
  historical: JourneyDefinition,
): DomainValidationResult<FrozenSuccessorJourneyOracle> {
  const valid = validateInput(input, historical);
  if (!valid.ok) {
    return valid;
  }

  const selectedMemberIds = deepFreeze([...input.selectedMemberIds]);
  const expectedMemberValidation = deepFreeze(
    input.expectedMemberValidation.map((item) =>
      deepFreeze({ memberId: item.memberId, expectedResult: item.expectedResult }),
    ),
  );

  const base =
    input.journeyId === 'CJ-08'
      ? {
          oracleId: input.oracleId,
          protocolId: T003_SUCCESSOR_ORACLE_PROTOCOL_ID,
          protocolDigest: T003_SUCCESSOR_ORACLE_PROTOCOL_DIGEST,
          journeyId: input.journeyId,
          taskCaseId: input.taskCaseId,
          selectedMemberIds,
          expectedMemberValidation,
          cj08BehavioralOracle: PROTOCOL_RULES.cj08,
        }
      : {
          oracleId: input.oracleId,
          protocolId: T003_SUCCESSOR_ORACLE_PROTOCOL_ID,
          protocolDigest: T003_SUCCESSOR_ORACLE_PROTOCOL_DIGEST,
          journeyId: input.journeyId,
          taskCaseId: input.taskCaseId,
          selectedMemberIds,
          expectedMemberValidation,
          expectedTerminal: deepFreeze({
            ...historical.expectedResultStatuses,
            validationSummary: validationSummaryFromExpectation(
              selectedMemberIds,
              expectedMemberValidation,
            ),
          }),
        };

  return ok(deepFreeze({ ...base, oracleDigest: stableDigest(base) }));
}

export interface CJ08BehaviorObservation {
  readonly staleAssumptionRejected: boolean;
  readonly silentStaleTargetReuse: boolean;
  readonly silentStaleMembershipReuse: boolean;
  readonly acquisitionStartedBeforeRepairOrConfirmation: boolean;
  readonly boundedRepairOrUserConfirmationOffered: boolean;
}

export interface CJ08BehaviorEvaluation {
  readonly verdict: 'PASS' | 'FAIL';
  readonly violations: readonly string[];
}

/**
 * Evaluate the PRD §31/CJ-08 behavior without requiring a synthetic terminal.
 * A downstream terminal, if one genuinely occurs after repair/confirmation,
 * remains subject to the normal canonical terminal/result validators.
 */
export function evaluateCJ08Behavior(observation: CJ08BehaviorObservation): CJ08BehaviorEvaluation {
  const violations: string[] = [];
  if (!observation.staleAssumptionRejected) {
    violations.push('STALE_ASSUMPTION_NOT_REJECTED');
  }
  if (observation.silentStaleTargetReuse) {
    violations.push('SILENT_STALE_TARGET_REUSE');
  }
  if (observation.silentStaleMembershipReuse) {
    violations.push('SILENT_STALE_MEMBERSHIP_REUSE');
  }
  if (observation.acquisitionStartedBeforeRepairOrConfirmation) {
    violations.push('ACQUISITION_STARTED_BEFORE_REPAIR_OR_CONFIRMATION');
  }
  if (!observation.boundedRepairOrUserConfirmationOffered) {
    violations.push('NO_BOUNDED_REPAIR_OR_USER_CONFIRMATION');
  }
  return deepFreeze({
    verdict: violations.length === 0 ? 'PASS' : 'FAIL',
    violations: deepFreeze(violations),
  });
}
