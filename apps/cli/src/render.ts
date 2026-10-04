/**
 * T013 CLI presentation layer — pure renderers from Core-owned seam facts
 * to machine-readable JSON documents (PRD §27) and the documented exit-code
 * table. Render, never derive: every status value is read from a
 * `READ_PROJECTION` view; a field the v1 projection does not carry renders
 * as `null` (absent), never as an invented value (EXECUTION_CONTRACT
 * "fail closed"; TEST_MATRIX "missing-projection-fields-render-absent").
 */

import type { SeamDiagnostic, SeamProjectionView } from '@xdownload/core-seam';
import type { TerminalResult } from '@xdownload/domain-contracts';

/** CLI presentation schema of the JSON documents (CLI-local, not a wire contract). */
export const CLI_OUTPUT_SCHEMA = '1' as const;

/** PRD §11/§18.5 verified-empty wording — never "downloaded successfully". */
export const NO_MATCH_VERIFIED = 'No matching resources in the requested scope (verified)';

/** PRD §27: submit acceptance is not final task success. */
export const ACCEPTANCE_NOTE = 'submit acceptance is not final acquisition success';

/** Documented exit codes (F2 numbers; PRD §27 freezes the semantics). */
export const EXIT = {
  /** Submit accepted without pending user action; status/cancel/retry/confirm OK; wait: final success. */
  SUCCESS: 0,
  /** Typed local input error before any envelope (usage, malformed payload). */
  USAGE: 1,
  /** Seam typed rejection (REJECTED); diagnostics projected verbatim. */
  REJECTED: 2,
  /** Bounded machine-readable NEEDS_USER_ACTION state (non-interactive confirmation). */
  NEEDS_USER_ACTION: 3,
  /** Wait-mode final result that does not represent a completed acquisition. */
  TERMINAL_NON_SUCCESS: 4,
  /** Transport/connection failure (includes schema-incompatible responses dropped by the client). */
  TRANSPORT: 5,
  /** Bounded wait elapsed without a projected terminal result; nothing was invented. */
  WAIT_TIMEOUT: 6,
} as const;

export interface Presentation {
  readonly summary: string | null;
  readonly no_match_verified: boolean;
}

export interface StatusDocument {
  readonly document: 'xdownload.cli.status';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly contract_id: string;
  readonly contract_revision: number;
  readonly intent_type: string;
  readonly lineage_status: string;
  readonly projection_schema: { readonly schema: string; readonly version: string };
  /** v1 READ_PROJECTION does not carry scope; rendered absent, never invented. */
  readonly requested_scope: null;
  readonly continuation_scope: null;
  readonly snapshot_id: string | null;
  readonly requested_count_if_known: null;
  readonly auth_accessible_count_if_known: null;
  readonly resolved_count: null;
  readonly selected_count: number | null;
  readonly validated_success_count: number | null;
  readonly RequestFulfillmentStatus: string | null;
  readonly TargetResolutionStatus: string | null;
  readonly SelectionAcquisitionStatus: string | null;
  readonly CoverageStatus: string | null;
  readonly StopReason: string | null;
  readonly needs_user_action: boolean | null;
  readonly failed_member_count: number;
  readonly retried_member_ids: readonly string[];
  readonly presentation: Presentation;
  readonly diagnostics: null;
}

export interface AcceptanceDocument {
  readonly document: 'xdownload.cli.acceptance';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly command: string;
  readonly outcome: 'ACCEPTED';
  readonly contract_id: string;
  readonly request_id: string;
  readonly revision: number;
  readonly converged: boolean;
  readonly current_revision: number;
  readonly needs_user_action: boolean;
  readonly required_action: 'CONFIRM_SNAPSHOT' | null;
  readonly note: typeof ACCEPTANCE_NOTE;
}

export interface RejectionDocument {
  readonly document: 'xdownload.cli.rejection';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly command: string;
  readonly outcome: 'REJECTED';
  readonly request_id: string;
  readonly contract_id: string | null;
  readonly current_revision: number | null;
  readonly diagnostics: readonly SeamDiagnostic[];
}

export interface ErrorDocument {
  readonly document: 'xdownload.cli.error';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly error: 'USAGE' | 'PAYLOAD_TOO_LARGE' | 'TRANSPORT';
  readonly message: string;
  readonly usage: string | null;
  readonly diagnostics: readonly CliDiagnosticLike[] | null;
}

