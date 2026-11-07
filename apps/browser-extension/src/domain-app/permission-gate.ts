/**
 * v0.2.1 T05 — the submission permission decision (browser lane).
 *
 * The frozen T05/L2 rule: "permission is requested only when required" and
 * "no silent permission grant". This module is the ONE place that decides
 * whether the v0.2 submission needs a browser permission prompt:
 *
 * - the explicit v0.2 seam submission performs NO browser fetch: the
 *   transfer is executed by the trusted local Host/Core. Its required
 *   browser-origin set is therefore EMPTY and no `chrome.permissions`
 *   prompt may be fired for it — requesting one anyway would be exactly
 *   the forbidden silent/unnecessary grant;
 * - if a future lane declares required origins (the declarative table
 *   below is the only place that can grow them), the decision is explicit:
 *   already-granted origins never re-prompt, and a denied request is a
 *   typed fail-closed refusal BEFORE anything is submitted.
 *
 * Pure decision only: no chrome.* API (the caller's adapter owns the
 * chrome.permissions round trip and is unit-tested with fakes).
 */

/**
 * The frozen required-browser-origin table of the v0.2 submission lane.
 * Empty by contract: the trusted Host performs the transfer, so the
 * submission itself needs no host permission. Only an L2-reviewed change
 * may add entries here.
 */
export const V02_SUBMISSION_REQUIRED_ORIGINS: readonly string[] = Object.freeze([]);

export type SubmissionPermissionDecision =
  | { readonly kind: 'NOT_REQUIRED' }
  | { readonly kind: 'GRANTED' }
  | { readonly kind: 'REQUEST_NEEDED'; readonly origins: readonly string[] };

/**
 * Decide the permission step for one submission. `NOT_REQUIRED` skips the
 * browser permission machinery entirely (the prompt is never fired when
 * nothing is required); `GRANTED` means every required origin is already
 * granted so no re-prompt happens; `REQUEST_NEEDED` carries exactly the
 * missing origins — never a wildcard beyond the declared requirement.
 */
export function decideSubmissionPermission(
  requiredOrigins: readonly string[],
  grantedOrigins: readonly string[],
): SubmissionPermissionDecision {
  if (requiredOrigins.length === 0) {
    return { kind: 'NOT_REQUIRED' };
  }
  const granted = new Set(grantedOrigins);
  const missing = requiredOrigins.filter((origin) => !granted.has(origin));
  return missing.length === 0
    ? { kind: 'GRANTED' }
    : { kind: 'REQUEST_NEEDED', origins: Object.freeze([...missing]) };
}

/** The typed outcome after the caller's permission request round trip. */
export type PermissionRequestOutcome =
  { readonly kind: 'ALLOWED' } | { readonly kind: 'DENIED'; readonly detail: string };

/** The typed fail-closed refusal code a denied request maps to. */
export const V02_PERMISSION_DENIED = 'V02_PERMISSION_DENIED' as const;

/**
 * Human-renderable rationale for the popup (shown at the action, never
 * pre-granted): explains WHY a permission step exists or why none is
 * needed. Static text only — no page or target content.
 */
export function permissionRationale(requiredOrigins: readonly string[]): string {
  return requiredOrigins.length === 0
    ? 'No extra browser permission is needed: the download is performed by your local trusted xDownload Host, not by the browser.'
    : `The local trusted Host needs browser access to ${requiredOrigins.join(', ')} for this action. You will be asked explicitly; denying it cancels the action.`;
}
