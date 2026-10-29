/**
 * T006 typed control rejections — fail-closed outcomes at the single
 * Core-owned scheduling/budget/control boundary.
 *
 * Codes align with `.agent/execution/T006/FAILURE_MATRIX.yaml` classifications:
 * every illegal transition or budget mutation rejects deterministically and is
 * never silently coerced into the nearest legal outcome.
 */

import type { StopReason } from '@xdownload/domain-contracts';

/**
 * Control rejection vocabulary.
 *
 * FAILURE_MATRIX classification mapping:
 * - `BUDGET_AUTHORITY_VIOLATION`      ← private-budget-counter
 * - `BUDGET_REPLENISHMENT_REJECTED`   ← budget-replenishment
 * - `SCOPE_MUTATION_REJECTED`         ← budget-as-scope
 * - `CANCELLATION_CUTOFF_VIOLATION`   ← auto-accept-after-cancel
 * - `DISPATCH_SUPPRESSED`             ← dispatch-after-cancel
 * - `LINEAGE_FORK_REJECTED`           ← duplicate-lineage-fork
 * - `SNAPSHOT_DRIFT_REJECTED`         ← retry-membership-drift
 * - `UNAUTHORIZED_TRANSITION_REJECTED`← unauthenticated-resume / reconciliation-alone-reopening
 * - `RESULT_FALSIFICATION_REJECTED`   ← failure-rewritten-to-success / uncertain-to-success
 * - `MALFORMED_CONTROL_FACT`          ← control transition consuming unvalidated or forked
 *                                       canonical identity; malformed durable fact
 * - `UNKNOWN_LINEAGE`                 ← transition against an unregistered lineage
 * - `BUDGET_EXHAUSTED`                ← a gate outcome (not misconduct): carries the
 *                                       budget-truthful `StopReason` (never scope truth)
 * - `STAGED_REUSE_VALIDATION_REQUIRED`← staged-byte reuse requested without the ordinary
 *                                       validation evidence required by L2 retry/resume
 */
export type ControlRejectionCode =
  | 'BUDGET_AUTHORITY_VIOLATION'
  | 'BUDGET_EXHAUSTED'
  | 'BUDGET_REPLENISHMENT_REJECTED'
  | 'SCOPE_MUTATION_REJECTED'
  | 'CANCELLATION_CUTOFF_VIOLATION'
  | 'DISPATCH_SUPPRESSED'
  | 'LINEAGE_FORK_REJECTED'
  | 'SNAPSHOT_DRIFT_REJECTED'
  | 'UNAUTHORIZED_TRANSITION_REJECTED'
  | 'RESULT_FALSIFICATION_REJECTED'
  | 'STAGED_REUSE_VALIDATION_REQUIRED'
  | 'MALFORMED_CONTROL_FACT'
  | 'UNKNOWN_LINEAGE';

export interface ControlRejection {
  readonly code: ControlRejectionCode;
  readonly message: string;
  readonly detail?: string;
  /** Budget-truthful stop reason carried by `BUDGET_EXHAUSTED` rejections (PRD §16.5). */
  readonly stopReason?: StopReason;
}

/** Fail-closed control outcome: a typed value or a typed rejection — never a silent no-op. */
export type ControlResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly rejection: ControlRejection };

export function controlOk<T>(value: T): ControlResult<T> {
  return { ok: true, value };
}

export function controlReject<T = never>(
  code: ControlRejectionCode,
  message: string,
  detail?: string,
  stopReason?: StopReason,
): ControlResult<T> {
  const rejection: ControlRejection =
    stopReason === undefined
      ? detail === undefined
        ? { code, message }
        : { code, message, detail }
      : detail === undefined
        ? { code, message, stopReason }
        : { code, message, detail, stopReason };
  return { ok: false, rejection };
}

/** Unwrap a control result or fail the calling test with its rejection. */
export function controlUnwrap<T>(result: ControlResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(
    `control rejection ${result.rejection.code}: ${result.rejection.message}` +
      (result.rejection.detail === undefined ? '' : ` (${result.rejection.detail})`),
  );
}
