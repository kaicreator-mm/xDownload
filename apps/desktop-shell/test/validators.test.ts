/**
 * T07 desktop-shell validator tests — the exact fail-closed decoders the IPC
 * handlers and the seam-endpoint resolution use, exercised over hostile and
 * well-formed inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalPipeName,
  decodeInstallCoreBinding,
  decodeLineageRefPayload,
  decodeLoopbackOverride,
  decodePreviewAddPayload,
  decodeUnitPayload,
  isCanonicalPipeName,
} from '../src/main/validators.ts';

describe('decodeUnitPayload', () => {
  it('accepts exactly undefined (the declared payload shape)', () => {
    const result = decodeUnitPayload(undefined);
    expect(result.ok).toBe(true);
  });

  it('refuses any present payload, including null and containers', () => {
    for (const hostile of [null, {}, [], 'x', 0, true, { payload: {} }]) {
      const result = decodeUnitPayload(hostile);
      expect(result.ok, String(JSON.stringify(hostile))).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PAYLOAD_REJECTED');
      }
    }
  });
});

describe('decodeInstallCoreBinding', () => {
  it('accepts a binding whose pipe is the canonical namespace for the install', () => {
    const result = decodeInstallCoreBinding({
      installId: 'xdownload',
      userId: 'user_1',
      pipeName: canonicalPipeName('xdownload'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pipeName).toBe('\\\\.\\pipe\\xdownload-core-xdownload');
    }
  });

  it('refuses a pipe name outside the install canonical namespace', () => {
    const result = decodeInstallCoreBinding({
      installId: 'xdownload',
      userId: 'user_1',
      pipeName: '\\\\.\\pipe\\other-core',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain('canonical');
    }
  });

  it('refuses unknown fields (exact-shape decode, no silent widening)', () => {
    const result = decodeInstallCoreBinding({
      installId: 'xdownload',
      userId: 'user_1',
      pipeName: canonicalPipeName('xdownload'),
      extra: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain('extra');
    }
  });

  it('refuses non-string and seam-invalid peer identities', () => {
    const nonString = decodeInstallCoreBinding({ installId: 7, userId: 'u', pipeName: 'p' });
    expect(nonString.ok).toBe(false);
    const badInstall = decodeInstallCoreBinding({
      installId: '',
      userId: 'user_1',
      pipeName: canonicalPipeName('x'),
    });
    expect(badInstall.ok).toBe(false);
    const badUser = decodeInstallCoreBinding({
      installId: 'xdownload',
      userId: 'has space',
      pipeName: canonicalPipeName('xdownload'),
    });
    expect(badUser.ok).toBe(false);
  });

  it('refuses non-object input', () => {
    expect(decodeInstallCoreBinding(null).ok).toBe(false);
    expect(decodeInstallCoreBinding('core').ok).toBe(false);
    expect(decodeInstallCoreBinding([]).ok).toBe(false);
  });
});

describe('decodeLoopbackOverride', () => {
  it('accepts loopback hosts with a numeric port', () => {
    for (const raw of ['127.0.0.1:41234', 'localhost:1', '::1:65535']) {
      const result = decodeLoopbackOverride(raw);
      expect(result.ok, raw).toBe(true);
    }
  });

  it('refuses non-loopback hosts (the local seam is same-host only)', () => {
    for (const raw of ['192.168.1.10:41234', 'example.com:80', '0.0.0.0:8080']) {
      const result = decodeLoopbackOverride(raw);
      expect(result.ok, raw).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OVERRIDE_REFUSED');
      }
    }
  });

  it('refuses malformed or out-of-range ports', () => {
    for (const raw of [
      '127.0.0.1',
      '127.0.0.1:',
      '127.0.0.1:abc',
      '127.0.0.1:0',
      '127.0.0.1:99999',
    ]) {
      const result = decodeLoopbackOverride(raw);
      expect(result.ok, raw).toBe(false);
    }
  });
});

describe('canonicalPipeName', () => {
  it('mirrors the install-host pipe namespace rule', () => {
    expect(canonicalPipeName('abc')).toBe('\\\\.\\pipe\\xdownload-core-abc');
    expect(isCanonicalPipeName(canonicalPipeName('abc'), 'abc')).toBe(true);
    expect(isCanonicalPipeName(canonicalPipeName('abc'), 'other')).toBe(false);
  });
});

describe('decodePreviewAddPayload', () => {
  it('accepts exactly { url } and { url, destination }', () => {
    const bare = decodePreviewAddPayload({ url: 'https://example.com/a.mp4' });
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.value.url).toBe('https://example.com/a.mp4');
      expect(bare.value.destination).toBeUndefined();
    }
    const withDestination = decodePreviewAddPayload({
      url: 'http://127.0.0.1:8000/x',
      destination: 'C:/downloads',
    });
    expect(withDestination.ok).toBe(true);
    if (withDestination.ok) {
      expect(withDestination.value.destination).toBe('C:/downloads');
    }
  });

  it('refuses non-objects, unknown fields and hostile url shapes', () => {
    for (const hostile of [
      undefined,
      null,
      'https://example.com/a.mp4',
      [],
      { url: 'https://example.com/a.mp4', extra: 1 },
      { url: '' },
      { url: 42 },
      { url: 'https://e.com/x\n' },
      { url: 'ftp://example.com/a' },
      { url: 'https://example.com/a.mp4', destination: 7 },
      { url: 'https://example.com/' + 'a'.repeat(2100) },
    ]) {
      const result = decodePreviewAddPayload(hostile);
      expect(result.ok, JSON.stringify(hostile) ?? 'undefined').toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PAYLOAD_REJECTED');
      }
    }
  });
});

describe('decodeLineageRefPayload', () => {
  it('accepts exactly { lineageId } with an opaque bounded identity', () => {
    const result = decodeLineageRefPayload({
      lineageId: 'contract-desktop-ab12cd34-000001',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lineageId).toBe('contract-desktop-ab12cd34-000001');
    }
  });

  it('refuses non-objects, unknown fields and non-opaque identities', () => {
    for (const hostile of [
      undefined,
      null,
      {},
      { lineageId: 'x', extra: 1 },
      { lineageId: '' },
      { lineageId: 9 },
      { lineageId: 'has space' },
      { lineageId: 'line\tx' },
      { lineageId: 'x'.repeat(129) },
    ]) {
      const result = decodeLineageRefPayload(hostile);
      expect(result.ok, JSON.stringify(hostile) ?? 'undefined').toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PAYLOAD_REJECTED');
      }
    }
  });
});
