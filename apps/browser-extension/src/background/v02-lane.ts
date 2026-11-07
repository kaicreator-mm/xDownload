/**
 * v0.2.1 T05 — the extension's v0.2 submission lane (service-worker side).
 *
 * The frozen T05 cutover as an explicit ORDERED journey: an inbound
 * extension-internal gesture may reach ONE bounded v0.2 submission and the
 * ONLY transport it may ride is the existing trusted Native Messaging
 * boundary (the extension's single sanctioned broker channel — there is no
 * fallback branch, by design). The order is fixed:
 *
 *   decode (exact-key, fail closed)
 *     → page-origin authority (the privileged tab state re-check)
 *     → identity allocation (extension infrastructure, never page data)
 *     → T01 intent gate (exact no-widening; verbatim diagnostics)
 *     → permission decision (request only when required; denial cancels
 *       BEFORE anything is submitted)
 *     → v0.2 DOMAIN_APP_SEND envelope (requestId/aggregateId bound to the
 *       sealed intent)
 *     → trusted Host answer, fail-closed (absence/disconnect/timeout/
 *       broker rejection/seam rejection all refuse with typed codes)
 *
 * The lane NEVER: derives status locally (READ_JOB_PROJECTION is the only
 * status truth), echoes the confirmed intent back to the popup (outcomes
 * carry typed codes, acceptance identity facts and Core-owned projections
 * only), touches cookies/browser context (the T08 payload whitelist has no
 * field for them), or instantiates any kernel (the K lives in Core only).
 *
 * All browser capability is injected through `V02LanePorts`; the pure
 * ordering is unit-testable in Node without any chrome runtime. The real
 * Chromium + installed Host session is T13 validation and stays NOT_RUN in
 * this lane.
 */

import { isHttpUrl } from './s2-glue.ts';
import type { ValidationDiagnostic } from '@xdownload/domain-contracts';
import type { DownloadJobProjection } from '@xdownload/domain-contracts';
import {
  buildAuthorizationPayload,
  gateConfirmedAuthorization,
  type BrowserAuthorizationAction,
  type ConfirmationIdentity,
} from '../domain-app/index.ts';
import {
  V02_PERMISSION_DENIED,
  V02_SUBMISSION_REQUIRED_ORIGINS,
  decideSubmissionPermission,
  permissionRationale,
} from '../domain-app/index.ts';
import {
  buildV02DomainAppSend,
  buildV02JobProjectionQuery,
  evaluateV02ProjectionAnswer,
  evaluateV02SendAnswer,
  type V02AnswerDiagnostic,
  type V02RouteContext,
} from '../domain-app/index.ts';

// ------------------------------------------------------- inbound message kinds

export const V02_ADD_DOWNLOAD_MESSAGE_KIND = 'V02_ADD_DOWNLOAD' as const;
export const V02_JOB_STATUS_MESSAGE_KIND = 'V02_JOB_STATUS' as const;

/** Cheap routing guards (decode owns the fail-closed strictness). */
export function isV02AddDownloadGesture(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>)['kind'] === V02_ADD_DOWNLOAD_MESSAGE_KIND
  );
}

export function isV02JobStatusQuery(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>)['kind'] === V02_JOB_STATUS_MESSAGE_KIND
  );
}

// ------------------------------------------------------------- decoders

const MAX_URL_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 128;
const MAX_ROOT_LENGTH = 1024;

export interface V02AddDownloadGesture {
  readonly kind: typeof V02_ADD_DOWNLOAD_MESSAGE_KIND;
  readonly tabId: number;
  /** Observed page URL the journey re-verifies against the live tab. */
  readonly pageUrl: string;
  /** The explicit confirmation facts of the user's download decision. */
  readonly action: BrowserAuthorizationAction;
  /**
   * Display-only selected target (what the user clicked). It is NEVER
   * submitted: the confirmed intent carries only the opaque Host-resolvable
   * targetRef, and a raw locator is refused by the gate.
   */
  readonly selectionUrl?: string;
}

export type V02DecodedMessage<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function httpLocator(value: unknown): value is string {
  return boundedString(value, MAX_URL_LENGTH) && isHttpUrl(value);
}

