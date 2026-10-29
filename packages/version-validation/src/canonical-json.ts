/**
 * Deterministic canonical serialization and content digesting.
 *
 * Harness outputs must be byte-stable across repeated runs on identical
 * inputs (TEST_MATRIX suite `harness-self-tests`). Key order is normalized
 * (lexicographic) so object insertion order can never leak into digests or
 * formatted evidence. Only Node built-ins are used; nothing here touches the
 * network or the wall clock.
 */

import { createHash } from 'node:crypto';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable JSON: object keys sorted lexicographically, arrays order-preserving. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  // undefined / functions / symbols have no canonical JSON form.
  return 'null';
}

/** Deterministic SHA-256 over the stable serialization of `value`. */
export function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
