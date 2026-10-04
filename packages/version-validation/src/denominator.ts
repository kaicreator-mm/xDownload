/**
 * T003 denominator / UNKNOWN / abandonment accounting (frozen PRD §32.1;
 * C32).
 *
 * Pure classification/aggregation over recorded end-to-end task outcomes:
 * every rule row is individually testable without I/O. Non-success classes
 * are preserved distinctly and never collapsed into a success count:
 * UNKNOWN is never success and stays in the denominator unless independent
 * truth itself is unavailable (INSUFFICIENT_EVIDENCE); friction-caused
 * abandonment is non-success; external cancellation is excluded only with a
 * pre-recorded reason; repeated runs of the same unchanged task are not
 * independent sample units; scope-classification errors count against
 * scope/UX correctness.
 */

import {
  andThen,
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  requireBoolean,
  requireLiteral,
  requireNonEmptyString,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { makeRunId, makeTaskCaseId, type RunId, type TaskCaseId } from './identity.ts';
import { decodeTruthSource } from './truth-source.ts';

/** The sample unit literal: one end-to-end user Acquisition task (PRD §32.1). */
export const SAMPLE_UNIT = 'END_TO_END_ACQUISITION_TASK' as const;

export interface TaskRunRecord {
  /** Sample-unit literal; per-file counting is unrepresentable by construction. */
  readonly sampleUnit: typeof SAMPLE_UNIT;
  readonly taskCaseId: TaskCaseId;
  readonly runId: RunId;
  /** The confirmation outcome recorded for the end-to-end task. */
  readonly outcome: 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'UNKNOWN' | 'OUT_OF_SCOPE';
  /** Whether independent truth was available for the outcome. */
  readonly truthAvailable: boolean;
  /** Required when truth was available; must be a pre-registered independent source. */
  readonly truthSource?: unknown;
  readonly abandonment?: {
    readonly cause: 'XDOWNLOAD_FRICTION' | 'EXTERNAL_UNRELATED';
    /** Pre-recorded exclusion reason; required to exclude external cancellation. */
    readonly reasonPreRecorded?: boolean;
  };
  /** Set when this run repeats an earlier run of the same unchanged task. */
  readonly repeatOf?: { readonly priorRunId: RunId; readonly taskUnchanged: boolean };
  /** Scope-classification audit: true when the task was misclassified in/out of scope. */
  readonly scopeClassificationError?: boolean;
}

export type OutcomeClass =
  | 'SUCCESS'
  | 'FAILURE'
  | 'UNKNOWN_NON_SUCCESS'
  | 'ABANDONED_NON_SUCCESS'
  | 'OUT_OF_SCOPE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'EXCLUDED_EXTERNAL_CANCELLATION'
  | 'REPEATED_RUN_NOT_INDEPENDENT';

const RECORD_KEYS: readonly string[] = [
  'sampleUnit',
  'taskCaseId',
  'runId',
  'outcome',
  'truthAvailable',
  'truthSource',
  'abandonment',
  'repeatOf',
  'scopeClassificationError',
];

const OUTCOMES: readonly TaskRunRecord['outcome'][] = [
  'SUCCESS',
  'FAILED',
  'ABANDONED',
  'UNKNOWN',
  'OUT_OF_SCOPE',
];

const ABANDONMENT_KEYS: readonly string[] = ['cause', 'reasonPreRecorded'];
const REPEAT_KEYS: readonly string[] = ['priorRunId', 'taskUnchanged'];

/**
 * Decode one recorded task-run outcome. Success claims require independent
 * pre-registered truth; a success without truth, or with self-generated
 * truth, fails closed (PRD §32.1 truth-source rule, C34).
 */
export function decodeTaskRunRecord(value: unknown): DomainValidationResult<TaskRunRecord> {
  const path = 'taskRun';
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, RECORD_KEYS, path), () => {
      const sampleUnit = requireLiteral(record, 'sampleUnit', [SAMPLE_UNIT], path);
      if (!sampleUnit.ok) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.sampleUnit`,
            `sample unit must be '${SAMPLE_UNIT}'; individual downloaded files are never sample units`,
            'PRD-§32.1',
          ),
        ]);
      }
      const taskCaseIdRaw = requireNonEmptyString(record, 'taskCaseId', path);
      if (!taskCaseIdRaw.ok) {
        return taskCaseIdRaw;
      }
      const taskCaseId = makeTaskCaseId(taskCaseIdRaw.value);
      if (!taskCaseId.ok) {
        return taskCaseId;
      }
      const runIdRaw = requireNonEmptyString(record, 'runId', path);
      if (!runIdRaw.ok) {
        return runIdRaw;
      }
      const runId = makeRunId(runIdRaw.value);
      if (!runId.ok) {
        return runId;
      }
      const outcome = requireLiteral(record, 'outcome', OUTCOMES, path);
      if (!outcome.ok) {
        return outcome;
      }
      const truthAvailable = requireBoolean(record, 'truthAvailable', path);
      if (!truthAvailable.ok) {
        return truthAvailable;
      }
      let truthSource;
      const rawTruthSource = record['truthSource'];
      if (truthAvailable.value) {
        if (rawTruthSource === undefined) {
          return fail([
            diagnostic(
              'MISSING_REQUIRED_FIELD',
              `${path}.truthSource`,
              'an outcome with available truth must carry its pre-registered truth source',
              'PRD-§32.1',
            ),
          ]);
        }
        const decodedTruth = decodeTruthSource(rawTruthSource, `${path}.truthSource`);
        if (!decodedTruth.ok) {
          return decodedTruth;
        }
        truthSource = decodedTruth.value;
      } else if (rawTruthSource !== undefined) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.truthSource`,
            'truth source recorded while truthAvailable is false',
          ),
        ]);
      }
      let abandonment: TaskRunRecord['abandonment'];
      const rawAbandonment = record['abandonment'];
      if (rawAbandonment !== undefined) {
        const decoded = andThen(
          asRecord(rawAbandonment, `${path}.abandonment`),
          (abandonmentRecord) =>
            andThen(
              rejectUnknownFields(abandonmentRecord, ABANDONMENT_KEYS, `${path}.abandonment`),
              () => {
                const cause = requireLiteral(
                  abandonmentRecord,
                  'cause',
                  ['XDOWNLOAD_FRICTION', 'EXTERNAL_UNRELATED'],
                  `${path}.abandonment`,
                );
                if (!cause.ok) {
                  return cause;
                }
                let reasonPreRecorded: boolean | undefined;
                if (abandonmentRecord['reasonPreRecorded'] !== undefined) {
                  const decodedReason = requireBoolean(
                    abandonmentRecord,
                    'reasonPreRecorded',
                    `${path}.abandonment`,
                  );
                  if (!decodedReason.ok) {
                    return decodedReason;
                  }
                  reasonPreRecorded = decodedReason.value;
                }
                return ok(
                  deepFreeze({
                    cause: cause.value,
                    reasonPreRecorded,
                  }),
                );
              },
            ),
        );
        if (!decoded.ok) {
          return decoded;
        }
        abandonment = decoded.value;
      }
      let repeatOf: TaskRunRecord['repeatOf'];
      const rawRepeat = record['repeatOf'];
      if (rawRepeat !== undefined) {
        const decoded = andThen(asRecord(rawRepeat, `${path}.repeatOf`), (repeatRecord) =>
          andThen(rejectUnknownFields(repeatRecord, REPEAT_KEYS, `${path}.repeatOf`), () => {
            const priorRunIdRaw = requireNonEmptyString(
              repeatRecord,
              'priorRunId',
              `${path}.repeatOf`,
            );
            const taskUnchanged = requireBoolean(repeatRecord, 'taskUnchanged', `${path}.repeatOf`);
            if (!priorRunIdRaw.ok || !taskUnchanged.ok) {
              return fail([
                ...(priorRunIdRaw.ok ? [] : priorRunIdRaw.diagnostics),
                ...(taskUnchanged.ok ? [] : taskUnchanged.diagnostics),
              ]);
            }
            const priorRunId = makeRunId(priorRunIdRaw.value);
            if (!priorRunId.ok) {
              return priorRunId;
            }
            return ok(
              deepFreeze({ priorRunId: priorRunId.value, taskUnchanged: taskUnchanged.value }),
            );
          }),
        );
        if (!decoded.ok) {
          return decoded;
        }
        repeatOf = decoded.value;
      }
      let scopeClassificationError: boolean | undefined;
      if (record['scopeClassificationError'] !== undefined) {
        const decodedFlag = requireBoolean(record, 'scopeClassificationError', path);
        if (!decodedFlag.ok) {
          return decodedFlag;
        }
        scopeClassificationError = decodedFlag.value;
      }
      const decoded: TaskRunRecord = deepFreeze({
        sampleUnit: SAMPLE_UNIT,
        taskCaseId: taskCaseId.value,
        runId: runId.value,
        outcome: outcome.value,
        truthAvailable: truthAvailable.value,
        truthSource,
        abandonment,
        repeatOf,
        scopeClassificationError,
      });
      if (decoded.outcome === 'SUCCESS' && !decoded.truthAvailable) {
        return fail([
          diagnostic(
            'SELF_CERTIFICATION',
            `${path}.outcome`,
            'a success classification without available independent truth is self-certification',
            'C34/PRD-§32.1',
          ),
        ]);
      }
      if (decoded.outcome === 'ABANDONED' && decoded.abandonment === undefined) {
        return fail([
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            `${path}.abandonment`,
            'an abandoned task must record its abandonment cause so exclusion is only possible with a pre-recorded reason',
            'PRD-§32.1',
          ),
        ]);
      }
      if (decoded.outcome !== 'ABANDONED' && decoded.abandonment !== undefined) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.abandonment`,
            'an abandonment cause can only be recorded on an ABANDONED outcome',
            'PRD-§32.1',
          ),
        ]);
      }
      if (decoded.outcome === 'OUT_OF_SCOPE' && decoded.abandonment !== undefined) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.outcome`,
            'an out-of-scope task cannot also record an abandonment cause',
          ),
        ]);
      }
      return ok(decoded);
    }),
  );
}

