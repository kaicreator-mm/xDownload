/**
 * T015 task-owned controlled localhost HTTP fixture (same discipline as the
 * upstream adapter fixtures: deterministic, programmed per test, every
 * request recorded; no third-party network).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ServeFileOptions {
  readonly body: Uint8Array;
  readonly etag?: string;
  readonly contentType?: string;
  /** Serve this many bytes of content-length but only `body` bytes of data. */
  readonly declaredLength?: number;
}

export class ControlledHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<
    string,
    (request: IncomingMessage, response: ServerResponse) => void
  >();
  readonly requests: { readonly path: string; readonly range: string | undefined }[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1`);
      this.requests.push({ path: url.pathname, range: request.headers['range'] });
      const behavior = this.behaviors.get(url.pathname);
      if (behavior === undefined) {
        response.writeHead(404, { 'content-length': 0 });
        response.end();
        return;
      }
      behavior(request, response);
    });
  }

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

  async stop(): Promise<void> {
    this.server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  on(path: string, behavior: (request: IncomingMessage, response: ServerResponse) => void): void {
    this.behaviors.set(path, behavior);
  }

  /** Standard single-file origin: ETag + If-Range-aware bytes ranges. */
  serveFile(path: string, options: ServeFileOptions): void {
    this.on(path, (request, response) => {
      const etag = options.etag;
      const contentType = options.contentType ?? 'application/octet-stream';
      const rangeHeader = request.headers['range'];
      const ifRange = request.headers['if-range'];
      if (
        typeof rangeHeader === 'string' &&
        etag !== undefined &&
        (ifRange === undefined || ifRange === etag)
      ) {
        const match = /^bytes=(\d+)-$/.exec(rangeHeader);
        if (match !== null) {
          const start = Number(match[1]);
          const slice = options.body.subarray(start);
          response.writeHead(206, {
            'content-type': contentType,
            'content-length': String(slice.byteLength),
            'content-range': `bytes ${String(start)}-${String(options.body.byteLength - 1)}/${String(options.body.byteLength)}`,
            'accept-ranges': 'bytes',
            etag,
          });
          response.end(Buffer.from(slice));
          return;
        }
      }
      response.writeHead(200, {
        'content-type': contentType,
        'content-length': String(options.declaredLength ?? options.body.byteLength),
        'accept-ranges': 'bytes',
        ...(etag === undefined ? {} : { etag }),
      });
      response.end(Buffer.from(options.body));
    });
  }

  /** 302 redirect to another path on this fixture (or an absolute URL). */
  redirect(path: string, location: string): void {
    this.on(path, (_request, response) => {
      response.writeHead(302, { location });
      response.end();
    });
  }
}
