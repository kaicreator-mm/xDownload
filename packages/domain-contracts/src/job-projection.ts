/**
 * v0.2.1 T01 — canonical user-facing download job/attempt projections.
 *
 * These are immutable read projections, not lifecycle authority. The status
 * vocabulary is a stable presentation projection; transitions and ownership
 * remain Core/Domain App facts. Unknown totals are explicit and never become
 * zero, percentages or ETAs.
 */
import { asRecord, rejectUnknownFields } from './decode.ts';
import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { decodeSchemaIdentity, type SchemaIdentity } from './version.ts';

export const DOWNLOAD_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;

export type DownloadJobStatus = (typeof DOWNLOAD_JOB_STATUSES)[number];

export const DOWNLOAD_ATTEMPT_STATUSES = [
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;

export type DownloadAttemptStatus = (typeof DOWNLOAD_ATTEMPT_STATUSES)[number];

export const DOWNLOAD_LINEAGE_OWNERS = ['old-core', 'new-k'] as const;
export type DownloadLineageOwner = (typeof DOWNLOAD_LINEAGE_OWNERS)[number];

export interface DownloadProgressProjection {
  readonly transferredBytes: number;
  readonly totalBytes:
    { readonly kind: 'KNOWN'; readonly bytes: number } | { readonly kind: 'UNKNOWN' };
}

export interface DownloadErrorProjection {
  readonly code: string;
  readonly message: string;
}

export interface DownloadAttemptProjection {
  readonly attemptId: string;
  /** Monotonic Core sequence for this lineage; not wall-clock time. */
  readonly sequence: number;
  readonly status: DownloadAttemptStatus;
  readonly error?: DownloadErrorProjection;
}

export interface DownloadJobProjection {
  readonly schemaIdentity: SchemaIdentity;
  /** Opaque lineage/job identity; never a URL or filesystem locator. */
  readonly lineageId: string;
  /** Exactly one owner may write this lineage. */
  readonly owner: DownloadLineageOwner;
  readonly status: DownloadJobStatus;
  readonly attempts: readonly DownloadAttemptProjection[];
  readonly currentAttemptId?: string;
  /** Current-attempt byte facts only; absent when no authoritative sample exists. */
  readonly progress?: DownloadProgressProjection;
  /** Current job-level error, e.g. a pre-attempt admission failure. */
  readonly error?: DownloadErrorProjection;
}

export type OldCoreLineageFact = 'REGISTERED' | 'UNREGISTERED' | 'UNKNOWN';
export type NewKLineageFact = 'OWNED' | 'RELEASED' | 'ABSENT' | 'UNKNOWN';

export interface LineageOwnerFacts {
  readonly oldCore: OldCoreLineageFact;
  readonly newK: NewKLineageFact;
}

export type LineageOwnerResolution =
  | { readonly status: 'RESOLVED'; readonly owner: DownloadLineageOwner }
  | {
      readonly status: 'REFUSED';
      readonly reason: 'LINEAGE_OWNER_AMBIGUOUS' | 'LINEAGE_OWNER_CONFLICT';
    };

const JOB_KEYS = [
  'schemaIdentity',
  'lineageId',
  'owner',
  'status',
  'attempts',
  'currentAttemptId',
  'progress',
  'error',
] as const;

const ATTEMPT_KEYS = ['attemptId', 'sequence', 'status', 'error'] as const;
const PROGRESS_KEYS = ['transferredBytes', 'totalBytes'] as const;
const ERROR_KEYS = ['code', 'message'] as const;
const OWNER_FACT_KEYS = ['oldCore', 'newK'] as const;

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
): DomainValidationResult<string> {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'expected a non-empty bounded string'),
    ]);
  }
  return ok(value);
}

function opaqueIdentity(
  value: unknown,
  path: string,
  maxLength = 128,
): DomainValidationResult<string> {
  const bounded = boundedString(value, path, maxLength);
  if (!bounded.ok) return bounded;
  const rawLocator =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(bounded.value) ||
    /^[/\\]/.test(bounded.value) ||
    /^[A-Za-z]:[/\\]/.test(bounded.value);
  if (rawLocator) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        path,
        'projection identity must be opaque; raw URLs and filesystem paths are forbidden',
      ),
    ]);
  }
  return bounded;
}

function safeNonNegativeInteger(
  value: unknown,
  path: string,
  minimum = 0,
): DomainValidationResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'expected a non-negative safe integer'),
    ]);
  }
  return ok(value);
}

