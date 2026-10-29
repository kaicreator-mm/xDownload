/**
 * T004 lifecycle-independent seam client (frozen L2 §9 architecture-driving
 * facts, §10 "read caches are disposable and never become authority").
 *
 * The client submits commands and reads projections; it never starts/stops
 * the Core as an authority prerequisite and never caches authoritative state
 * as a side channel. On disconnect it reconnects and re-submits with the
 * SAME idempotent request identity, so the server's idempotency gate makes
 * replay safe (ADR-010 idempotent acceptance/reconciliation, never
 * exactly-once).
 */

import {
  decodeSeamResponse,
  type CommandEnvelope,
  type QueryEnvelope,
  type SeamResponse,
} from './envelope.ts';
import type { PeerIdentity } from './peer.ts';
import type { SeamClientConnection, SeamClientTransport, SeamListenTarget } from './transport.ts';

export interface SeamClientOptions {
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  /** Same-install/same-user identity presented on every message. */
  readonly peer: PeerIdentity;
  /** Reconnect attempts per request after a connection loss. Default 3. */
  readonly maxReconnectAttempts?: number;
}

export interface SeamClient {
  /** Submit one command envelope; re-submits with the same identity across reconnects. */
  submitCommand(envelope: CommandEnvelope): Promise<SeamResponse>;
  /** Submit one query envelope; queries are read-only and safe to repeat. */
  submitQuery(envelope: QueryEnvelope): Promise<SeamResponse>;
  /** Close the client connection. Never affects Core lifetime. */
  close(): Promise<void>;
}

interface PendingRequest {
  readonly resolve: (response: SeamResponse) => void;
  readonly reject: (error: Error) => void;
}

export function createSeamClient(options: SeamClientOptions): SeamClient {
  const maxAttempts = options.maxReconnectAttempts ?? 3;
  let connection: SeamClientConnection | null = null;
  let connecting: Promise<SeamClientConnection> | null = null;
  const pending = new Map<string, PendingRequest>();

  function dropConnection(): void {
    connection = null;
  }

  async function ensureConnection(): Promise<SeamClientConnection> {
    if (connection !== null) {
      return connection;
    }
    if (connecting === null) {
      connecting = options.transport.connect(options.target).then((established) => {
        connection = established;
        connecting = null;
        established.onFrame((frame) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame) as unknown;
          } catch {
            return;
          }
          const decoded = decodeSeamResponse(parsed);
          if (!decoded.ok) {
            return;
          }
          const waiting = pending.get(decoded.value.inReplyTo);
          if (waiting !== undefined) {
            pending.delete(decoded.value.inReplyTo);
            waiting.resolve(decoded.value);
          }
        });
        established.onEnded(() => {
          connection = null;
          // Connection loss fails in-flight in-flight waiters immediately so
          // the caller's reconnect loop re-sends with the same identity.
          for (const [id, waiting] of pending) {
            pending.delete(id);
            waiting.reject(new Error(`seam connection lost during request '${id}'`));
          }
        });
        return established;
      });
    }
    return connecting;
  }

  async function requestOnce(
    frame: string,
    requestId: string,
    timeoutMs: number,
  ): Promise<SeamResponse> {
    const established = await ensureConnection();
    return new Promise<SeamResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        established.close().catch(() => undefined);
        dropConnection();
        reject(new Error(`seam request '${requestId}' timed out`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        established.send(frame);
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        dropConnection();
        reject(error instanceof Error ? error : new Error('send failed'));
      }
    });
  }

  async function requestWithReconnect(frame: string, requestId: string): Promise<SeamResponse> {
    let lastError: Error = new Error('seam request failed');
    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      try {
        return await requestOnce(frame, requestId, 5_000);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('seam request failed');
        dropConnection();
      }
    }
    throw lastError;
  }

  return {
    async submitCommand(envelope: CommandEnvelope): Promise<SeamResponse> {
      const frame = JSON.stringify({ ...envelope });
      return requestWithReconnect(frame, envelope.requestId);
    },
    async submitQuery(envelope: QueryEnvelope): Promise<SeamResponse> {
      const frame = JSON.stringify({ ...envelope });
      return requestWithReconnect(frame, envelope.requestId);
    },
    async close(): Promise<void> {
      const current = connection;
      connection = null;
      if (current !== null) {
        await current.close();
      }
    },
  };
}

/** Stamp the client's own peer identity onto an outgoing message. */
export function stampPeer<T extends CommandEnvelope | QueryEnvelope>(
  envelope: T,
  peer: PeerIdentity,
): T {
  return { ...envelope, peer };
}
