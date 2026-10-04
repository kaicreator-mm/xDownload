/**
 * Canonical-vocabulary probe.
 *
 * T003 oracle/journey expectations bind to the canonical result vocabulary of
 * `@xdownload/domain-contracts` WITHOUT re-declaring any status enum: every
 * expected status field/tuple is validated by running it through the
 * canonical `decodeTerminalResult` structural decoder, so an unknown or
 * misspelled canonical status fails closed with the canonical diagnostic.
 */

import {
  andThen,
  asRecord,
  currentSchemaIdentity,
  decodeTerminalResult,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  type DomainValidationResult,
  type TerminalResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

/** A neutral, structurally valid terminal-result record used purely as the decode probe base. */
const NEUTRAL_PROBE_BASE: Record<string, unknown> = {
  schemaIdentity: currentSchemaIdentity(),
  contractId: 'oracle/canonical-probe',
  requestFulfillment: 'UNKNOWN',
  targetResolution: 'EMPTY_UNKNOWN',
  selectionAcquisition: 'NOT_STARTED',
  coverage: 'UNKNOWN',
  stopReason: 'NONE',
  validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
  recordedAt: '1970-01-01T00:00:00.000Z',
};

export type StatusFieldName =
  | 'requestFulfillment'
  | 'targetResolution'
  | 'selectionAcquisition'
  | 'coverage'
  | 'stopReason'
  | 'validationSummary';

/**
 * Prove `value` is a canonical member of the enum behind `field` by making it
 * survive the canonical structural decoder. Unknown values fail closed.
 */
export function assertCanonicalStatusValue(
  field: StatusFieldName,
  value: unknown,
  path: string,
): DomainValidationResult<void> {
  const candidate: Record<string, unknown> = { ...NEUTRAL_PROBE_BASE, [field]: value };
  const decoded = decodeTerminalResult(candidate);
  if (!decoded.ok) {
    return fail(
      decoded.diagnostics.map((d: ValidationDiagnostic) => ({
        ...d,
        path: `${path}.${field}`,
      })),
    );
  }
  return ok(undefined);
}

/**
 * One pre-registered expected terminal status tuple. Every present field is
 * validated against the canonical vocabulary; the decoded canonical values
 * are returned so callers can never observe an unvalidated literal.
 */
export type ExpectedTerminalStatusTuple = Pick<
  TerminalResult,
  | 'requestFulfillment'
  | 'targetResolution'
  | 'selectionAcquisition'
  | 'coverage'
  | 'stopReason'
  | 'validationSummary'
>;

const TUPLE_KEYS: readonly string[] = [
  'requestFulfillment',
  'targetResolution',
  'selectionAcquisition',
  'coverage',
  'stopReason',
  'validationSummary',
];

export function decodeExpectedTuple(
  value: unknown,
  path: string,
): DomainValidationResult<ExpectedTerminalStatusTuple> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, TUPLE_KEYS, path), (_void) => {
      const candidate: Record<string, unknown> = { ...NEUTRAL_PROBE_BASE, ...record };
      const decoded = decodeTerminalResult(candidate);
      if (!decoded.ok) {
        return fail(
          decoded.diagnostics.map((d: ValidationDiagnostic) => ({
            ...d,
            path: `${path}.${d.path}`,
          })),
        );
      }
      const result = decoded.value;
      return ok(
        deepFreeze({
          requestFulfillment: result.requestFulfillment,
          targetResolution: result.targetResolution,
          selectionAcquisition: result.selectionAcquisition,
          coverage: result.coverage,
          stopReason: result.stopReason,
          validationSummary: result.validationSummary,
        }),
      );
    }),
  );
}

/** Diagnostic helper carrying a canonical enum-rejection with an exact path. */
export function unknownValueDiagnostic(path: string, value: unknown): ValidationDiagnostic {
  return diagnostic('UNKNOWN_ENUM_VALUE', path, `unknown canonical value '${String(value)}'`);
}
