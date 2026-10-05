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
 *
 * Cyclic/aliased object graphs (issue #72, T010-CTRL-P1-CYCLE-SINK) share
 * the browser-observation cycle semantic: sanitizing sinks (`redactForSink`,
 * `scrubSentinels`) replace a cycle back-edge with the inert
 * `BROKER_REDACTED_MARKER` and reuse already-sanitized copies for shared
 * non-cyclic references, so an original reference can never re-enter
 * sanitized output and hostile graphs cannot force unbounded recursion; the
 * typed rejection boundary (`rejectRawSecretPayload`) fails closed on a true
 * ancestor cycle with a `CYCLIC_STRUCTURE` diagnostic (T012
 * `auditSecretMaterial` precedent, PR #63); the sentinel audit terminates
 * deterministically on any finite graph with exact answers. Non-cycle
 * semantics (the ANY-type `RAW_SECRET_FIELD_NAMES` rule, sentinel
 * replacement, opaque AuthorizationContextRef pass-through) are unchanged.
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
  return redact(value, new WeakSet<object>(), new Map<object, unknown>()) as T;
}

/**
 * Cycle-safe redaction walk (same semantic as the browser-observation
 * redactor): `ancestors` detects true cycles, `sanitized` memoizes finished
 * copies for shared non-cyclic references; an original reference is never
 * returned into sanitized output.
 */
function redact(
  value: unknown,
  ancestors: WeakSet<object>,
  sanitized: Map<object, unknown>,
): unknown {
  if (typeof value === 'string') {
    return looksLikeSecretValue(value) ? BROKER_REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return BROKER_REDACTED_MARKER;
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
      return BROKER_REDACTED_MARKER;
    }
    const cached = sanitized.get(value);
    if (cached !== undefined) {
      return cached;
    }
    ancestors.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = RAW_SECRET_FIELD_NAMES.has(key)
        ? BROKER_REDACTED_MARKER
        : redact(child, ancestors, sanitized);
    }
    ancestors.delete(value);
    sanitized.set(value, out);
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
  return rejectRawSecretWalk(value, path, new WeakSet<object>());
}

/**
 * Ancestor-guarded rejection walk (T012 `auditSecretMaterial` precedent):
 * a true ancestor cycle fails closed with a typed `CYCLIC_STRUCTURE`
 * diagnostic naming the re-entry path, shared non-cyclic references are
 * walked once per reference without a false positive, and the walk
 * terminates deterministically on any input without throwing.
 */
function rejectRawSecretWalk(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): BrokerResult<void> {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return brokerFail([cyclicStructureDiagnostic(path)]);
    }
    ancestors.add(value);
    const diagnostics = value
      .map((item, index) => rejectRawSecretWalk(item, `${path}[${index}]`, ancestors))
      .filter(
        (result): result is { ok: false; diagnostics: readonly BrokerDiagnostic[] } => !result.ok,
      )
      .flatMap((result) => result.diagnostics);
    ancestors.delete(value);
    return diagnostics.length === 0 ? brokerOk(undefined) : brokerFail(diagnostics);
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) {
      return brokerFail([cyclicStructureDiagnostic(path)]);
    }
    ancestors.add(value);
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
      const nested = rejectRawSecretWalk(child, path === '' ? key : `${path}.${key}`, ancestors);
      if (!nested.ok) {
        diagnostics.push(...nested.diagnostics);
      }
    }
    ancestors.delete(value);
    return diagnostics.length === 0 ? brokerOk(undefined) : brokerFail(diagnostics);
  }
  return brokerOk(undefined);
}

function cyclicStructureDiagnostic(path: string): BrokerDiagnostic {
  return brokerDiagnostic(
    'CYCLIC_STRUCTURE',
    path,
    'cyclic structure cannot be proven secret-free; the broker boundary rejects the payload',
    'PRD-§29',
  );
}

/** Sentinel audit: does the value contain the sentinel material anywhere? */
export function auditContainsSecretSentinel(value: unknown, sentinel: string): boolean {
  return auditSentinelMaterial(value, sentinel, new WeakSet<object>());
}

/**
 * Ancestor-guarded sentinel audit: terminates deterministically on any
 * finite graph (every distinct node is visited exactly once, so the boolean
 * answer stays exact) and shared non-cyclic references never produce a
 * false positive.
 */
function auditSentinelMaterial(
  value: unknown,
  sentinel: string,
  ancestors: WeakSet<object>,
): boolean {
  if (typeof value === 'string') {
    return value.includes(sentinel);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const hit = value.some((item) => auditSentinelMaterial(item, sentinel, ancestors));
    ancestors.delete(value);
    return hit;
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const hit = Object.values(value).some((child) =>
      auditSentinelMaterial(child, sentinel, ancestors),
    );
    ancestors.delete(value);
    return hit;
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
  const scrubbed = scrubSentinels(
    redacted,
    sentinels,
    new WeakSet<object>(),
    new Map<object, unknown>(),
  );
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
  ancestors: WeakSet<object>,
  sanitized: Map<object, unknown>,
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
    if (ancestors.has(value)) {
      return BROKER_REDACTED_MARKER;
    }
    const cached = sanitized.get(value);
    if (cached !== undefined) {
      return cached;
    }
    ancestors.add(value);
    const out = value.map((item) => scrubSentinels(item, sentinels, ancestors, sanitized));
    ancestors.delete(value);
    sanitized.set(value, out);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) {
      return BROKER_REDACTED_MARKER;
    }
    const cached = sanitized.get(value);
    if (cached !== undefined) {
      return cached;
    }
    ancestors.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = scrubSentinels(child, sentinels, ancestors, sanitized);
    }
    ancestors.delete(value);
    sanitized.set(value, out);
    return out;
  }
  return value;
}
