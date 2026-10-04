/**
 * T010 local rejection vocabulary for the browser/auth boundary.
 *
 * Shape mirrors the canonical `ValidationDiagnostic`/`DomainValidationResult`
 * from `@xdownload/domain-contracts` (T002). Codes that already exist in the
 * canonical vocabulary are reused verbatim (`UNKNOWN_FIELD`,
 * `MALFORMED_REQUIRED_FIELD`, `MISSING_REQUIRED_FIELD`, `RAW_SECRET_FIELD`,
 * `ADMISSION_REJECTED`, `SCOPE_MUTATION`); browser/broker-specific rejections
 * use the local codes below so the canonical vocabulary is never forked or
 * stretched beyond its frozen meaning.
 */

import type { DiagnosticCode } from '@xdownload/domain-contracts';

/** T010-specific failure codes (browser observation / auth broker seam). */
export type BrowserBoundaryCode =
  | 'OBSERVATION_OVERSIZED'
  | 'OBSERVATION_MALFORMED'
  | 'UNPROVENANCED_OBSERVATION'
  | 'PRIVILEGE_ESCALATION_REJECTED'
  | 'NATIVE_MESSAGE_OVERSIZED'
  | 'NATIVE_MESSAGE_MALFORMED'
  | 'ALLOWED_ORIGINS_REJECTED'
  | 'CALLER_ORIGIN_MISSING'
  | 'NATIVE_MESSAGING_FALLBACK_FORBIDDEN'
  | 'AUTH_BINDING_VIOLATED'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'CAPABILITY_UNKNOWN'
  | 'PARTITION_CONTEXT_STRIPPED'
  | 'SCOPE_BINDING_MISMATCH'
  | 'SECRET_IN_SINK'
  | 'ISSUE_DECISION_REQUIRED';

/** Local codes plus the canonical diagnostic codes reused verbatim. */
export type BrowserDiagnosticCode = BrowserBoundaryCode | DiagnosticCode;

export interface BrowserDiagnostic {
  readonly code: BrowserDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type BrowserResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly BrowserDiagnostic[] };

export function bOk<T>(value: T): BrowserResult<T> {
  return { ok: true, value };
}

export function bFail<T = never>(diagnostics: readonly BrowserDiagnostic[]): BrowserResult<T> {
  return { ok: false, diagnostics };
}

export function bDiagnostic(
  code: BrowserDiagnosticCode,
  path: string,
  message: string,
  invariant?: string,
): BrowserDiagnostic {
  return invariant === undefined ? { code, path, message } : { code, path, message, invariant };
}