function enumValue<K extends string>(
  value: unknown,
  allowed: readonly K[],
  path: string,
): DomainValidationResult<K> {
  if (typeof value !== 'string' || !allowed.includes(value as K)) {
    return fail([
      diagnostic('UNKNOWN_ENUM_VALUE', path, 'value is not in the closed canonical vocabulary'),
    ]);
  }
  return ok(value as K);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function decodeDownloadProgressProjection(
  value: unknown,
  path = 'progress',
): DomainValidationResult<DownloadProgressProjection> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const shape = rejectUnknownFields(parsed.value, PROGRESS_KEYS, path);
  if (!shape.ok) return shape;

  const transferredBytes = safeNonNegativeInteger(
    parsed.value['transferredBytes'],
    path + '.transferredBytes',
  );
  if (!transferredBytes.ok) return transferredBytes;

  const totalParsed = asRecord(parsed.value['totalBytes'], path + '.totalBytes');
  if (!totalParsed.ok) return totalParsed;
  const kind = enumValue(
    totalParsed.value['kind'],
    ['KNOWN', 'UNKNOWN'] as const,
    path + '.totalBytes.kind',
  );
  if (!kind.ok) return kind;

  if (kind.value === 'UNKNOWN') {
    const totalShape = rejectUnknownFields(totalParsed.value, ['kind'], path + '.totalBytes');
    if (!totalShape.ok) return totalShape;
    return ok(
      deepFreeze({
        transferredBytes: transferredBytes.value,
        totalBytes: { kind: 'UNKNOWN' as const },
      }),
    );
  }

  const totalShape = rejectUnknownFields(
    totalParsed.value,
    ['kind', 'bytes'],
    path + '.totalBytes',
  );
  if (!totalShape.ok) return totalShape;
  const bytes = safeNonNegativeInteger(totalParsed.value['bytes'], path + '.totalBytes.bytes');
  if (!bytes.ok) return bytes;
  if (transferredBytes.value > bytes.value) {
    return fail([
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path,
        'transferred bytes cannot exceed a known total; use UNKNOWN when the total is not authoritative',
        'progress.totalBytes >= progress.transferredBytes when totalBytes.kind is KNOWN',
      ),
    ]);
  }

  return ok(
    deepFreeze({
      transferredBytes: transferredBytes.value,
      totalBytes: { kind: 'KNOWN' as const, bytes: bytes.value },
    }),
  );
}

export function decodeDownloadErrorProjection(
  value: unknown,
  path = 'error',
): DomainValidationResult<DownloadErrorProjection> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const shape = rejectUnknownFields(parsed.value, ERROR_KEYS, path);
  if (!shape.ok) return shape;
  const code = boundedString(parsed.value['code'], path + '.code', 64);
  if (!code.ok) return code;
  const message = boundedString(parsed.value['message'], path + '.message', 512);
  if (!message.ok) return message;
  return ok(deepFreeze({ code: code.value, message: message.value }));
}

export function decodeDownloadAttemptProjection(
  value: unknown,
  path = 'attempt',
): DomainValidationResult<DownloadAttemptProjection> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const shape = rejectUnknownFields(parsed.value, ATTEMPT_KEYS, path);
  if (!shape.ok) return shape;

  const attemptId = opaqueIdentity(parsed.value['attemptId'], path + '.attemptId');
  if (!attemptId.ok) return attemptId;
  const sequence = safeNonNegativeInteger(parsed.value['sequence'], path + '.sequence', 1);
  if (!sequence.ok) return sequence;
  const status = enumValue(parsed.value['status'], DOWNLOAD_ATTEMPT_STATUSES, path + '.status');
  if (!status.ok) return status;

  let error: DownloadErrorProjection | undefined;
  if (hasOwn(parsed.value, 'error')) {
    const decodedError = decodeDownloadErrorProjection(parsed.value['error'], path + '.error');
    if (!decodedError.ok) return decodedError;
    error = decodedError.value;
  }

  return ok(
    deepFreeze({
      attemptId: attemptId.value,
      sequence: sequence.value,
      status: status.value,
      ...(error === undefined ? {} : { error }),
    }),
  );
}

