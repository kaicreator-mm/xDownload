/**
 * T014 fail-closed projection verification at the presentation boundary.
 *
 * The seam returns `SeamResponse.projection` as untrusted JSON across the
 * wire. Before anything is rendered, this module shape-verifies the payload
 * and binds it to the addressed aggregate. Verification never re-decodes the
 * payload into new surface semantics: the six terminal dimensions and all
 * statuses are checked against the known literal sets and rendered verbatim.
 * Any shape, literal or binding failure is a typed degraded state — never a
 * best-effort reinterpretation of partial data.
 */

import type { SeamProjectionView } from '@xdownload/core-seam';
import type {
  CoverageStatus,
  RequestFulfillmentStatus,
  SelectionAcquisitionStatus,
  StopReason,
  TargetResolutionStatus,
  ValidationSummary,
  ValidationSummaryStatus,
} from '@xdownload/domain-contracts';

export type ProjectionFailureReason =
  'PROJECTION_MALFORMED' | 'PROJECTION_AGGREGATE_BINDING_MISMATCH';

export type ProjectionVerification =
  | { readonly ok: true; readonly view: SeamProjectionView }
  | {
      readonly ok: false;
      readonly reason: ProjectionFailureReason;
      readonly detail: string;
    };

export type TerminalVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProjectionFailureReason; readonly detail: string };

