/**
 * T010 broker secret zone (PRD §29, frozen L2 §6.4/§12, counterexample C21).
 *
 * The broker is the local secret/capability zone. Its invariants:
 *
 * - raw reusable cookie/token/password/session/signed-URL material never
 *   appears in canonical state, Core-durable paths, logs, evidence, Recipe
 *   data or model input — every exit sink pipes through `redactForSink`;
 * - canonical state exposes only the opaque AuthorizationContextRef;
 * - raw-secret-named fields are rejected at broker boundaries outright.
 *
 * v0.1.0 recorded F1 choice: the broker stores binding + lifecycle state
 * only and holds NO raw secret material — browser session state stays in
 * the browser context. The zone APIs exist to enforce and audit containment
 * so a later, separately validated broker-side vault cannot silently widen
 * what exits the zone.
 */

import { RAW_SECRET_FIELD_NAMES } from '@xdownload/domain-contracts';
import {
  brokerDiagnostic,
  brokerFail,
  brokerOk,
  type BrokerDiagnostic,
  type BrokerResult,
} from './result.ts';

export const BROKER_REDACTED_MARKER = '[REDACTED]' as const;

/** Deep-redaction at broker exit sinks (Core-durable, log, evidence, Recipe, model). */
export function redactForSink<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return looksLikeSecretValue(value) ? BROKER_REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => redact(item, seen));
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = RAW_SECRET_FIELD_NAMES.has(key) ? BROKER_REDACTED_MARKER : redact(child, seen);
    }
    return out;
  }
  return value;
}

/**
 * Scheme/shape heuristics for secret-bearing string values that could be
 * smuggled through non-secret-named fields (defense in depth on top of the
 * canonical RAW_SECRET_FIELD_NAMES key containment).
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^SESS[A-Za-z0-9_-]{8,}$/, // session-cookie style values
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT-style three-segment tokens
  /^Bearer\s+\S+$/i, // authorization headers
  /^(?:[A-Za-z0-9+/]{40,}={0,2})$/, // long base64 blobs
];

function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** Reject a payload that tries to carry raw-secret fields through a broker boundary. */
export function rejectRawSecretPayload(value: unknown, path: string): BrokerResult<void> {
  if (Array.isArray(value)) {
    const diagnostics = value
      .map((item, index) => rejectRawSecretPayload(item, `${path}[${index}]`))
      .filter(
        (result): result is { ok: false; diagnostics: readonly BrokerDiagnostic[] } => !result.ok,
      )
      .flatMap((result) => result.diagnostics);
    return diagnostics.length === 0 ? brokerOk(undefined) : brokerFail(diagnostics);
  }
  if (typeof value === 'object' && value !== null) {
    const diagnostics: BrokerDiagnostic[] = [];
    for (const [key, child] of Object.entries(value)) {
      if (RAW_SECRET_FIELD_NAMES.has(key)) {
        diagnostics.push(
          brokerDiagnostic(
            'RAW_SECRET_FIELD',
            path === '' ? key : `${path}.${key}`,
            'raw reusable secret material can never cross a broker boundary into canonical state',
            'PRD-§29',
          ),
        );
      }
      const nested = rejectRawSecretPayload(child, path === '' ? key : `${path}.${key}`);
      if (!nested.ok) {
        diagnostics.push(...nested.diagnostics);
      }
    }
    return diagnostics.length === 0 ? brokerOk(undefined) : brokerFail(diagnostics);
  }
  return brokerOk(undefined);
}

/** Sentinel audit: does the value contain the sentinel material anywhere? */
export function auditContainsSecretSentinel(value: unknown, sentinel: string): boolean {
  if (typeof value === 'string') {
    return value.includes(sentinel);
  }
  if (Array.isArray(value)) {
    return value.some((item) => auditContainsSecretSentinel(item, sentinel));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((child) => auditContainsSecretSentinel(child, sentinel));
  }
  return false;
}

/**
 * Typed sink-guard: pipe an exit-sink write through redaction plus explicit
 * sentinel scrubbing, then audit. Fail closed (instead of silently writing)
 * if sentinel material survives — the audit is the backstop that makes a
 * false pass impossible even for hostile sentinel choices.
 */
export function guardedSinkWrite<T>(value: T, sentinels: readonly string[]): BrokerResult<T> {
  const redacted = redactForSink(value);
  const scrubbed = scrubSentinels(redacted, sentinels, new WeakSet());
  for (const sentinel of sentinels) {
    if (sentinel.length > 0 && auditContainsSecretSentinel(scrubbed, sentinel)) {
      return brokerFail([
        brokerDiagnostic(
          'SECRET_IN_SINK',
          'sink',
          'secret sentinel material survived sink redaction; the sink write fails closed',
          'PRD-§29',
        ),
      ]);
    }
  }
  return brokerOk(scrubbed as T);
}

function scrubSentinels(
  value: unknown,
  sentinels: readonly string[],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const sentinel of sentinels) {
      if (sentinel.length > 0 && out.includes(sentinel)) {
        out = out.split(sentinel).join(BROKER_REDACTED_MARKER);
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => scrubSentinels(item, sentinels, seen));
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = scrubSentinels(child, sentinels, seen);
    }
    return out;
  }
  return value;
}
