/**
 * v0.2.1 T05 — the explicit Domain App v0.2 route builders (browser lane,
 * browser-side half only).
 *
 * The frozen T05 cutover: the extension's bounded submission switches from
 * the legacy v1 envelope to the EXPLICIT v0.2 seam route (T01/T02 grammar):
 *
 * - the send half re-uses the core-seam `V02CommandEnvelope` wire shape
 *   verbatim (`route: 'v0.2'`, `commandType: 'DOMAIN_APP_SEND'`, sealed
 *   intent as `payload.intent`, `aggregateId` bound to the intent's
 *   `lineageId`, and `requestId` bound to the intent's `requestId` — the
 *   seam refuses a send whose envelope/requestId or aggregate/lineage
 *   binding mismatches). No `expectedRevision` and no `correlation` exist
 *   on the v0.2 envelope grammar;
 * - the read half builds the v0.2 `READ_JOB_PROJECTION` query — the ONLY
 *   status truth for an admitted v0.2 lineage (Core-owned projection;
 *   never surface-derived);
 * - the answer halves are fail-closed: absence of an answer is a refusal,
 *   never an implicit pass, and a v0.2 send answered on the legacy route
 *   (`route` absent or not `'v0.2'`) is a mismatch refusal, never a pass.
 *
 * This module implements NO transport: frames cross the existing trusted
 * Native Messaging boundary (the extension's only broker transport). The
 * packaged host's v0.2 relay lane belongs to the T09 packaging write set;
 * until that carrier is installed the host's typed broker rejection is the
 * truthful, actionable answer this lane renders. Real-browser proof is
 * T13 validation and is NOT exercised here (NOT_RUN in this lane).
 *
 * Pure functions only: no chrome.* API, no DOM.
 */

import {
  currentSeamSchemaIdentity,
  decodeSeamResponse,
  makeCommandRequestId,
  makePeerInstallId,
  makePeerUserId,
  type CommandEnvelope,
  type PeerIdentity,
  type SeamResponse,
  type V02CommandEnvelope,
  type V02JobQueryEnvelope,
} from '@xdownload/core-seam';
import { decodeDownloadJobProjection, deepFreeze } from '@xdownload/domain-contracts';
import type { DownloadJobProjection } from '@xdownload/domain-contracts';
import type { ConfirmedDownloadIntent } from '../../../../packages/download-domain-app/src/contracts/index.ts';

/** The one explicit route id this lane may put on the seam. */
export const V02_ROUTE_ID = 'v0.2' as const;

/** The one command this surface may send on the v0.2 route. */
export const V02_SEND_COMMAND_TYPE = 'DOMAIN_APP_SEND' as const;

/** The one query this surface may send on the v0.2 route. */
export const V02_STATUS_QUERY_TYPE = 'READ_JOB_PROJECTION' as const;

/** The extension's fixed surface identity on the seam (never chosen per call). */
export const V02_SURFACE = 'BROWSER_EXTENSION' as const;

/** Seam/peer identity facts of this install (never chosen per call). */
export interface V02RouteContext {
  /** Same-install peer identity part (application-level, same host). */
  readonly installId: string;
  /** Same-user local identity part (application-level, same host). */
  readonly userId: string;
  /** ISO-8601 issue-time source; provenance fact only. */
  readonly now?: () => string;
}

function buildPeer(
  context: V02RouteContext,
):
  | { readonly ok: true; readonly peer: PeerIdentity }
  | { readonly ok: false; readonly reason: string } {
  const installId = makePeerInstallId(context.installId);
  if (!installId.ok) {
    return { ok: false, reason: `installId '${context.installId}' rejected by the seam id rules` };
  }
  const userId = makePeerUserId(context.userId);
  if (!userId.ok) {
    return { ok: false, reason: `userId '${context.userId}' rejected by the seam id rules` };
  }
  return {
    ok: true,
    peer: { installId: installId.value, userId: userId.value, surface: V02_SURFACE },
  };
}

export type V02SendRequestResult =
  | { readonly ok: true; readonly request: Readonly<V02CommandEnvelope> }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the v0.2 `DOMAIN_APP_SEND` envelope for one sealed confirmed intent.
 * The envelope identity IS the intent identity: `requestId` carries the
 * intent's `requestId` and `aggregateId` the intent's `lineageId` — the
 * exact binding the seam re-checks before any route decision. A malformed
 * identity fails closed instead of producing a frame the seam would have to
 * reject later.
 */
