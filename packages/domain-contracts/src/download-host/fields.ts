/**
 * V022 A01 — neutral Host-operation contracts: shared field grammar.
 *
 * The bounded field grammars both Host request DTOs validate against, kept
 * as data (patterns and bounds) plus tiny pure predicates. Business Intent,
 * K/S/B/C vocabulary and route policy deliberately do NOT live here — only
 * the scalar grammars a Host operation DTO needs to fail closed before any
 * physical effect. Pure: no I/O, no Node APIs.
 */

/** Bounded lowercase-kebab id grammar for request/lineage identities. */
export const INTENT_FIELD_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Lowercase SHA-256 hex grammar for every digest fact in the DTOs. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** v0.2 profile bound: 1 TiB per confirmed Host operation. */
export const MAX_DECLARED_BYTES = 1_099_511_627_776;

/** A bounded lowercase-kebab identity field. */
export function isBoundedIntentField(value: unknown): value is string {
  return typeof value === 'string' && INTENT_FIELD_PATTERN.test(value);
}

/** A lowercase 64-hex SHA-256 digest fact. */
export function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

/** A positive safe-integer byte count within the v0.2 profile bound. */
export function isBoundedByteCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_DECLARED_BYTES
  );
}

/**
 * An ISO-8601 timestamp with an EXPLICIT timezone designator (`Z` or
 * `±hh:mm`). Wall-clock-naive timestamps are refused: `Date.parse` would
 * interpret them in the host's local zone, making freshness validation
 * host-dependent and non-deterministic across machines.
 */
export const EXPLICIT_TIMEZONE_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isExplicitTimezoneIso(value: unknown): value is string {
  return typeof value === 'string' && EXPLICIT_TIMEZONE_ISO_PATTERN.test(value);
}
