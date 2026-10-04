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
 *    redaction marker at any nesting depth (key-based containment).
 * 2. String values that contain registered secret sentinels are replaced
 *    wholesale (value-based containment), so secret material smuggled into
 *    non-secret-named fields cannot leak either.
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
  return redact(value, new WeakSet()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return containsSentinel(value) ? REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return value.map((item) => redact(item, seen));
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (RAW_SECRET_FIELD_NAMES.has(key)) {
        out[key] = REDACTED_MARKER;
      } else {
        out[key] = redact(child, seen);
      }
    }
    return out;
  }
  return value;
}

/** Audit helper: does this value contain any registered sentinel anywhere? */
export function auditValueContainsSentinel(value: unknown): boolean {
  if (typeof value === 'string') {
    return containsSentinel(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => auditValueContainsSentinel(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((child) => auditValueContainsSentinel(child));
  }
  return false;
}
