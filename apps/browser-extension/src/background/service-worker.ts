/**
 * T010/#95 privileged extension service worker (browser capability zone,
 * frozen L2 §6.4) — the SHIPPED production entrypoint of the installed S2
 * journey (PRD §28 S2, §29; issue #95).
 *
 * Trust-boundary rules enforced in this glue:
 * - content-script input is untrusted: it passes the schema/size gate and
 *   can only become a provenance-bound observation record; it can NEVER
 *   invoke broker/auth actions (the gate rejects any attempt);
 * - the S2 journey starts ONLY from an explicit in-extension user decision
 *   (the action popup's Download click) carried over the extension-internal
 *   message boundary (`sender.id === chrome.runtime.id`);
 * - the page origin authority is the privileged context's own `chrome.tabs`
 *   state, never a page-supplied value; a mismatch fails closed;
 * - the attachment bytes are acquired by THIS browser zone under the page's
 *   own authorized context (`credentials: 'include'`, activeTab host
 *   access): raw cookies/passwords/tokens NEVER leave the browser zone
 *   (recorded T010 F1 choice; PRD §29);
 * - the ONLY broker transport is Native Messaging via `connectNative`; there
 *   is no fallback IPC branch in this file by design;
 * - the extension lane contributes evidence, decision and delivered bytes
 *   only: terminal truth is the verbatim Core projection relayed by the
 *   native host, never derived here.
 *
 * This glue contains no business logic; all authorization semantics live in
 * @xdownload/browser-auth-broker, all gating in
 * @xdownload/browser-observation, and the composed acquisition in
 * @xdownload/browser-collection-workflow (native-host side).
 */

import {
  buildObservationHandoff,
  decodeUntrustedContentMessage,
  redactForSink,
  recordObservation,
} from '@xdownload/browser-observation';
import {
  createNativeMessagingChannel,
  openBrokerChannel,
  type NativeMessagingChannel,
} from '@xdownload/browser-auth-broker';
import {
  createS2SlabEncoder,
  decodeInternalS2Message,
  isHttpUrl,
  MAX_S2_ATTACHMENT_BYTES,
  type S2Selection,
} from './s2-glue.ts';
import { decodeS5PageGroupGesture, isS5PageGroupGesture } from './s5-group-intent.ts';
import { decodeS5BatchMessage, isS5BatchMessageKind } from './s5-batch.ts';
import { decodeS6CollectionGesture, isS6CollectionGesture } from './s6-collection-intent.ts';
import { decodeS6BatchMessage, isS6BatchMessageKind } from './s6-collection-batch.ts';

/**
 * Module-scoped ambient surface for the browser fetch used by the byte lane
 * (declared here, NOT globally, so Node-side code keeps its own fetch type).
 */
