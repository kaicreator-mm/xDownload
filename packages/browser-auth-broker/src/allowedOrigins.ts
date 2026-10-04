/**
 * T010 Native Messaging `allowed_origins` enforcement (frozen L2 invariant
 * 14, ADR-005).
 *
 * Chromium's `allowed_origins` manifest key is the platform-enforced
 * boundary; the broker independently enforces the same strict list as a
 * second lock. Rules that never bend:
 *
 * - exact `chrome-extension://<id>/` origin match only;
 * - an empty allow list rejects every caller (no empty-match fallback);
 * - no wildcards, no prefixes, no "closest match";
 * - a caller whose origin cannot be established fails closed.
 */

import { brokerDiagnostic, brokerFail, brokerOk, type BrokerResult } from './result.ts';

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}\/$/;

export type AllowedOrigins = readonly string[];

/** True only for an exact, well-formed, allow-listed extension origin. */
export function isOriginAllowed(origin: string, allowed: AllowedOrigins): boolean {
  if (!EXTENSION_ORIGIN_PATTERN.test(origin)) {
    return false;
  }
  // Every configured entry must itself be well-formed; a malformed
  // configuration fails closed for all callers rather than matching loosely.
  return allowed.every((entry) => EXTENSION_ORIGIN_PATTERN.test(entry)) && allowed.includes(origin);
}

/** Typed allow-list enforcement with an explicit invariant reference. */
export function assertOriginAllowed(
  origin: string,
  allowed: AllowedOrigins,
): BrokerResult<'ALLOWED'> {
  if (allowed.length === 0) {
    return brokerFail([
      brokerDiagnostic(
        'ALLOWED_ORIGINS_REJECTED',
        'allowedOrigins',
        'the allow list is empty: every caller is rejected (no empty-match fallback)',
        'L2-inv14',
      ),
    ]);
  }
  if (!isOriginAllowed(origin, allowed)) {
    return brokerFail([
      brokerDiagnostic(
        'ALLOWED_ORIGINS_REJECTED',
        'callerOrigin',
        `extension origin '${origin}' is not exactly listed in allowed_origins; there is no fallback path`,
        'L2-inv14',
      ),
    ]);
  }
  return brokerOk('ALLOWED' as const);
}

/**
 * Resolve the caller origin from the native host process arguments. When
 * Chromium launches a Native Messaging host it passes the calling extension
 * origin (`chrome-extension://<id>/`) as an argument; a host started without
 * such an argument did not come from an allow-listed extension and fails
 * closed.
 */
export function resolveCallerOrigin(argv: readonly string[]): BrokerResult<string> {
  for (const arg of argv) {
    if (EXTENSION_ORIGIN_PATTERN.test(arg)) {
      return brokerOk(arg);
    }
  }
  return brokerFail([
    brokerDiagnostic(
      'CALLER_ORIGIN_MISSING',
      'argv',
      'no chrome-extension:// origin argument was passed to the native host; refusing to establish a session',
      'L2-inv14',
    ),
  ]);
}
