/**
 * #151 Native Messaging broker session — the closed S5 command vocabulary:
 * structural decode (unknown kinds/fields reject), lane-absent fail-closed
 * typed rejection, and lane forwarding of the exact decoded shape.
 */
import { describe, expect, it } from 'vitest';
import { createAuthBroker } from '../src/index.ts';
import {
  decodeBrokerCommand,
  establishNativeHostSession,
  serveNativeHostSession,
  type S5LaneCommandShape,
} from '../src/nativeHost.ts';
import { encodeFrame } from '../src/nativeFrame.ts';

function s5ResultFrame(requestId: string) {
  return {
    kind: 'S5_RESULT',
    requestId,
    phase: 'STATUS',
    contractId: 'c',
    facts: {},
  } as const;
}

const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

function sessionWith(
  input: {
    readonly s5Lane?: {
      handle(command: S5LaneCommandShape): Promise<ReturnType<typeof s5ResultFrame>>;
    };
  } = {},
) {
  const established = establishNativeHostSession({
    argv: ['host', ORIGIN],
    allowedOrigins: [ORIGIN],
    broker: createAuthBroker(),
    ...(input.s5Lane === undefined ? {} : { s5Lane: input.s5Lane }),
  });
  if (!established.ok) {
    throw new Error(JSON.stringify(established.diagnostics));
  }
  return established.value;
}

describe('decodeBrokerCommand: S5 vocabulary', () => {
  it('decodes the four closed S5 kinds and rejects unknown kinds or extra fields', () => {
    for (const kind of [
      'S5_GROUP_PREPARE',
      'S5_GROUP_CONFIRM',
      'S5_GROUP_EXECUTE',
      'S5_GROUP_STATUS',
    ]) {
      const decoded = decodeBrokerCommand({ kind, requestId: 'r1', s5: { a: 1 } });
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value.kind).toBe(kind);
      }
    }
    expect(decodeBrokerCommand({ kind: 'S5_GROUP_HACK', requestId: 'r1', s5: {} }).ok).toBe(false);
    expect(
      decodeBrokerCommand({ kind: 'S5_GROUP_PREPARE', requestId: 'r1', s5: {}, extra: 1 }).ok,
    ).toBe(false);
    expect(decodeBrokerCommand({ kind: 'S5_GROUP_PREPARE', requestId: 'r1' }).ok).toBe(false);
    expect(decodeBrokerCommand({ kind: 'S5_GROUP_PREPARE', requestId: 'r1', s5: [] }).ok).toBe(
      false,
    );
  });
});

describe('native host session: S5 dispatch', () => {
  it('fails closed with a typed rejection when no S5 lane is configured', async () => {
    const session = sessionWith();
    const result = await session.handleMessage({
      kind: 'S5_GROUP_PREPARE',
      requestId: 'r1',
      s5: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const response = result.value as Record<string, unknown>;
    expect(response['kind']).toBe('REJECTED');
    const reasons = response['reasons'] as { code: string }[];
    expect(reasons[0]?.['code']).toBe('S5_LANE_UNAVAILABLE');
  });

  it('forwards the exact decoded S5 command to the installed lane', async () => {
    const seen: unknown[] = [];
    const session = sessionWith({
      s5Lane: {
        handle: async (command: S5LaneCommandShape) => {
          seen.push(command);
          return s5ResultFrame('r1');
        },
      },
    });
    const frameBytes = encodeFrame({
      kind: 'S5_GROUP_STATUS',
      requestId: 'r1',
      s5: { contractId: 'c' },
    });
    const encoded = frameBytes.ok
      ? frameBytes.value
      : new TextEncoder().encode(
          JSON.stringify({ kind: 'S5_GROUP_STATUS', requestId: 'r1', s5: { contractId: 'c' } }),
        );
    const result = await session.handleFrame(encoded);
    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      { kind: 'S5_GROUP_STATUS', requestId: 'r1', payload: { contractId: 'c' } },
    ]);
    // serveNativeHostSession remains the only stdio writer; nothing here
    // touches stdout.
    void serveNativeHostSession;
  });
});
