/**
 * F1 concrete loopback transport tests: framing, declared frame bound,
 * deterministic local operation, request/response correlation over a real
 * local socket. No second machine, no external service (IMPLEMENTATION_MAP
 * "Expected test placement seam").
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  createSeamClient,
  encodeFrame,
  FrameAccumulator,
  FRAME_HEADER_BYTES,
  SeamFrameError,
  SEAM_MESSAGE_LIMITS,
  stampPeer,
  type SeamServerTransport,
} from './helpers.ts';
import { EXPECTED_PEER, peer, rawCommand, rawQuery, rawSingleResourceContract } from './helpers.ts';

const running: SeamServerTransport[] = [];

afterEach(async () => {
  for (const transport of running.splice(0)) {
    await transport.stop();
  }
});

async function startSeam(journal?: ReturnType<typeof createInMemorySeamJournal>) {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, journal });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  const server = result.value;
  const transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
  running.push(transport);
  const target = await transport.start({
    onFrame: (connection, frame) => {
      const response = server.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
  return { server, target };
}

describe('frame codec', () => {
  it('encode → accumulate roundtrips frames across arbitrary chunk boundaries', () => {
    const frames = ['{"a":1}', '{"b":"tw"}', '{"c":{"nested":[1,2,3]}}'];
    const bytes = Buffer.concat(frames.map((f) => encodeFrame(f)));
    const accumulator = new FrameAccumulator();
    // Feed one byte at a time: framing must be chunk-independent.
    const decoded: string[] = [];
    for (const byte of bytes) {
      decoded.push(...accumulator.push(Buffer.from([byte])));
    }
    expect(decoded).toStrictEqual(frames);
  });

  it('a frame body over the declared bound raises SeamFrameError before parsing', () => {
    const accumulator = new FrameAccumulator();
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32BE(SEAM_MESSAGE_LIMITS.maxFrameBytes, 0);
    expect(() => accumulator.push(header)).toThrow(SeamFrameError);
  });

  it('encodeFrame refuses oversized payloads at the framing layer', () => {
    const huge = 'x'.repeat(SEAM_MESSAGE_LIMITS.maxFrameBytes);
    expect(() => encodeFrame(huge)).toThrow(SeamFrameError);
  });
});

describe('loopback transport end-to-end over a real local socket', () => {
  it('submits a command through framed wire bytes and correlates the response', async () => {
    const { server, target } = await startSeam();
    expect(target.host).toBe('127.0.0.1');
    expect(target.port).toBeGreaterThan(0);
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target,
      peer: peer('CLI'),
    });
    const response = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        peer('CLI'),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
    expect(server.acceptedCommandCount).toBe(1);
    const projection = await client.submitQuery(
      rawQuery({ aggregateId: 'contract-single-001' }) as never,
    );
    expect(projection.outcome).toBe('PROJECTION');
    await client.close();
  });

  it('serves sequential commands on one connection and rejects unauthorized frames truthfully', async () => {
    const { target } = await startSeam();
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target,
      peer: peer('DESKTOP_UI'),
    });
    const first = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        peer('DESKTOP_UI'),
      ),
    );
    expect(first.outcome).toBe('ACCEPTED');
    // The same client connection attempting to act as a foreign peer gets a
    // typed rejection — truthful transport/auth failure, no silent degrade.
    const smuggled = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
        }) as never,
        { installId: 'install-999', userId: 'user-999', surface: 'DESKTOP_UI' },
      ),
    );
    expect(smuggled.outcome).toBe('REJECTED');
    expect(smuggled.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    await client.close();
  });

  it('restarts on a new endpoint over the same journal without duplicating effects', async () => {
    const journal = createInMemorySeamJournal();
    const first = await startSeam(journal);
    const firstClient = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: first.target,
      peer: peer('CLI'),
    });
    const command = stampPeer(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        requestId: 'req-transport-restart-001',
      }) as never,
      peer('CLI'),
    );
    expect((await firstClient.submitCommand(command)).outcome).toBe('ACCEPTED');
    await firstClient.close();
    for (const transport of running.splice(0)) {
      await transport.stop();
    }
    const second = await startSeam(journal);
    const secondClient = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: second.target,
      peer: peer('CLI'),
    });
    const resubmitted = await secondClient.submitCommand(command);
    expect(resubmitted.outcome).toBe('ACCEPTED');
    expect(resubmitted.acceptance?.converged).toBe(true);
    expect(second.server.acceptedCommandCount).toBe(1);
    await secondClient.close();
  });
});
