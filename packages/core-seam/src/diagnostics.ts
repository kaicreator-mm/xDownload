/**
 * T004 seam diagnostics — typed rejection vocabulary for the command/query
 * authority boundary.
 *
 * Seam-level rejections reuse the exact `ValidationDiagnostic` shape of
 * `@xdownload/domain-contracts` so surfaces receive one rejection shape, and
 * extend (never replace) the diagnostic code vocabulary with seam-specific
 * codes for peer authorization, wire bounds, idempotency and lifecycle facts
 * that are T004-layer concepts (IMPLEMENTATION_MAP "Identity separation").
 * Payload-decode failures surface the original domain diagnostics verbatim.
 */

import type { DiagnosticCode, ValidationDiagnostic } from '@xdownload/domain-contracts';

/** Codes that only the seam boundary emits; domain decoders never emit these. */
export type SeamOnlyDiagnosticCode =
  | 'PEER_IDENTITY_REJECTED'
  | 'PEER_UNAUTHORIZED'
  | 'TRANSPORT_UNAUTHORIZED'
  | 'ENVELOPE_MALFORMED'
  | 'UNSUPPORTED_ENVELOPE_VERSION'
  | 'UNKNOWN_COMMAND_TYPE'
  | 'UNKNOWN_QUERY_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'ENVELOPE_TOO_DEEP'
  | 'TOO_MANY_FIELDS'
  | 'STRING_TOO_LONG'
  | 'ARRAY_TOO_LONG'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REVISION_MISMATCH'
  | 'AGGREGATE_NOT_FOUND'
  | 'DUPLICATE_ALLOCATION'
  | 'LATE_COMMAND'
  | 'CORRELATION_BINDING_REJECTED'
  | 'RETRY_AUTHORITY_DOMAIN_REJECTED'
  | 'QUERY_REJECTED';

/** Every diagnostic code observable at the seam: domain codes plus seam-only codes. */
export type SeamDiagnosticCode = DiagnosticCode | SeamOnlyDiagnosticCode;

/** Same structure as the domain `ValidationDiagnostic`; a wider code union. */
export interface SeamDiagnostic {
  readonly code: SeamDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type SeamResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly SeamDiagnostic[] };

export function seamOk<T>(value: T): SeamResult<T> {
  return { ok: true, value };
}

export function seamFail<T = never>(diagnostics: readonly SeamDiagnostic[]): SeamResult<T> {
  return { ok: false, diagnostics };
}

export function seamDiagnostic(
  code: SeamDiagnosticCode,
  path: string,
  message: string,
  invariant?: string,
): SeamDiagnostic {
  return invariant === undefined ? { code, path, message } : { code, path, message, invariant };
}

/**
 * Domain diagnostics are directly valid seam diagnostics (domain codes are a
 * subset of `SeamDiagnosticCode`); this keeps payload rejections verbatim.
 */
export function domainDiagnosticsToSeam(
  diagnostics: readonly ValidationDiagnostic[],
): readonly SeamDiagnostic[] {
  return diagnostics;
}

/** Collect a domain result's diagnostics into a seam failure, verbatim. */
export function seamFromDomainFailure<T>(result: {
  readonly ok: false;
  readonly diagnostics: readonly ValidationDiagnostic[];
}): SeamResult<T> {
  return seamFail(domainDiagnosticsToSeam(result.diagnostics));
}

/** Chain a dependent seam validation step onto a successful result. */
export function seamAndThen<T, U>(
  result: SeamResult<T>,
  next: (value: T) => SeamResult<U>,
): SeamResult<U> {
  return result.ok ? next(result.value) : result;
}