export function buildV02DomainAppSend(
  intent: Readonly<ConfirmedDownloadIntent>,
  context: V02RouteContext,
): V02SendRequestResult {
  const requestId = makeCommandRequestId(intent.requestId);
  if (!requestId.ok) {
    return {
      ok: false,
      reason: `requestId '${intent.requestId}' rejected by the seam id rules`,
    };
  }
  const peer = buildPeer(context);
  if (!peer.ok) {
    return peer;
  }
  const request: V02CommandEnvelope = {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    route: V02_ROUTE_ID,
    commandType: V02_SEND_COMMAND_TYPE,
    peer: peer.peer,
    requestId: requestId.value,
    aggregateId: intent.lineageId,
    issuedAt: (context.now ?? (() => new Date().toISOString()))(),
    payload: { intent },
  };
  return { ok: true, request: deepFreeze(request) };
}

export type V02QueryRequestResult =
  | { readonly ok: true; readonly request: Readonly<V02JobQueryEnvelope> }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the v0.2 `READ_JOB_PROJECTION` query for one lineage. `requestId`
 * is allocated by the extension's id allocator (queries are read-only; the
 * identity correlates the answer, it is never an effect identity).
 */
export function buildV02JobProjectionQuery(
  lineageId: string,
  requestId: string,
  context: V02RouteContext,
): V02QueryRequestResult {
  const boundRequest = makeCommandRequestId(requestId);
  if (!boundRequest.ok) {
    return { ok: false, reason: `requestId '${requestId}' rejected by the seam id rules` };
  }
  const peer = buildPeer(context);
  if (!peer.ok) {
    return peer;
  }
  const request: V02JobQueryEnvelope = {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    route: V02_ROUTE_ID,
    queryType: V02_STATUS_QUERY_TYPE,
    peer: peer.peer,
    requestId: boundRequest.value,
    aggregateId: lineageId,
    issuedAt: (context.now ?? (() => new Date().toISOString()))(),
  };
  return { ok: true, request: deepFreeze(request) };
}

// ------------------------------------------------------------- answer halves

/** The closed refusal vocabulary of the v0.2 answer evaluation. */
export type V02AnswerRefusalCode =
  | 'HOST_RESPONSE_ABSENT'
  | 'HOST_RESPONSE_MALFORMED'
  | 'HOST_RESPONSE_UNBOUND'
  | 'HOST_ROUTE_MISMATCH'
  | 'HOST_CHECK_REJECTED'
  | 'HOST_QUERY_REJECTED'
  | 'HOST_OUTCOME_UNEXPECTED'
  | 'PROJECTION_MALFORMED';

export interface V02AnswerDiagnostic {
  readonly code: string;
  /** The seam diagnostic's field path (wire key `path`). */
  readonly field: string;
  readonly message: string;
}

export type V02SendAnswerDecision =
  | { readonly accepted: true; readonly response: SeamResponse }
  | {
      readonly accepted: false;
      readonly reason: V02AnswerRefusalCode;
      readonly detail: string;
      readonly diagnostics?: readonly V02AnswerDiagnostic[];
    };

function toAnswerDiagnostics(diagnostics: readonly unknown[]): V02AnswerDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const record = (diagnostic ?? {}) as Record<string, unknown>;
    return {
      code: typeof record['code'] === 'string' ? record['code'] : 'UNKNOWN',
      field: typeof record['path'] === 'string' ? record['path'] : '',
      message: typeof record['message'] === 'string' ? record['message'] : '',
    };
  });
}

/** The shared refusal shape of both v0.2 answer evaluators. */
type V02AnswerRefusal = {
  readonly accepted: false;
  readonly reason: V02AnswerRefusalCode;
  readonly detail: string;
  readonly diagnostics?: readonly V02AnswerDiagnostic[];
};

function refuse(
  reason: V02AnswerRefusalCode,
  detail: string,
  diagnostics?: readonly V02AnswerDiagnostic[],
): V02AnswerRefusal {
  return diagnostics === undefined
    ? { accepted: false, reason, detail }
    : { accepted: false, reason, detail, diagnostics };
}

/**
 * Evaluate the trusted Host's answer to one v0.2 send. The shared seam
 * discipline (absent/malformed/unbound/rejected/unexpected all refuse) plus
 * the two send-specific bindings: a send admitted on the explicit v0.2
 * route is answered with `route: 'v0.2'` — an answer without it rode the
 * legacy route and is refused, never treated as admission — and only a
 * well-formed ACCEPTED admission whose acceptance record re-binds to this
 * request and aggregate is accepted.
 */