const CONTRACT_STATUSES: readonly string[] = ['DRAFT', 'CONFIRMED'];
const INTENT_TYPES: readonly string[] = ['SINGLE_RESOURCE', 'COLLECTION'];
const LINEAGE_STATUSES: readonly string[] = ['ACTIVE', 'CANCELLED', 'TERMINAL'];

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
const SUMMARY_STATUSES: readonly ValidationSummaryStatus[] = [
  'ALL_PASSED',
  'PARTIAL',
  'FAILED',
  'INSUFFICIENT_EVIDENCE',
  'NOT_PERFORMED',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(reason: ProjectionFailureReason, detail: string): ProjectionVerification {
  return { ok: false, reason, detail };
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberAt(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stringArrayAt(
  record: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string' && item.length > 0)
    ? (value as readonly string[])
    : undefined;
}

/**
 * The schema identity a seam projection carries: it mirrors the projected
 * aggregate's canonical domain vocabulary (the seam adds no competing
 * domain semantics), so the presentation gate admits exactly that schema.
 */
const PROJECTION_DOMAIN_SCHEMA_ID = 'xdownload.domain-contracts' as const;

/** Verify a raw READ_PROJECTION response payload for one addressed aggregate. */
export function verifyProjectionPayload(raw: unknown, aggregateId: string): ProjectionVerification {
  if (!isRecord(raw)) {
    return fail('PROJECTION_MALFORMED', 'projection payload is not an object');
  }
  const schemaIdentity = raw['schemaIdentity'];
  if (!isRecord(schemaIdentity) || schemaIdentity['schema'] !== PROJECTION_DOMAIN_SCHEMA_ID) {
    return fail(
      'PROJECTION_MALFORMED',
      `projection schema is not '${PROJECTION_DOMAIN_SCHEMA_ID}'`,
    );
  }
  if (typeof schemaIdentity['version'] !== 'string') {
    return fail('PROJECTION_MALFORMED', 'projection schema version is missing');
  }
  const contract = raw['contract'];
  if (!isRecord(contract)) {
    return fail('PROJECTION_MALFORMED', 'projection is missing the contract block');
  }
  const contractId = stringAt(contract, 'contractId');
  if (contractId === undefined) {
    return fail('PROJECTION_MALFORMED', 'projection contract identity is missing');
  }
  if (contractId !== aggregateId) {
    return fail(
      'PROJECTION_AGGREGATE_BINDING_MISMATCH',
      `projection binds contract '${contractId}' but the query addressed '${aggregateId}'`,
    );
  }
  if (!CONTRACT_STATUSES.includes(stringAt(contract, 'status') ?? '')) {
    return fail('PROJECTION_MALFORMED', 'projection contract status is not a known literal');
  }
  if (!INTENT_TYPES.includes(stringAt(contract, 'intentType') ?? '')) {
    return fail('PROJECTION_MALFORMED', 'projection intent type is not a known literal');
  }
  const revision = numberAt(contract, 'revision');
  if (revision === undefined || revision < 1) {
    return fail('PROJECTION_MALFORMED', 'projection contract revision must be a positive integer');
  }
  const lineage = raw['lineage'];
  if (!isRecord(lineage)) {
    return fail('PROJECTION_MALFORMED', 'projection is missing the lineage block');
  }
  if (!LINEAGE_STATUSES.includes(stringAt(lineage, 'status') ?? '')) {
    return fail('PROJECTION_MALFORMED', 'projection lineage status is not a known literal');
  }
  if (numberAt(lineage, 'failedMemberCount') === undefined) {
    return fail('PROJECTION_MALFORMED', 'projection lineage failed-member count is missing');
  }
  if (stringArrayAt(lineage, 'retriedMemberIds') === undefined) {
    return fail('PROJECTION_MALFORMED', 'projection lineage retried members are missing');
  }
  const snapshotRaw = raw['snapshot'];
  if (snapshotRaw !== undefined && snapshotRaw !== null) {
    if (!isRecord(snapshotRaw)) {
      return fail('PROJECTION_MALFORMED', 'projection snapshot block is malformed');
    }
    const snapshot = snapshotRaw;
    if (
      stringAt(snapshot, 'snapshotId') === undefined ||
      stringAt(snapshot, 'contractId') !== contractId ||
      stringArrayAt(snapshot, 'selectedMemberIds') === undefined ||
      stringAt(snapshot, 'createdAt') === undefined
    ) {
      return fail('PROJECTION_MALFORMED', 'projection snapshot block is incomplete');
    }
  }
  const terminalRaw = raw['terminal'];
  if (terminalRaw !== undefined && terminalRaw !== null) {
    const terminal = terminalRaw;
    const terminalCheck = verifyTerminalDimensions(terminal);
    if (!terminalCheck.ok) {
      return terminalCheck;
    }
  }
  return { ok: true, view: raw as unknown as SeamProjectionView };
}

/**
 * Verify the six terminal dimensions are present with known literals. The
 * values are consumed verbatim afterwards — this gate exists so an unknown
 * or tampered literal can never reach the display (fail closed).
 */
export function verifyTerminalDimensions(terminal: unknown): TerminalVerification {
  if (!isRecord(terminal)) {
    return fail('PROJECTION_MALFORMED', 'terminal result is not an object');
  }
  const contractId = stringAt(terminal, 'contractId');
  if (contractId === undefined) {
    return fail('PROJECTION_MALFORMED', 'terminal result contract identity is missing');
  }
  if (!FULFILLMENT.includes(terminal['requestFulfillment'] as RequestFulfillmentStatus)) {
    return fail('PROJECTION_MALFORMED', 'requestFulfillment is not a known literal');
  }
  if (!RESOLUTION.includes(terminal['targetResolution'] as TargetResolutionStatus)) {
    return fail('PROJECTION_MALFORMED', 'targetResolution is not a known literal');
  }
  if (!ACQUISITION.includes(terminal['selectionAcquisition'] as SelectionAcquisitionStatus)) {
    return fail('PROJECTION_MALFORMED', 'selectionAcquisition is not a known literal');
  }
  if (!COVERAGE.includes(terminal['coverage'] as CoverageStatus)) {
    return fail('PROJECTION_MALFORMED', 'coverage is not a known literal');
  }
  if (typeof terminal['stopReason'] !== 'string') {
    return fail('PROJECTION_MALFORMED', 'stopReason is missing');
  }
  const summary = terminal['validationSummary'];
  if (!isRecord(summary)) {
    return fail('PROJECTION_MALFORMED', 'validation summary is missing');
  }
  if (!SUMMARY_STATUSES.includes(summary['status'] as ValidationSummaryStatus)) {
    return fail('PROJECTION_MALFORMED', 'validation summary status is not a known literal');
  }
  if (
    numberAt(summary, 'passedCount') === undefined ||
    numberAt(summary, 'failedCount') === undefined
  ) {
    return fail('PROJECTION_MALFORMED', 'validation summary counts are missing');
  }
  return { ok: true };
}

/** Read a verified terminal result's summary (post-verification accessor). */
export function terminalSummary(terminal: Record<string, unknown>): ValidationSummary {
  return terminal['validationSummary'] as ValidationSummary;
}

/** Read a verified terminal result's stop reason (post-verification accessor). */
export function terminalStopReason(terminal: Record<string, unknown>): StopReason {
  return terminal['stopReason'] as StopReason;
}
