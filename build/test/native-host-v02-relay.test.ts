/**
 * T09 v0.2 relay lane tests — the packaged native host's explicit v0.2 seam
 * route (issue #258, T05 legacy R1 closure).
 *
 * Real wires, no in-process substitutes where it matters: the relay talks to
 * a REAL loopback TCP seam listener (the seam wire protocol: 4-byte
 * big-endian length prefix + UTF-8 JSON) that captures the exact envelope it
 * received and answers a canned Core SeamResponse; the stdio wiring test
 * drives real Native Messaging framed bytes through `serveBrokerHostStdio`
 * and parses the NM frames coming back.
 *
 * Covered fail-closed rules:
 * - verbatim relay both ways (the host adds no field, strips no field);
 * - the closed v0.2 vocabulary (one command, one query) — anything else is
 *   rejected typed and NEVER forwarded to Core;
 * - frames without the explicit v0.2 route keep the broker session's own
 *   typed rejection (never silently reinterpreted);
 * - no Core configured → typed refusal; Core unreachable → typed refusal;
 * - unauthenticated callers never reach any lane (origin gate first).
 */

import net from 'node:net';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createV02RelayLane,
  decodeV02RelayFrame,
  isV02SeamFrame,
  parseBrokerConfig,
  serveBrokerHostStdio,
  type V02RelayAnswer,
  type V02RelayRejection,
} from '../native-host-entry.ts';
import type { SeamResponse } from '@xdownload/core-seam';

const ORIGIN = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/';

// ------------------------------------------------------------ fake seam Core

interface FakeCoreServer {
  readonly port: number;
  readonly received: readonly Record<string, unknown>[];
  close(): Promise<void>;
}

/**
 * A real loopback seam-protocol listener: capture in, canned answer out. The
 * default answer echoes the received request identity (`inReplyTo` =
 * `requestId`, `aggregateId` = `aggregateId`) — the seam client correlates
 * responses by `inReplyTo` and silently drops frames that do not match, so a
 * fixed canned answer would hang every non-default requestId.
 */
function startFakeCore(
  answerFor: (envelope: Record<string, unknown>) => Record<string, unknown> = (envelope) => ({
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'response',
    route: 'v0.2',
    inReplyTo: envelope['requestId'],
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: envelope['requestId'],
      aggregateId: envelope['aggregateId'],
      revision: 0,
      converged: false,
    },
  }),
): Promise<FakeCoreServer> {
  const received: Record<string, unknown>[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const declared = buffered.readUInt32BE(0);
        if (buffered.length - 4 < declared) {
          return;
        }
        const envelope = JSON.parse(buffered.subarray(4, 4 + declared).toString('utf8')) as Record<
          string,
          unknown
        >;
        received.push(envelope);
        buffered = buffered.subarray(4 + declared);
        const body = Buffer.from(JSON.stringify(answerFor(envelope)), 'utf8');
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length, 0);
        socket.write(Buffer.concat([header, body]));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      expect(address).not.toBeNull();
      const port = (address as net.AddressInfo).port;
      resolve({
        port,
        received,
        close(): Promise<void> {
          for (const socket of sockets) {
            socket.destroy();
          }
          return new Promise((resolveClose) => {
            server.close(() => resolveClose());
          });
        },
      });
    });
  });
}

// ------------------------------------------------------------- NM frame codec

function nmFrame(message: unknown): Buffer {
  const encoded = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  return Buffer.concat([header, encoded]);
}

/**
 * The ONE output consumer: parse NM frames as they arrive and park them in a
 * queue; tests await queued frames by identity. Attaching several 'data'
 * listeners with read() calls would race over the same chunks.
 */
class NmFrameCollector {
  private readonly pending: Record<string, unknown>[] = [];
  private readonly waiters: Array<(frame: Record<string, unknown>) => void> = [];
  private readonly parser: (chunk: Buffer) => readonly Record<string, unknown>[];

  constructor() {
    let buffer = Buffer.alloc(0);
    this.parser = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const frames: Record<string, unknown>[] = [];
      for (;;) {
        if (buffer.length < 4) break;
        const declared = buffer.readUInt32LE(0);
        if (buffer.length - 4 < declared) break;
        frames.push(
          JSON.parse(buffer.subarray(4, 4 + declared).toString('utf8')) as Record<string, unknown>,
        );
        buffer = buffer.subarray(4 + declared);
      }
      return frames;
    };
  }

  /** Attach as the single 'data' listener of the output stream. */
  observe(output: PassThrough): void {
    output.on('data', (chunk: Buffer) => {
      for (const frame of this.parser(chunk)) {
        const waiter = this.waiters.shift();
        if (waiter !== undefined) {
          waiter(frame);
        } else {
          this.pending.push(frame);
        }
      }
    });
  }

  next(timeoutMs = 10_000): Promise<Record<string, unknown>> {
    const parked = this.pending.shift();
    if (parked !== undefined) {
      return Promise.resolve(parked);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no NM frame arrived in time')), timeoutMs);
      this.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }
}

