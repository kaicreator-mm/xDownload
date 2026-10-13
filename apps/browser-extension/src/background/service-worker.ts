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
  decodeInternalS2Message,
  isHttpUrl,
  MAX_S2_ATTACHMENT_BYTES,
  toBase64Chunks,
  type S2Selection,
} from './s2-glue.ts';

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
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const NATIVE_HOST_NAME = 'com.xdownload.broker';
// Exact extension origin of this build; replaced at integration packaging.
// This mirrors the platform `allowed_origins` list — never a wildcard.
const BROKER_ALLOWED_ORIGINS: readonly string[] = [
  'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
];

let observationCounter = 0;

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

/**
 * Run the installed S2 journey for one explicit user selection:
 * observation → credentialed byte fetch (browser zone) → Native Messaging
 * S2_ACQUIRE → verbatim Core terminal projection.
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

  try {
    // 1. The page origin authority: the privileged context's own tab state.
    const tab = await chrome.tabs.get(selection.tabId);
    const tabUrl = tab.url;
    if (typeof tabUrl !== 'string' || !isHttpUrl(tabUrl)) {
      fail('ORIGIN_AUTHORITY', 'the active tab exposes no trustworthy http(s) origin');
      return;
    }
    const pageOrigin = new URL(tabUrl).origin;
    const linkOrigin = new URL(selection.linkUrl).origin;
    if (linkOrigin !== pageOrigin) {
      // v0.1.0 journey scope: the explicit attachment is on the observed page
      // origin; a cross-origin locator is refused, never silently followed.
      fail('ORIGIN_MISMATCH', 'the selected attachment is not on the observed page origin');
      return;
    }

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

    // 3. Credentialed byte acquisition in the browser zone (activeTab).
    const response = await fetch(selection.linkUrl, {
      credentials: 'include',
      redirect: 'follow',
    });
    if (response.status !== 200) {
      fail(
        'ATTACHMENT_FETCH',
        `HTTP ${String(response.status)} — the authorized context did not return the attachment`,
      );
      return;
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      fail('ATTACHMENT_FETCH', 'the attachment response carried zero bytes');
      return;
    }
    if (bytes.length > MAX_S2_ATTACHMENT_BYTES) {
      fail(
        'ATTACHMENT_BOUND',
        `attachment of ${String(bytes.length)} bytes exceeds the declared v0.1.0 delivered-acquisition bound ${String(MAX_S2_ATTACHMENT_BYTES)}`,
      );
      return;
    }

    // 4. Native Messaging S2_ACQUIRE → the native host's privileged lane.
    const s2Acquire = {
      kind: 'S2_ACQUIRE',
      requestId: `s2-journey-${observationId}`,
      s2: {
        handoff: redactedHandoff,
        decisionToken: `user-confirm:${observationId}`,
        ttlMs: 60_000,
        delivery: {
          locatorUri: selection.linkUrl,
          originLocatorUri: selection.linkUrl,
          provenanceBinding: 'SELECTED_RESOURCE_PROVENANCE',
          declaredRedirectHosts: [new URL(pageOrigin).host],
          expectedSha256: selection.expectedSha256,
          ...(selection.contentTypePrefix === undefined
            ? {}
            : { expectedContentTypePrefix: selection.contentTypePrefix }),
          expectedTotalBytes: bytes.length,
        },
        browserResponse: {
          finalUrl: response.url,
          ...(response.headers.get('content-type') === null
            ? {}
            : { contentType: response.headers.get('content-type') ?? undefined }),
          status: response.status,
        },
        bytes: toBase64Chunks(bytes),
      },
    };

    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    let settled = false;
    const finish = new Promise<void>((resolve) => {
      port.onDisconnect.addListener(() => {
        if (settled) {
          return;
        }
        settled = true;
        fail('NATIVE_HOST', 'the native host disconnected without a terminal result');
        resolve();
      });
      port.onMessage.addListener((message: unknown) => {
        if (settled || typeof message !== 'object' || message === null) {
          return;
        }
        const record = message as Record<string, unknown>;
        if (record['requestId'] !== s2Acquire.requestId) {
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
    port.postMessage(s2Acquire);
    await finish;
  } catch (error) {
    fail('JOURNEY', error instanceof Error ? error.message : 'unexpected journey failure');
  }
}

// ------------------------------------------------------------- entrypoints

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Extension-internal boundary: only this extension's own pages (the action
  // popup) may submit an explicit S2 selection decision or poll journey
  // status. Content scripts and any other sender can never reach the journey.
  if (sender.id === chrome.runtime.id && sender.tab === undefined) {
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
    const observationId = `s2-t${selection.tabId}-${(observationCounter += 1)}`;
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
