/**
 * T010 privileged extension service worker (browser capability zone, frozen
 * L2 §6.4).
 *
 * Trust-boundary rules enforced in this glue:
 * - content-script input is untrusted: it passes the schema/size gate and
 *   can only become a provenance-bound observation record; it can NEVER
 *   invoke broker/auth actions (the gate rejects any attempt);
 * - the ONLY broker transport is Native Messaging via `connectNative`; there
 *   is no fallback IPC branch in this file by design;
 * - auth issue/use/revoke decisions run in this privileged context only,
 *   triggered by explicit user-confirmation decisions.
 *
 * This glue contains no business logic; all authorization semantics live in
 * @xdownload/browser-auth-broker and all gating in
 * @xdownload/browser-observation. Extension bundling/packaging is downstream
 * (T016 integration / T018 packaging) and is not claimed here.
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

const NATIVE_HOST_NAME = 'com.xdownload.broker';
// Exact extension origin of this build; replaced at integration packaging.
// This mirrors the platform `allowed_origins` list — never a wildcard.
const BROKER_ALLOWED_ORIGINS: readonly string[] = [
  'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
];

let observationCounter = 0;

chrome.runtime.onMessage.addListener((raw, sender) => {
  // Untrusted boundary: gate before anything privileged can happen.
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
    // Exit sink toward Core: values pass the redactor (defense in depth).
    void redactForSink(handoff.value);
  }
});

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
