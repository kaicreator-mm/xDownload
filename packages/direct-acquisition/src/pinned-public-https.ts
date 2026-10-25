/**
 * #150 S3 public-file HTTPS transport. This is a bounded network BYTE port,
 * NOT a Core command, installed selection authority, or Media/COMPLETE proof.
 *
 * Every hop: strict media HTTPS URL -> independently pinned Core source
 * policy -> DNS A all-public classification -> pinned lookup to one public IP
 * -> hostname SNI / CA verification -> exact connected peer IP equality.
 * Node fetch and transparent redirects are deliberately prohibited.
 */
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { TLSSocket } from 'node:tls';
import type { PinnedPublicMediaSourcePolicy } from './public-media-source.ts';

const CIDRS = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc01fc400, 24],
  [0xc034c100, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc0af3000, 24],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
] as const;
const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]{1,64}\.(mp4|m4a|mp3|webm)$/u;
const HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_MS = 30_000;

export type PinnedS3HttpsReadResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly contentType: string | undefined;
      readonly visited: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'SOURCE_REJECTED'
        | 'DNS_REJECTED'
        | 'TLS_REJECTED'
        | 'HTTP_REJECTED'
        | 'OVERSIZE'
        | 'TIMEOUT'
        | 'BODY_INVALID';
    };

export interface PinnedS3HttpsReadBounds {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
}

function failure(
  reason: Extract<PinnedS3HttpsReadResult, { ok: false }>['reason'],
): PinnedS3HttpsReadResult {
  return { ok: false, reason };
}

function publicIpv4(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return false;
  const parts = value.split('.');
  if (parts.some((part) => (part.length > 1 && part.startsWith('0')) || Number(part) > 255)) {
    return false;
  }
  const [a, b, c, d] = parts.map(Number);
  const ip = ((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0;
  return !CIDRS.some(([network, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (network & mask) >>> 0;
  });
}

interface MediaUrl {
  readonly href: string;
  readonly hostname: string;
}
function mediaUrl(raw: unknown): MediaUrl | undefined {
  if (
    typeof raw !== 'string' ||
    raw.length < 25 ||
    raw.length > 2048 ||
    !/^[\x21-\x7e]+$/u.test(raw) ||
    /[%?#@\\]/u.test(raw)
  )
    return undefined;
  const candidate = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/.*)$/u.exec(raw);
  if (
    !candidate ||
    !HOST.test(candidate[1]!) ||
    !candidate[1]!.includes('.') ||
    candidate[1]!.endsWith('.') ||
    !MEDIA_PATH.test(candidate[3]!)
  )
    return undefined;
  const port = candidate[2];
  if (
    port !== undefined &&
    (String(Number(port)) !== port || Number(port) < 1 || Number(port) > 65535)
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    if (
      parsed.href !== raw ||
      parsed.protocol !== 'https:' ||
      parsed.hostname !== candidate[1] ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.pathname !== candidate[3]
    )
      return undefined;
    return { href: raw, hostname: parsed.hostname };
  } catch {
    return undefined;
  }
}

async function resolvePublic(hostname: string, deadline: number): Promise<string | undefined> {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) return undefined;
  const answers = await new Promise<readonly string[] | undefined>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(undefined), remaining);
    function finish(value: readonly string[] | undefined): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    void Promise.resolve()
      .then(() => resolve4(hostname))
      .then(
        (values) => finish(values),
        () => finish(undefined),
      );
  });
  if (
    performance.now() >= deadline ||
    !Array.isArray(answers) ||
    answers.length < 1 ||
    answers.length > 16 ||
    answers.some((ip) => !publicIpv4(ip))
  )
    return undefined;
  return answers[0];
}

type HttpsHop =
  | { readonly kind: 'body'; readonly bytes: Uint8Array; readonly contentType: string | undefined }
  | { readonly kind: 'redirect'; readonly location: string }
  | {
      readonly kind: 'failure';
      readonly reason: Extract<PinnedS3HttpsReadResult, { ok: false }>['reason'];
    };