export function decodeDownloadJobProjection(
  value: unknown,
  path = 'job',
): DomainValidationResult<DownloadJobProjection> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const shape = rejectUnknownFields(parsed.value, JOB_KEYS, path);
  if (!shape.ok) return shape;

  const schemaIdentity = decodeSchemaIdentity(parsed.value['schemaIdentity']);
  if (!schemaIdentity.ok) return schemaIdentity;
  const lineageId = opaqueIdentity(parsed.value['lineageId'], path + '.lineageId');
  if (!lineageId.ok) return lineageId;
  const owner = enumValue(parsed.value['owner'], DOWNLOAD_LINEAGE_OWNERS, path + '.owner');
  if (!owner.ok) return owner;
  const status = enumValue(parsed.value['status'], DOWNLOAD_JOB_STATUSES, path + '.status');
  if (!status.ok) return status;

  const rawAttempts = parsed.value['attempts'];
  if (!Array.isArray(rawAttempts)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path + '.attempts',
        'expected an array of attempt projections',
      ),
    ]);
  }
  if (rawAttempts.length > 128) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path + '.attempts',
        'attempt history exceeds the bounded projection limit of 128',
      ),
    ]);
  }

  const attempts: DownloadAttemptProjection[] = [];
  const diagnostics: ValidationDiagnostic[] = [];
  for (let index = 0; index < rawAttempts.length; index += 1) {
    const attempt = decodeDownloadAttemptProjection(
      rawAttempts[index],
      path + '.attempts[' + String(index) + ']',
    );
    if (attempt.ok) {
      attempts.push(attempt.value);
    } else {
      diagnostics.push(...attempt.diagnostics);
    }
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  const seenAttemptIds = new Set<string>();
  let previousSequence = 0;
  for (const attempt of attempts) {
    if (seenAttemptIds.has(attempt.attemptId)) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          path + '.attempts',
          'attempt identities must be unique within a job projection',
        ),
      );
    }
    if (attempt.sequence <= previousSequence) {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          path + '.attempts',
          'attempts must be ordered by strictly increasing Core sequence',
        ),
      );
    }
    seenAttemptIds.add(attempt.attemptId);
    previousSequence = attempt.sequence;
  }

  let currentAttemptId: string | undefined;
  if (hasOwn(parsed.value, 'currentAttemptId')) {
    const current = opaqueIdentity(parsed.value['currentAttemptId'], path + '.currentAttemptId');
    if (!current.ok) return current;
    currentAttemptId = current.value;
  }

  const currentAttempt =
    currentAttemptId === undefined
      ? undefined
      : attempts.find((attempt) => attempt.attemptId === currentAttemptId);

  if (currentAttemptId !== undefined && currentAttempt === undefined) {
    diagnostics.push(
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        path + '.currentAttemptId',
        'currentAttemptId must identify an attempt in the same job projection',
      ),
    );
  }
  if (
    currentAttempt !== undefined &&
    attempts.length > 0 &&
    attempts[attempts.length - 1]?.attemptId !== currentAttemptId
  ) {
    diagnostics.push(
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        path + '.currentAttemptId',
        'currentAttemptId must identify the latest attempt in the ordered history',
      ),
    );
  }

  if (status.value === 'QUEUED' && currentAttemptId !== undefined) {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.currentAttemptId',
        'a queued job cannot have a current attempt',
      ),
    );
  }
  if (status.value === 'RUNNING' && currentAttempt?.status !== 'RUNNING') {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.status',
        'a running job requires a current RUNNING attempt',
      ),
    );
  }
  if (status.value === 'SUCCEEDED' && currentAttempt?.status !== 'SUCCEEDED') {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.status',
        'a succeeded job requires a current SUCCEEDED attempt',
      ),
    );
  }
  if (
    status.value === 'FAILED' &&
    currentAttempt !== undefined &&
    currentAttempt.status !== 'FAILED'
  ) {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.status',
        'a failed job current attempt must be FAILED',
      ),
    );
  }
  if (
    status.value === 'CANCELLED' &&
    currentAttempt !== undefined &&
    currentAttempt.status !== 'CANCELLED'
  ) {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.status',
        'a cancelled job current attempt must be CANCELLED',
      ),
    );
  }
  if (
    status.value === 'UNKNOWN' &&
    currentAttempt !== undefined &&
    currentAttempt.status !== 'UNKNOWN'
  ) {
    diagnostics.push(
      diagnostic(
        'INVALID_RESULT_COMBINATION',
        path + '.status',
        'an unknown job current attempt must also be UNKNOWN',
      ),
    );
  }

  let progress: DownloadProgressProjection | undefined;
  if (hasOwn(parsed.value, 'progress')) {
    const decodedProgress = decodeDownloadProgressProjection(
      parsed.value['progress'],
      path + '.progress',
    );
    if (!decodedProgress.ok) return decodedProgress;
    progress = decodedProgress.value;
    if (currentAttemptId === undefined) {
      diagnostics.push(
        diagnostic(
          'INVALID_RESULT_COMBINATION',
          path + '.progress',
          'progress must be bound to a current attempt',
        ),
      );
    }
  }

  let error: DownloadErrorProjection | undefined;
  if (hasOwn(parsed.value, 'error')) {
    const decodedError = decodeDownloadErrorProjection(parsed.value['error'], path + '.error');
    if (!decodedError.ok) return decodedError;
    error = decodedError.value;
    if (status.value === 'QUEUED' || status.value === 'RUNNING' || status.value === 'SUCCEEDED') {
      diagnostics.push(
        diagnostic(
          'INVALID_RESULT_COMBINATION',
          path + '.error',
          'job-level error is only valid for FAILED, CANCELLED or UNKNOWN status',
        ),
      );
    }
  }

  if (diagnostics.length > 0) return fail(diagnostics);

  return ok(
    deepFreeze({
      schemaIdentity: schemaIdentity.value,
      lineageId: lineageId.value,
      owner: owner.value,
      status: status.value,
      attempts,
      ...(currentAttemptId === undefined ? {} : { currentAttemptId }),
      ...(progress === undefined ? {} : { progress }),
      ...(error === undefined ? {} : { error }),
    }),
  );
}

