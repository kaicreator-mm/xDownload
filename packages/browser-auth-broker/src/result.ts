/**
 * T010 local rejection vocabulary for the native-host/broker/auth boundary.
 *
 * Shape mirrors the canonical `ValidationDiagnostic`/`DomainValidationResult`
 * from `@xdownload/domain-contracts` (T002). Canonical codes are reused
 * verbatim where their frozen meaning applies (`UNKNOWN_FIELD`,
 * `MALFORMED_REQUIRED_FIELD`, `MISSING_REQUIRED_FIELD`, `RAW_SECRET_FIELD`,
 * `SCOPE_MUTATION`, `LOCATOR_SUBSTITUTION_REJECTED`); broker-specific
 * rejections use the local codes below.
 */

import type { DiagnosticCode } from '@xdownload/domain-contracts';

/** Broker-boundary-specific failure codes. */
export type BrokerBoundaryCode =
  | 'NATIVE_MESSAGE_OVERSIZED'
  | 'NATIVE_MESSAGE_MALFORMED'
  | 'ALLOWED_ORIGINS_REJECTED'
  | 'CALLER_ORIGIN_MISSING'
  | 'NATIVE_MESSAGING_FALLBACK_FORBIDDEN'
  | 'ISSUE_DECISION_REQUIRED'
  | 'CAPABILITY_UNKNOWN'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'AUTH_BINDING_VIOLATED'
  | 'PARTITION_CONTEXT_STRIPPED'
  | 'SCOPE_BINDING_MISMATCH'
  | 'SECRET_IN_SINK'
  | 'CYCLIC_STRUCTURE';

/** Local codes plus the canonical diagnostic codes reused verbatim. */
export type BrokerDiagnosticCode = BrokerBoundaryCode | DiagnosticCode;

export interface BrokerDiagnostic {
  readonly code: BrokerDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type BrokerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly BrokerDiagnostic[] };

export function brokerOk<T>(value: T): BrokerResult<T> {
  return { ok: true, value };
}

export function brokerFail<T = never>(diagnostics: readonly BrokerDiagnostic[]): BrokerResult<T> {
  return { ok: false, diagnostics };
}

export function brokerDiagnostic(
  code: BrokerDiagnosticCode,
  path: string,
  message: string,
  invariant?: string,
): BrokerDiagnostic {
  return invariant === undefined ? { code, path, message } : { code, path, message, invariant };
}

/** Truthful authorization outcomes at the browser/auth seam (PRD §16.5/§17). */
export type AuthUseOutcome =
  | { readonly outcome: 'AUTH_GRANTED'; readonly ref: string }
  | { readonly outcome: 'AUTH_REQUIRED'; readonly reasons: readonly BrokerDiagnostic[] }
  | { readonly outcome: 'AUTH_FAILED'; readonly reasons: readonly BrokerDiagnostic[] };