declare const fetch: (
  input: string,
  init?: {
    readonly credentials?: 'include' | 'omit' | 'same-origin';
    readonly redirect?: 'follow' | 'error' | 'manual';
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
  /** F04: the streamed body — the attachment is never buffered whole. */
  readonly body: {
    getReader(): {
      read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
}>;

const NATIVE_HOST_NAME = 'com.xdownload.broker';
// Exact extension origin of this build; replaced at integration packaging.
// This mirrors the platform `allowed_origins` list — never a wildcard.
const BROKER_ALLOWED_ORIGINS: readonly string[] = [
  'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
];

let observationCounter = 0;

declare const crypto: { getRandomValues(array: Uint32Array): void };

/**
 * Durable-identity-safe journey id. A bare SW-lifetime counter resets to zero
 * on every MV3 service-worker restart and would re-issue a journaled seam
 * idempotency identity (`s2-execute-s2-journey-…`) from an earlier journey
 * with a different payload — the seam correctly rejects that as a
 * conflicting duplicate, refusing a legitimate new journey (surfaced by the
 * R1 browser E2E: SW restart between two journeys on the same tab). The
 * time+random components make every journey identity unique across restarts.
 */
function newJourneyId(tabId: number): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return `s2-t${tabId}-${Date.now().toString(36)}-${random[0]!.toString(36)}`;
}

// ---------------------------------------------------------------- journeys

interface S2JourneyState {
  readonly observationId: string;
  readonly linkUrl: string;
  readonly startedAtMs: number;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  terminal?: unknown;
  failure?: { readonly stage: string; readonly detail: string };
}

/** SW-lifetime journey registry (durable truth stays in Core). */
const journeys = new Map<string, S2JourneyState>();

function notify(title: string, message: string): void {
  void chrome.notifications
    .create(`s2-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title,
      message,
    })
    .catch(() => undefined);
}

type NativePort = ReturnType<typeof chrome.runtime.connectNative>;

/**
 * Run the installed S2 journey for one explicit user selection:
 * observation → credentialed streamed byte fetch (browser zone) → bounded
 * chunked Native Messaging delivery → verbatim Core terminal projection.
 *
 * R1 repairs:
 * - F01: no declared digest is required; the selection's observed provenance
 *   (page URL + anchor, re-verified against the live tab) is the target
 *   anchor, and a declared digest only strengthens it;
 * - F03: a cross-origin selected member (CDN) is admissible — it was
 *   positively observed on the page and the user granted the scoped host
 *   permission at selection time; the declared delivery scope stays bounded
 *   to the page host and the selected link host (never widened blindly);
 * - F04: the attachment is streamed (never buffered whole) and crosses NM
 *   as bounded chunk frames; the declared v0.1.0 bound is enforced BEFORE
 *   unconsumed buffering (Content-Length pre-check, then while streaming).
 */
async function runS2Journey(selection: S2Selection, observationId: string): Promise<void> {
  const state: S2JourneyState = {
    observationId,
    linkUrl: selection.linkUrl,
    status: 'RUNNING',
    startedAtMs: Date.now(),
  };
  journeys.set(observationId, state);
  const fail = (stage: string, detail: string): void => {
    state.status = 'FAILED';
    state.failure = { stage, detail };
    notify('xDownload S2 — failed', `${stage}: ${detail}`);
  };
  let port: NativePort | undefined;

  try {
    // 1. The page origin authority: the privileged context's own tab state,
    // grounded in the selection's observed page URL (a navigated-away tab
    // voids the selection provenance and fails closed).
    const tab = await chrome.tabs.get(selection.tabId);
    const tabUrl = tab.url;
    if (typeof tabUrl !== 'string' || !isHttpUrl(tabUrl)) {
      fail('ORIGIN_AUTHORITY', 'the active tab exposes no trustworthy http(s) origin');
      return;
    }
    if (tabUrl !== selection.pageUrl) {
      fail(
        'ORIGIN_AUTHORITY',
        'the page navigated after the selection; the observed selection provenance no longer matches the tab',
      );
      return;
    }
    const pageOrigin = new URL(tabUrl).origin;
    // F03: the declared delivery scope is exactly the observed page host plus
    // the observed selected-link host (a provenance-bound CDN member). Core
    // rejects any final URL outside this bounded declared set (C29).
    const declaredHosts = Array.from(
      new Set([new URL(pageOrigin).host, new URL(selection.linkUrl).host]),
    );

    // 2. Gated observation → provenance-bound record → redacted handoff.
    const observationRaw = {
      boundary: 'CONTENT_SCRIPT',
      kind: 'NETWORK_OBSERVATION',
      provenance: {
        tabId: selection.tabId,
        frameId: 0,
        origin: pageOrigin,
        requestRef: `s2-select:${observationId}`,
      },
      payload: { requestUrl: selection.linkUrl, requestMethod: 'GET' },
    };
    const gated = decodeUntrustedContentMessage(observationRaw);
    if (!gated.ok) {
      fail('OBSERVATION_GATE', gated.diagnostics[0]?.message ?? 'observation rejected');
      return;
    }
    const recorded = recordObservation(gated.value, {
      observationId,
      capturedAtMs: Date.now(),
    });
    if (!recorded.ok) {
      fail('OBSERVATION_RECORD', recorded.diagnostics[0]?.message ?? 'observation rejected');
      return;
    }
    const handoff = buildObservationHandoff(recorded.value);
    if (!handoff.ok) {
      fail('OBSERVATION_HANDOFF', handoff.diagnostics[0]?.message ?? 'handoff rejected');
      return;
    }
    // Exit-sink redaction (defense in depth) — the redacted envelope is the
    // only observation material that crosses toward the broker.
    const redactedHandoff = redactForSink(handoff.value);

    // 3. Credentialed byte acquisition in the browser zone (activeTab plus,
    //    for a cross-origin selection, the user-granted scoped host
    //    permission). The body streams; the declared bound is enforced before
    //    unconsumed buffering.
    let response;
    try {
      response = await fetch(selection.linkUrl, {
        credentials: 'include',
        redirect: 'follow',
      });
    } catch (error) {
      fail(
        'ATTACHMENT_FETCH',
        `the authorized fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (response.status !== 200) {
      fail(
        'ATTACHMENT_FETCH',
        `HTTP ${String(response.status)} — the authorized context did not return the attachment`,
      );
      return;
    }
    const contentLengthHeader = response.headers.get('content-length');
    const parsedLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    const declaredLength =
      Number.isInteger(parsedLength) && parsedLength >= 0 ? parsedLength : undefined;
    if (declaredLength !== undefined && declaredLength > MAX_S2_ATTACHMENT_BYTES) {
      fail(
        'ATTACHMENT_BOUND',
        `the server declares ${String(declaredLength)} bytes, exceeding the declared v0.1.0 S2 bound of ${String(MAX_S2_ATTACHMENT_BYTES)} — the body was never read`,
      );
      return;
    }
    if (declaredLength === 0) {
      fail('ATTACHMENT_FETCH', 'the attachment response declared zero bytes');
      return;
    }
    if (response.body === null) {
      fail('ATTACHMENT_FETCH', 'the attachment response exposes no readable body stream');
      return;
    }

    // 4. Native Messaging chunked delivery → the native host's privileged
    //    lane. Metadata first, then bounded byte slabs as the body streams,
    //    then the completion frame; the lane runs after the host verifies
    //    the assembled stream.
    const requestId = `s2-journey-${observationId}`;
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    const openPort = port;
    let settled = false;
    const finish = new Promise<void>((resolve) => {
      openPort.onDisconnect.addListener(() => {
        if (settled) {
          return;
        }
        settled = true;
        fail('NATIVE_HOST', 'the native host disconnected without a terminal result');
        resolve();
      });
      openPort.onMessage.addListener((message: unknown) => {
        if (settled || typeof message !== 'object' || message === null) {
          return;
        }
        const record = message as Record<string, unknown>;
        // Chunk acknowledgements carry the journey requestId but are not
        // terminal; keep waiting for the lane's verdict.
        if (record['kind'] === 'S2_ACQUIRE_ACCEPTED' || record['kind'] === 'S2_CHUNK_ACK') {
          return;
        }
        if (record['kind'] === 'TRANSPORT_REJECTED') {
          settled = true;
          const reasons = Array.isArray(record['reasons'])
            ? (record['reasons'] as readonly { readonly message?: string }[])
                .map((reason) => reason.message ?? '')
                .join('; ')
                .slice(0, 300)
            : '';
          fail('NATIVE_HOST', reasons || 'the native host rejected the S2 frames');
          resolve();
          return;
        }
        if (record['requestId'] !== requestId) {
          return;
        }
        settled = true;
        if (record['kind'] === 'S2_RESULT') {
          // Terminal truth: the verbatim Core projection, never derived here.
          state.status = 'COMPLETE';
          state.terminal = record['terminal'];
          const terminal = record['terminal'] as { readonly requestFulfillment?: string } | null;
          const fulfillment = terminal?.requestFulfillment ?? 'UNKNOWN';
          const complete = fulfillment === 'COMPLETE';
          if (complete) {
            notify('xDownload S2 — complete', 'The attachment was accepted by Core.');
          } else {
            state.status = 'FAILED';
            state.failure = {
              stage: 'CORE_TERMINAL',
              detail: `terminal requestFulfillment: ${fulfillment}`,
            };
            notify('xDownload S2 — truthful failure', `Core terminal: ${fulfillment}`);
          }
        } else if (record['kind'] === 'S2_REJECTED') {
          const stage = typeof record['stage'] === 'string' ? record['stage'] : 'UNKNOWN';
          const reasons = Array.isArray(record['reasons'])
            ? (record['reasons'] as readonly { readonly message?: string }[])
                .map((reason) => reason.message ?? '')
                .join('; ')
                .slice(0, 300)
            : '';
          fail(stage, reasons || 'the S2 journey was rejected (typed reasons in the log)');
        } else if (record['kind'] === 'REJECTED') {
          const reasons = Array.isArray(record['reasons'])
            ? (record['reasons'] as readonly { readonly message?: string }[])
                .map((reason) => reason.message ?? '')
                .join('; ')
                .slice(0, 300)
            : '';
          fail('NATIVE_HOST', reasons || 'the native host rejected the S2 command');
        }
        resolve();
      });
    });
    openPort.postMessage({
      kind: 'S2_ACQUIRE',
      requestId,
      s2: {
        handoff: redactedHandoff,
        decisionToken: `user-confirm:${observationId}`,
        ttlMs: 60_000,
        delivery: {
          locatorUri: selection.linkUrl,
          originLocatorUri: selection.linkUrl,
          provenanceBinding: 'SELECTED_RESOURCE_PROVENANCE',
          declaredRedirectHosts: declaredHosts,
          ...(selection.expectedSha256 === undefined
            ? {}
            : { expectedSha256: selection.expectedSha256 }),
          ...(selection.contentTypePrefix === undefined
            ? {}
            : { expectedContentTypePrefix: selection.contentTypePrefix }),
        },
        browserResponse: {
          finalUrl: response.url,
          ...(response.headers.get('content-type') === null
            ? {}
            : { contentType: response.headers.get('content-type') ?? undefined }),
          ...(declaredLength === undefined ? {} : { contentLength: declaredLength }),
          status: response.status,
        },
        ...(declaredLength === undefined ? {} : { byteCount: declaredLength }),
      },
    });
    const reader = response.body.getReader();
    const encoder = createS2SlabEncoder();
    let sequence = 0;
    const sendSlab = (slab: string): void => {
      openPort.postMessage({
        kind: 'S2_ACQUIRE_CHUNK',
        requestId,
        seq: sequence,
        data: slab,
      });
      sequence += 1;
    };
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      const value = read.value;
      if (value === undefined || value.length === 0) {
        continue;
      }
      if (encoder.totalBytes + value.length > MAX_S2_ATTACHMENT_BYTES) {
        void reader.cancel();
        fail(
          'ATTACHMENT_BOUND',
          `the attachment body crossed the declared v0.1.0 S2 bound of ${String(MAX_S2_ATTACHMENT_BYTES)} bytes — streaming stopped before the excess was buffered`,
        );
        return;
      }
      for (const slab of encoder.push(value)) {
        sendSlab(slab);
      }
    }
    if (encoder.totalBytes === 0) {
      fail('ATTACHMENT_FETCH', 'the attachment response carried zero bytes');
      return;
    }
    const finalSlab = encoder.flush();
    if (finalSlab !== undefined) {
      sendSlab(finalSlab);
    }
    openPort.postMessage({ kind: 'S2_ACQUIRE_END', requestId });
    await finish;
  } catch (error) {
    fail('JOURNEY', error instanceof Error ? error.message : 'unexpected journey failure');
  } finally {
    // The host process exits with the port; an incomplete chunked assembly
    // never outlives the journey.
    port?.disconnect();
  }
}

// ------------------------------------------------------------- S5 journeys

/**
 * SW-lifetime S5 batch journey registry (durable truth stays in Core; the
 * popup polls this for phase/terminal rendering, and a fresh worker answers
 * UNKNOWN truthfully — the Core projection remains reachable through a new
 * S5_GROUP_STATUS round trip).
 */
interface S5JourneyState {
  readonly contractId: string;
  status: 'PREPARE' | 'CONFIRM' | 'EXECUTE' | 'TERMINAL' | 'FAILED';
  phase?: string;
  facts?: unknown;
  failure?: { readonly stage: string; readonly detail: string };
}

const s5Journeys = new Map<string, S5JourneyState>();

/**
 * One Native Messaging round trip for one S5 lane command. The CONFIRM
 * BEGIN+COMMIT pair rides a single lane command (one host process, one
 * seam connection), so the connection-bound Core challenge discipline is
 * preserved even though each popup gesture opens a fresh port.
 */
function s5NmRoundTrip(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    const finish = (value: Record<string, unknown>): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        port.disconnect();
      } catch {
        // The host may already be gone with the port.
      }
      resolve(value);
    };
    port.onDisconnect.addListener(() => {
      finish({
        kind: 'S5_REJECTED',
        stage: 'NATIVE_HOST',
        reasons: [{ message: 'the native host disconnected without a result' }],
      });
    });
    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      finish(message as Record<string, unknown>);
    });
    port.postMessage(payload);
  });
}

