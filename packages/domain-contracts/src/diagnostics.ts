/**
 * T002 canonical domain contracts — typed validation diagnostics.
 *
 * Pure contract/schema layer owned by the Core contract domain (frozen L2
 * ADR-002 / invariant 1). Every authoritative boundary decodes `unknown`
 * input and fails closed; no surface, transport or persistence semantics
 * live here.
 */

export type DiagnosticCode =
  | 'ADMISSION_REJECTED'
  | 'BASELINE_IDENTITY_CHANGED'
  | 'BUDGET_AS_SCOPE'
  | 'CANCELLATION_CUTOFF_VIOLATION'
  | 'CONTRACT_BINDING_MISMATCH'
  | 'COVERAGE_EVIDENCE_INSUFFICIENT'
  | 'CURRENT_VALIDATION_REQUIRED'
  | 'DUPLICATE_ALLOCATION'
  | 'DUPLICATE_IDENTITY'
  | 'EMPTY_SET_NOT_SUCCESS'
  | 'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN'
  | 'INCOMPATIBLE_VERSION_TRANSITION'
  | 'INSUFFICIENT_EVIDENCE'
  | 'INVALID_RESULT_COMBINATION'
  | 'KNOWLEDGE_NOT_REUSABLE'
  | 'LEDGER_MUTATION_REJECTED'
  | 'LOCATOR_SUBSTITUTION_REJECTED'
  | 'MALFORMED_REQUIRED_FIELD'
  | 'MEMBERSHIP_DRIFT'
  | 'MISSING_REQUIRED_FIELD'
  | 'RAW_SECRET_FIELD'
  | 'SCOPE_CONTINUATION_MISMATCH'
  | 'SCOPE_MUTATION'
  | 'SELF_CERTIFICATION'
  | 'CONFIRMATION_CANNOT_WAIVE_VALIDATION'
  | 'VALIDATION_CLAIM_BINDING_MISMATCH'
  | 'SNAPSHOT_MUTATION'
  | 'UNKNOWN_ENUM_VALUE'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_SCHEMA_IDENTITY'
  | 'UNSUPPORTED_SCHEMA_VERSION';

export interface ValidationDiagnostic {
  readonly code: DiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type DomainValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly ValidationDiagnostic[] };

export function ok<T>(value: T): DomainValidationResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  diagnostics: readonly ValidationDiagnostic[],
): DomainValidationResult<T> {
  return { ok: false, diagnostics };
}

export function diagnostic(
  code: DiagnosticCode,
  path: string,
  message: string,
  invariant?: string,
): ValidationDiagnostic {
  return invariant === undefined ? { code, path, message } : { code, path, message, invariant };
}

/** Push a sub-result's diagnostics into `sink` and unwrap its value, if any. */
export function must<T>(
  result: DomainValidationResult<T>,
  sink: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  sink.push(...result.diagnostics);
  return undefined;
}

/** Chain a dependent validation step onto a successful result. */
export function andThen<T, U>(
  result: DomainValidationResult<T>,
  next: (value: T) => DomainValidationResult<U>,
): DomainValidationResult<U> {
  return result.ok ? next(result.value) : result;
}

/** Combine sub-results: all must be `void`-ok, otherwise every diagnostic is returned. */
export function allValid(
  results: readonly DomainValidationResult<void>[],
): DomainValidationResult<void> {
  const diagnostics: ValidationDiagnostic[] = [];
  for (const result of results) {
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
    }
  }
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/** Convenience for call sites that treat rejection as exceptional (tests, thin adapters). */
export class DomainSchemaRejectedError extends Error {
  readonly diagnostics: readonly ValidationDiagnostic[];

  constructor(diagnostics: readonly ValidationDiagnostic[]) {
    super(`canonical domain value rejected (${diagnostics.length} diagnostic(s))`);
    this.name = 'DomainSchemaRejectedError';
    this.diagnostics = diagnostics;
  }
}

export function unwrapOrThrow<T>(result: DomainValidationResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new DomainSchemaRejectedError(result.diagnostics);
}

/** Freeze canonical values structurally so confirmed semantics cannot be mutated in place. */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  const seen = new WeakSet<object>();
  const freeze = (node: unknown): void => {
    if (node === null || (typeof node !== 'object' && typeof node !== 'function')) {
      return;
    }
    const obj = node as Record<string, unknown>;
    if (seen.has(obj)) {
      return;
    }
    seen.add(obj);
    Object.values(obj).forEach(freeze);
    Object.freeze(obj);
  };
  freeze(value);
  return value as Readonly<T>;
}
