/**
 * T004 declared wire bounds (frozen L2 §12: schema/size bounds on all
 * local-IPC messages, enforced before authority transition).
 *
 * The constants below are part of the wire contract, not implementation
 * accidents: tests are written against these exported constants so the
 * declared limit and its enforcement cannot silently diverge.
 */

import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

/** Declared seam message bounds. Part of the v1 wire contract. */
export const SEAM_MESSAGE_LIMITS = {
  /** Maximum serialized envelope bytes accepted on any seam channel. */
  maxFrameBytes: 1_048_576,
  /** Maximum serialized `payload` bytes; the payload is the authority-bearing part. */
  maxPayloadBytes: 786_432,
  /** Maximum structural nesting depth of a decoded envelope. */
  maxDepth: 32,
  /** Maximum own-property count of any object inside an envelope. */
  maxFieldsPerObject: 256,
  /** Maximum length of any string value inside an envelope. */
  maxStringFieldLength: 4096,
  /** Maximum length of any array inside an envelope. */
  maxArrayLength: 10_000,
} as const;

export type SeamMessageLimits = typeof SEAM_MESSAGE_LIMITS;

/**
 * Deterministic canonical JSON serialization (object keys sorted) used for
 * payload equality digests and byte-size measurement. Input must already
 * have passed the structural bounds walk so serialization is bounded.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = stabilize(record[key]);
    }
    return out;
  }
  return value;
}

/** Canonical byte length of a (bounds-checked) payload value. */
export function payloadByteLength(value: unknown): number {
  return Buffer.byteLength(stableStringify(value), 'utf8');
}

/**
 * Structural bounds walk over decoded JSON, enforced before any authority
 * transition. Diagnostics name the violated declared bound and the path;
 * messages never embed the offending value, so no content (including secret
 * material) can leak through a bounds rejection.
 */
export function checkStructureBounds(
  value: unknown,
  limits: SeamMessageLimits = SEAM_MESSAGE_LIMITS,
): SeamResult<void> {
  return walk(value, '', 0, limits);
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  limits: SeamMessageLimits,
): SeamResult<void> {
  if (depth > limits.maxDepth) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_TOO_DEEP',
        path === '' ? '$' : path,
        `nesting depth exceeds declared bound ${String(limits.maxDepth)}`,
      ),
    ]);
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringFieldLength) {
      return seamFail([
        seamDiagnostic(
          'STRING_TOO_LONG',
          path === '' ? '$' : path,
          `string length exceeds declared bound ${String(limits.maxStringFieldLength)}`,
        ),
      ]);
    }
    return seamOk(undefined);
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      return seamFail([
        seamDiagnostic(
          'ARRAY_TOO_LONG',
          path === '' ? '$' : path,
          `array length exceeds declared bound ${String(limits.maxArrayLength)}`,
        ),
      ]);
    }
    for (let index = 0; index < value.length; index += 1) {
      const result = walk(value[index], `${path}[${String(index)}]`, depth + 1, limits);
      if (!result.ok) {
        return result;
      }
    }
    return seamOk(undefined);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > limits.maxFieldsPerObject) {
      return seamFail([
        seamDiagnostic(
          'TOO_MANY_FIELDS',
          path === '' ? '$' : path,
          `object field count exceeds declared bound ${String(limits.maxFieldsPerObject)}`,
        ),
      ]);
    }
    for (const key of keys) {
      const result = walk(record[key], path === '' ? key : `${path}.${key}`, depth + 1, limits);
      if (!result.ok) {
        return result;
      }
    }
  }
  return seamOk(undefined);
}
