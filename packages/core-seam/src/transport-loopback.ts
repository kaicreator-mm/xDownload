/**
 * T004 F1 concrete transport: loopback TCP carrying framed seam messages,
 * built entirely on Node built-ins (`node:net`) — no new runtime dependency
 * (IMPLEMENTATION_MAP "Dependency decision seam" option 1).
 *
 * Recorded F1 choice (EXECUTION_CONTRACT "F1 implementation choices"):
 *
 * - Mechanism: TCP socket bound to the loopback interface only (127.0.0.1 by
 *   default; ::1 admitted as loopback). The listener refuses any
 *   non-loopback bind at construction, so no unrestricted/unauthenticated
 *   transport path coexists with the authorized seam (frozen L2 §6.4/§12,
 *   invariant 14; Native Messaging `allowed_origins` remains a separate
 *   platform boundary this transport never bypasses).
 * - Peer authorization split: the transport enforces the same-install
 *   (same-host) precondition by admitting loopback connections only; the
 *   seam server re-decides the same-user authorization per frame from the
 *   envelope's peer block. No anonymous path exists: frames from
 *   unauthorized peers get a typed rejection response, never silent
 *   admission.
 * - Framing: 4-byte big-endian length prefix + UTF-8 JSON; the declared
 *   MAX_FRAME_BYTES bound is enforced before buffering/parsing.
 * - Production replacement: platform pipes/unix sockets/daemon IPC remain
 *   behind the same `SeamServerTransport`/`SeamClientTransport` ports
 *   (ADR-012); this choice does not freeze the production transport.
 */

import net from 'node:net';
import { SEAM_MESSAGE_LIMITS, type SeamMessageLimits } from './bounds.ts';
import { FrameAccumulator, SeamFrameError, type SeamListenTarget } from './transport.ts';
import type {
  SeamClientConnection,
  SeamClientTransport,
  SeamConnectionHandler,
  SeamServerConnection,
  SeamServerTransport,
} from './transport.ts';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackAddress(address: string): boolean {
  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('::ffff:127.') ||
    address.startsWith('127.')
  );
}

export interface LoopbackServerTransportOptions {
  /** Must be a loopback host; anything else is refused at construction. */
  readonly host: string;
  /** 0 lets the OS assign a free port (concern tests use this). */
  readonly port: number;
  readonly limits?: SeamMessageLimits;
}

export class NonLoopbackTransportRefusedError extends Error {
  constructor(host: string) {
    super(
      `refusing to bind seam transport to non-loopback host '${host}'; the local seam admits same-host peers only (L2 §12)`,
    );
    this.name = 'NonLoopbackTransportRefusedError';
  }
}

/** F1 concrete server transport: loopback-only framed TCP. */
export function createLoopbackServerTransport(
  options: LoopbackServerTransportOptions,
): SeamServerTransport {
  if (!LOOPBACK_HOSTS.has(options.host)) {
    throw new NonLoopbackTransportRefusedError(options.host);
  }
  const limits = options.limits ?? SEAM_MESSAGE_LIMITS;
  const host = options.host === 'localhost' ? '127.0.0.1' : options.host;
  let server: net.Server | null = null;
  let nextConnectionId = 0;
  const openSockets = new Set<net.Socket>();

  return {
    start(handler: SeamConnectionHandler): Promise<SeamListenTarget> {
      return new Promise((resolve, reject) => {
        const created = net.createServer((socket) => {
          const remote = socket.remoteAddress ?? 'unknown';
          // Same-install precondition: loopback peers only. Anything else is
          // destroyed before a single frame is read; no fallback channel.
          if (!isLoopbackAddress(remote)) {
            socket.destroy();
            return;
          }
          openSockets.add(socket);
          const connectionId = `loopback-${String(nextConnectionId)}`;
          nextConnectionId += 1;
          const accumulator = new FrameAccumulator(limits.maxFrameBytes);
          const connection: SeamServerConnection = {
            id: connectionId,
            remoteAddress: remote,
            send(frame) {
              if (!socket.destroyed) {
                socket.write(encodeFrameForTransport(frame, limits.maxFrameBytes));
              }
            },
            close() {
              socket.destroy();
            },
          };
          socket.on('data', (chunk: Buffer) => {
            let frames: string[];
            try {
              frames = accumulator.push(chunk);
            } catch {
              // Frame bound violation: fail closed and drop the connection.
              socket.destroy();
              return;
            }
            for (const frame of frames) {
              handler.onFrame(connection, frame);
            }
          });
          socket.on('error', () => {
            socket.destroy();
          });
          socket.on('close', () => {
            openSockets.delete(socket);
            handler.onConnectionEnded(connection);
          });
        });
        created.on('error', (error) => {
          reject(error);
        });
        created.listen(options.port, host, () => {
          const address = created.address();
          const listenPort = typeof address === 'object' && address !== null ? address.port : 0;
          server = created;
          resolve({ host, port: listenPort });
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        for (const socket of openSockets) {
          socket.destroy();
        }
        openSockets.clear();
        const current = server;
        if (current === null) {
          resolve();
          return;
        }
        current.close(() => {
          server = null;
          resolve();
        });
      });
    },
  };
}

function encodeFrameForTransport(payload: string, maxFrameBytes: number): Buffer {
  const bodyBytes = Buffer.byteLength(payload, 'utf8');
  const frame = Buffer.alloc(4 + bodyBytes);
  frame.writeUInt32BE(bodyBytes, 0);
  frame.write(payload, 4, 'utf8');
  if (frame.byteLength > maxFrameBytes) {
    throw new SeamFrameError(
      `frame of ${String(frame.byteLength)} bytes exceeds declared bound ${String(maxFrameBytes)}`,
    );
  }
  return frame;
}

/** F1 concrete client transport: framed TCP to a loopback seam endpoint. */
export function createLoopbackClientTransport(): SeamClientTransport {
  return {
    connect(target: SeamListenTarget): Promise<SeamClientConnection> {
      return new Promise((resolve, reject) => {
        const socket = net.connect({ host: target.host, port: target.port });
        const frameHandlers: Array<(frame: string) => void> = [];
        const endHandlers: Array<() => void> = [];
        const accumulator = new FrameAccumulator();
        socket.on('connect', () => {
          const connection: SeamClientConnection = {
            onFrame(handler) {
              frameHandlers.push(handler);
            },
            onEnded(handler) {
              endHandlers.push(handler);
            },
            send(frame) {
              if (!socket.destroyed) {
                socket.write(encodeFrameForTransport(frame, SEAM_MESSAGE_LIMITS.maxFrameBytes));
              }
            },
            close() {
              return new Promise((resolveClose) => {
                if (socket.destroyed) {
                  resolveClose();
                  return;
                }
                socket.once('close', () => resolveClose());
                socket.end();
              });
            },
          };
          socket.on('data', (chunk: Buffer) => {
            let frames: string[];
            try {
              frames = accumulator.push(chunk);
            } catch {
              socket.destroy();
              return;
            }
            for (const frame of frames) {
              for (const handler of frameHandlers) {
                handler(frame);
              }
            }
          });
          socket.on('error', () => {
            socket.destroy();
          });
          socket.on('close', () => {
            for (const handler of endHandlers) {
              handler();
            }
          });
          resolve(connection);
        });
        socket.on('error', (error) => {
          reject(error);
        });
      });
    },
  };
}