// ------------------------------------------------------------------- fixtures

function v02SendEnvelope(requestId = 'req-1'): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
    requestId,
    aggregateId: 'ln-0001',
    issuedAt: '2026-10-31T00:00:00.000Z',
    payload: { intent: { requestId, lineageId: 'ln-0001', slice: 'S1' } },
  };
}

function v02QueryEnvelope(requestId = 'q-1'): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'query',
    route: 'v0.2',
    queryType: 'READ_JOB_PROJECTION',
    peer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
    requestId,
    aggregateId: 'ln-0001',
    issuedAt: '2026-10-31T00:00:00.000Z',
  };
}

function acceptedAnswer(requestId: string): SeamResponse {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'response',
    route: 'v0.2',
    inReplyTo: requestId as SeamResponse['inReplyTo'],
    outcome: 'ACCEPTED',
    acceptance: {
      requestId,
      aggregateId: 'ln-0001',
      revision: 0,
      converged: false,
    } as SeamResponse['acceptance'],
  };
}

function isRejection(answer: V02RelayAnswer): V02RelayRejection {
  expect((answer as V02RelayRejection).kind).toBe('REJECTED');
  return answer as V02RelayRejection;
}

// ------------------------------------------------------------------- the lane

describe('v0.2 relay frame gate (structural, closed vocabulary)', () => {
  it('recognizes the explicit v0.2 route only', () => {
    expect(isV02SeamFrame(v02SendEnvelope())).toBe(true);
    expect(isV02SeamFrame({ kind: 'command', commandType: 'SUBMIT_CONTRACT' })).toBe(false);
    expect(isV02SeamFrame({ kind: 'AUTH_ISSUE', requestId: 'r' })).toBe(false);
    expect(isV02SeamFrame('string')).toBe(false);
    expect(isV02SeamFrame([v02SendEnvelope()])).toBe(false);
  });

  it('admits the closed v0.2 command and query vocabulary', () => {
    const send = decodeV02RelayFrame(v02SendEnvelope());
    expect(send.ok).toBe(true);
    if (send.ok) {
      expect(send.requestId).toBe('req-1');
      expect(send.isQuery).toBe(false);
      expect(send.envelope['commandType']).toBe('DOMAIN_APP_SEND');
    }
    const query = decodeV02RelayFrame(v02QueryEnvelope());
    expect(query.ok).toBe(true);
    if (query.ok) {
      expect(query.isQuery).toBe(true);
      expect(query.envelope['queryType']).toBe('READ_JOB_PROJECTION');
    }
  });

  it('rejects v0.2 frames outside the closed vocabulary, never forwarding them', () => {
    for (const payload of [
      { ...v02SendEnvelope(), commandType: 'SUBMIT_CONTRACT' },
      { ...v02QueryEnvelope(), queryType: 'READ_PROJECTION' },
      { ...v02SendEnvelope(), kind: 'response' },
      { route: 'v0.2', requestId: 'r', kind: 'mystery' },
      { route: 'v0.2' },
      'not an object',
    ]) {
      const decoded = decodeV02RelayFrame(payload);
      expect(decoded.ok, JSON.stringify(payload)).toBe(false);
      if (!decoded.ok) {
        expect(decoded.rejection.kind).toBe('REJECTED');
        expect(decoded.rejection.reasons[0]?.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries an empty requestId on uncorrelated malformed frames', () => {
    const decoded = decodeV02RelayFrame({ route: 'v0.2', kind: 'command' });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.rejection.requestId).toBe('');
      expect(decoded.rejection.reasons[0]?.code).toBe('V02_FRAME_MALFORMED');
    }
  });
});

describe('v0.2 relay lane over a real loopback seam connection', () => {
  let core: FakeCoreServer;

  beforeEach(async () => {
    core = await startFakeCore();
  });

  afterEach(async () => {
    await core.close();
  });

  it('relays the DOMAIN_APP_SEND envelope verbatim and answers the verbatim response', async () => {
    const lane = createV02RelayLane({
      core: { host: '127.0.0.1', port: core.port, installId: 'install-001', userId: 'user-001' },
    });
    const envelope = v02SendEnvelope();
    const decoded = decodeV02RelayFrame(envelope);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const answer = await lane.handle(decoded);
    expect(answer).toEqual(acceptedAnswer('req-1'));
    expect(core.received).toHaveLength(1);
    expect(core.received[0]).toEqual(envelope);
    await lane.close();
  });

  it('relays READ_JOB_PROJECTION as a query', async () => {
    const projection = {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      lineageId: 'ln-0001',
      owner: 'new-k',
      status: 'RUNNING',
      attempts: [{ attemptId: 'attempt-1', sequence: 1, status: 'RUNNING' }],
      currentAttemptId: 'attempt-1',
    };
    const core = await startFakeCore((envelope) => ({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
      kind: 'response',
      route: 'v0.2',
      inReplyTo: envelope['requestId'],
      outcome: 'PROJECTION',
      projection,
    }));
    try {
      const lane = createV02RelayLane({
        core: { host: '127.0.0.1', port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const decoded = decodeV02RelayFrame(v02QueryEnvelope());
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const answer = await lane.handle(decoded);
      expect((answer as SeamResponse).outcome).toBe('PROJECTION');
      expect((answer as SeamResponse).projection).toEqual(projection);
      expect(core.received[0]?.['queryType']).toBe('READ_JOB_PROJECTION');
      await lane.close();
    } finally {
      await core.close();
    }
  });

  it('answers a typed refusal without contacting an unconfigured Core', async () => {
    const lane = createV02RelayLane({ core: undefined });
    const decoded = decodeV02RelayFrame(v02SendEnvelope());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const rejection = isRejection(await lane.handle(decoded));
    expect(rejection.requestId).toBe('req-1');
    expect(rejection.reasons[0]?.code).toBe('V02_CORE_UNCONFIGURED');
    expect(core.received).toHaveLength(0);
    await lane.close();
  });

  it('answers a typed refusal when the Core is unreachable (single bounded attempt)', async () => {
    const dead = await startFakeCore();
    const deadPort = dead.port;
    await dead.close();
    const lane = createV02RelayLane({
      core: { host: '127.0.0.1', port: deadPort, installId: 'install-001', userId: 'user-001' },
    });
    const decoded = decodeV02RelayFrame(v02SendEnvelope());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const rejection = isRejection(await lane.handle(decoded));
    expect(rejection.reasons[0]?.code).toBe('V02_CORE_UNREACHABLE');
    expect(rejection.requestId).toBe('req-1');
    expect(core.received).toHaveLength(0);
    await lane.close();
  });

  it('serializes concurrent frames in arrival order', async () => {
    const lane = createV02RelayLane({
      core: { host: '127.0.0.1', port: core.port, installId: 'install-001', userId: 'user-001' },
    });
    const first = decodeV02RelayFrame(v02SendEnvelope('r-first'));
    const second = decodeV02RelayFrame(v02SendEnvelope('r-second'));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const answers = await Promise.all([lane.handle(first), lane.handle(second)]);
    expect((answers[0] as SeamResponse).inReplyTo).toBe('r-first');
    expect((answers[1] as SeamResponse).inReplyTo).toBe('r-second');
    expect(core.received.map((envelope) => envelope['requestId'])).toEqual(['r-first', 'r-second']);
    await lane.close();
  });
});

// ------------------------------------------------- broker-config plumbing

describe('broker config core section feeds the relay unchanged', () => {
  it('parses the pipe core section the relay prefers', () => {
    const config = parseBrokerConfig(
      JSON.stringify({
        allowedOrigins: [ORIGIN],
        core: {
          installId: 'xdownload',
          userId: 'u1',
          pipeName: '\\\\.\\pipe\\xdownload-core-xdownload',
        },
      }),
    );
    expect(config.core?.pipeName).toBe('\\\\.\\pipe\\xdownload-core-xdownload');
  });
});

// ------------------------------------------------------- full stdio wiring

describe('serveBrokerHostStdio (NM framing with the v0.2 interception)', () => {
  function writeConfig(core: Record<string, unknown> | undefined): {
    configPath: string;
    cleanup: () => void;
  } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-v02-relay-'));
    const configPath = path.join(dir, 'broker-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        allowedOrigins: [ORIGIN],
        ...(core === undefined ? {} : { core }),
      }),
      'utf8',
    );
    return { configPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('refuses the whole stdio service for a non-allow-listed caller', () => {
    const { cleanup } = writeConfig(undefined);
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      const outcome = serveBrokerHostStdio(
        { input, output },
        {
          argv: ['chrome-extension://cccccccccccccccccccccccccccccccc/'],
          allowedOrigins: [ORIGIN],
          core: undefined,
        },
      );
      expect(outcome.brokerSessionEstablished).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('answers a v0.2 send from the Core and a v1 command from the broker session', async () => {
    const core = await startFakeCore();
    const { configPath, cleanup } = writeConfig({
      host: '127.0.0.1',
      port: core.port,
      installId: 'install-001',
      userId: 'user-001',
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new NmFrameCollector();
    collector.observe(output);
    try {
      const outcome = serveBrokerHostStdio(
        { input, output },
        {
          argv: [ORIGIN],
          allowedOrigins: [ORIGIN],
          core: parseBrokerConfig(fs.readFileSync(configPath, 'utf8')).core,
        },
      );
      expect(outcome.brokerSessionEstablished).toBe(true);

      // 1. A v0.2 DOMAIN_APP_SEND frame rides the relay to Core and back.
      input.write(nmFrame(v02SendEnvelope('req-wire')));
      const relayAnswer = await collector.next();
      expect(relayAnswer['kind']).toBe('response');
      expect(relayAnswer['inReplyTo']).toBe('req-wire');
      expect(relayAnswer).toEqual(acceptedAnswer('req-wire') as unknown as Record<string, unknown>);
      expect(core.received).toHaveLength(1);
      expect(core.received[0]).toEqual(v02SendEnvelope('req-wire'));

      // 2. A legacy v1 broker command keeps the broker session's typed
      //    rejection and never touches Core.
      input.write(nmFrame({ kind: 'AUTH_INSPECT', requestId: 'auth-1', ref: 'missing' }));
      const brokerAnswer = await collector.next();
      expect(brokerAnswer['kind']).toBe('REJECTED');
      expect(Array.isArray(brokerAnswer['reasons'])).toBe(true);
      expect(core.received).toHaveLength(1);

      // 3. A v0.2 frame outside the closed vocabulary is rejected typed
      //    without ever reaching Core.
      input.write(nmFrame({ ...v02SendEnvelope('req-forbidden'), commandType: 'SUBMIT_CONTRACT' }));
      const forbiddenAnswer = await collector.next();
      expect(forbiddenAnswer['kind']).toBe('REJECTED');
      const reasons = forbiddenAnswer['reasons'] as readonly { code?: string }[];
      expect(reasons[0]?.code).toBe('V02_ROUTE_UNSUPPORTED');
      expect(core.received).toHaveLength(1);

      input.end();
    } finally {
      cleanup();
      await core.close();
    }
  });

  it('answers every v0.2 frame typed when no Core is bound', async () => {
    const { configPath, cleanup } = writeConfig(undefined);
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new NmFrameCollector();
    collector.observe(output);
    try {
      const outcome = serveBrokerHostStdio(
        { input, output },
        {
          argv: [ORIGIN],
          allowedOrigins: [ORIGIN],
          core: parseBrokerConfig(fs.readFileSync(configPath, 'utf8')).core,
        },
      );
      expect(outcome.brokerSessionEstablished).toBe(true);
      input.write(nmFrame(v02SendEnvelope('req-unbound')));
      const answer = await collector.next();
      expect(answer['kind']).toBe('REJECTED');
      const reasons = answer['reasons'] as readonly { code?: string }[];
      expect(reasons[0]?.code).toBe('V02_CORE_UNCONFIGURED');
      input.end();
    } finally {
      cleanup();
    }
  });

  it('keeps answers ordered when v0.2 frames arrive back to back', async () => {
    const core = await startFakeCore();
    const { configPath, cleanup } = writeConfig({
      host: '127.0.0.1',
      port: core.port,
      installId: 'install-001',
      userId: 'user-001',
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new NmFrameCollector();
    collector.observe(output);
    try {
      serveBrokerHostStdio(
        { input, output },
        {
          argv: [ORIGIN],
          allowedOrigins: [ORIGIN],
          core: parseBrokerConfig(fs.readFileSync(configPath, 'utf8')).core,
        },
      );
      input.write(nmFrame(v02SendEnvelope('req-a')));
      input.write(nmFrame(v02SendEnvelope('req-b')));
      const first = await collector.next();
      const second = await collector.next();
      expect(first['inReplyTo']).toBe('req-a');
      expect(second['inReplyTo']).toBe('req-b');
      expect(core.received.map((envelope) => envelope['requestId'])).toEqual(['req-a', 'req-b']);
      input.end();
    } finally {
      cleanup();
      await core.close();
    }
  });
});
