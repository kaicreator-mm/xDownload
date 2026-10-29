/**
 * T010 untrusted content-script observer (page/content script zone = untrusted
 * input, frozen L2 §6.4).
 *
 * The content script collects a minimal PAGE_CONTEXT observation and submits
 * it to the privileged extension context. It holds no privilege: the
 * extension gate rejects anything from this boundary that is not an
 * observation submission, and this file intentionally contains no path that
 * reaches the native broker or authorization actions.
 *
 * Injected on demand by the privileged context (activeTab + scripting, least
 * privilege); no broad host permissions are requested.
 */

// Untrusted side only knows how to describe what it observes; provenance
// (tab/frame identity) is attached by the privileged context from its own
// trusted API state, never trusted from here.
const submission = {
  boundary: 'CONTENT_SCRIPT',
  kind: 'PAGE_CONTEXT',
  provenance: { tabId: 0, frameId: 0, origin: location.origin },
  payload: { pageUrl: location.href },
};

chrome.runtime.sendMessage(submission);