/** Bound SW-lifetime registry: the newest journeys stay answerable. */
function rememberS5Journey(journey: S5JourneyState): void {
  s5Journeys.set(journey.contractId, journey);
  while (s5Journeys.size > 64) {
    const oldest = s5Journeys.keys().next();
    if (oldest.done === true) {
      break;
    }
    s5Journeys.delete(oldest.value);
  }
}

function s5NmResponse(
  response: Record<string, unknown>,
): { ok: true; phase: string; facts: Record<string, unknown> } | { ok: false; error: string } {
  if (response['kind'] === 'S5_RESULT') {
    // The lane frames carry the journey identity at the top level; merge it
    // into the facts so every consumer sees one verbatim Core-fact bundle.
    return {
      ok: true,
      phase: typeof response['phase'] === 'string' ? response['phase'] : 'UNKNOWN',
      facts: {
        ...((response['facts'] as Record<string, unknown> | undefined) ?? {}),
        ...(typeof response['contractId'] === 'string'
          ? { contractId: response['contractId'] }
          : {}),
      },
    };
  }
  const stage = typeof response['stage'] === 'string' ? response['stage'] : 'UNKNOWN';
  const reasons = Array.isArray(response['reasons'])
    ? (response['reasons'] as readonly { readonly message?: string }[])
        .map((reason) => reason.message ?? '')
        .join('; ')
        .slice(0, 300)
    : '';
  if (response['kind'] === 'REJECTED' && stage === 'NATIVE_HOST') {
    return { ok: false, error: 'S5_CORE_CARRIER_NOT_INSTALLED' };
  }
  return { ok: false, error: reasons || `S5 lane rejection at ${stage}` };
}

