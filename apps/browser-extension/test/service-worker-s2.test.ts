/**
 * #95 shipped-entrypoint S2 glue tests — the pure boundary logic of the
 * production service worker (no chrome runtime needed for these units):
 *
 * - the extension-internal selection decoder fails closed on unknown
 *   fields, forged kinds, malformed optional digests and unbounded values;
 *   a well-formed explicit decision decodes — with OR without the optional
 *   known-digest strengthening (F01: the digest never gates selection), and
 *   always with the observed page URL the journey re-verifies (F03);
 * - the streaming slab encoder emits quantum-aligned 768 KiB base64 slabs
 *   from arbitrary body chunks with bounded memory (F04);
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
  createS2SlabEncoder,
  decodeInternalS2Message,
  encodeNativeFrame,
  MAX_S2_ATTACHMENT_BYTES,
  S2_NM_CHUNK_BYTES,
  toBase64Chunks,
} from '../src/background/s2-glue.ts';

const VALID_SELECTION = {
  kind: 'S2_SELECT_ATTACHMENT',
  tabId: 42,
  pageUrl: 'http://127.0.0.1:43181/s2/page',
  linkUrl: 'http://127.0.0.1:43181/s2/private-attachment.bin',
  linkText: 'Download explicit attachment',
};

function decodeB64(whole: string): Uint8Array {
  const binary = atob(whole);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

describe('#95 service-worker internal S2 boundary', () => {
  it('decodes a well-formed explicit user selection without any declared digest (F01 default path)', () => {
    const decoded = decodeInternalS2Message(VALID_SELECTION);
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.kind === 'S2_SELECT_ATTACHMENT') {
      expect(decoded.value.expectedSha256).toBeUndefined();
      expect(decoded.value.pageUrl).toBe(VALID_SELECTION.pageUrl);
    }
  });

  it('decodes a selection carrying the optional known-digest strengthening', () => {
    const decoded = decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: 'a'.repeat(64) });
    expect(decoded.ok).toBe(true);
  });

  it('fails closed on unknown fields, forged kinds and non-object payloads', () => {
    expect(decodeInternalS2Message(null).ok).toBe(false);
    expect(decodeInternalS2Message('x').ok).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, smuggled: 'grant' }).ok).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, kind: 'AUTH_ISSUE' }).ok).toBe(false);
  });

  it('a malformed optional digest still fails closed; the digest is never required (F01)', () => {
    expect(decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: '' }).ok).toBe(false);
    expect(
      decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: 'zz'.repeat(32) }).ok,
    ).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, expectedSha256: 'A'.repeat(64) }).ok).toBe(
      false,
    );
  });

  it('requires the observed page URL and an http(s) link locator (F03 provenance grounding)', () => {
    const withoutPage = { ...VALID_SELECTION } as Record<string, unknown>;
    delete withoutPage['pageUrl'];
    expect(decodeInternalS2Message(withoutPage).ok).toBe(false);
    expect(decodeInternalS2Message({ ...VALID_SELECTION, pageUrl: 'javascript:alert(1)' }).ok).toBe(
      false,
    );
    expect(decodeInternalS2Message({ ...VALID_SELECTION, linkUrl: 'file:///etc/passwd' }).ok).toBe(
      false,
    );
    expect(decodeInternalS2Message({ ...VALID_SELECTION, tabId: 1.5 }).ok).toBe(false);
  });

  it('a cross-origin selected member (provenance-bound CDN) is admissible (F03)', () => {
    const decoded = decodeInternalS2Message({
      ...VALID_SELECTION,
      linkUrl: 'https://cdn.example.net/attachments/invoice.pdf',
    });
    expect(decoded.ok).toBe(true);
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
    expect(decodeB64(chunks.join(''))).toEqual(bytes);
  });

  it('the declared S2 bound is 64 MiB and NM slabs carry 768 KiB raw (F04 declared limits)', () => {
    expect(MAX_S2_ATTACHMENT_BYTES).toBe(64 * 1024 * 1024);
    expect(S2_NM_CHUNK_BYTES).toBe(786_432);
    // The slab is a whole number of base64 quanta: non-final slabs never pad.
    expect(S2_NM_CHUNK_BYTES % 3).toBe(0);
  });
});

describe('#95 streaming slab encoder (F04: bounded memory, quantum-aligned slabs)', () => {
  // Two full slabs of real encode + a byte-exact deep compare over 1.7 MB:
  // heavy enough that full-suite contention can push it past the 5 s default
  // (observed 8.2 s), so the timeout is declared explicitly.
  it('streams an unaligned trickle into aligned slabs with a correct final slab', () => {
    const total = S2_NM_CHUNK_BYTES * 2 + 123_457;
    const source = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) {
      source[index] = (index * 131 + 17) & 0xff;
    }
    const encoder = createS2SlabEncoder();
    const slabs: string[] = [];
    let offset = 0;
    while (offset < total) {
      const step = Math.min(65_537, total - offset); // odd trickle sizes
      slabs.push(...encoder.push(source.subarray(offset, offset + step)));
      offset += step;
    }
    expect(encoder.totalBytes).toBe(total);
    const final = encoder.flush();
    if (final !== undefined) {
      slabs.push(final);
    }
    // Two full slabs plus the final partial one.
    expect(slabs.length).toBe(3);
    expect(slabs[0]!.length).toBe((S2_NM_CHUNK_BYTES / 3) * 4);
    expect(slabs[0]!.endsWith('=')).toBe(false);
    expect(slabs[1]!.endsWith('=')).toBe(false);
    // The whole stream round-trips byte-exactly.
    expect(decodeB64(slabs.join(''))).toEqual(source);
  }, 20_000);

  it('emits exactly one slab for a body of exactly one slab size', () => {
    const encoder = createS2SlabEncoder();
    const slabs = encoder.push(new Uint8Array(S2_NM_CHUNK_BYTES).fill(7));
    expect(slabs.length).toBe(1);
    expect(encoder.flush()).toBeUndefined();
  });

  it('flush on an empty stream emits nothing; double flush throws', () => {
    const encoder = createS2SlabEncoder();
    expect(encoder.flush()).toBeUndefined();
    expect(() => encoder.flush()).toThrow();
  });

  it('push after flush throws (protocol misuse fails closed)', () => {
    const encoder = createS2SlabEncoder();
    encoder.flush();
    expect(() => encoder.push(new Uint8Array(4))).toThrow();
  });
});