function decodeCaller(value: unknown): BrowserAuthorizationAction['caller'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'actor' && key !== 'sessionRef')) return undefined;
  if (!boundedString(record['actor'], MAX_TOKEN_LENGTH)) return undefined;
  if (!boundedString(record['sessionRef'], 256)) return undefined;
  return { actor: record['actor'], sessionRef: record['sessionRef'] };
}

/**
 * Decode one extension-internal v0.2 submission gesture. The action shape
 * is the CLOSED T08 confirmation-facts interface (exact keys; no field for
 * cookies, tabs, history or any browser context), so page-supplied extra
 * fields can never smuggle browser context toward the intent.
 */
export function decodeV02AddDownloadGesture(
  raw: unknown,
): V02DecodedMessage<V02AddDownloadGesture> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'the v0.2 submission gesture must be a JSON object' };
  }
  const record = raw as Record<string, unknown>;
  const allowed = ['kind', 'tabId', 'pageUrl', 'action', 'selectionUrl'];
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return { ok: false, detail: `unknown gesture field(s): ${unknown.join(', ')}` };
  }
  if (record['kind'] !== V02_ADD_DOWNLOAD_MESSAGE_KIND) {
    return { ok: false, detail: 'gesture kind mismatch' };
  }
  const tabId = record['tabId'];
  if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0) {
    return { ok: false, detail: 'tabId must be a non-negative safe integer' };
  }
  if (!httpLocator(record['pageUrl'])) {
    return { ok: false, detail: 'pageUrl must be an http(s) URL the journey can re-verify' };
  }
  const selectionUrl = record['selectionUrl'];
  if (selectionUrl !== undefined && !httpLocator(selectionUrl)) {
    return { ok: false, detail: 'selectionUrl must be an http(s) URL' };
  }
  const action = record['action'];
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    return { ok: false, detail: 'action must be a plain confirmation-facts object' };
  }
  const actionRecord = action as Record<string, unknown>;
  const actionKeys = [
    'targetRef',
    'outputRootScope',
    'allowedOperation',
    'slice',
    'digestAnchor',
    'declaredBytes',
    'caller',
  ];
  const unknownAction = Object.keys(actionRecord).filter((key) => !actionKeys.includes(key));
  if (unknownAction.length > 0) {
    return { ok: false, detail: `unknown action field(s): ${unknownAction.join(', ')}` };
  }
  if (!boundedString(actionRecord['targetRef'], MAX_TOKEN_LENGTH)) {
    return {
      ok: false,
      detail: 'targetRef must be the opaque Host-issued handle (1..128 chars)',
    };
  }
  if (!boundedString(actionRecord['outputRootScope'], MAX_ROOT_LENGTH)) {
    return { ok: false, detail: 'outputRootScope must be a bounded authorized output root' };
  }
  if (!boundedString(actionRecord['allowedOperation'], MAX_TOKEN_LENGTH)) {
    return { ok: false, detail: 'allowedOperation must be a bounded operation id' };
  }
  if (actionRecord['slice'] !== 'S1' && actionRecord['slice'] !== 'S3') {
    return { ok: false, detail: "slice must be 'S1' or 'S3'" };
  }
  const digestAnchor = actionRecord['digestAnchor'];
  if (digestAnchor !== undefined && !boundedString(digestAnchor, 64)) {
    return { ok: false, detail: 'digestAnchor must be a 64-char lowercase hex digest' };
  }
  const declaredBytes = actionRecord['declaredBytes'];
  if (
    declaredBytes !== undefined &&
    (typeof declaredBytes !== 'number' ||
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes <= 0)
  ) {
    return { ok: false, detail: 'declaredBytes must be a positive safe integer' };
  }
  const caller = decodeCaller(actionRecord['caller']);
  if (caller === undefined) {
    return { ok: false, detail: 'caller must be a bounded {actor, sessionRef} identity' };
  }
  return {
    ok: true,
    value: {
      kind: V02_ADD_DOWNLOAD_MESSAGE_KIND,
      tabId,
      pageUrl: record['pageUrl'] as string,
      action: {
        targetRef: actionRecord['targetRef'] as string,
        outputRootScope: actionRecord['outputRootScope'] as string,
        allowedOperation: actionRecord['allowedOperation'] as string,
        slice: actionRecord['slice'] as 'S1' | 'S3',
        ...(digestAnchor === undefined ? {} : { digestAnchor: digestAnchor as string }),
        ...(declaredBytes === undefined ? {} : { declaredBytes: declaredBytes as number }),
        caller,
      },
      ...(selectionUrl === undefined ? {} : { selectionUrl: selectionUrl as string }),
    },
  };
}