export function isDownloadJobTerminalStatus(status: DownloadJobStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';
}

export function decodeLineageOwnerFacts(
  value: unknown,
  path = 'lineageOwnerFacts',
): DomainValidationResult<LineageOwnerFacts> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const shape = rejectUnknownFields(parsed.value, OWNER_FACT_KEYS, path);
  if (!shape.ok) return shape;
  const oldCore = enumValue(
    parsed.value['oldCore'],
    ['REGISTERED', 'UNREGISTERED', 'UNKNOWN'] as const,
    path + '.oldCore',
  );
  if (!oldCore.ok) return oldCore;
  const newK = enumValue(
    parsed.value['newK'],
    ['OWNED', 'RELEASED', 'ABSENT', 'UNKNOWN'] as const,
    path + '.newK',
  );
  if (!newK.ok) return newK;
  return ok(deepFreeze({ oldCore: oldCore.value, newK: newK.value }));
}

export function decodeLineageOwnerResolution(
  value: unknown,
  path = 'lineageOwnerResolution',
): DomainValidationResult<LineageOwnerResolution> {
  const parsed = asRecord(value, path);
  if (!parsed.ok) return parsed;
  const status = enumValue(
    parsed.value['status'],
    ['RESOLVED', 'REFUSED'] as const,
    path + '.status',
  );
  if (!status.ok) return status;

  if (status.value === 'RESOLVED') {
    const shape = rejectUnknownFields(parsed.value, ['status', 'owner'], path);
    if (!shape.ok) return shape;
    const owner = enumValue(parsed.value['owner'], DOWNLOAD_LINEAGE_OWNERS, path + '.owner');
    if (!owner.ok) return owner;
    return ok(deepFreeze({ status: 'RESOLVED' as const, owner: owner.value }));
  }

  const shape = rejectUnknownFields(parsed.value, ['status', 'reason'], path);
  if (!shape.ok) return shape;
  const reason = enumValue(
    parsed.value['reason'],
    ['LINEAGE_OWNER_AMBIGUOUS', 'LINEAGE_OWNER_CONFLICT'] as const,
    path + '.reason',
  );
  if (!reason.ok) return reason;
  return ok(deepFreeze({ status: 'REFUSED' as const, reason: reason.value }));
}

/**
 * Resolve the single writer from the two authoritative ownership facts.
 * Unknown source facts fail closed. With no explicit new-K owner, the frozen
 * default partition remains old-core; conflicting ownership is never guessed.
 */
export function resolveLineageOwner(
  value: unknown,
): DomainValidationResult<LineageOwnerResolution> {
  const facts = decodeLineageOwnerFacts(value);
  if (!facts.ok) return facts;

  if (facts.value.oldCore === 'UNKNOWN' || facts.value.newK === 'UNKNOWN') {
    return ok(
      deepFreeze({
        status: 'REFUSED' as const,
        reason: 'LINEAGE_OWNER_AMBIGUOUS' as const,
      }),
    );
  }
  if (facts.value.oldCore === 'REGISTERED' && facts.value.newK === 'OWNED') {
    return ok(
      deepFreeze({
        status: 'REFUSED' as const,
        reason: 'LINEAGE_OWNER_CONFLICT' as const,
      }),
    );
  }
  if (facts.value.oldCore === 'REGISTERED') {
    return ok(deepFreeze({ status: 'RESOLVED' as const, owner: 'old-core' as const }));
  }
  if (facts.value.newK === 'OWNED') {
    return ok(deepFreeze({ status: 'RESOLVED' as const, owner: 'new-k' as const }));
  }
  return ok(deepFreeze({ status: 'RESOLVED' as const, owner: 'old-core' as const }));
}
