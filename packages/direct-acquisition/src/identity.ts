/**
 * T008 representation identity and the typed resume/restart decision.
 *
 * Frozen L2 U5: resume only when representation identity is sufficiently
 * validated; use a strong validator/`If-Range` where available; if identity
 * cannot be proven or the validator changes incompatibly, restart instead of
 * appending uncertain bytes. Weak validators (`W/`) are never sufficient
 * representation identity for append (RFC 9110 §8.8.3).
 */

import type { PartialTransferState, RepresentationIdentity, ResumeDecision } from './port.ts';

/** Parse representation-identity headers into a typed identity record. */
export function observeIdentity(headers: Headers): RepresentationIdentity {
  const etag = headerOrNull(headers, 'etag');
  const lastModified = headerOrNull(headers, 'last-modified');
  const contentLengthRaw = headerOrNull(headers, 'content-length');
  const contentLength =
    contentLengthRaw !== undefined && /^\d+$/.test(contentLengthRaw)
      ? Number(contentLengthRaw)
      : undefined;
  return {
    strongETag: etag !== undefined && !etag.startsWith('W/') ? etag : undefined,
    weakETag: etag !== undefined && etag.startsWith('W/') ? etag : undefined,
    lastModified,
    contentLength,
  };
}

function headerOrNull(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  return value === null ? undefined : value;
}

/**
 * Pre-request resume plan for the given partial state. Append is planned
 * only against a recorded strong validator; anything else transfers fresh
 * on the same lineage (never appends uncertain bytes).
 */
export function planResume(partial: PartialTransferState | undefined): ResumeDecision {
  if (partial === undefined) {
    return { kind: 'FRESH_TRANSFER' };
  }
  if (partial.identity.strongETag === undefined) {
    return { kind: 'SAFE_RESTART', reason: 'NO_STRONG_VALIDATOR' };
  }
  return {
    kind: 'VALIDATED_RESUME',
    offsetBytes: partial.receivedBytes,
    strongETag: partial.identity.strongETag,
  };
}

/**
 * How a response to this attempt reconciles with the recorded partial
 * representation: `APPEND_VALIDATED` (conditional range matched the recorded
 * strong validator), `RESTART_NEW_REPRESENTATION` (full response replaced a
 * changed representation), `FRESH_FULL_RESPONSE` (plain full response with
 * no prior state), or `PROTOCOL_VIOLATION` (unsolicited partial response —
 * ambiguous identity, fail closed).
 */
export type RangeResponseClassification =
  | { readonly kind: 'APPEND_VALIDATED' }
  | { readonly kind: 'RESTART_NEW_REPRESENTATION' }
  | { readonly kind: 'FRESH_FULL_RESPONSE' }
  | { readonly kind: 'PROTOCOL_VIOLATION' };

/**
 * Classify a 2xx response against the resume plan that was sent. A `200` to
 * a conditional range request means the representation changed
 * (`If-Range` mismatch): the full new representation replaces the partial
 * bytes on the same lineage. A `206` keeps identity only when the response
 * still carries the recorded strong validator (defensive check); otherwise
 * the adapter restarts rather than guessing. A `206` without a preceding
 * range request is a protocol violation and fails closed.
 */
export function classifyRangeResponse(
  sentRange: boolean,
  status: number,
  responseIdentity: RepresentationIdentity,
  recordedStrongETag: string | undefined,
): RangeResponseClassification {
  if (status === 206) {
    if (!sentRange) {
      return { kind: 'PROTOCOL_VIOLATION' };
    }
    if (
      recordedStrongETag !== undefined &&
      responseIdentity.strongETag !== undefined &&
      responseIdentity.strongETag !== recordedStrongETag
    ) {
      return { kind: 'RESTART_NEW_REPRESENTATION' };
    }
    return { kind: 'APPEND_VALIDATED' };
  }
  if (sentRange && recordedStrongETag !== undefined) {
    return { kind: 'RESTART_NEW_REPRESENTATION' };
  }
  return { kind: 'FRESH_FULL_RESPONSE' };
}

/** Hex SHA-256 pattern for target identity anchors. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_PATTERN.test(value);
}