/** The #152 shipped batch flow: prepare → (user subset choice) → confirm → execute. */
async function runS5Prepare(gesture: {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly members: readonly { readonly href: string; readonly text: string }[];
}): Promise<
  { ok: true; contractId: string; facts: Record<string, unknown> } | { ok: false; error: string }
> {
  const response = s5NmResponse(
    await s5NmRoundTrip({
      kind: 'S5_GROUP_PREPARE',
      requestId: `s5prep-${Date.now().toString(36)}`,
      s5: {
        tabId: gesture.tabId,
        pageUrl: gesture.pageUrl,
        members: gesture.members.map((member) => ({ href: member.href, text: member.text })),
      },
    }),
  );
  if (!response.ok) {
    return response;
  }
  const contractId =
    typeof response.facts['contractId'] === 'string'
      ? (response.facts['contractId'] as string)
      : '';
  if (contractId === '') {
    return { ok: false, error: 'S5 lane returned no contract identity' };
  }
  rememberS5Journey({
    contractId,
    status: 'PREPARE',
    phase: response.phase,
    facts: response.facts,
  });
  return { ok: true, contractId, facts: response.facts };
}

async function runS5Confirm(message: {
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
}): Promise<void> {
  const journey: S5JourneyState = s5Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'CONFIRM',
  };
  journey.status = 'CONFIRM';
  rememberS5Journey(journey);
  const response = s5NmResponse(
    await s5NmRoundTrip({
      kind: 'S5_GROUP_CONFIRM',
      requestId: `s5conf-${Date.now().toString(36)}`,
      s5: {
        contractId: message.contractId,
        prepareId: message.prepareId,
        snapshotId: message.snapshotId,
        selectedMemberIds: [...message.selectedMemberIds],
        decisionToken: `user-confirm:${message.contractId}`,
      },
    }),
  );
  if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    notify(
      'xDownload S5 — group confirmed',
      `${String(response.facts['selectedMemberIds'] ?? []).length} members frozen by Core`,
    );
  } else {
    journey.status = 'FAILED';
    journey.failure = { stage: 'CONFIRM', detail: response.error };
    notify('xDownload S5 — confirmation refused', response.error);
  }
}

