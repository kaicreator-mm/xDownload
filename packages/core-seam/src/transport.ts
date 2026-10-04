/**
 * T004 transport-neutral seam ports and frame codec (frozen L2 invariant 19 /
 * ADR-012: the exact production IPC transport remains replaceable; frozen
 * §6.9: the production transport is a downstream decision).
 *
 * The wire frame is a 4-byte big-endian length prefix followed by UTF-8 JSON
 * of one seam envelope/response. The frame layer enforces the declared
 * MAX_FRAME_BYTES bound before buffering/parsing and never degrades to an
 * unbounded or unauthenticated channel.
 */

import { SEAM_MESSAGE_LIMITS } from './bounds.ts';

export const FRAME_HEADER_BYTES = 4;

/** Raised when a framed chunk violates the declared frame bound. */
export class SeamFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeamFrameError';
  }
}

/** Encode one frame; rejects oversized payloads at the framing layer. */
export function encodeFrame(
  payload: string,
  maxFrameBytes: number = SEAM_MESSAGE_LIMITS.maxFrameBytes,
): Buffer {
  const bodyBytes = Buffer.byteLength(payload, 'utf8');
  const totalBytes = FRAME_HEADER_BYTES + bodyBytes;
  if (totalBytes > maxFrameBytes) {
    throw new SeamFrameError(
      `frame of ${String(totalBytes)} bytes exceeds declared bound ${String(maxFrameBytes)}`,
    );
  }
  const frame = Buffer.alloc(totalBytes);
  frame.writeUInt32BE(bodyBytes, 0);
  frame.write(payload, FRAME_HEADER_BYTES, 'utf8');
  return frame;
}

/**
 * Incremental frame accumulator for a byte stream. `push` returns every
 * completed frame string in order; a bound violation raises `SeamFrameError`
 * and the connection must be closed (fail closed, no partial parse).
 */
export class FrameAccumulator {
  private readonly chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private header: Buffer | null = null;
  private readonly maxFrameBytes: number;

  constructor(maxFrameBytes: number = SEAM_MESSAGE_LIMITS.maxFrameBytes) {
    this.maxFrameBytes = maxFrameBytes;
  }

  push(chunk: Buffer): string[] {
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.byteLength;
    const frames: string[] = [];
    for (;;) {
      const next = this.nextFrame();
      if (next === null) {
        break;
      }
      frames.push(next);
    }
    return frames;
  }

  private nextFrame(): string | null {
    if (this.header === null) {
      const taken = this.takeBytes(FRAME_HEADER_BYTES);
      if (taken === null) {
        return null;
      }
      this.header = taken;
    }
    const bodyLength = this.header.readUInt32BE(0);
    if (FRAME_HEADER_BYTES + bodyLength > this.maxFrameBytes) {
      throw new SeamFrameError(
        `framed body of ${String(bodyLength)} bytes exceeds declared bound ${String(this.maxFrameBytes)}`,
      );
    }
    const body = this.takeBytes(bodyLength);
    if (body === null) {
      return null;
    }
    this.header = null;
    return body.toString('utf8');
  }

  /** Take exactly `count` buffered bytes, or null when fewer are buffered. */
  private takeBytes(count: number): Buffer | null {
    if (this.bufferedBytes < count) {
      return null;
    }
    const merged =
      this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.bufferedBytes);
    this.chunks.length = 0;
    if (merged.byteLength === count) {
      this.bufferedBytes = 0;
      return merged;
    }
    const taken = merged.subarray(0, count);
    const rest = merged.subarray(count);
    this.chunks.push(rest);
    this.bufferedBytes = rest.byteLength;
    return taken;
  }
}

/** Where a server transport listens; loopback-only for the local seam. */
export interface SeamListenTarget {
  readonly host: string;
  readonly port: number;
}

/** Server-side view of one peer connection. */
export interface SeamServerConnection {
  readonly id: string;
  readonly remoteAddress: string;
  send(frame: string): void;
  close(): void;
}

export interface SeamConnectionHandler {
  onFrame(connection: SeamServerConnection, frame: string): void;
  onConnectionEnded(connection: SeamServerConnection): void;
}

/**
 * Server transport port: adapts one concrete local IPC mechanism to framed
 * seam messages. Implementations must enforce loopback-only admission and
 * the declared frame bound; there is no unauthenticated fallback mode.
 */
export interface SeamServerTransport {
  start(handler: SeamConnectionHandler): Promise<SeamListenTarget>;
  stop(): Promise<void>;
}

/** Client-side view of one connection to the Core seam. */
export interface SeamClientConnection {
  onFrame(handler: (frame: string) => void): void;
  onEnded(handler: () => void): void;
  send(frame: string): void;
  close(): Promise<void>;
}

/** Client transport port (ADR-012 replaceability on the client side too). */
export interface SeamClientTransport {
  connect(target: SeamListenTarget): Promise<SeamClientConnection>;
}
