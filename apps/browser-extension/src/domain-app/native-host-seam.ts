/**
 * v0.2 T08 — native-host check seam (browser lane, browser-side half only).
 *
 * The frozen Task Pack acceptance "native Host check" and the forbidden
 * negative "no automatic browser privilege expansion" land here as a
 * fail-closed check seam ALIGNED with the existing `@xdownload/core-seam`
 * message contract:
 *
 * - the request half re-uses the core-seam `CommandEnvelope` wire shape
 *   verbatim (`currentSeamSchemaIdentity()`, closed v1 command vocabulary,
 *   `BROWSER_EXTENSION` peer identity, idempotent requestId, aggregate
 *   binding, provenance issuedAt) with the sealed intent as the payload;
 * - the response half re-uses the core-seam `SeamResponse` decoder
 *   (`decodeSeamResponse`, unsupported-major fail-closed) and adds the
 *   binding checks a surface owes before it may treat a host answer as its
 *   own: reply/request correlation, ACCEPTED outcome, and a well-formed
 *   acceptance re-bound to the same request and aggregate;
 * - NO valid host answer (absent/timeout, malformed, unbound, rejected,
 *   unexpected outcome) refuses the submission. Absence of an answer is a
 *   refusal, never an implicit pass (fail-closed).
 *
 * This module implements NO transport: the Native Messaging pipe, host
 * process lifecycle and relay integration belong to the later join lanes
 * (T12/T15). Pure functions only: no chrome.* API, no DOM.
 */

import {
  currentSeamSchemaIdentity,
  decodeSeamResponse,
  makeCommandRequestId,
  makePeerInstallId,
  makePeerUserId,
  type CommandEnvelope,
  type CommandType,
  type PeerIdentity,
  type SeamDiagnostic,
  type SeamResponse,
} from '@xdownload/core-seam';
import { deepFreeze } from '@xdownload/domain-contracts';
import type { ConfirmedDownloadIntent } from '../../../../packages/download-domain-app/src/contracts/index.ts';

/**
 * The one command this surface may put on the check seam: the canonical
 * closed-vocabulary contract submission whose effect the host check guards.
 * Typed as `CommandType` so an out-of-vocabulary drift is a compile error.
 */
export const NATIVE_HOST_CHECK_COMMAND_TYPE: CommandType = 'SUBMIT_CONTRACT';

/** The extension's fixed surface identity on the seam (never chosen per call). */
export const NATIVE_HOST_CHECK_SURFACE = 'BROWSER_EXTENSION' as const;

export interface NativeHostCheckContext {
  /** Same-install peer identity part (application-level, same host). */
  readonly installId: string;
  /** Same-user local identity part (application-level, same host). */
  readonly userId: string;
  /** Idempotent request identity; allocated by the extension id allocator. */
  readonly requestId: string;
  /** ISO-8601 issue-time source; provenance fact only. */
  readonly now?: () => string;
}

export type NativeHostCheckRequestResult =
  | { readonly ok: true; readonly request: Readonly<CommandEnvelope> }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the host-check request: a core-seam `CommandEnvelope` carrying the
 * sealed intent as payload. Identity parts are validated against the seam id
 * rules first — a malformed identity fails closed instead of producing a
 * frame the seam would have to reject later.
 */
export function buildNativeHostCheckRequest(
  intent: Readonly<ConfirmedDownloadIntent>,
  context: NativeHostCheckContext,
): NativeHostCheckRequestResult {
  const requestId = makeCommandRequestId(context.requestId);
  if (!requestId.ok) {
    return { ok: false, reason: `requestId '${context.requestId}' rejected by the seam id rules` };
  }
  const installId = makePeerInstallId(context.installId);
  if (!installId.ok) {
    return { ok: false, reason: `installId '${context.installId}' rejected by the seam id rules` };
  }
  const userId = makePeerUserId(context.userId);
  if (!userId.ok) {
    return { ok: false, reason: `userId '${context.userId}' rejected by the seam id rules` };
  }
  const peer: PeerIdentity = {
    installId: installId.value,
    userId: userId.value,
    surface: NATIVE_HOST_CHECK_SURFACE,
  };
  const request: CommandEnvelope = {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: NATIVE_HOST_CHECK_COMMAND_TYPE,
    peer,
    requestId: requestId.value,
    aggregateId: intent.requestId,
    expectedRevision: 0,
    correlation: {},
    issuedAt: (context.now ?? (() => new Date().toISOString()))(),
    payload: intent,
  };
  return { ok: true, request: deepFreeze(request) };
}