async function runS5Execute(message: {
  readonly contractId: string;
  readonly confirmedGroupId: string;
  readonly snapshotId: string;
}): Promise<void> {
  const journey: S5JourneyState = s5Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'EXECUTE',
  };
  journey.status = 'EXECUTE';
  rememberS5Journey(journey);
  const response = s5NmResponse(
    await s5NmRoundTrip({
      kind: 'S5_GROUP_EXECUTE',
      requestId: `s5exec-${Date.now().toString(36)}`,
      s5: {
        contractId: message.contractId,
        confirmedGroupId: message.confirmedGroupId,
        snapshotId: message.snapshotId,
      },
    }),
  );
  if (response.ok && (response.phase === 'TERMINAL' || response.phase === 'RUNNING')) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    if (response.phase === 'TERMINAL') {
      const terminal = response.facts['terminal'] as Record<string, unknown> | null;
      const fulfillment = terminal?.['requestFulfillment'] ?? 'UNKNOWN';
      journey.status = 'TERMINAL';
      notify(
        fulfillment === 'COMPLETE'
          ? 'xDownload S5 — batch complete'
          : 'xDownload S5 — batch terminal (truthful)',
        `Core terminal requestFulfillment: ${String(fulfillment)}`,
      );
    }
  } else if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
  } else {
    journey.status = 'FAILED';
    journey.failure = { stage: 'EXECUTE', detail: response.error };
    notify('xDownload S5 — execution refused', response.error);
  }
}

async function s5RefreshStatus(contractId: string): Promise<void> {
  const response = s5NmResponse(
    await s5NmRoundTrip({
      kind: 'S5_GROUP_STATUS',
      requestId: `s5stat-${Date.now().toString(36)}`,
      s5: { contractId },
    }),
  );
  const journey: S5JourneyState = s5Journeys.get(contractId) ?? { contractId, status: 'EXECUTE' };
  rememberS5Journey(journey);
  if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    if (response.facts['terminal'] !== null && response.facts['terminal'] !== undefined) {
      journey.status = 'TERMINAL';
    }
  }
}

// ------------------------------------------------------------- S6 journeys

/**
 * SW-lifetime S6 collection journey registry (durable truth stays in Core;
 * the popup polls this for phase/coverage rendering, and a fresh worker
 * answers UNKNOWN truthfully — the Core projection remains reachable through
 * a new S6_GROUP_STATUS round trip).
 */
interface S6JourneyState {
  readonly contractId: string;
  status: 'PREPARE' | 'WALK' | 'CONFIRM' | 'EXECUTE' | 'TERMINAL' | 'FAILED';
  phase?: string;
  facts?: unknown;
  failure?: { readonly stage: string; readonly detail: string };
}

const s6Journeys = new Map<string, S6JourneyState>();

function rememberS6Journey(journey: S6JourneyState): void {
  s6Journeys.set(journey.contractId, journey);
  while (s6Journeys.size > 64) {
    const oldest = s6Journeys.keys().next();
    if (oldest.done === true) {
      break;
    }
    s6Journeys.delete(oldest.value);
  }
}

