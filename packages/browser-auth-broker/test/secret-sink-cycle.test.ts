/**
 * T010 broker secret-zone cycle containment (issue #72,
 * T010-CTRL-P1-CYCLE-SINK). The broker shares the browser-observation
 * bounded cycle semantic: sanitizing sinks (`redactForSink`,
 * `scrubSentinels` via `guardedSinkWrite`) replace cycle back-edges with the
 * inert `BROKER_REDACTED_MARKER` and never re-introduce an original
 * reference; the typed rejection boundary (`rejectRawSecretPayload`) fails
 * closed on true ancestor cycles with a `CYCLIC_STRUCTURE` diagnostic
 * (T012 `auditSecretMaterial` precedent, PR #63); the sentinel audit
 * terminates exactly on any finite graph. Non-cycle semantics (the ANY-type
 * raw-secret rule, sentinel scrubbing, opaque AuthorizationContextRef
 * pass-through) are exercised as positive controls.
 */

import { describe, expect, it } from 'vitest';
import {
  BROKER_REDACTED_MARKER,
  auditContainsSecretSentinel,
  guardedSinkWrite,
  redactForSink,
  rejectRawSecretPayload,
} from '../src/index.ts';

const SENTINEL = 'SESSsupersecretcookievalue001';
// Three dot-separated segments: matches the broker's JWT-style heuristic.
const JWT_STYLE = 'eyJhbGciOi.JFUzI1NiIs.InRlc3Q';

describe('rejectRawSecretPayload cycle rejection', () => {
  it('fails closed with a typed CYCLIC_STRUCTURE diagnostic on a self-referential object', () => {
    const node: Record<string, unknown> = { keep: 'value' };
    node['self'] = node;
    const rejected = rejectRawSecretPayload(node, 'canonical');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics).toHaveLength(1);
      expect(rejected.diagnostics[0]?.code).toBe('CYCLIC_STRUCTURE');
      expect(rejected.diagnostics[0]?.path).toBe('canonical.self');
      expect(rejected.diagnostics[0]?.invariant).toBe('PRD-§29');
    }
  });

  it('fails closed on a self-referential array, naming the re-entry index', () => {
    const cycle: unknown[] = ['entry'];
    cycle.push(cycle);
    const rejected = rejectRawSecretPayload(cycle, '');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.code)).toEqual(['CYCLIC_STRUCTURE']);
      expect(rejected.diagnostics[0]?.path).toBe('[1]');
    }
  });

  it('fails closed on mutual object cycles and terminates deterministically', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    a['b'] = b;
    b['a'] = a;
    const rejected = rejectRawSecretPayload(a, 'payload');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.code)).toEqual(['CYCLIC_STRUCTURE']);
      expect(rejected.diagnostics[0]?.path).toBe('payload.b.a');
    }
  });

  it('a cycle containing a raw-secret key reports both the raw-secret and cycle diagnostics', () => {
    const node: Record<string, unknown> = {};
    node['cookie'] = SENTINEL;
    node['self'] = node;
    const rejected = rejectRawSecretPayload(node, 'canonical');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.code)).toEqual([
        'RAW_SECRET_FIELD',
        'CYCLIC_STRUCTURE',
      ]);
      expect(rejected.diagnostics.map((d) => d.path)).toEqual([
        'canonical.cookie',
        'canonical.self',
      ]);
    }
  });

  it('repeated shared references without a cycle are not false positives', () => {
    const shared = { authorizationContextRef: 'authctx/test/1@0' };
    const input = { x: shared, y: shared, z: [shared] };
    expect(rejectRawSecretPayload(input, 'canonical').ok).toBe(true);
  });

  it('raw secrets behind shared references are still reported on every alias path', () => {
    const shared = { cookie: SENTINEL };
    const input = { x: shared, y: shared };
    const rejected = rejectRawSecretPayload(input, 'canonical');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.path)).toEqual([
        'canonical.x.cookie',
        'canonical.y.cookie',
      ]);
      expect(rejected.diagnostics.every((d) => d.code === 'RAW_SECRET_FIELD')).toBe(true);
    }
  });

  it('a long finite cycle fails closed without unbounded recursion', () => {
    const head: Record<string, unknown> = { index: 0 };
    let cursor = head;
    for (let i = 1; i < 1000; i += 1) {
      const next: Record<string, unknown> = { index: i };
      cursor['next'] = next;
      cursor = next;
    }
    cursor['next'] = head;
    const rejected = rejectRawSecretPayload(head, 'canonical');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics).toHaveLength(1);
      expect(rejected.diagnostics[0]?.code).toBe('CYCLIC_STRUCTURE');
      expect(rejected.diagnostics[0]?.path).toBe(`canonical${'.next'.repeat(1000)}`);
    }
  });
});