/** Closed refusal vocabulary of the host check (fail-closed by design). */
export type NativeHostCheckRefusalCode =
  | 'HOST_RESPONSE_ABSENT'
  | 'HOST_RESPONSE_MALFORMED'
  | 'HOST_RESPONSE_UNBOUND'
  | 'HOST_CHECK_REJECTED'
  | 'HOST_OUTCOME_UNEXPECTED';

export type NativeHostCheckDecision =
  | { readonly accepted: true; readonly response: SeamResponse }
  | {
      readonly accepted: false;
      readonly reason: NativeHostCheckRefusalCode;
      readonly detail: string;
      readonly diagnostics?: readonly SeamDiagnostic[];
    };

function refuse(
  reason: NativeHostCheckRefusalCode,
  detail: string,
  diagnostics?: readonly SeamDiagnostic[],
): NativeHostCheckDecision {
  return diagnostics === undefined
    ? { accepted: false, reason, detail }
    : { accepted: false, reason, detail, diagnostics };
}

/**
 * Evaluate the native host's answer to one check request. Any of the
 * following refuses the submission (the caller MUST NOT submit):
 *
 * - no answer at all (`HOST_RESPONSE_ABSENT`) — a missing/unavailable host
 *   is a refusal, never an implicit pass;
 * - an answer the seam response decoder refuses, including unsupported seam
 *   major versions (`HOST_RESPONSE_MALFORMED`);
 * - an answer bound to a different request/aggregate
 *   (`HOST_RESPONSE_UNBOUND`);
 * - an explicit host rejection, with the host diagnostics passed through
 *   verbatim (`HOST_CHECK_REJECTED`);
 * - any non-ACCEPTED outcome for a command frame (`HOST_OUTCOME_UNEXPECTED`).
 */
export function evaluateNativeHostCheck(
  request: Readonly<CommandEnvelope>,
  rawResponse: unknown,
): NativeHostCheckDecision {
  if (rawResponse === undefined || rawResponse === null) {
    return refuse(
      'HOST_RESPONSE_ABSENT',
      'no native host answer arrived; the submission is refused (fail-closed)',
    );
  }
  const decoded = decodeSeamResponse(rawResponse);
  if (!decoded.ok) {
    const first = decoded.diagnostics[0];
    return refuse(
      'HOST_RESPONSE_MALFORMED',
      `host answer is not a valid seam response${first === undefined ? '' : `: ${first.message}`}`,
      decoded.diagnostics,
    );
  }
  const response = decoded.value;
  if (response.inReplyTo !== request.requestId) {
    return refuse(
      'HOST_RESPONSE_UNBOUND',
      `host answer replies to '${String(response.inReplyTo)}', not to this request '${request.requestId}'`,
    );
  }
  if (response.outcome === 'REJECTED') {
    return refuse('HOST_CHECK_REJECTED', 'the native host rejected the check', response.diagnostics);
  }
  if (response.outcome !== 'ACCEPTED') {
    return refuse(
      'HOST_OUTCOME_UNEXPECTED',
      `host answered with outcome '${String(response.outcome)}'; a command check accepts only ACCEPTED`,
    );
  }
  const acceptance = response.acceptance;
  if (acceptance === undefined) {
    return refuse(
      'HOST_RESPONSE_MALFORMED',
      'ACCEPTED host answer carries no well-formed acceptance record',
    );
  }
  if (acceptance.requestId !== request.requestId || acceptance.aggregateId !== request.aggregateId) {
    return refuse(
      'HOST_RESPONSE_UNBOUND',
      'ACCEPTED host answer is re-bound to a different request/aggregate',
    );
  }
  return { accepted: true, response };
}