/** Verbatim S6 lane frame → one typed fact bundle (the S5 discipline). */
function s6NmResponse(
  response: Record<string, unknown>,
): { ok: true; phase: string; facts: Record<string, unknown> } | { ok: false; error: string } {
  if (response['kind'] === 'S6_RESULT') {
    return {
      ok: true,
      phase: typeof response['phase'] === 'string' ? response['phase'] : 'UNKNOWN',
      facts: {
        ...((response['facts'] as Record<string, unknown> | undefined) ?? {}),
        ...(typeof response['contractId'] === 'string'
          ? { contractId: response['contractId'] }
          : {}),
      },
    };
  }
  const stage = typeof response['stage'] === 'string' ? response['stage'] : 'UNKNOWN';
  const reasons = Array.isArray(response['reasons'])
    ? (response['reasons'] as readonly { readonly message?: string }[])
        .map((reason) => reason.message ?? '')
        .join('; ')
        .slice(0, 300)
    : '';
  if (response['kind'] === 'REJECTED' && stage === 'NATIVE_HOST') {
    return { ok: false, error: 'S6_CORE_CARRIER_NOT_INSTALLED' };
  }
  return { ok: false, error: reasons || `S6 lane rejection at ${stage}` };
}

/** The #154 shipped collection flow: prepare → (bounded page walk) → confirm → execute. */
async function runS6Prepare(gesture: {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly collectionIdentity: string;
  readonly collectionKind: 'playlist' | 'gallery';
  readonly fromPage: number;
  readonly toPage: number;
}): Promise<
  { ok: true; contractId: string; facts: Record<string, unknown> } | { ok: false; error: string }
> {
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_GROUP_PREPARE',
      requestId: `s6prep-${Date.now().toString(36)}`,
      s6: {
        tabId: gesture.tabId,
        pageUrl: gesture.pageUrl,
        collectionIdentity: gesture.collectionIdentity,
        collectionKind: gesture.collectionKind,
        fromPage: gesture.fromPage,
        toPage: gesture.toPage,
      },
    }),
  );
  if (!response.ok) {
    return response;
  }
  const contractId =
    typeof response.facts['contractId'] === 'string'
      ? (response.facts['contractId'] as string)
      : '';
  if (contractId === '') {
    return { ok: false, error: 'S6 lane returned no contract identity' };
  }
  rememberS6Journey({
    contractId,
    status: 'PREPARE',
    phase: response.phase,
    facts: response.facts,
  });
  return { ok: true, contractId, facts: response.facts };
}

async function runS6PageAdmit(message: {
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly pageNumber: number;
}): Promise<{ ok: true; facts: Record<string, unknown> } | { ok: false; error: string }> {
  const journey: S6JourneyState = s6Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'WALK',
  };
  journey.status = 'WALK';
  rememberS6Journey(journey);
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_PAGE_ADMIT',
      requestId: `s6admit-${Date.now().toString(36)}`,
      s6: {
        contractId: message.contractId,
        prepareId: message.prepareId,
        snapshotId: message.snapshotId,
        pageNumber: message.pageNumber,
      },
    }),
  );
  if (!response.ok) {
    journey.status = 'FAILED';
    journey.failure = { stage: 'PAGE_ADMIT', detail: response.error };
    return response;
  }
  journey.phase = response.phase;
  journey.facts = response.facts;
  return { ok: true, facts: response.facts };
}

async function runS6PageRecord(message: {
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly pageNumber: number;
  readonly members: readonly { readonly href: string; readonly text: string }[];
}): Promise<{ ok: true; facts: Record<string, unknown> } | { ok: false; error: string }> {
  const journey: S6JourneyState = s6Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'WALK',
  };
  journey.status = 'WALK';
  rememberS6Journey(journey);
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_PAGE_RECORD',
      requestId: `s6rec-${Date.now().toString(36)}`,
      s6: {
        contractId: message.contractId,
        prepareId: message.prepareId,
        snapshotId: message.snapshotId,
        pageNumber: message.pageNumber,
        members: message.members.map((member) => ({ href: member.href, text: member.text })),
      },
    }),
  );
  if (!response.ok) {
    journey.status = 'FAILED';
    journey.failure = { stage: 'PAGE_RECORD', detail: response.error };
    return response;
  }
  journey.phase = response.phase;
  journey.facts = response.facts;
  return { ok: true, facts: response.facts };
}

async function runS6Confirm(message: {
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
}): Promise<void> {
  const journey: S6JourneyState = s6Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'CONFIRM',
  };
  journey.status = 'CONFIRM';
  rememberS6Journey(journey);
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_GROUP_CONFIRM',
      requestId: `s6conf-${Date.now().toString(36)}`,
      s6: {
        contractId: message.contractId,
        prepareId: message.prepareId,
        snapshotId: message.snapshotId,
        selectedMemberIds: [...message.selectedMemberIds],
        decisionToken: `user-confirm:${message.contractId}`,
      },
    }),
  );
  if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    notify(
      'xDownload S6 — collection confirmed',
      `${String(response.facts['selectedMemberIds'] ?? []).length} members frozen by Core`,
    );
  } else {
    journey.status = 'FAILED';
    journey.failure = { stage: 'CONFIRM', detail: response.error };
    notify('xDownload S6 — confirmation refused', response.error);
  }
}

