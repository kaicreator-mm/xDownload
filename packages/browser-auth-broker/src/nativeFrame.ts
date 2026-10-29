/**
 * T010 Native Messaging framing codec (Chrome Native Messaging wire format:
 * 4-byte native-order length prefix + UTF-8 JSON payload).
 *
 * Every frame is size-bounded BEFORE any payload handling: oversized frames
 * are rejected without parsing, malformed frames (bad length, invalid JSON,
 * non-object payload) are rejected with typed diagnostics. There is no code
 * path in this module that executes a command, grants authority or stores
 * state — the codec only moves validated JSON objects across the wire
 * boundary (frozen L2 §6.4 "schema/size-bound all page/content messages
 * before privilege").
 */

import { brokerDiagnostic, brokerFail, brokerOk, type BrokerResult } from './result.ts';

/** Chrome caps host→browser messages at 1 MiB; the host enforces it symmetrically. */
export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

/** Chrome caps browser→host messages at 4 GiB; the broker enforces a saner local bound. */
export const DEFAULT_MAX_INBOUND_FRAME_BYTES = 64 * 1024 * 1024;

const LENGTH_PREFIX_BYTES = 4;

/** Encode one JSON message into the Native Messaging frame format. */
export function encodeFrame(
  message: unknown,
  maxBytes = DEFAULT_MAX_FRAME_BYTES,
): BrokerResult<Uint8Array> {
  let payload;
  try {
    payload = new TextEncoder().encode(JSON.stringify(message));
  } catch {
    return brokerFail([
      brokerDiagnostic('NATIVE_MESSAGE_MALFORMED', 'frame', 'message is not JSON-serializable'),
    ]);
  }
  if (payload.length > maxBytes) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_OVERSIZED',
        'frame',
        `encoded message of ${payload.length} bytes exceeds the ${maxBytes}-byte Native Messaging bound`,
        'L2-inv11',
      ),
    ]);
  }
  const frame = new Uint8Array(LENGTH_PREFIX_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  // Native byte order of the tested tuple (x86-64/arm64 little-endian); the
  // exact tested tuple stays recorded in T010 validation evidence.
  view.setUint32(0, payload.length, true);
  frame.set(payload, LENGTH_PREFIX_BYTES);
  return brokerOk(frame);
}

export interface DecodedFrame<T = Record<string, unknown>> {
  readonly payload: T;
  readonly byteLength: number;
}

/**
 * Decode one Native Messaging frame: length prefix validation, explicit size
 * bound, UTF-8 JSON decode and object-shape check — all fail closed before
 * the payload reaches any privileged handler.
 */
export function decodeFrame<T = Record<string, unknown>>(
  frame: Uint8Array,
  maxBytes: number = DEFAULT_MAX_INBOUND_FRAME_BYTES,
): BrokerResult<DecodedFrame<T>> {
  if (frame.length < LENGTH_PREFIX_BYTES) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_MALFORMED',
        'frame.length',
        'frame is shorter than the 4-byte Native Messaging length prefix',
        'L2-inv11',
      ),
    ]);
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const payloadLength = view.getUint32(0, true);
  if (payloadLength > maxBytes) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_OVERSIZED',
        'frame.length',
        `declared payload length ${payloadLength} exceeds the ${maxBytes}-byte bound; rejected before parse`,
        'L2-inv11',
      ),
    ]);
  }
  if (frame.length - LENGTH_PREFIX_BYTES < payloadLength) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_MALFORMED',
        'frame',
        `truncated frame: declared ${payloadLength} bytes but only ${frame.length - LENGTH_PREFIX_BYTES} present`,
        'L2-inv11',
      ),
    ]);
  }
  const payloadBytes = frame.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + payloadLength);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch {
    return brokerFail([
      brokerDiagnostic('NATIVE_MESSAGE_MALFORMED', 'frame', 'frame payload is not valid UTF-8'),
    ]);
  }
  let parsed;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return brokerFail([
      brokerDiagnostic('NATIVE_MESSAGE_MALFORMED', 'frame', 'frame payload is not valid JSON'),
    ]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return brokerFail([
      brokerDiagnostic('NATIVE_MESSAGE_MALFORMED', 'frame', 'frame payload must be a JSON object'),
    ]);
  }
  return brokerOk(Object.freeze({ payload: parsed as T, byteLength: payloadLength }));
}