describe('redactForSink cycle containment (broker variant)', () => {
  it('contains a self-referential object cycle as the inert marker, never the original', () => {
    const node: Record<string, unknown> = { keep: 'value' };
    node['self'] = node;
    const redacted = redactForSink(node);
    expect(redacted).not.toBe(node);
    expect(redacted).toEqual({ keep: 'value', self: BROKER_REDACTED_MARKER });
    expect(JSON.stringify(redacted)).toBe(`{"keep":"value","self":"${BROKER_REDACTED_MARKER}"}`);
  });

  it('applies the secret-value pattern rule inside cycles and terminates', () => {
    const node: Record<string, unknown> = {};
    node['notes'] = JWT_STYLE;
    node['self'] = node;
    const redacted = redactForSink(node);
    expect(redacted).toEqual({ notes: BROKER_REDACTED_MARKER, self: BROKER_REDACTED_MARKER });
    expect(JSON.stringify(redacted)).not.toContain('eyJhbGciOi');
  });

  it('contains mutual object/array cycles and preserves the opaque AuthorizationContextRef', () => {
    const obj: Record<string, unknown> = {
      authorizationContextRef: 'authctx/test/1@0',
    };
    const arr: unknown[] = [];
    obj['back'] = arr;
    arr.push(obj);
    const redacted = redactForSink(obj);
    expect(redacted).toEqual({
      authorizationContextRef: 'authctx/test/1@0',
      back: [BROKER_REDACTED_MARKER],
    });
    expect(JSON.stringify(redacted)).toContain('authctx/test/1@0');
  });

  it('repeated shared references without a cycle reuse the sanitized copy, never the original', () => {
    const shared = { notes: 'plain' };
    const redacted = redactForSink({ x: shared, y: shared }) as {
      x: Record<string, unknown>;
      y: Record<string, unknown>;
    };
    expect(redacted).toEqual({ x: { notes: 'plain' }, y: { notes: 'plain' } });
    expect(redacted.x).not.toBe(shared);
    expect(redacted.y).not.toBe(shared);
    expect(redacted.x).toBe(redacted.y);
  });
});

describe('auditContainsSecretSentinel cycle safety', () => {
  it('reports true for a sentinel inside a cyclic graph and terminates', () => {
    const node: Record<string, unknown> = {};
    node['notes'] = `session=${SENTINEL}`;
    node['self'] = node;
    expect(auditContainsSecretSentinel(node, SENTINEL)).toBe(true);

    const cycle: unknown[] = ['entry'];
    cycle.push({ nested: SENTINEL });
    cycle.push(cycle);
    expect(auditContainsSecretSentinel(cycle, SENTINEL)).toBe(true);
  });

  it('reports false for cyclic graphs without the sentinel and for shared clean references', () => {
    const node: Record<string, unknown> = { keep: 'value' };
    node['self'] = node;
    expect(auditContainsSecretSentinel(node, SENTINEL)).toBe(false);

    const cycle: unknown[] = ['entry'];
    cycle.push(cycle);
    expect(auditContainsSecretSentinel(cycle, SENTINEL)).toBe(false);

    const shared = { notes: 'plain' };
    expect(auditContainsSecretSentinel({ x: shared, y: [shared] }, SENTINEL)).toBe(false);
    expect(auditContainsSecretSentinel({ x: shared, y: [shared] }, 'plain')).toBe(true);
  });
});

describe('guardedSinkWrite cycle containment', () => {
  it('a cyclic payload is contained: sanitized acyclic output, no sentinel, opaque ref survives', () => {
    const node: Record<string, unknown> = {};
    node['self'] = node;
    node['cookie'] = SENTINEL;
    node['notes'] = `session=${SENTINEL}`;
    node['authorizationContextRef'] = 'authctx/test/1@0';
    const result = guardedSinkWrite(node, [SENTINEL]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).toContain('[REDACTED]');
      expect(serialized).toContain('authctx/test/1@0');
    }
  });

  it('a mutual array/object cycle writes only inert markers and terminates', () => {
    const obj: Record<string, unknown> = { notes: `session=${SENTINEL}` };
    const arr: unknown[] = [];
    obj['back'] = arr;
    arr.push(obj);
    const result = guardedSinkWrite(obj, [SENTINEL]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized.split('[REDACTED]').length - 1).toBeGreaterThanOrEqual(1);
    }
  });
});