/**
 * Classify one recorded run per PRD §32.1. The classification is total: every
 * record lands in exactly one class, and non-success classes stay distinct.
 */
export function classifyTaskRun(record: TaskRunRecord): OutcomeClass {
  if (record.repeatOf !== undefined && record.repeatOf.taskUnchanged) {
    return 'REPEATED_RUN_NOT_INDEPENDENT';
  }
  if (record.outcome === 'OUT_OF_SCOPE') {
    return 'OUT_OF_SCOPE';
  }
  if (record.abandonment !== undefined) {
    if (
      record.abandonment.cause === 'EXTERNAL_UNRELATED' &&
      record.abandonment.reasonPreRecorded === true
    ) {
      return 'EXCLUDED_EXTERNAL_CANCELLATION';
    }
    return 'ABANDONED_NON_SUCCESS';
  }
  if (record.outcome === 'SUCCESS') {
    return 'SUCCESS';
  }
  if (record.outcome === 'FAILED') {
    return 'FAILURE';
  }
  // UNKNOWN outcome: stays in the denominator unless independent truth
  // itself is unavailable (PRD §32.1).
  return record.truthAvailable ? 'UNKNOWN_NON_SUCCESS' : 'INSUFFICIENT_EVIDENCE';
}

export interface DenominatorReport {
  /** In-scope, independent sample units: SUCCESS + FAILURE + UNKNOWN + ABANDONED. */
  readonly primaryDenominator: number;
  readonly successes: number;
  readonly failures: number;
  readonly unknownInDenominator: number;
  readonly abandonmentNonSuccess: number;
  /** Excluded from the primary denominator but reported separately (PRD §32.1). */
  readonly outOfScope: number;
  readonly insufficientEvidence: number;
  readonly repeatedRuns: number;
  readonly externalCancellationsExcluded: number;
  /** Scope-classification errors count against scope/UX correctness. */
  readonly scopeClassificationErrors: number;
}

