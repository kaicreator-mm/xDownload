/**
 * T012 proposal diagnostics — typed rejection vocabulary for the bounded AI
 * proposal adapter (frozen L2 ADR-008: AI is proposal-only and cannot grant
 * authority).
 *
 * Proposal-level rejections reuse the exact `ValidationDiagnostic` shape of
 * `@xdownload/domain-contracts` so every boundary produces one rejection
 * shape, and extend (never replace) the diagnostic code vocabulary with
 * proposal-specific codes for concerns that only the T012 boundary owns:
 * size bounds, proposal schema versioning, provenance binding, capability
 * admission and secret-material containment.
 *
 * Every rejection names the violated policy/oracle through `invariant`
 * (e.g. `C06`, `C21`, `C34`, `ADR-008`, `PRD-§29`), per the frozen T012
 * Task Pack: rejections are deterministic and never normalize an invalid
 * proposal into a legal one.
 */

import type { DiagnosticCode, ValidationDiagnostic } from '@xdownload/domain-contracts';

/** Codes that only the T012 proposal boundary emits; domain decoders never emit these. */
export type ProposalOnlyDiagnosticCode =
  | 'PROPOSAL_INPUT_TOO_LARGE'
  | 'PROPOSAL_TOO_LARGE'
  | 'PROVENANCE_BINDING_REJECTED'
  | 'CAPABILITY_NOT_AUTHORIZED'
  | 'SECRET_MATERIAL_DETECTED'
  | 'DETERMINISTIC_FALLBACK_REQUIRED';

/** Every diagnostic code observable at the proposal boundary: domain codes plus proposal-only codes. */
export type ProposalDiagnosticCode = DiagnosticCode | ProposalOnlyDiagnosticCode;

/** Same structure as the domain `ValidationDiagnostic`; a wider code union. */
export interface ProposalDiagnostic {
  readonly code: ProposalDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type ProposalValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly ProposalDiagnostic[] };

export function proposalOk<T>(value: T): ProposalValidationResult<T> {
  return { ok: true, value };
}

export function proposalFail<T = never>(
  diagnostics: readonly ProposalDiagnostic[],
): ProposalValidationResult<T> {
  return { ok: false, diagnostics };
}

export function proposalDiagnostic(
  code: ProposalDiagnosticCode,
  path: string,
  message: string,
  invariant?: string,
): ProposalDiagnostic {
  return invariant === undefined ? { code, path, message } : { code, path, message, invariant };
}

/**
 * Domain diagnostics are directly valid proposal diagnostics (domain codes
 * are a subset of `ProposalDiagnosticCode`); this keeps payload rejections
 * from the unmodified Recipe decoder verbatim.
 */
export function domainDiagnosticsToProposal(
  diagnostics: readonly ValidationDiagnostic[],
): readonly ProposalDiagnostic[] {
  return diagnostics;
}