async function runS6Execute(message: {
  readonly contractId: string;
  readonly confirmedGroupId: string;
  readonly snapshotId: string;
}): Promise<void> {
  const journey: S6JourneyState = s6Journeys.get(message.contractId) ?? {
    contractId: message.contractId,
    status: 'EXECUTE',
  };
  journey.status = 'EXECUTE';
  rememberS6Journey(journey);
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_GROUP_EXECUTE',
      requestId: `s6exec-${Date.now().toString(36)}`,
      s6: {
        contractId: message.contractId,
        confirmedGroupId: message.confirmedGroupId,
        snapshotId: message.snapshotId,
      },
    }),
  );
  if (response.ok && (response.phase === 'TERMINAL' || response.phase === 'RUNNING')) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    if (response.phase === 'TERMINAL') {
      const terminal = response.facts['terminal'] as Record<string, unknown> | null;
      const fulfillment = terminal?.['requestFulfillment'] ?? 'UNKNOWN';
      journey.status = 'TERMINAL';
      notify(
        fulfillment === 'COMPLETE'
          ? 'xDownload S6 — collection complete'
          : 'xDownload S6 — collection terminal (truthful)',
        `Core terminal requestFulfillment: ${String(fulfillment)}`,
      );
    }
  } else if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
  } else {
    journey.status = 'FAILED';
    journey.failure = { stage: 'EXECUTE', detail: response.error };
    notify('xDownload S6 — execution refused', response.error);
  }
}

async function s6RefreshStatus(contractId: string): Promise<void> {
  const response = s6NmResponse(
    await s5NmRoundTrip({
      kind: 'S6_GROUP_STATUS',
      requestId: `s6stat-${Date.now().toString(36)}`,
      s6: { contractId },
    }),
  );
  const journey: S6JourneyState = s6Journeys.get(contractId) ?? { contractId, status: 'EXECUTE' };
  rememberS6Journey(journey);
  if (response.ok) {
    journey.phase = response.phase;
    journey.facts = response.facts;
    if (response.facts['terminal'] !== null && response.facts['terminal'] !== undefined) {
      journey.status = 'TERMINAL';
    }
  }
}

