/**
 * T010 exit-sink redaction cycle containment (issue #72,
 * T010-CTRL-P1-CYCLE-SINK). Cyclic/aliased object graphs at the exit-sink
 * boundary must be contained deterministically: a cycle back-edge becomes
 * the inert redaction marker (never the original reference), shared
 * non-cyclic aliases reuse the sanitized copy, and the sentinel audit
 * terminates with exact answers on any finite graph — while ordinary
 * acyclic behavior (the ANY-type raw-secret rule, sentinel replacement)
 * stays unchanged.
 */

import { describe, expect, it } from 'vitest';
import {
  REDACTED_MARKER,
  auditValueContainsSentinel,
  clearSinkScrubSentinels,
  redactForSink,
  registerSinkScrubSentinel,
} from '../src/index.ts';

const SENTINEL = 'SESSsupersecretcookievalue001';

describe('redactForSink cycle containment', () => {
  it('contains a self-referential object cycle as the inert marker, never the original reference', () => {
    const node: Record<string, unknown> = { keep: 'value' };
    node['self'] = node;
    const redacted = redactForSink(node);
    expect(redacted).not.toBe(node);
    expect(redacted).toEqual({ keep: 'value', self: REDACTED_MARKER });
    // The output is acyclic: serialization terminates.
    expect(JSON.stringify(redacted)).toBe(`{"keep":"value","self":"${REDACTED_MARKER}"}`);
  });

  it('contains a self-referential array cycle and terminates', () => {
    const cycle: unknown[] = ['entry'];
    cycle.push(cycle);
    const redacted = redactForSink(cycle);
    expect(redacted).not.toBe(cycle);
    expect(redacted).toEqual(['entry', REDACTED_MARKER]);
    expect(JSON.stringify(redacted)).toBe(`["entry","${REDACTED_MARKER}"]`);
  });

  it('contains mutual object/array cycles deterministically', () => {
    const obj: Record<string, unknown> = {};
    const arr: unknown[] = [];
    obj['back'] = arr;
    arr.push(obj);
    const redacted = redactForSink(obj);
    expect(redacted).toEqual({ back: [REDACTED_MARKER] });
    expect(JSON.stringify(redacted)).toBe(`{"back":["${REDACTED_MARKER}"]}`);
  });

  it('keeps the ANY-type raw-secret rule inside a cycle', () => {
    const node: Record<string, unknown> = {};
    node['cookie'] = 'raw-cookie-value';
    node['token'] = { nested: 'raw' };
    node['self'] = node;
    const redacted = redactForSink(node);
    expect(redacted).toEqual({
      cookie: REDACTED_MARKER,
      token: REDACTED_MARKER,
      self: REDACTED_MARKER,
    });
    expect(JSON.stringify(redacted)).not.toContain('raw');
  });

  it('contains a sentinel smuggled under a non-secret key inside a cycle', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      const node: Record<string, unknown> = {};
      node['notes'] = `session=${SENTINEL}`;
      node['self'] = node;
      const redacted = redactForSink(node);
      expect(redacted).toEqual({ notes: REDACTED_MARKER, self: REDACTED_MARKER });
      expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
    } finally {
      clearSinkScrubSentinels();
    }
  });

  it('repeated shared references without a cycle are not false positives and never leak the original', () => {
    const shared: Record<string, unknown> = { notes: 'plain' };
    const input = { x: shared, y: shared, z: [shared] };
    const redacted = redactForSink(input) as {
      x: Record<string, unknown>;
      y: Record<string, unknown>;
      z: unknown[];
    };
    expect(redacted).toEqual({
      x: { notes: 'plain' },
      y: { notes: 'plain' },
      z: [{ notes: 'plain' }],
    });
    // No original reference escapes the sanitized output.
    expect(redacted.x).not.toBe(shared);
    expect(redacted.y).not.toBe(shared);
    expect(redacted.z[0]).not.toBe(shared);
    // Deterministic alias preservation: the sanitized copy is reused.
    expect(redacted.x).toBe(redacted.y);
    expect(redacted.z[0]).toBe(redacted.x);
  });

  it('ordinary acyclic behavior is unchanged and the input is not mutated', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      const input = {
        authorizationContextRef: 'authctx/test/1@0',
        cookie: 'raw-cookie-value',
        nested: { deep: { token: 42 } },
        notes: `session=${SENTINEL}`,
        count: 3,
        flag: true,
        missing: null,
        list: ['a', 2, false],
      };
      const snapshot = JSON.stringify(input);
      const redacted = redactForSink(input);
      expect(redacted).toEqual({
        authorizationContextRef: 'authctx/test/1@0',
        cookie: REDACTED_MARKER,
        nested: { deep: { token: REDACTED_MARKER } },
        notes: REDACTED_MARKER,
        count: 3,
        flag: true,
        missing: null,
        list: ['a', 2, false],
      });
      expect(JSON.stringify(input)).toBe(snapshot);
      expect(redacted).not.toBe(input);
    } finally {
      clearSinkScrubSentinels();
    }
  });

  it('a long finite cycle terminates without unbounded recursion', () => {
    const head: Record<string, unknown> = { index: 0 };
    let cursor = head;
    for (let i = 1; i < 1000; i += 1) {
      const next: Record<string, unknown> = { index: i };
      cursor['next'] = next;
      cursor = next;
    }
    cursor['next'] = head;
    const redacted = redactForSink(head) as Record<string, unknown>;
    expect(redacted['index']).toBe(0);
    const serialized = JSON.stringify(redacted);
    // The whole ring is walked exactly once and the single back-edge is cut
    // with exactly one inert marker.
    expect(serialized).toContain('"index":0');
    expect(serialized).toContain('"index":999');
    expect(serialized.split(REDACTED_MARKER).length - 1).toBe(1);
  });
});

describe('auditValueContainsSentinel cycle safety', () => {
  it('reports true for a sentinel inside a cyclic graph and terminates', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      const node: Record<string, unknown> = {};
      node['notes'] = `session=${SENTINEL}`;
      node['self'] = node;
      expect(auditValueContainsSentinel(node)).toBe(true);

      const cycle: unknown[] = ['entry'];
      cycle.push({ nested: SENTINEL });
      cycle.push(cycle);
      expect(auditValueContainsSentinel(cycle)).toBe(true);
    } finally {
      clearSinkScrubSentinels();
    }
  });

  it('reports false for cyclic graphs without sentinel material', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      const node: Record<string, unknown> = { keep: 'value' };
      node['self'] = node;
      expect(auditValueContainsSentinel(node)).toBe(false);

      const cycle: unknown[] = ['entry'];
      cycle.push(cycle);
      expect(auditValueContainsSentinel(cycle)).toBe(false);

      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { back: a };
      a['b'] = b;
      expect(auditValueContainsSentinel(a)).toBe(false);
    } finally {
      clearSinkScrubSentinels();
    }
  });

  it('shared non-cyclic references never produce a false positive', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      const shared = { notes: 'plain' };
      const input = { x: shared, y: shared, z: [shared, shared] };
      expect(auditValueContainsSentinel(input)).toBe(false);
    } finally {
      clearSinkScrubSentinels();
    }
  });

  it('still detects sentinels in ordinary acyclic values', () => {
    registerSinkScrubSentinel(SENTINEL);
    try {
      expect(auditValueContainsSentinel({ a: { b: [`session=${SENTINEL}`] } })).toBe(true);
      expect(auditValueContainsSentinel({ a: { b: ['clean'] } })).toBe(false);
      expect(auditValueContainsSentinel('plain string')).toBe(false);
    } finally {
      clearSinkScrubSentinels();
    }
  });
});