export interface V02JobStatusQuery {
  readonly kind: typeof V02_JOB_STATUS_MESSAGE_KIND;
  readonly lineageId: string;
}

/** Decode one status poll: the lineage identity is the only payload. */
export function decodeV02JobStatusQuery(raw: unknown): V02DecodedMessage<V02JobStatusQuery> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'the v0.2 status query must be a JSON object' };
  }
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== 'kind' && key !== 'lineageId');
  if (unknown.length > 0) {
    return { ok: false, detail: `unknown status field(s): ${unknown.join(', ')}` };
  }
  if (record['kind'] !== V02_JOB_STATUS_MESSAGE_KIND) {
    return { ok: false, detail: 'status query kind mismatch' };
  }
  if (!boundedString(record['lineageId'], MAX_TOKEN_LENGTH)) {
    return { ok: false, detail: 'lineageId must be a bounded lineage identity' };
  }
  return {
    ok: true,
    value: { kind: V02_JOB_STATUS_MESSAGE_KIND, lineageId: record['lineageId'] as string },
  };
}

// ------------------------------------------------------------------ ports

/** One trusted-Host answer class the lane can observe on the NM boundary. */
export type V02FrameAnswer =
  | { readonly kind: 'DISCONNECTED' }
  | { readonly kind: 'TIMEOUT' }
  | { readonly kind: 'BROKER_REJECTION'; readonly reasons: readonly unknown[] }
  | { readonly kind: 'FRAME'; readonly message: unknown };

/**
 * The browser capabilities the lane needs. Every chrome.* round trip lives
 * behind this port surface; tests inject deterministic fakes.
 */
export interface V02LanePorts {
  /** Install-stable seam peer identity (extension infrastructure). */
  ensureRouteContext(): Promise<V02RouteContext>;
  /** Restart-safe confirmed-intent identity allocator. */
  allocateIdentity(): ConfirmationIdentity;
  /** Read-only query correlation identity allocator. */
  allocateRequestId(): string;
  /** The privileged tab URL authority for one tab. */
  getTabUrl(tabId: number): Promise<string | undefined>;
  /** Origins the browser has already granted host access for. */
  grantedOrigins(): Promise<readonly string[]>;
  /** Ask the user for exactly these origins; true only when granted. */
  requestOrigins(origins: readonly string[]): Promise<boolean>;
  /** One NM round trip with the trusted Host (the only transport). */
  sendSeamFrame(frame: unknown): Promise<V02FrameAnswer>;
}

// --------------------------------------------------------------- outcomes

/** Typed lane outcome. It NEVER carries the confirmed intent itself. */
export type V02SubmitOutcome =
  | {
      readonly outcome: 'ADMITTED';
      readonly lineageId: string;
      readonly requestId: string;
      /** The verbatim seam acceptance identity facts (safe identity fields). */
      readonly acceptance: Record<string, unknown>;
    }
  | {
      readonly outcome: 'REFUSED';
      readonly code: string;
      readonly detail: string;
      readonly diagnostics?: readonly V02AnswerDiagnostic[];
    };

export type V02StatusOutcome =
  | { readonly outcome: 'PROJECTION'; readonly projection: DownloadJobProjection }
  | {
      readonly outcome: 'REFUSED';
      readonly code: string;
      readonly detail: string;
      readonly diagnostics?: readonly V02AnswerDiagnostic[];
    };