function hop(
  uri: MediaUrl,
  pinnedIp: string,
  maxBytes: number,
  deadline: number,
): Promise<HttpsHop> {
  return new Promise((resolve) => {
    let done = false;
    let req: ClientRequest | undefined;
    const left = Math.floor(deadline - performance.now());
    if (left <= 0) {
      resolve({ kind: 'failure', reason: 'TIMEOUT' });
      return;
    }
    const timer = setTimeout(() => finish({ kind: 'failure', reason: 'TIMEOUT' }), left);
    function finish(value: HttpsHop): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(value);
    }
    function peerOkay(socket: TLSSocket): boolean {
      return (
        socket.encrypted === true && socket.authorized === true && socket.remoteAddress === pinnedIp
      );
    }
    try {
      req = httpsRequest(
        uri.href,
        {
          method: 'GET',
          agent: false,
          family: 4,
          servername: uri.hostname,
          rejectUnauthorized: true,
          maxHeaderSize: 8192,
          headers: { Accept: 'video/*, audio/*' },
          lookup: (hostname, options, callback) => {
            if (hostname !== uri.hostname || options.all === true) {
              callback(new Error('S3 pinned DNS hostname changed'), '', 4);
              return;
            }
            callback(null, pinnedIp, 4);
          },
        },
        (response: IncomingMessage) => {
          if (!peerOkay(response.socket as TLSSocket)) {
            finish({ kind: 'failure', reason: 'TLS_REJECTED' });
            return;
          }
          const code = response.statusCode;
          if (code !== undefined && REDIRECTS.has(code)) {
            const location = response.headers['location'];
            if (typeof location !== 'string') {
              finish({ kind: 'failure', reason: 'HTTP_REJECTED' });
              return;
            }
            finish({ kind: 'redirect', location });
            return;
          }
          if (code !== 200) {
            finish({ kind: 'failure', reason: 'HTTP_REJECTED' });
            return;
          }
          const declared = response.headers['content-length'];
          if (
            declared !== undefined &&
            (typeof declared !== 'string' ||
              !/^\d+$/u.test(declared) ||
              !Number.isSafeInteger(Number(declared)) ||
              Number(declared) > maxBytes)
          ) {
            finish({ kind: 'failure', reason: 'OVERSIZE' });
            return;
          }
          const contentType = response.headers['content-type'];
          if (contentType !== undefined && typeof contentType !== 'string') {
            finish({ kind: 'failure', reason: 'BODY_INVALID' });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: unknown) => {
            if (done) return;
            if (!Buffer.isBuffer(chunk)) {
              finish({ kind: 'failure', reason: 'BODY_INVALID' });
              return;
            }
            size += chunk.length;
            if (size > maxBytes) {
              finish({ kind: 'failure', reason: 'OVERSIZE' });
              return;
            }
            chunks.push(chunk);
          });
          response.once('aborted', () => finish({ kind: 'failure', reason: 'HTTP_REJECTED' }));
          response.once('error', () => finish({ kind: 'failure', reason: 'HTTP_REJECTED' }));
          response.once('end', () => {
            if (done) return;
            if (size === 0 || (declared !== undefined && size !== Number(declared))) {
              finish({ kind: 'failure', reason: 'BODY_INVALID' });
              return;
            }
            finish({ kind: 'body', bytes: Buffer.concat(chunks), contentType });
          });
        },
      );
      req.once('socket', (socket) => {
        const peer = socket as TLSSocket;
        peer.once('secureConnect', () => {
          if (!peerOkay(peer)) finish({ kind: 'failure', reason: 'TLS_REJECTED' });
        });
      });
      req.once('error', () => finish({ kind: 'failure', reason: 'TLS_REJECTED' }));
      req.end();
    } catch {
      finish({ kind: 'failure', reason: 'TLS_REJECTED' });
    }
  });
}

/**
 * A Core-private network effect primitive, without authority to mint any
 * selected/confirmed S3 Core work item. An installed Core composer must later
 * provide trusted policy and persisted authority before ever calling read().
 */
export function createPinnedPublicS3HttpsReader(
  policy: PinnedPublicMediaSourcePolicy,
  bounds: PinnedS3HttpsReadBounds,
): Readonly<{ read(uri: string): Promise<PinnedS3HttpsReadResult> }> {
  const maxBytes = bounds.maxBytes;
  const timeoutMs = bounds.timeoutMs;
  const maxRedirects = bounds.maxRedirects;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_MS ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 3
  )
    throw new Error('S3 HTTPS reader requires bounded trusted configuration');
  return Object.freeze({
    async read(uri: string): Promise<PinnedS3HttpsReadResult> {
      const deadline = performance.now() + timeoutMs;
      let next = uri;
      const visited: string[] = [];
      for (let redirectIndex = 0; redirectIndex <= maxRedirects; redirectIndex += 1) {
        const parsed = mediaUrl(next);
        if (parsed === undefined) return failure('SOURCE_REJECTED');
        // Policy may be an injected test double. Independently verify the
        // HTTPS/URI/public IP constraints; do not treat admission as Core grant.
        const admission =
          redirectIndex === 0 ? policy.admitInitial(next) : policy.admitRedirect(next);
        if (!admission.ok || admission.uri !== next || visited.includes(next)) {
          return failure('SOURCE_REJECTED');
        }
        const pinnedIp = await resolvePublic(parsed.hostname, deadline);
        if (pinnedIp === undefined) return failure('DNS_REJECTED');
        visited.push(next);
        const reply = await hop(parsed, pinnedIp, maxBytes, deadline);
        if (reply.kind === 'failure') return failure(reply.reason);
        if (reply.kind === 'body') {
          return {
            ok: true,
            bytes: reply.bytes,
            contentType: reply.contentType,
            visited: Object.freeze(visited),
          };
        }
        if (redirectIndex === maxRedirects) return failure('HTTP_REJECTED');
        next = reply.location;
      }
      return failure('HTTP_REJECTED');
    },
  });
}
