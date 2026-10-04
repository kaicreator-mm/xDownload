/**
 * T010 untrusted-input gate (TEST_MATRIX suite:
 * oversized-and-malformed-message-boundary plus negative cases
 * `unknown-authoritative-field-in-untrusted-message`,
 * `unprovenanced-observation-promoted-to-privilege`; frozen L2 invariant 11).
 */

import { describe, expect, it } from 'vitest';
import { decodeUntrustedContentMessage } from '../src/index.ts';

const PROVENANCE = {
  tabId: 7,
  frameId: 0,
  origin: 'https://media.example.org',
};

const VALID_PAGE_MESSAGE = {
  boundary: 'CONTENT_SCRIPT',
  kind: 'PAGE_CONTEXT',
  provenance: PROVENANCE,
  payload: { pageUrl: 'https://media.example.org/watch/1', title: 'Example' },
};

const VALID_NETWORK_MESSAGE = {
  boundary: 'CONTENT_SCRIPT',
  kind: 'NETWORK_OBSERVATION',
  provenance: { ...PROVENANCE, requestRef: 'req-0042' },
  payload: { requestUrl: 'https://cdn.example.org/seg-1.ts', requestMethod: 'GET' },
};

describe('gate positives: observation submissions pass', () => {
  it('accepts a well-formed page observation with full provenance', () => {
    const gated = decodeUntrustedContentMessage(VALID_PAGE_MESSAGE);
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.kind).toBe('PAGE_CONTEXT');
    expect(gated.value.provenance.tabId).toBe(7);
    expect(gated.value.provenance.origin).toBe('https://media.example.org');
  });

  it('accepts a network observation carrying request provenance', () => {
    const gated = decodeUntrustedContentMessage(VALID_NETWORK_MESSAGE);
    expect(gated.ok).toBe(true);
  });

  it('loopback http origins are accepted for local fixture pages only', () => {
    const gated = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      provenance: { ...PROVENANCE, origin: 'http://localhost:8899' },
    });
    expect(gated.ok).toBe(true);
  });
});

describe('oversized and malformed messages fail closed before privilege', () => {
  it('oversized messages are rejected by the explicit byte bound', () => {
    const big = {
      ...VALID_PAGE_MESSAGE,
      payload: { pageUrl: 'https://media.example.org/x', title: 'y'.repeat(4096) },
    };
    const gated = decodeUntrustedContentMessage(big, { maxBytes: 1024 });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.diagnostics.map((d) => d.code)).toContain('OBSERVATION_OVERSIZED');
      expect(gated.diagnostics.some((d) => d.invariant === 'L2-inv11')).toBe(true);
    }
  });

  it('malformed messages (non-object) are rejected with typed diagnostics', () => {
    expect(decodeUntrustedContentMessage('a string').ok).toBe(false);
    expect(decodeUntrustedContentMessage(42).ok).toBe(false);
    expect(decodeUntrustedContentMessage(null).ok).toBe(false);
    const gated = decodeUntrustedContentMessage([VALID_PAGE_MESSAGE]);
    expect(gated.ok).toBe(false);
  });

  it('unknown-authoritative-field-in-untrusted-message is rejected', () => {
    const gated = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      grantNativeAuthority: true,
    });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.diagnostics.map((d) => d.code)).toContain('UNKNOWN_FIELD');
    }
  });

  it('payload fields outside the kind-allowed set are rejected', () => {
    const gated = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      payload: { requestUrl: 'https://cdn.example.org/x' },
    });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.diagnostics.map((d) => d.code)).toContain('UNKNOWN_FIELD');
    }
  });

  it('malformed provenance (bad origin, negative ids) fails closed', () => {
    const badOrigin = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      provenance: { ...PROVENANCE, origin: 'https://*.example.org' },
    });
    expect(badOrigin.ok).toBe(false);
    const negativeTab = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      provenance: { ...PROVENANCE, tabId: -1 },
    });
    expect(negativeTab.ok).toBe(false);
  });
});

describe('the untrusted content boundary cannot invoke privileged actions', () => {
  it('a forged privileged boundary label is a typed privilege-escalation rejection', () => {
    const gated = decodeUntrustedContentMessage({
      boundary: 'PRIVILEGED_EXTENSION',
      kind: 'PAGE_CONTEXT',
      provenance: PROVENANCE,
      payload: { pageUrl: 'https://media.example.org/' },
    });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.diagnostics.map((d) => d.code)).toContain('PRIVILEGE_ESCALATION_REJECTED');
    }
  });

  it('an AUTH/NATIVE command kind from the content boundary is rejected outright', () => {
    const gated = decodeUntrustedContentMessage({
      boundary: 'CONTENT_SCRIPT',
      kind: 'AUTH_USE',
      provenance: PROVENANCE,
      payload: {},
    });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.diagnostics.map((d) => d.code)).toContain('PRIVILEGE_ESCALATION_REJECTED');
    }
  });

  it('unprovenanced-observation-promoted-to-privilege: missing provenance fails closed', () => {
    const gated = decodeUntrustedContentMessage({
      boundary: 'CONTENT_SCRIPT',
      kind: 'PAGE_CONTEXT',
      payload: { pageUrl: 'https://media.example.org/' },
    });
    expect(gated.ok).toBe(false);
  });

  it('raw-secret fields can never cross the untrusted boundary', () => {
    const topLevel = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      cookie: 'SESS=abc',
    });
    expect(topLevel.ok).toBe(false);
    if (!topLevel.ok) {
      expect(topLevel.diagnostics.map((d) => d.code)).toContain('RAW_SECRET_FIELD');
    }
    const nested = decodeUntrustedContentMessage({
      ...VALID_PAGE_MESSAGE,
      payload: { pageUrl: 'https://media.example.org/', token: 'jwt.value.here' },
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(nested.diagnostics.map((d) => d.code)).toContain('RAW_SECRET_FIELD');
    }
  });
});