/** Closed refusal codes of the lane's own (pre-Host) decision stages. */
export const V02_LANE_REFUSALS = {
  MESSAGE_MALFORMED: 'V02_MESSAGE_MALFORMED',
  ORIGIN_UNAVAILABLE: 'V02_ORIGIN_UNAVAILABLE',
  ORIGIN_MISMATCH: 'V02_ORIGIN_MISMATCH',
  PERMISSION_DENIED: V02_PERMISSION_DENIED,
  INTENT_REFUSED: 'V02_INTENT_REFUSED',
  REQUEST_BUILD_REFUSED: 'V02_REQUEST_BUILD_REFUSED',
  HOST_ABSENT: 'V02_HOST_ABSENT',
  HOST_TIMEOUT: 'V02_HOST_TIMEOUT',
  HOST_CARRIER_REJECTED: 'V02_HOST_CARRIER_REJECTED',
  STATUS_UNAVAILABLE: 'V02_STATUS_UNAVAILABLE',
} as const;

function refusal(
  code: string,
  detail: string,
  diagnostics?: readonly V02AnswerDiagnostic[],
): {
  outcome: 'REFUSED';
  code: string;
  detail: string;
  diagnostics?: readonly V02AnswerDiagnostic[];
} {
  return diagnostics === undefined
    ? { outcome: 'REFUSED', code, detail }
    : { outcome: 'REFUSED', code, detail, diagnostics };
}

function gateDiagnostics(diagnostics: readonly ValidationDiagnostic[]): V02AnswerDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    field: diagnostic.path,
    message: diagnostic.message,
  }));
}

function brokerReasons(reasons: readonly unknown[]): string {
  const text = reasons
    .map((reason) => {
      if (typeof reason === 'object' && reason !== null) {
        const message = (reason as Record<string, unknown>)['message'];
        if (typeof message === 'string') return message;
      }
      return typeof reason === 'string' ? reason : '';
    })
    .filter((entry) => entry.length > 0)
    .join('; ')
    .slice(0, 300);
  return text.length > 0 ? text : 'the trusted Host rejected the v0.2 frame (typed reasons only)';
}

// ------------------------------------------------------------- the journey

export interface V02SubmitOptions {
  /**
   * The required browser-origin set of this submission. Defaults to the
   * frozen lane contract (empty — the trusted Host performs the transfer).
   * Only the declarative permission table may widen it.
   */
  readonly permissionRequirements?: readonly string[];
}

/**
 * Run one bounded v0.2 submission for one explicit popup gesture. Never
 * throws; every failure is a typed actionable refusal and a refusal NEVER
 * reaches the transport (the send is the last stage).
 */