/**
 * Aggregate classified runs into the common-denominator report. Pure,
 * deterministic, and structurally unable to count UNKNOWN as success: only
 * the SUCCESS class feeds `successes`.
 */
export function computeDenominator(records: readonly TaskRunRecord[]): DenominatorReport {
  const report = {
    primaryDenominator: 0,
    successes: 0,
    failures: 0,
    unknownInDenominator: 0,
    abandonmentNonSuccess: 0,
    outOfScope: 0,
    insufficientEvidence: 0,
    repeatedRuns: 0,
    externalCancellationsExcluded: 0,
    scopeClassificationErrors: 0,
  };
  for (const record of records) {
    if (record.scopeClassificationError === true) {
      report.scopeClassificationErrors += 1;
    }
    switch (classifyTaskRun(record)) {
      case 'SUCCESS':
        report.primaryDenominator += 1;
        report.successes += 1;
        break;
      case 'FAILURE':
        report.primaryDenominator += 1;
        report.failures += 1;
        break;
      case 'UNKNOWN_NON_SUCCESS':
        report.primaryDenominator += 1;
        report.unknownInDenominator += 1;
        break;
      case 'ABANDONED_NON_SUCCESS':
        report.primaryDenominator += 1;
        report.abandonmentNonSuccess += 1;
        break;
      case 'OUT_OF_SCOPE':
        report.outOfScope += 1;
        break;
      case 'INSUFFICIENT_EVIDENCE':
        report.insufficientEvidence += 1;
        break;
      case 'REPEATED_RUN_NOT_INDEPENDENT':
        report.repeatedRuns += 1;
        break;
      case 'EXCLUDED_EXTERNAL_CANCELLATION':
        report.externalCancellationsExcluded += 1;
        break;
    }
  }
  return deepFreeze(report);
}

/**
 * Structural invariant check on a report: UNKNOWN can never appear inside
 * successes, and the primary denominator always accounts for exactly the
 * in-scope non-excluded classes.
 */
export function assertDenominatorInvariants(
  report: DenominatorReport,
): DomainValidationResult<void> {
  const accounted =
    report.successes + report.failures + report.unknownInDenominator + report.abandonmentNonSuccess;
  if (accounted !== report.primaryDenominator) {
    return fail([
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        'denominatorReport',
        'primary denominator must equal the sum of in-scope independent classes',
        'PRD-§32.1',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Convenience decode+classify+aggregate over raw untrusted records; any
 * malformed or self-certified record fails closed.
 */
export function computeDenominatorFromRaw(
  rawRecords: readonly unknown[],
): DomainValidationResult<DenominatorReport> {
  const decoded: TaskRunRecord[] = [];
  for (const [index, raw] of rawRecords.entries()) {
    const record = decodeTaskRunRecord(raw);
    if (!record.ok) {
      return fail(record.diagnostics.map((d) => ({ ...d, path: `taskRuns[${index}].${d.path}` })));
    }
    decoded.push(record.value);
  }
  return ok(computeDenominator(decoded));
}
