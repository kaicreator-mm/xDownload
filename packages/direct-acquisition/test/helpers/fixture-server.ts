/**
 * T008 controlled localhost HTTP fixture server (task-owned protocol
 * fixture). Deterministic, no third-party network: every scenario behavior
 * is programmed per test and every request is recorded for oracle
 * assertions (Range/If-Range/redirect/signed-locator flows).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
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

export interface ServeFileOptions {
  readonly body: Uint8Array;
  readonly etag?: string | undefined;
  /** Serve this ETag value but ignore Range/If-Range semantics when false. */
  readonly acceptRanges?: boolean | undefined;
  readonly contentType?: string | undefined;
  readonly lastModified?: string | undefined;
}

/** True when the fixture should answer ranged requests with 206. */
function rangeSupported(options: ServeFileOptions): boolean {
  return options.acceptRanges !== false;
}

export class ControlledHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<string, Behavior>();
  readonly requests: RecordedRequest[] = [];
  private port = 0;

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

  async stop(): Promise<void> {
    this.server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  /** Forget recorded requests (call between tests that count requests). */
  clearRequests(): void {
    this.requests.length = 0;
  }

  /** A standard single-file origin: ETag, ranges and If-Range semantics. */
  serveFile(path: string, options: ServeFileOptions): void {
    this.on(path, (_request, response) => {
      const etagHeader = options.etag === undefined ? undefined : options.etag;
      const rangeHeader = _request.headers['range'];
      const ifRangeHeader = _request.headers['if-range'];
      const contentType = options.contentType ?? 'application/octet-stream';

      const respondFull = (): void => {
        response.writeHead(200, {
          'content-type': contentType,
          'content-length': String(options.body.byteLength),
          'accept-ranges': rangeSupported(options) ? 'bytes' : 'none',
          ...(etagHeader === undefined ? {} : { etag: etagHeader }),
          ...(options.lastModified === undefined ? {} : { 'last-modified': options.lastModified }),
        });
        response.end(Buffer.from(options.body));
      };

      if (typeof rangeHeader === 'string' && rangeSupported(options)) {
        const match = /^bytes=(\d+)-$/.exec(rangeHeader);
        if (match !== null) {
          const start = Number(match[1]);
          // If-Range: only serve a range when the recorded representation
          // matches; a mismatch (or absent validator) means full response.
          const ifRangeSatisfied =
            ifRangeHeader === undefined ||
            (etagHeader !== undefined && ifRangeHeader === etagHeader);
          if (!ifRangeSatisfied) {
            respondFull();
            return;
          }
          const slice = options.body.subarray(start);
          response.writeHead(206, {
            'content-type': contentType,
            'content-length': String(slice.byteLength),
            'content-range': `bytes ${String(start)}-${String(options.body.byteLength - 1)}/${String(options.body.byteLength)}`,
            'accept-ranges': 'bytes',
            ...(etagHeader === undefined ? {} : { etag: etagHeader }),
          });
          response.end(Buffer.from(slice));
          return;
        }
      }
      respondFull();
    });
  }

  /** 200 with a Content-Length larger than the bytes actually sent. */
  serveTruncated(
    path: string,
    options: { body: Uint8Array; declaredLength: number; etag?: string },
  ): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(options.declaredLength),
        ...(options.etag === undefined ? {} : { etag: options.etag }),
      });
      response.write(Buffer.from(options.body));
      // Cut the connection short so the client observes a premature EOF
      // instead of waiting on keep-alive for the declared remainder.
      response.end(() => {
        response.socket?.destroy();
      });
    });
  }

  /** Login/error HTML masquerading as target content. */
  serveHtml(path: string, options: { declaredLength?: number } = {}): void {
    const html = '<!DOCTYPE html><html><body><form>login</form></body></html>';
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(options.declaredLength ?? html.length),
      });
      response.end(html);
    });
  }

  redirect(path: string, location: string, status = 302): void {
    this.on(path, (_request, response) => {
      response.writeHead(status, { location });
      response.end();
    });
  }

  /** Expired signed locator: 403 until the fixture "issues" a fresh URL. */
  expireSigned(path: string, freshPath: string, body: Uint8Array, etag: string): void {
    this.on(path, (_request, response) => {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('signature expired');
    });
    this.serveFile(freshPath, { body, etag, contentType: 'video/mp4' });
  }

  /** Ambiguous origin: answers any request with 206 and no validator. */
  serveUnsolicited206(path: string, body: Uint8Array): void {
    this.on(path, (_request, response) => {
      response.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.end(Buffer.from(body));
    });
  }

  /** Media file with an MP4 `ftyp` box but a missing declared track box. */
  serveMediaMissingTrack(path: string, options: { etag: string }): void {
    const body = mp4WithoutTrackBox();
    this.serveFile(path, { body, etag: options.etag, contentType: 'video/mp4' });
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    this.requests.push({
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

/** Deterministic pseudo-media bytes: MP4 ftyp box, no moov/trak structure. */
export function mp4WithoutTrackBox(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[3] = 24; // box length prefix
  bytes.set(Buffer.from('ftyp', 'ascii'), 4);
  bytes.set(Buffer.from('isom', 'ascii'), 8);
  return bytes;
}
