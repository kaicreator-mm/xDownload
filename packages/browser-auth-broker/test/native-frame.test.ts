/**
 * T010 Native Messaging framing boundary (TEST_MATRIX suite:
 * oversized-and-malformed-message-boundary). Protocol-level builder
 * evidence; the real-tuple proof belongs to T010 concern Validation.
 */

import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame } from '../src/index.ts';

function frameFrom(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const frame = new Uint8Array(4 + bytes.length);
  new DataView(frame.buffer).setUint32(0, bytes.length, true);
  frame.set(bytes, 4);
  return frame;
}

describe('native frame codec', () => {
  it('round-trips a valid JSON message', () => {
    const message = { kind: 'AUTH_USE', requestId: 'r-1' };
    const encoded = encodeFrame(message);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = decodeFrame(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.payload).toEqual(message);
    expect(decoded.value.byteLength).toBeGreaterThan(0);
  });

  it('oversized-native-message: rejects before parse when declared length exceeds the bound', () => {
    const frame = new Uint8Array(4);
    new DataView(frame.buffer).setUint32(0, 1024 * 1024, true); // declares 1 MiB payload
    const decoded = decodeFrame(frame, 64 * 1024);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.diagnostics.map((d) => d.code)).toContain('NATIVE_MESSAGE_OVERSIZED');
      expect(decoded.diagnostics.some((d) => d.invariant === 'L2-inv11')).toBe(true);
    }
  });

  it('oversized outbound messages cannot be encoded either', () => {
    const big = { blob: 'x'.repeat(2048) };
    const encoded = encodeFrame(big, 1024);
    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.diagnostics.map((d) => d.code)).toContain('NATIVE_MESSAGE_OVERSIZED');
    }
  });

  it('malformed-native-message: truncated frames, invalid UTF-8, invalid JSON and non-objects all fail closed', () => {
    const short = decodeFrame(new Uint8Array([1, 2, 3]));
    expect(short.ok).toBe(false);

    const declaredButTruncated = new Uint8Array(4);
    new DataView(declaredButTruncated.buffer).setUint32(0, 100, true);
    const truncated = decodeFrame(declaredButTruncated);
    expect(truncated.ok).toBe(false);

    const invalidUtf8 = frameFrom(new Uint8Array([0xff, 0xfe, 0xfd]));
    const utf8 = decodeFrame(invalidUtf8);
    expect(utf8.ok).toBe(false);

    const notJson = frameFrom('not json at all');
    const json = decodeFrame(notJson);
    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.diagnostics.map((d) => d.code)).toContain('NATIVE_MESSAGE_MALFORMED');
    }

    const notAnObject = frameFrom('[1,2,3]');
    const array = decodeFrame(notAnObject);
    expect(array.ok).toBe(false);
  });
});
