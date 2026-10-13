/**
 * #95 shipped-entrypoint S2 glue tests — the pure boundary logic of the
 * production service worker (no chrome runtime needed for these units):
 *
 * - the extension-internal selection decoder fails closed on unknown
 *   fields, forged kinds, missing/invalid declared digests and unbounded
 *   values; a well-formed explicit decision decodes;
 * - Native Messaging frame encoding is the exact 4-byte little-endian
 *   length-prefix + JSON shape the native host decodes;
 * - base64 chunking respects the 4096-char seam string bound.
 *
 * The full installed journey (popup → service worker → native host → Core)
 * is exercised by the real-browser validation (T022/#95 real-host legs);
 * these units pin the boundary shapes that journey depends on.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeInternalS2Message,
  encodeNativeFrame,
  toBase64Chunks,
} from '../src/background/s2-glue.ts';

const VALID_SELECTION = {
  kind: 'S2_SELECT_ATTACHMENT',
  tabId: 42,
  linkUrl: 'http://127.0.0.1:43181/s2/private-attachment.bin',
  linkText: 'Download explicit attachment',
  expectedSha256: 'a'.repeat(64),
};

describe('#95 service-worker internal S2 boundary', () => {
  it('decodes a well-formed explicit user selection', () => {
    const decoded = decodeInternalS2Message(VALID_SELECTION);
    expect(decoded.ok).toBe(true);
  });

  it('fails closed on unknown fields, forged kinds and non-object payloads', () => {
    expect(decodeInternalS2Message(null).ok).toBe(false);
    expect(decodeInternalS2Message('x').ok).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, smuggled: 'grant' }).ok).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, kind: 'AUTH_ISSUE' }).ok).toBe(false);
  });

  it('requires the declared SHA-256 anchor (frozen validation contract) and http(s) locator', () => {
    expect(decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: '' }).ok).toBe(false);
    expect(
      decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: 'zz'.repeat(32) }).ok,
    ).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, linkUrl: 'file:///etc/passwd' }).ok).toBe(
      false,
    );
    expect(decodeInternalS2Message({ ...VALID_SELECTION, tabId: 1.5 }).ok).toBe(false);
  });

  it('encodes Native Messaging frames with the exact 4-byte LE length prefix', () => {
    const message = { kind: 'S2_ACQUIRE' };
    const buffer = encodeNativeFrame(message);
    const view = new Uint8Array(buffer);
    const length = new DataView(view.buffer).getUint32(0, true);
    expect(length).toBe(view.length - 4);
    const payload = new TextDecoder().decode(view.subarray(4));
    expect(JSON.parse(payload)).toEqual(message);
  });

  it('chunks base64 within the 4096-char seam string bound', () => {
    const bytes = new Uint8Array(64 * 1024).map((_, index) => index & 0xff);
    const chunks = toBase64Chunks(bytes);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      expect(chunk.length).toBeGreaterThan(0);
    }
    // Round-trip: the concatenation decodes back to the exact bytes.
    const whole = chunks.join('');
    const binary = atob(whole);
    const decoded = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      decoded[index] = binary.charCodeAt(index);
    }
    expect(decoded).toEqual(bytes);
  });
});
