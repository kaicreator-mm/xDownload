/**
 * #95 R1/F04 — chunked S2 delivery across Native Messaging.
 *
 * Bytes never ride the S2_ACQUIRE frame itself: the browser lane streams
 * bounded base64 slab frames which the host session reassembles with strict
 * stream semantics (contiguous seq, canonical base64, padding only at the
 * stream end, declared-byte-count match, the declared 64 MiB assembly bound
 * enforced while staging). The installed lane runs only after S2_ACQUIRE_END
 * verifies the assembled stream. Every protocol violation fails closed with
 * a typed rejection and never reaches the lane.
 */

import { describe, expect, it } from 'vitest';
import {
  establishNativeHostSession,
  MAX_S2_ASSEMBLY_BYTES,
  S2_NM_CHUNK_MAX_CHARS,
  type BrokerResponse,
  type S2AcquireCommandShape,
} from '../src/index.ts';
import { ALLOWED_EXTENSION_ORIGIN, brokerWith, fixedClock } from './helpers.ts';

const META = {
  handoff: {
    kind: 'NETWORK_OBSERVATION',
    provenanceKey: 't42|f0|http://127.0.0.1:43181|obs-1',
    origin: 'http://127.0.0.1:43181',
    payload: { requestUrl: 'http://127.0.0.1:43181/f.bin', requestMethod: 'GET' },
    capturedAtMs: 1_700_000_000_000,
    authority: 'EVIDENCE_INPUT_ONLY',
  },
  decisionToken: 'user-confirm:obs-1',
  ttlMs: 60_000,
  delivery: { locatorUri: 'http://127.0.0.1:43181/f.bin' },
  browserResponse: { finalUrl: 'http://127.0.0.1:43181/f.bin', status: 200 },
};

interface CapturedLane {
  readonly commands: S2AcquireCommandShape[];
}

function sessionWithLane(options?: { readonly lane?: undefined }): {
  readonly handle: (message: unknown) => Promise<BrokerResponse>;
  readonly captured: CapturedLane;
} {
  const captured: CapturedLane = { commands: [] };
  const established = establishNativeHostSession({
    argv: ['chrome', ALLOWED_EXTENSION_ORIGIN, '--parent-window=0'],
    allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    broker: brokerWith(fixedClock()),
    ...(options?.lane === undefined
      ? {
          s2Lane: {
            handle: (command: S2AcquireCommandShape): Promise<BrokerResponse> => {
              captured.commands.push(command);
              return Promise.resolve({
                kind: 'S2_RESULT',
                requestId: command.requestId,
                contractId: 'contract-s2-test',
                terminal: { requestFulfillment: 'COMPLETE' },
                authorizationContextRef: 'authctx/test',
              });
            },
          },
        }
      : {}),
  });
  expect(established.ok).toBe(true);
  if (!established.ok) throw new Error('unreachable');
  const session = established.value;
  return {
    captured,
    handle: async (message: unknown) => {
      const result = await session.handleMessage(message);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      return result.value;
    },
  };
}

/** base64 slabs of the exact NM wire shape (≤ S2_NM_CHUNK_MAX_CHARS, aligned). */
function nmChunks(bytes: Uint8Array): string[] {
  const whole = Buffer.from(bytes).toString('base64');
  const chunks: string[] = [];
  for (let index = 0; index < whole.length; index += S2_NM_CHUNK_MAX_CHARS) {
    chunks.push(whole.slice(index, index + S2_NM_CHUNK_MAX_CHARS));
  }
  return chunks;
}

async function drive(
  handle: (message: unknown) => Promise<BrokerResponse>,
  requestId: string,
  chunks: readonly string[],
  byteCount?: number,
): Promise<BrokerResponse> {
  const accepted = await handle({
    kind: 'S2_ACQUIRE',
    requestId,
    s2: { ...META, ...(byteCount === undefined ? {} : { byteCount }) },
  });
  expect(accepted.kind).toBe('S2_ACQUIRE_ACCEPTED');
  for (let index = 0; index < chunks.length; index += 1) {
    const ack = await handle({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId,
      seq: index,
      data: chunks[index],
    });
    expect(ack.kind).toBe('S2_CHUNK_ACK');
    if (ack.kind === 'S2_CHUNK_ACK') {
      expect(ack.seq).toBe(index);
    }
  }
  return handle({ kind: 'S2_ACQUIRE_END', requestId });
}

