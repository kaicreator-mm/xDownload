/**
 * T010 allowed_origins enforcement (TEST_MATRIX suite:
 * allowed-origins-enforcement; frozen L2 invariant 14). The broker's own
 * second lock plus the host launch-argument origin resolution.
 */

import { describe, expect, it } from 'vitest';
import { assertOriginAllowed, isOriginAllowed, resolveCallerOrigin } from '../src/index.ts';
import { ALLOWED_EXTENSION_ORIGIN, OTHER_EXTENSION_ORIGIN } from './helpers.ts';

describe('non-allow-listed native messaging origin', () => {
  it('an exactly allow-listed extension origin is accepted', () => {
    const result = assertOriginAllowed(ALLOWED_EXTENSION_ORIGIN, [ALLOWED_EXTENSION_ORIGIN]);
    expect(result.ok).toBe(true);
  });

  it('a non-allow-listed extension origin is rejected with the typed invariant', () => {
    const result = assertOriginAllowed(OTHER_EXTENSION_ORIGIN, [ALLOWED_EXTENSION_ORIGIN]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('ALLOWED_ORIGINS_REJECTED');
      expect(result.diagnostics.some((d) => d.invariant === 'L2-inv14')).toBe(true);
    }
  });

  it('an empty allow list rejects every caller — no empty-match fallback', () => {
    const result = assertOriginAllowed(ALLOWED_EXTENSION_ORIGIN, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.message).toMatch(/empty/i);
    }
  });

  it('malformed origins and wildcard-style entries never match', () => {
    expect(isOriginAllowed('chrome-extension://*/', [ALLOWED_EXTENSION_ORIGIN])).toBe(false);
    expect(isOriginAllowed('https://media.example.org', [ALLOWED_EXTENSION_ORIGIN])).toBe(false);
    expect(isOriginAllowed('chrome-extension://short/', [ALLOWED_EXTENSION_ORIGIN])).toBe(false);
    expect(
      isOriginAllowed(ALLOWED_EXTENSION_ORIGIN, ['chrome-extension://*recommend/'] as const),
    ).toBe(false);
    expect(isOriginAllowed(ALLOWED_EXTENSION_ORIGIN, ['not-an-origin'])).toBe(false);
  });

  it('a malformed configuration entry fails the whole list closed (no loose matching)', () => {
    const result = assertOriginAllowed(ALLOWED_EXTENSION_ORIGIN, [
      ALLOWED_EXTENSION_ORIGIN,
      'wildcard*',
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('host launch-argument origin resolution', () => {
  it('finds the chrome-extension:// caller origin among launch arguments', () => {
    const resolved = resolveCallerOrigin([
      'chrome',
      '--user-data-dir=/tmp/profile',
      ALLOWED_EXTENSION_ORIGIN,
      '--parent-window=0',
    ]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value).toBe(ALLOWED_EXTENSION_ORIGIN);
    }
  });

  it('a host started without an extension origin argument fails closed', () => {
    const resolved = resolveCallerOrigin(['node', 'host.js', '--stdio']);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.diagnostics.map((d) => d.code)).toContain('CALLER_ORIGIN_MISSING');
    }
  });
});