// ------------------------------------------------------------- entrypoints

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Extension-internal boundary: only this extension's own pages (the action
  // popup) may submit an explicit S2 selection decision or poll journey
  // status. Content scripts and any other sender can never reach the journey.
  if (
    sender.id === chrome.runtime.id &&
    // Extension-internal senders are the popup page(s) — including a popup
    // opened in its own extension-owned window, whose sender carries a tab.
    // Content scripts (page-origin sender.url) stay excluded: only an
    // extension page may submit an explicit journey decision.
    (sender.tab === undefined ||
      (typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('/'))))
  ) {
    // #152 shipped S5 batch flow: the popup gesture is browser-observed
    // only. The worker routes it to the installed Core S5 carrier through
    // Native Messaging — the frozen members, confirmation and per-member
    // terminal all come back as verbatim Core projection facts, never
    // derived here. Every phase fails closed when the carrier is absent.
    if (isS5PageGroupGesture(raw)) {
      const prepared = decodeS5PageGroupGesture(raw);
      if (!prepared.ok) {
        sendResponse({ ok: false, error: prepared.detail });
        return false;
      }
      void (async () => {
        const outcome = await runS5Prepare(prepared.value);
        if (!outcome.ok) {
          sendResponse({ ok: false, error: outcome.error });
          return;
        }
        sendResponse({ ok: true, contractId: outcome.contractId, facts: outcome.facts });
      })();
      return true;
    }
    if (isS5BatchMessageKind(raw)) {
      const decoded = decodeS5BatchMessage(raw);
      if (!decoded.ok) {
        sendResponse({ ok: false, error: decoded.detail });
        return false;
      }
      const message = decoded.value;
      void (async () => {
        if (message.kind === 'S5_CONFIRM_GROUP') {
          await runS5Confirm(message);
        } else if (message.kind === 'S5_EXECUTE_GROUP') {
          await runS5Execute(message);
        } else {
          await s5RefreshStatus(message.contractId);
        }
        const journey = s5Journeys.get(message.contractId);
        if (journey === undefined) {
          sendResponse({ ok: false, error: 'S5_JOURNEY_UNKNOWN_TO_WORKER' });
          return;
        }
        if (journey.status === 'FAILED') {
          sendResponse({ ok: false, error: journey.failure?.detail ?? 'unknown failure' });
          return;
        }
        sendResponse({
          ok: true,
          status: journey.status,
          phase: journey.phase,
          facts: journey.facts,
        });
      })();
      return true;
    }
    // #154 shipped S6 collection flow: the popup gestures are browser-observed
    // only. The worker routes them to the installed Core S6 carrier through
    // Native Messaging — the frozen admission, page records, confirmation,
    // per-member outcomes and the coverage terminal all come back as verbatim
    // Core projection facts, never derived here. Every phase fails closed
    // when the carrier is absent, and the declared page range is frozen by
    // Core before any navigation effect.
    if (isS6CollectionGesture(raw)) {
      const prepared = decodeS6CollectionGesture(raw);
      if (!prepared.ok) {
        sendResponse({ ok: false, error: prepared.detail });
        return false;
      }
      void (async () => {
        const outcome = await runS6Prepare(prepared.value);
        if (!outcome.ok) {
          sendResponse({ ok: false, error: outcome.error });
          return;
        }
        sendResponse({ ok: true, contractId: outcome.contractId, facts: outcome.facts });
      })();
      return true;
    }
    if (isS6BatchMessageKind(raw)) {
      const decoded = decodeS6BatchMessage(raw);
      if (!decoded.ok) {
        sendResponse({ ok: false, error: decoded.detail });
        return false;
      }
      const message = decoded.value;
      void (async () => {
        if (message.kind === 'S6_PAGE_ADMIT') {
          const outcome = await runS6PageAdmit(message);
          sendResponse(
            outcome.ok ? { ok: true, facts: outcome.facts } : { ok: false, error: outcome.error },
          );
          return;
        }
        if (message.kind === 'S6_PAGE_RECORD') {
          const outcome = await runS6PageRecord(message);
          sendResponse(
            outcome.ok ? { ok: true, facts: outcome.facts } : { ok: false, error: outcome.error },
          );
          return;
        }
        if (message.kind === 'S6_CONFIRM_COLLECTION') {
          await runS6Confirm(message);
        } else if (message.kind === 'S6_EXECUTE_COLLECTION') {
          await runS6Execute(message);
        } else {
          await s6RefreshStatus(message.contractId);
        }
        const journey = s6Journeys.get(message.contractId);
        if (journey === undefined) {
          sendResponse({ ok: false, error: 'S6_JOURNEY_UNKNOWN_TO_WORKER' });
          return;
        }
        if (journey.status === 'FAILED') {
          sendResponse({ ok: false, error: journey.failure?.detail ?? 'unknown failure' });
          return;
        }
        sendResponse({
          ok: true,
          status: journey.status,
          phase: journey.phase,
          facts: journey.facts,
        });
      })();
      return true;
    }
    const decoded = decodeInternalS2Message(raw);
    if (!decoded.ok) {
      sendResponse({ ok: false, error: decoded.detail });
      return false;
    }
    if (decoded.value.kind === 'S2_JOURNEY_STATUS') {
      sendResponse({ ok: true, journey: journeys.get(decoded.value.observationId) ?? null });
      return false;
    }
    const selection = decoded.value;
    const observationId = newJourneyId(selection.tabId);
    void runS2Journey(selection, observationId);
    sendResponse({ ok: true, observationId });
    return false;
  }

  // Untrusted content-script boundary: gate before anything privileged can
  // happen (unchanged T010 intake; a content message can NEVER trigger the
  // S2 journey).
  const gated = decodeUntrustedContentMessage(raw);
  if (!gated.ok) {
    // Fail closed with typed diagnostics; never echo payload content back.
    return;
  }
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return;
  }
  const record = recordObservation(gated.value, {
    observationId: `t${tabId}-${(observationCounter += 1)}`,
    capturedAtMs: Date.now(),
  });
  if (!record.ok) {
    return;
  }
  const handoff = buildObservationHandoff(record.value);
  if (handoff.ok) {
    // Exit sink toward the privileged zone: values pass the redactor
    // (defense in depth).
    void redactForSink(handoff.value);
  }
});

/** Popup status poll: the truthful SW-lifetime journey registry. */
export function s2JourneyStatus(observationId: string): unknown {
  return journeys.get(observationId) ?? { status: 'UNKNOWN' };
}

/**
 * The one sanctioned broker channel descriptor: Native Messaging with the
 * exact allow list. If Native Messaging is rejected/unavailable the task
 * path fails closed — there is no alternate transport to fall back to.
 */
export function brokerChannel(): NativeMessagingChannel | undefined {
  const created = createNativeMessagingChannel({
    hostName: NATIVE_HOST_NAME,
    allowedOrigins: BROKER_ALLOWED_ORIGINS,
  });
  if (!created.ok) {
    return undefined;
  }
  const opened = openBrokerChannel(created.value);
  if (!opened.ok) {
    return undefined;
  }
  return opened.value;
}