export async function runV02Submit(
  rawGesture: unknown,
  ports: V02LanePorts,
  options: V02SubmitOptions = {},
): Promise<V02SubmitOutcome> {
  const decoded = decodeV02AddDownloadGesture(rawGesture);
  if (!decoded.ok) {
    return refusal(V02_LANE_REFUSALS.MESSAGE_MALFORMED, decoded.detail);
  }
  const gesture = decoded.value;

  // 1. Page-origin authority: the privileged tab state, grounded in the
  // gesture's observed page URL (a navigated-away tab voids the selection).
  let tabUrl: string | undefined;
  try {
    tabUrl = await ports.getTabUrl(gesture.tabId);
  } catch {
    tabUrl = undefined;
  }
  if (typeof tabUrl !== 'string' || !isHttpUrl(tabUrl)) {
    return refusal(
      V02_LANE_REFUSALS.ORIGIN_UNAVAILABLE,
      'the tab exposes no trustworthy http(s) origin; the submission was cancelled before anything was sent',
    );
  }
  if (tabUrl !== gesture.pageUrl) {
    return refusal(
      V02_LANE_REFUSALS.ORIGIN_MISMATCH,
      'the page navigated after the selection; the observed selection provenance no longer matches the tab, so the submission was cancelled',
    );
  }

  // 2. Identity allocation (extension infrastructure) and the T01 intent
  // gate. Gate diagnostics pass through VERBATIM — the surface never
  // re-writes, swallows or downgrades a refusal reason.
  const identity = ports.allocateIdentity();
  const gate = gateConfirmedAuthorization(buildAuthorizationPayload(identity, gesture.action));
  if (!gate.authorized) {
    return refusal(
      V02_LANE_REFUSALS.INTENT_REFUSED,
      'the confirmed intent was refused by the canonical no-widening gate; nothing was sent',
      gateDiagnostics(gate.diagnostics),
    );
  }

  // 3. Permission decision: request only when required, never silently.
  const requirements = options.permissionRequirements ?? V02_SUBMISSION_REQUIRED_ORIGINS;
  const decision = decideSubmissionPermission(requirements, await ports.grantedOrigins());
  if (decision.kind === 'REQUEST_NEEDED') {
    const granted = await ports.requestOrigins(decision.origins);
    if (!granted) {
      return refusal(
        V02_LANE_REFUSALS.PERMISSION_DENIED,
        `the browser permission request was denied, so the action was cancelled before anything was sent. ${permissionRationale(requirements)}`,
      );
    }
  }

  // 4. The explicit v0.2 DOMAIN_APP_SEND envelope (identity-bound).
  const routeContext = await ports.ensureRouteContext();
  const request = buildV02DomainAppSend(gate.intent, routeContext);
  if (!request.ok) {
    return refusal(V02_LANE_REFUSALS.REQUEST_BUILD_REFUSED, request.reason);
  }

  // 5. The trusted Host answer — fail closed on every non-acceptance class.
  const answer = await ports.sendSeamFrame(request.request);
  if (answer.kind === 'DISCONNECTED') {
    return refusal(
      V02_LANE_REFUSALS.HOST_ABSENT,
      'the trusted local xDownload Host is not reachable; install/start it and retry. Nothing was submitted',
    );
  }
  if (answer.kind === 'TIMEOUT') {
    return refusal(
      V02_LANE_REFUSALS.HOST_TIMEOUT,
      'the trusted Host did not answer in time; the exchange was refused (fail-closed)',
    );
  }
  if (answer.kind === 'BROKER_REJECTION') {
    return refusal(V02_LANE_REFUSALS.HOST_CARRIER_REJECTED, brokerReasons(answer.reasons));
  }
  const check = evaluateV02SendAnswer(request.request, answer.message);
  if (!check.accepted) {
    return refusal(check.reason, check.detail, check.diagnostics);
  }
  const acceptance = check.response.acceptance;
  return {
    outcome: 'ADMITTED',
    lineageId: gate.intent.lineageId,
    requestId: gate.intent.requestId,
    acceptance: acceptance as unknown as Record<string, unknown>,
  };
}

/**
 * Read the Core-owned v0.2 job projection for one lineage the worker
 * admitted. The projection is rendered verbatim by the caller — the lane
 * never derives or fabricates status/progress.
 */
export async function runV02Status(
  lineageId: string,
  ports: V02LanePorts,
): Promise<V02StatusOutcome> {
  const routeContext = await ports.ensureRouteContext();
  const request = buildV02JobProjectionQuery(lineageId, ports.allocateRequestId(), routeContext);
  if (!request.ok) {
    return refusal(V02_LANE_REFUSALS.STATUS_UNAVAILABLE, request.reason);
  }
  const answer = await ports.sendSeamFrame(request.request);
  if (answer.kind === 'DISCONNECTED') {
    return refusal(
      V02_LANE_REFUSALS.HOST_ABSENT,
      'the trusted local xDownload Host is not reachable; install/start it and retry',
    );
  }
  if (answer.kind === 'TIMEOUT') {
    return refusal(
      V02_LANE_REFUSALS.HOST_TIMEOUT,
      'the trusted Host did not answer in time; the status read was refused (fail-closed)',
    );
  }
  if (answer.kind === 'BROKER_REJECTION') {
    return refusal(V02_LANE_REFUSALS.HOST_CARRIER_REJECTED, brokerReasons(answer.reasons));
  }
  const check = evaluateV02ProjectionAnswer(request.request, answer.message);
  if (!check.accepted) {
    return refusal(check.reason, check.detail, check.diagnostics);
  }
  return { outcome: 'PROJECTION', projection: check.projection };
}
