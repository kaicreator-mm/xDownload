/**
 * T10 bounded localhost HTTP fixture server (task-owned protocol fixture,
 * independent implementation of the established direct-acquisition pattern).
 *
 * Deterministic and hermetic: every origin is 127.0.0.1 on an ephemeral
 * port, every scenario behavior is programmed per test, and every request is
 * recorded so oracle assertions (including the first-class zero-network
 * assertion) read the recorded truth instead of guessing.
 *
 * Scenarios: complete / truncated (declared > delivered, premature EOF) /
 * 404 / redirect / stall (headers sent, body never completed until the test
 * releases or destroys it).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly sequence: number;
  readonly method: string;
  readonly path: string;
  readonly range: string | undefined;
  readonly ifRange: string | undefined;
  readonly host: string;
}

export type Behavior = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => void | Promise<void>;

export interface CompleteFileOptions {
  readonly body: Uint8Array;
  readonly contentType?: string | undefined;
  readonly etag?: string | undefined;
  readonly status?: number | undefined;
}

export interface TruncatedOptions {
  /** The bytes actually delivered before the premature EOF. */
  readonly body: Uint8Array;
  /** Content-Length promised but never delivered. */
  readonly declaredLength: number;
  readonly etag?: string | undefined;
}

/** Control handle for a stalled response (never completes on its own). */
export interface StalledResponse {
  /** The recorded request currently being stalled (latest truth). */
  readonly request: RecordedRequest;
  /** Complete the response normally (the stall ends). */
  release(): void;
  /** Destroy the underlying socket (client observes an abrupt failure). */
  destroy(): void;
  /** True once the response has been settled by release/destroy. */
  readonly settled: boolean;
}

export class BoundedHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<string, Behavior>();
  private readonly openResponses = new Set<ServerResponse>();
  private sequence = 0;
  private port = 0;
  readonly requests: RecordedRequest[] = [];

  constructor() {
    this.server = createServer((request, response) => {
      void this.dispatch(request, response);
    });
  }

  /** Start listening on an ephemeral localhost port; returns the base URI. */
  async start(): Promise<string> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this.baseUri;
  }

  get baseUri(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  uri(path: string): string {
    return `${this.baseUri}${path}`;
  }

  /** Idempotent stop: stalled responses are destroyed so node:test never hangs. */
  async stop(): Promise<void> {
    for (const response of this.openResponses) {
      response.socket?.destroy();
    }
    this.openResponses.clear();
    this.server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  clearRequests(): void {
    this.requests.length = 0;
    this.sequence = 0;
  }

  requestCount(): number {
    return this.requests.length;
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((recorded) => recorded.path === path);
  }

  /** Standard complete origin: 200 + exact body + exact Content-Length. */
  serveComplete(path: string, options: CompleteFileOptions): void {
    this.on(path, (_request, response) => {
      response.writeHead(options.status ?? 200, {
        'content-type': options.contentType ?? 'application/octet-stream',
        'content-length': String(options.body.byteLength),
        ...(options.etag === undefined ? {} : { etag: options.etag }),
      });
      response.end(Buffer.from(options.body));
    });
  }

  /**
   * 200 with a Content-Length larger than the bytes actually sent; the
   * socket is cut short so the client observes a premature EOF instead of
   * waiting on keep-alive for the declared remainder.
   */
  serveTruncated(path: string, options: TruncatedOptions): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(options.declaredLength),
        ...(options.etag === undefined ? {} : { etag: options.etag }),
      });
      response.write(Buffer.from(options.body));
      response.end(() => {
        response.socket?.destroy();
      });
    });
  }

  /** 404 with no behavior ambiguity: the target simply does not exist. */
  serveNotFound(path: string, body = 'fixture: not found'): void {
    this.on(path, (_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(body);
    });
  }

  /** Status-3xx redirect to another (registered or missing) location. */
  serveRedirect(path: string, location: string, status = 302): void {
    this.on(path, (_request, response) => {
      response.writeHead(status, { location });
      response.end();
    });
  }

  /**
   * Headers are sent, the body is never completed: the response hangs until
   * the test releases or destroys it. This is the mid-effect interruption
   * fixture (nothing observable ever terminates on its own). Registration is
   * synchronous; the handle is usable before, during and after the request.
   */
  serveStall(path: string, options: { declaredLength: number; etag?: string }): StalledResponse {
    const state = { settled: false };
    let stalledResponse: ServerResponse | undefined;
    const latestRequest = (): RecordedRequest => {
      const last = this.requests[this.requests.length - 1];
      if (last !== undefined && last.path === path) {
        return last;
      }
      return {
        sequence: -1,
        method: 'GET',
        path,
        range: undefined,
        ifRange: undefined,
        host: '',
      };
    };
    const handle: StalledResponse = {
      get request(): RecordedRequest {
        return latestRequest();
      },
      release() {
        if (state.settled) return;
        state.settled = true;
        stalledResponse?.end(Buffer.alloc(0));
      },
      destroy() {
        if (state.settled) return;
        state.settled = true;
        stalledResponse?.socket?.destroy();
      },
      get settled(): boolean {
        return state.settled;
      },
    };
    this.on(path, (_request, response) => {
      stalledResponse = response;
      this.openResponses.add(response);
      response.on('close', () => {
        this.openResponses.delete(response);
      });
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(options.declaredLength),
        ...(options.etag === undefined ? {} : { etag: options.etag }),
      });
      response.write(Buffer.alloc(0));
    });
    return handle;
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    this.sequence += 1;
    this.requests.push({
      sequence: this.sequence,
      method: request.method ?? 'GET',
      path: url.pathname,
      range: headerOf(request, 'range'),
      ifRange: headerOf(request, 'if-range'),
      host: request.headers.host ?? '',
    });
    const behavior = this.behaviors.get(url.pathname);
    if (behavior === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('fixture: no behavior registered');
      return;
    }
    await behavior(request, response, url);
  }
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
