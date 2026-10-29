/**
 * v0.2 T08 — inbound authorization gate (browser lane).
 *
 * EVERYTHING a page, a message channel or any other untrusted inbound path
 * delivers that claims to be a confirmed download intent MUST pass this gate
 * before it can enter the submission flow. The gate is exactly the canonical
 * T01 `validateConfirmedIntent` decoder: exact-key no-widening (unknown
 * fields are REFUSED, never dropped), opaque targetRef grammar, output-root
 * containment and bounded caller identity.
 *
 * Rejection codes are passed through VERBATIM as typed diagnostics — the
 * surface never re-writes, swallows or downgrades a refusal reason.
 *
 * Pure function: no chrome.* API, no DOM, no Native Messaging.
 */

import { deepFreeze } from '@xdownload/domain-contracts';
import { validateConfirmedIntent } from '../../../../packages/download-domain-app/src/contracts/index.ts';
import type { ValidationDiagnostic } from '@xdownload/domain-contracts';
import type { ConfirmedDownloadIntent } from '../../../../packages/download-domain-app/src/contracts/index.ts';

export type AuthorizationGateDecision =
  | { readonly authorized: true; readonly intent: Readonly<ConfirmedDownloadIntent> }
  | { readonly authorized: false; readonly diagnostics: readonly ValidationDiagnostic[] };

/**
 * Gate one untrusted inbound candidate. On success the confirmed intent is
 * deep-frozen (the sealed scope cannot be mutated in place afterwards); on
 * failure the canonical T01 diagnostics pass through unchanged.
 */
export function gateConfirmedAuthorization(raw: unknown): AuthorizationGateDecision {
  const result = validateConfirmedIntent(raw);
  if (!result.ok) {
    return { authorized: false, diagnostics: result.diagnostics };
  }
  return { authorized: true, intent: deepFreeze(result.value) };
}