export function evaluateV02SendAnswer(
  request: Readonly<V02CommandEnvelope | CommandEnvelope>,
  rawResponse: unknown,
): V02SendAnswerDecision {
  const base = evaluateSeamAnswerBase(request, rawResponse);
  if (base.kind === 'REFUSED') {
    return base.refusal;
  }
  if (base.kind === 'REJECTED') {
    return refuse(
      'HOST_CHECK_REJECTED',
      'the Core route rejected the send',
      toAnswerDiagnostics(base.response.diagnostics ?? []),
    );
  }
  const response = base.response;
  if (response.route !== V02_ROUTE_ID) {
    return refuse(
      'HOST_ROUTE_MISMATCH',
      `a v0.2 DOMAIN_APP_SEND was answered with route '${String(response.route)}'; only a v0.2-routed answer can admit this send`,
    );
  }
  if (response.outcome !== 'ACCEPTED') {
    return refuse(
      'HOST_OUTCOME_UNEXPECTED',
      `host answered with outcome '${String(response.outcome)}'; a v0.2 send accepts only ACCEPTED`,
    );
  }
  const acceptance = response.acceptance;
  if (acceptance === undefined) {
    return refuse(
      'HOST_RESPONSE_MALFORMED',
      'ACCEPTED Host answer carries no well-formed acceptance record',
    );
  }
  if (
    acceptance.requestId !== request.requestId ||
    acceptance.aggregateId !== request.aggregateId
  ) {
    return refuse(
      'HOST_RESPONSE_UNBOUND',
      'the ACCEPTED answer is re-bound to a different request/aggregate',
    );
  }
  return { accepted: true, response };
}

export type V02ProjectionAnswerDecision =
  | { readonly accepted: true; readonly projection: DownloadJobProjection }
  | {
      readonly accepted: false;
      readonly reason: V02AnswerRefusalCode;
      readonly detail: string;
      readonly diagnostics?: readonly V02AnswerDiagnostic[];
    };

/**
 * Evaluate the trusted Host's answer to one v0.2 `READ_JOB_PROJECTION`
 * query. Only a bound, well-formed Core-owned job projection is accepted;
 * everything else — including a projection for a different lineage or a
 * rejection with seam diagnostics — refuses with the verbatim reason.
 */
export function evaluateV02ProjectionAnswer(
  request: Readonly<V02JobQueryEnvelope | CommandEnvelope>,
  rawResponse: unknown,
): V02ProjectionAnswerDecision {
  const base = evaluateSeamAnswerBase(request, rawResponse);
  if (base.kind === 'REFUSED') {
    return base.refusal;
  }
  if (base.kind === 'REJECTED') {
    return refuse(
      'HOST_QUERY_REJECTED',
      'the query was rejected by the Core route',
      toAnswerDiagnostics(base.response.diagnostics ?? []),
    );
  }
  const response = base.response;
  if (response.outcome !== 'PROJECTION') {
    return refuse(
      'HOST_OUTCOME_UNEXPECTED',
      `host answered with outcome '${String(response.outcome)}'; a v0.2 job projection query accepts only PROJECTION`,
    );
  }
  const decoded = decodeDownloadJobProjection(response.projection);
  if (!decoded.ok) {
    return refuse(
      'PROJECTION_MALFORMED',
      'the answered job projection is not a well-formed Core projection',
      toAnswerDiagnostics(decoded.diagnostics),
    );
  }
  if (decoded.value.lineageId !== request.aggregateId) {
    return refuse(
      'HOST_RESPONSE_UNBOUND',
      `the answered projection belongs to lineage '${decoded.value.lineageId}', not to the queried '${request.aggregateId}'`,
    );
  }
  return { accepted: true, projection: decoded.value };
}

/**
 * Shared fail-closed seam-answer base: absence, decode and request binding
 * are refused here; an explicit REJECTED outcome surfaces as its own branch
 * (the send and query evaluators name it with their own refusal codes);
 * everything else continues to the evaluator-specific outcome checks.
 */
function evaluateSeamAnswerBase(
  request: Readonly<{ readonly requestId: string; readonly aggregateId: string }>,
  rawResponse: unknown,
):
  | { readonly kind: 'REFUSED'; readonly refusal: V02AnswerRefusal }
  | { readonly kind: 'REJECTED'; readonly response: SeamResponse }
  | { readonly kind: 'CONTINUE'; readonly response: SeamResponse } {
  if (rawResponse === undefined || rawResponse === null) {
    return {
      kind: 'REFUSED',
      refusal: refuse(
        'HOST_RESPONSE_ABSENT',
        'no trusted Host answer arrived; the v0.2 exchange is refused (fail-closed)',
      ),
    };
  }
  const decoded = decodeSeamResponse(rawResponse);
  if (!decoded.ok) {
    const first = decoded.diagnostics[0];
    return {
      kind: 'REFUSED',
      refusal: refuse(
        'HOST_RESPONSE_MALFORMED',
        `the Host answer is not a valid seam response${first === undefined ? '' : `: ${first.message}`}`,
        toAnswerDiagnostics(decoded.diagnostics),
      ),
    };
  }
  const response = decoded.value;
  if (response.inReplyTo !== request.requestId) {
    return {
      kind: 'REFUSED',
      refusal: refuse(
        'HOST_RESPONSE_UNBOUND',
        `the Host answer replies to '${String(response.inReplyTo)}', not to this request '${request.requestId}'`,
      ),
    };
  }
  if (response.outcome === 'REJECTED') {
    return { kind: 'REJECTED', response };
  }
  return { kind: 'CONTINUE', response };
}
