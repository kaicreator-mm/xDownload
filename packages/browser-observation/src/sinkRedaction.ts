/**
 * T010 exit-sink redaction for the browser observation boundary (PRD §29,
 * counterexample C21, frozen L2 §6.4 "redact secrets at logs/evidence/
 * model/Recipe/Core-durable boundaries").
 *
 * Every value crossing an exit sink toward Core-durable state, logs,
 * evidence, Recipe data or model input must pass through `redactForSink`.
 * Two containment rules apply:
 *
 * 1. Keys in the canonical `RAW_SECRET_FIELD_NAMES` set are replaced with a
 *    redaction marker at any nesting depth, for values of any type
 *    (key-based containment).
 * 2. String values that contain registered secret sentinels are replaced
 *    wholesale (value-based containment), so secret material smuggled into
 *    non-secret-named fields cannot leak either.
 *
 * Cyclic/aliased object graphs (issue #72, T010-CTRL-P1-CYCLE-SINK) are
 * contained deterministically. The walk is ancestor-guarded: a cycle
 * back-edge is replaced with the inert `REDACTED_MARKER` instead of
 * re-introducing the original (unredacted) reference into sanitized output,
 * while a shared non-cyclic reference reuses its already-sanitized copy
 * (never the original). The sanitized result of any input is therefore a
 * freshly built acyclic value, hostile graphs can neither smuggle an
 * unredacted reference out nor force unbounded recursion or a thrown
 * RangeError, and every non-cycle behavior (the ANY-type raw-secret rule,
 * sentinel replacement, plain-tree output) stays byte-stable.
 */

import { RAW_SECRET_FIELD_NAMES } from '@xdownload/domain-contracts';

export const REDACTED_MARKER = '[REDACTED]' as const;

const registeredSentinels = new Set<string>();

/**
 * Register a secret sentinel for value-based containment (test/audit
 * mechanics for sentinel-based sink audits; a real broker never relies on
 * sentinel registration for its key-based containment).
 */
export function registerSinkScrubSentinel(secret: string): void {
  if (secret.length > 0) {
    registeredSentinels.add(secret);
  }
}

export function clearSinkScrubSentinels(): void {
  registeredSentinels.clear();
}

function containsSentinel(value: string): boolean {
  for (const sentinel of registeredSentinels) {
    if (value.includes(sentinel)) {
      return true;
    }
  }
  return false;
}

/** Deep-redact a value for any exit sink. Returns a new value; input is not mutated. */
export function redactForSink<T>(value: T): T {
  return redact(value, new WeakSet<object>(), new Map<object, unknown>()) as T;
}

/**
 * Cycle-safe redaction walk: `ancestors` holds the objects/arrays on the
 * current path (a re-entry is a true cycle), `sanitized` memoizes finished
 * sanitized copies so shared non-cyclic references reuse the copy. An
 * original reference is never returned into sanitized output.
 */
function redact(
  value: unknown,
  ancestors: WeakSet<object>,
  sanitized: Map<object, unknown>,
): unknown {
  if (typeof value === 'string') {
    return containsSentinel(value) ? REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return REDACTED_MARKER;
    }
    const cached = sanitized.get(value);
    if (cached !== undefined) {
      return cached;
    }
    ancestors.add(value);
    const out: unknown[] = value.map((item) => redact(item, ancestors, sanitized));
    ancestors.delete(value);
    sanitized.set(value, out);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) {
      return REDACTED_MARKER;
    }
    const cached = sanitized.get(value);
    if (cached !== undefined) {
      return cached;
    }
    ancestors.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (RAW_SECRET_FIELD_NAMES.has(key)) {
        out[key] = REDACTED_MARKER;
      } else {
        out[key] = redact(child, ancestors, sanitized);
      }
    }
    ancestors.delete(value);
    sanitized.set(value, out);
    return out;
  }
  return value;
}

/** Audit helper: does this value contain any registered sentinel anywhere? */
export function auditValueContainsSentinel(value: unknown): boolean {
  return auditSentinel(value, new WeakSet<object>());
}

/**
 * Ancestor-guarded sentinel audit: terminates deterministically on any
 * finite graph (a cycle back-edge contributes nothing new — every distinct
 * node is still visited exactly once, so the boolean answer stays exact),
 * and shared non-cyclic references never produce a false positive.
 */
function auditSentinel(value: unknown, ancestors: WeakSet<object>): boolean {
  if (typeof value === 'string') {
    return containsSentinel(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const hit = value.some((item) => auditSentinel(item, ancestors));
    ancestors.delete(value);
    return hit;
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const hit = Object.values(value).some((child) => auditSentinel(child, ancestors));
    ancestors.delete(value);
    return hit;
  }
  return false;
}
