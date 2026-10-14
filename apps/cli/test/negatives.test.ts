/**
 * TEST_MATRIX negative cases. Several negatives are covered in the suites
 * they belong to (golden: missing-projection-fields + rejected-never-success;
 * batch: oversized-input-respects-limits + defaults-cannot-widen-scope;
 * non-interactive: bounded NEEDS_USER_ACTION; cancel-retry:
 * foreign-aggregate rejection; headless-authority: desktop-absent +
 * peer-unauthorized). This file adds the wire-level negatives: an
 * incompatible seam schema response must fail closed as a typed transport
 * failure, never be reinterpreted, and malformed input must fail before any
 * envelope is built.
 */

import { describe, expect, it } from 'vitest';
import { createLoopbackClientTransport, type SeamClientTransport } from '@xdownload/core-seam';
import net from 'node:net';
import { queryCountingTransport, runCli, startSeam } from './helpers.ts';

/** A raw framed endpoint that answers with an unsupported seam schema
 * version (2.0.0) and immediately closes — the exact-base fail-closed shape
 * the seam client must drop, never reinterpret. */
function startBadSchemaServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffered = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length < 4) {
          return;
        }
        const bodyLength = buffered.readUInt32BE(0);
        if (buffered.length < 4 + bodyLength) {
          return;
        }
        const request = JSON.parse(buffered.subarray(4, 4 + bodyLength).toString('utf8')) as {
          requestId?: string;
        };
        const response = {
          schemaIdentity: { schema: 'xdownload.core-seam', version: '2.0.0' },
          kind: 'response',
          inReplyTo: request.requestId ?? 'unknown',
          outcome: 'REJECTED',
          diagnostics: [
            {
              code: 'UNSUPPORTED_ENVELOPE_VERSION',
              path: 'schemaIdentity.version',
              message: 'unsupported seam envelope major version 2; fail closed',
            },
          ],
        };
        const payload = JSON.stringify(response);
        const frame = Buffer.alloc(4 + Buffer.byteLength(payload));
        frame.writeUInt32BE(Buffer.byteLength(payload), 0);
        frame.write(payload, 4);
        socket.write(frame);
        socket.destroy();
      });
      socket.on('error', () => socket.destroy());
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

describe('unsupported-seam-schema-version-response', () => {
  it('an incompatible seam response fails closed as a typed transport failure (never success)', async () => {
    const server = await startBadSchemaServer();
    const target = { host: '127.0.0.1', port: server.port };
    const run = await runCli(['status', '--contract', 'contract-single-001'], target);
    await server.close();
    expect(run.exitCode).toBe(5);
    const json = run.json as { document: string; error: string };
    expect(json['document']).toBe('xdownload.cli.error');
    expect(json['error']).toBe('TRANSPORT');
    // The incompatible frame's contents never surface as projection truth.
    expect(run.document.includes('"PROJECTION"')).toBe(false);
    expect(run.document.includes('UNSUPPORTED_ENVELOPE_VERSION')).toBe(false);
  });
});

describe('S1 Core 1.1 read-only compatibility preflight (#114)', () => {
  it('refuses a legacy Core response before sending any authoritative S1 command', async () => {
    const seam = await startSeam();
    const inner = createLoopbackClientTransport();
    let commands = 0;
    let queries = 0;
    const transport: SeamClientTransport = {
      async connect(target) {
        const connection = await inner.connect(target);
        const originalSend = connection.send.bind(connection);
        connection.send = (frame: string) => {
          const request = JSON.parse(frame) as { kind?: string };
          if (request.kind === 'command') commands += 1;
          if (request.kind === 'query') queries += 1;
          originalSend(frame);
        };
        const originalOnFrame = connection.onFrame.bind(connection);
        connection.onFrame = (listener) => {
          originalOnFrame((frame) => {
            const result = JSON.parse(frame) as {
              outcome?: string;
              diagnostics?: { code?: string }[];
              schemaIdentity?: { schema: string; version: string };
            };
            if (
              result.outcome === 'REJECTED' &&
              result.diagnostics?.[0]?.code === 'AGGREGATE_NOT_FOUND'
            ) {
              result.schemaIdentity = { schema: 'xdownload.core-seam', version: '1.0.0' };
            }
            listener(JSON.stringify(result));
          });
        };
        return connection;
      },
    };
    const run = await runCli(['download', '--url', 'http://127.0.0.1:9/file.bin'], seam.target, {
      transport,
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.document).toContain('S1 requires Core seam 1.1');
    expect(queries).toBe(1);
    expect(commands).toBe(0);
  });

  it('queries the genuinely fresh aggregate on a compatible Core before S1 submission', async () => {
    const seam = await startSeam();
    const transport = queryCountingTransport(createLoopbackClientTransport());
    const run = await runCli(['download', '--url', 'http://127.0.0.1:9/file.bin'], seam.target, {
      transport,
    });
    // The Core here intentionally has no S1 beginner, so execution rejects.
    // A normal first-time user nevertheless gets past the safe version probe.
    expect(run.exitCode).not.toBe(0);
    expect(transport.queryCount()).toBe(1);
    expect(run.document).not.toContain('S1 requires Core seam 1.1');
  });
});

describe('malformed input fails before any envelope', () => {
  it('a contract payload with an unknown field is rejected with verbatim domain diagnostics', async () => {
    const seam = await startSeam();
    const run = await runCli(['submit', '--stdin'], seam.target, {
      stdinText: JSON.stringify({ contractId: 'x', totallyUnknownField: true }),
    });
    expect(run.exitCode).toBe(1);
    const json = run.json as {
      document: string;
      error: string;
      diagnostics: { code: string; path: string }[];
    };
    expect(json['document']).toBe('xdownload.cli.error');
    expect(json['error']).toBe('USAGE');
    const codes = json['diagnostics'].map((diagnostic) => diagnostic.code);
    expect(codes).toContain('UNKNOWN_FIELD');
  });
});
