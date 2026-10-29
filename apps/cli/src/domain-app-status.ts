/**
 * v0.2 T07 — pure status projector: opaque Domain App query snapshots and
 * send receipts → a small, user-readable status vocabulary.
 *
 * Projection contract (frozen by this adapter, T07):
 * - The user vocabulary is exactly `DOMAIN_APP_STATUS_VOCABULARY`.
 * - A snapshot/receipt is untrusted opaque plain data. Only two documented
 *   public field names are ever read: `status` on a query snapshot and
 *   `kind` on a send receipt (the public facade documents `kind` as the
 *   receipt status). Everything else is ignored, never guessed.
 * - FAITHFUL UNKNOWN: a missing/non-string/unrecognized status word projects
 *   as `UNKNOWN` with the raw word preserved verbatim. UNKNOWN is never
 *   terminal and never success.
 * - Only `SUCCEEDED`/`FAILED`/`CANCELLED` are terminal; `ACCEPTED`/`PENDING`/
 *   `RUNNING` project as non-terminal `RUNNING` (frozen A05 grammar:
 *   accepted/running are not terminal).
 * - A `FAILED` projection carries the bounded typed error pair when the
 *   source carries a decodable `{ code, message }` record; nothing is
 *   invented when it does not.
 *
 * This module exports no kernel types and no store/key grammar: its inputs
 * and outputs are `unknown`/plain-data projections only.
 */

/** The closed user-facing status vocabulary of the v0.2 CLI adapter. */
export const DOMAIN_APP_STATUS_VOCABULARY = [
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;

export type DomainAppUserStatus = (typeof DOMAIN_APP_STATUS_VOCABULARY)[number];

/** Why a source projected as UNKNOWN (bounded, documented, never guessed away). */
export type DomainAppUnknownReason =
  | 'source_not_a_plain_object'
  | 'status_field_missing'
  | 'status_field_not_a_string'
  | 'unrecognized_status_word';

/** Terminal statuses of the user vocabulary (UNKNOWN is deliberately absent). */
const TERMINAL: ReadonlySet<DomainAppUserStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

/**
 * The exact recognized status words. Anything outside this closed table is
 * UNKNOWN with the raw word preserved — a status this adapter does not know
 * must never be promoted to (or demoted from) success.
 */
const RECOGNIZED_STATUS_WORDS: Readonly<Record<string, DomainAppUserStatus>> = {
  ACCEPTED: 'RUNNING',
  PENDING: 'RUNNING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export interface DomainAppStatusProjection {
  readonly status: DomainAppUserStatus;
  /** The raw source word, verbatim, when one was present; `null` otherwise. */
  readonly rawStatus: string | null;
  readonly terminal: boolean;
  /** Bounded typed error pair; present only for FAILED when decodable. */
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly unknownReason: DomainAppUnknownReason | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bounded decode of a typed `{ code, message }` error record; no invention. */
function decodeErrorRecord(value: unknown): { code: string; message: string } | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const { code, message } = value;
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

/**
 * Core reader: project the named status field of one opaque plain-data
 * source into the user vocabulary. See the module contract for the
 * faithfulness rules.
 */
function projectStatusField(source: unknown, field: 'status' | 'kind'): DomainAppStatusProjection {
  if (!isPlainRecord(source)) {
    return {
      status: 'UNKNOWN',
      rawStatus: null,
      terminal: false,
      error: null,
      unknownReason: 'source_not_a_plain_object',
    };
  }
  const raw = source[field];
  if (raw === undefined) {
    return {
      status: 'UNKNOWN',
      rawStatus: null,
      terminal: false,
      error: null,
      unknownReason: 'status_field_missing',
    };
  }
  if (typeof raw !== 'string') {
    return {
      status: 'UNKNOWN',
      rawStatus: null,
      terminal: false,
      error: null,
      unknownReason: 'status_field_not_a_string',
    };
  }
  const mapped = RECOGNIZED_STATUS_WORDS[raw];
  if (mapped === undefined) {
    return {
      status: 'UNKNOWN',
      rawStatus: raw,
      terminal: false,
      error: null,
      unknownReason: 'unrecognized_status_word',
    };
  }
  return {
    status: mapped,
    rawStatus: raw,
    terminal: TERMINAL.has(mapped),
    error: mapped === 'FAILED' ? decodeErrorRecord(source.error) : null,
    unknownReason: null,
  };
}

/**
 * Project one opaque query snapshot. Reads only the documented `status`
 * field (plus the bounded error pair for FAILED).
 */
export function projectSnapshotStatus(snapshot: unknown): DomainAppStatusProjection {
  return projectStatusField(snapshot, 'status');
}

/**
 * Project one opaque send receipt. The public facade documents `kind` as
 * the receipt status field; reads only that field (plus the bounded error
 * pair for FAILED).
 */
export function projectReceiptStatus(receipt: unknown): DomainAppStatusProjection {
  return projectStatusField(receipt, 'kind');
}