describe('#95 R1/F04 native-host chunked S2 delivery', () => {
  it('assembles a multi-slab stream and invokes the lane with the verified byte stream', async () => {
    const { handle, captured } = sessionWithLane();
    const bytes = new Uint8Array(2_400_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (index * 17 + 5) & 0xff;
    }
    const chunks = nmChunks(bytes);
    expect(chunks.length).toBeGreaterThan(1); // multiple NM slab frames
    const result = await drive(handle, 'req-1', chunks, bytes.length);
    expect(result.kind).toBe('S2_RESULT');
    expect(captured.commands.length).toBe(1);
    const payloadBytes = captured.commands[0]!.payload['bytes'];
    expect(Array.isArray(payloadBytes)).toBe(true);
    const assembled = Buffer.concat(
      (payloadBytes as string[]).map((chunk) => Buffer.from(chunk, 'base64')),
    );
    expect(assembled.length).toBe(bytes.length);
    expect(Buffer.compare(assembled, Buffer.from(bytes))).toBe(0);
    // The lane receives seam-bounded strings (≤4096 chars).
    for (const chunk of payloadBytes as string[]) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('a small attachment crosses as one slab; byteCount verification passes', async () => {
    const { handle, captured } = sessionWithLane();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await drive(handle, 'req-small', nmChunks(bytes), bytes.length);
    expect(result.kind).toBe('S2_RESULT');
    expect(captured.commands.length).toBe(1);
  });

  it('fails closed: chunk before begin, seq skip, and double begin are rejected', async () => {
    const { handle } = sessionWithLane();
    const orphan = await handle({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'nope',
      seq: 0,
      data: 'AAAA',
    });
    expect(orphan.kind).toBe('REJECTED');

    const accepted = await handle({ kind: 'S2_ACQUIRE', requestId: 'req-2', s2: { ...META } });
    expect(accepted.kind).toBe('S2_ACQUIRE_ACCEPTED');
    const skipped = await handle({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'req-2',
      seq: 1,
      data: 'AAAA',
    });
    expect(skipped.kind).toBe('REJECTED');
    const duplicate = await handle({ kind: 'S2_ACQUIRE', requestId: 'req-2', s2: { ...META } });
    expect(duplicate.kind).toBe('REJECTED');
  });

  it('fails closed: END with a byte-count mismatch, empty stream, or interior padding is rejected and never reaches the lane', async () => {
    const { handle, captured } = sessionWithLane();
    // Declared 8 bytes but only 4 delivered.
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const accepted = await handle({
      kind: 'S2_ACQUIRE',
      requestId: 'req-3',
      s2: { ...META, byteCount: 8 },
    });
    expect(accepted.kind).toBe('S2_ACQUIRE_ACCEPTED');
    await handle({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'req-3',
      seq: 0,
      data: nmChunks(bytes)[0],
    });
    const mismatch = await handle({ kind: 'S2_ACQUIRE_END', requestId: 'req-3' });
    expect(mismatch.kind).toBe('REJECTED');

    // Empty stream.
    const empty = await handle({ kind: 'S2_ACQUIRE', requestId: 'req-4', s2: { ...META } });
    expect(empty.kind).toBe('S2_ACQUIRE_ACCEPTED');
    const emptyEnd = await handle({ kind: 'S2_ACQUIRE_END', requestId: 'req-4' });
    expect(emptyEnd.kind).toBe('REJECTED');

    // Interior padding (a non-final chunk terminates a quantum early).
    const padded = await handle({ kind: 'S2_ACQUIRE', requestId: 'req-5', s2: { ...META } });
    expect(padded.kind).toBe('S2_ACQUIRE_ACCEPTED');
    await handle({ kind: 'S2_ACQUIRE_CHUNK', requestId: 'req-5', seq: 0, data: 'AQ==' });
    await handle({ kind: 'S2_ACQUIRE_CHUNK', requestId: 'req-5', seq: 1, data: 'AQID' });
    const interior = await handle({ kind: 'S2_ACQUIRE_END', requestId: 'req-5' });
    expect(interior.kind).toBe('REJECTED');
    expect(captured.commands.length).toBe(0);
  });

  it('a legal final-chunk padding crosses (canonical base64 stream end)', async () => {
    const { handle, captured } = sessionWithLane();
    const bytes = new Uint8Array([1]); // one byte → final chunk is padded ('AQ==')
    const result = await drive(handle, 'req-pad', nmChunks(bytes), bytes.length);
    expect(result.kind).toBe('S2_RESULT');
    expect(captured.commands.length).toBe(1);
  });

  it('malformed chunk frames reject at decode (charset, alignment, unknown fields, oversize byteCount)', async () => {
    const session = establishedForDecode();
    const badCharset = await session.handleMessage({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'r',
      seq: 0,
      data: 'A!A=',
    });
    expect(badCharset.ok).toBe(false);
    const unaligned = await session.handleMessage({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'r',
      seq: 0,
      data: 'AAA',
    });
    expect(unaligned.ok).toBe(false);
    const unknownField = await session.handleMessage({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'r',
      seq: 0,
      data: 'AAAA',
      exec: 'rm -rf',
    });
    expect(unknownField.ok).toBe(false);
    const tooBig = await session.handleMessage({
      kind: 'S2_ACQUIRE',
      requestId: 'r',
      s2: { ...META, byteCount: MAX_S2_ASSEMBLY_BYTES + 1 },
    });
    expect(tooBig.ok).toBe(false);
  });

  it('the declared 64 MiB assembly bound is enforced while staging, before further buffering', async () => {
    const { handle } = sessionWithLane();
    const accepted = await handle({ kind: 'S2_ACQUIRE', requestId: 'req-big', s2: { ...META } });
    expect(accepted.kind).toBe('S2_ACQUIRE_ACCEPTED');
    // 768 KiB raw per slab → 1,048,576 base64 chars; 86 slabs cross 64 MiB.
    const slab = 'A'.repeat(S2_NM_CHUNK_MAX_CHARS);
    let last: BrokerResponse | undefined;
    for (let index = 0; index < 86; index += 1) {
      last = await handle({
        kind: 'S2_ACQUIRE_CHUNK',
        requestId: 'req-big',
        seq: index,
        data: slab,
      });
      if (last.kind === 'REJECTED') {
        break;
      }
    }
    expect(last).toBeDefined();
    expect(last!.kind).toBe('REJECTED');
    if (last!.kind === 'REJECTED') {
      expect(JSON.stringify(last!)).toContain(String(MAX_S2_ASSEMBLY_BYTES));
    }
  }, 30_000);

  it('without a configured lane, all chunked-delivery frames fail closed (S2_LANE_UNAVAILABLE)', async () => {
    const established = establishNativeHostSession({
      argv: ['chrome', ALLOWED_EXTENSION_ORIGIN, '--parent-window=0'],
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
      broker: brokerWith(fixedClock()),
    });
    expect(established.ok).toBe(true);
    if (!established.ok) throw new Error('unreachable');
    const session = established.value;
    const acquire = await session.handleMessage({ kind: 'S2_ACQUIRE', requestId: 'x', s2: META });
    expect(acquire.ok && acquire.value.kind === 'REJECTED').toBe(true);
    const chunk = await session.handleMessage({
      kind: 'S2_ACQUIRE_CHUNK',
      requestId: 'x',
      seq: 0,
      data: 'AAAA',
    });
    expect(chunk.ok && chunk.value.kind === 'REJECTED').toBe(true);
    const end = await session.handleMessage({ kind: 'S2_ACQUIRE_END', requestId: 'x' });
    expect(end.ok && end.value.kind === 'REJECTED').toBe(true);
  });
});

/** A raw session handle for decode-level (BrokerResult) assertions. */
function establishedForDecode() {
  const established = establishNativeHostSession({
    argv: ['chrome', ALLOWED_EXTENSION_ORIGIN, '--parent-window=0'],
    allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    broker: brokerWith(fixedClock()),
    s2Lane: {
      handle: (): Promise<BrokerResponse> =>
        Promise.resolve({
          kind: 'S2_RESULT',
          requestId: 'unused',
          contractId: 'c',
          terminal: {},
          authorizationContextRef: 'r',
        }),
    },
  });
  expect(established.ok).toBe(true);
  if (!established.ok) throw new Error('unreachable');
  return established.value;
}
