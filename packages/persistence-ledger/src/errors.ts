/**
 * T005 typed persistence failures — fail closed at every authoritative boundary.
 *
 * Recovery, migration and writer rejections carry a stable typed code so
 * callers can classify truthfully instead of string-matching. No failure is
 * ever normalized into success (frozen L2 §11; TEST_MATRIX negative cases).
 */

export type PersistenceErrorCode =
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INCOMPATIBLE_SCHEMA_FAMILY'
  | 'SCHEMA_VERSION_REJECTED'
  | 'MIGRATION_SAFETY_VIOLATION'
  | 'MALFORMED_LEDGER_ROW'
  | 'UNKNOWN_LEDGER_STATE'
  | 'NON_MONOTONIC_FACT_ORDER'
  | 'AUTHORITATIVE_WRITER_VIOLATION'
  | 'DUPLICATE_IDENTITY_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'ACCEPTANCE_INVALID'
  | 'CANCELLATION_CUTOFF_BLOCKED'
  | 'BUDGET_LEDGER_VIOLATION'
  | 'RAW_SECRET_REJECTED'
  | 'PROVENANCE_DIGEST_MISMATCH'
  | 'ARTIFACT_CONFLICT'
  | 'ARTIFACT_STATE_INVALID'
  | 'INCONSISTENT_LEDGER';

export interface PersistenceErrorDetail {
  readonly path?: string;
  readonly invariant?: string;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly detail: PersistenceErrorDetail;

  constructor(
    code: PersistenceErrorCode,
    message: string,
    detail: PersistenceErrorDetail = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PersistenceError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPersistenceError(value: unknown): value is PersistenceError {
  return value instanceof PersistenceError;
}