export interface CliDiagnosticLike {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export interface NeedsUserActionDocument {
  readonly document: 'xdownload.cli.needs-user-action';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly state: 'NEEDS_USER_ACTION';
  readonly reason: 'CONFIRMATION_REQUIRED';
  readonly contract_id: string;
  readonly request_id: string;
  readonly required_action: 'CONFIRM_SNAPSHOT';
  readonly note: typeof ACCEPTANCE_NOTE;
  readonly guidance: string;
}

export interface WaitTimeoutDocument {
  readonly document: 'xdownload.cli.wait-timeout';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly state: 'BOUNDED_WAIT_TIMEOUT';
  readonly contract_id: string;
  readonly timeout_ms: number;
  readonly poll_ms: number;
  readonly note: string;
}

export interface BatchItem {
  readonly index: number;
  readonly contract_id: string | null;
  readonly outcome: 'ACCEPTED' | 'REJECTED' | 'INPUT_ERROR';
  readonly request_id: string | null;
  readonly revision: number | null;
  readonly converged: boolean | null;
  readonly needs_user_action: boolean | null;
  readonly diagnostics: readonly SeamDiagnostic[] | null;
  readonly input_error: { readonly kind: string; readonly message: string } | null;
}

export interface BatchDocument {
  readonly document: 'xdownload.cli.batch-result';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly accepted_count: number;
  readonly rejected_count: number;
  readonly input_error_count: number;
  readonly needs_user_action_count: number;
  readonly items: readonly BatchItem[];
}

/**
 * `needs_user_action` rendered purely from the projected StopReason: the two
 * projected authorization stop reasons mean the user must act (C10/C24);
 * before terminal truth is projected the field renders absent (`null`).
 */
export function needsUserActionFromTerminal(terminal: TerminalResult | undefined): boolean | null {
  if (terminal === undefined) {
    return null;
  }
  return terminal.stopReason === 'AUTH_REQUIRED' || terminal.stopReason === 'AUTH_FAILED';
}

/** PRD §11/§18.5 rule: verified-empty renders as no-match, never download success. */
export function renderPresentation(terminal: TerminalResult | undefined): Presentation {
  const noMatchVerified =
    terminal !== undefined &&
    terminal.targetResolution === 'EMPTY_CONFIRMED' &&
    terminal.coverage === 'VERIFIED_COMPLETE';
  return {
    summary: noMatchVerified ? NO_MATCH_VERIFIED : null,
    no_match_verified: noMatchVerified,
  };
}

/** Wait-mode final exit reflects the final request/selection result (PRD §27). */
export function terminalExitCode(terminal: TerminalResult): 0 | 4 {
  return terminal.requestFulfillment === 'COMPLETE' && terminal.selectionAcquisition === 'COMPLETE'
    ? 0
    : 4;
}

/**
 * Render the PRD §27 status document from one Core-owned projection view.
 * Values are projected verbatim; `selected_count` is the cardinality of the
 * projected selected-identity list; `validated_success_count` is the
 * projected validation summary's passed count. All other §27 counts and both
 * scope fields are not carried by the v1 projection and render as `null`.
 */
export function renderStatusDocument(view: SeamProjectionView): StatusDocument {
  const terminal = view.terminal;
  return {
    document: 'xdownload.cli.status',
    schema: CLI_OUTPUT_SCHEMA,
    contract_id: view.contract.contractId,
    contract_revision: view.contract.revision,
    intent_type: view.contract.intentType,
    lineage_status: view.lineage.status,
    projection_schema: { ...view.schemaIdentity },
    requested_scope: null,
    continuation_scope: null,
    snapshot_id: view.snapshot?.snapshotId ?? null,
    requested_count_if_known: null,
    auth_accessible_count_if_known: null,
    resolved_count: null,
    selected_count: view.snapshot === undefined ? null : view.snapshot.selectedMemberIds.length,
    validated_success_count: terminal === undefined ? null : terminal.validationSummary.passedCount,
    RequestFulfillmentStatus: terminal === undefined ? null : terminal.requestFulfillment,
    TargetResolutionStatus: terminal === undefined ? null : terminal.targetResolution,
    SelectionAcquisitionStatus: terminal === undefined ? null : terminal.selectionAcquisition,
    CoverageStatus: terminal === undefined ? null : terminal.coverage,
    StopReason: terminal === undefined ? null : terminal.stopReason,
    needs_user_action: needsUserActionFromTerminal(terminal),
    failed_member_count: view.lineage.failedMemberCount,
    retried_member_ids: [...view.lineage.retriedMemberIds],
    presentation: renderPresentation(terminal),
    diagnostics: null,
  };
}

export function renderAcceptanceDocument(input: {
  command: string;
  contractId: string;
  requestId: string;
  revision: number;
  converged: boolean;
  currentRevision: number;
  needsUserAction: boolean;
}): AcceptanceDocument {
  return {
    document: 'xdownload.cli.acceptance',
    schema: CLI_OUTPUT_SCHEMA,
    command: input.command,
    outcome: 'ACCEPTED',
    contract_id: input.contractId,
    request_id: input.requestId,
    revision: input.revision,
    converged: input.converged,
    current_revision: input.currentRevision,
    needs_user_action: input.needsUserAction,
    required_action: input.needsUserAction ? 'CONFIRM_SNAPSHOT' : null,
    note: ACCEPTANCE_NOTE,
  };
}

export function renderRejectionDocument(input: {
  command: string;
  requestId: string;
  contractId: string | null;
  currentRevision: number | null;
  diagnostics: readonly SeamDiagnostic[];
}): RejectionDocument {
  return {
    document: 'xdownload.cli.rejection',
    schema: CLI_OUTPUT_SCHEMA,
    command: input.command,
    outcome: 'REJECTED',
    request_id: input.requestId,
    contract_id: input.contractId,
    current_revision: input.currentRevision,
    diagnostics: [...input.diagnostics],
  };
}

export function renderErrorDocument(input: {
  error: ErrorDocument['error'];
  message: string;
  usage?: boolean;
  diagnostics?: readonly CliDiagnosticLike[];
}): ErrorDocument {
  return {
    document: 'xdownload.cli.error',
    schema: CLI_OUTPUT_SCHEMA,
    error: input.error,
    message: input.message,
    usage: input.usage === true ? 'run: xdownload help' : null,
    diagnostics: input.diagnostics === undefined ? null : [...input.diagnostics],
  };
}

export function renderNeedsUserActionDocument(input: {
  contractId: string;
  requestId: string;
}): NeedsUserActionDocument {
  return {
    document: 'xdownload.cli.needs-user-action',
    schema: CLI_OUTPUT_SCHEMA,
    state: 'NEEDS_USER_ACTION',
    reason: 'CONFIRMATION_REQUIRED',
    contract_id: input.contractId,
    request_id: input.requestId,
    required_action: 'CONFIRM_SNAPSHOT',
    note: ACCEPTANCE_NOTE,
    guidance:
      'selection confirmation is required before acquisition proceeds; issue CONFIRM_SNAPSHOT via: xdownload confirm --contract <id> --expected-revision <n> --file <snapshot.json>',
  };
}

export function renderWaitTimeoutDocument(input: {
  contractId: string;
  timeoutMs: number;
  pollMs: number;
}): WaitTimeoutDocument {
  return {
    document: 'xdownload.cli.wait-timeout',
    schema: CLI_OUTPUT_SCHEMA,
    state: 'BOUNDED_WAIT_TIMEOUT',
    contract_id: input.contractId,
    timeout_ms: input.timeoutMs,
    poll_ms: input.pollMs,
    note: 'bounded wait elapsed without a projected terminal result; no status was invented',
  };
}

export function renderBatchDocument(items: readonly BatchItem[]): BatchDocument {
  let accepted = 0;
  let rejected = 0;
  let inputErrors = 0;
  let needsAction = 0;
  for (const item of items) {
    if (item.outcome === 'ACCEPTED') {
      accepted += 1;
      if (item.needs_user_action === true) {
        needsAction += 1;
      }
    } else if (item.outcome === 'REJECTED') {
      rejected += 1;
    } else {
      inputErrors += 1;
    }
  }
  return {
    document: 'xdownload.cli.batch-result',
    schema: CLI_OUTPUT_SCHEMA,
    accepted_count: accepted,
    rejected_count: rejected,
    input_error_count: inputErrors,
    needs_user_action_count: needsAction,
    items: [...items],
  };
}

/** Deterministic serialization of one document (stable key order by construction). */
export function toJson(document: unknown): string {
  return JSON.stringify(document);
}
