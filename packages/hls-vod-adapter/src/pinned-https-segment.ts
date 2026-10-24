/**
 * Core-private S4 MPEG-TS segment reader with DNS/connected-IP pinned HTTPS.
 * A trusted Core must already journal and budget each selected plan entry.
 * No redirects, bearer credentials, generic URL fetch, or media PASS here.
 */
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { TLSSocket } from 'node:tls';
import type { SegmentFetchResult } from './acquire.ts';
import type { AsyncSegmentFetcherPort, HttpSegmentSourceAuthority } from './http-segment.ts';
import type { SegmentPlanEntry } from './plan.ts';
import { parsePublicHlsUriCandidate } from './public-uri-candidate.ts';
import { parsePublicIpv4TextCandidate } from './public-ipv4-text-candidate.ts';

const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;
const MAX_DNS_A = 16;

function rejected(failure: 'FAILED' | 'UNREACHABLE' | 'TRUNCATED'): SegmentFetchResult {
  return { ok: false, failure };
}

function checkedOrigins(config: HttpSegmentSourceAuthority): ReadonlySet<string> {
  if (
    !Number.isSafeInteger(config.maxBytes) ||
    config.maxBytes < 1 ||
    config.maxBytes > MAX_SEGMENT_BYTES ||
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > MAX_TIMEOUT_MS ||
    !Array.isArray(config.allowedOrigins) ||
    config.allowedOrigins.length === 0 ||
    config.allowedOrigins.length > 32 ||
    config.allowLoopbackHttpFixture === true
  ) {
    throw new Error('invalid pinned S4 segment bounds');
  }
  const origins = new Set<string>();
  for (const origin of config.allowedOrigins) {
    if (
      typeof origin !== 'string' ||
      parsePublicHlsUriCandidate(origin + '/__origin.ts', 'mpegts-segment')?.origin !== origin ||
      origins.has(origin)
    ) {
      throw new Error('S4 segment origins must be unique canonical public HTTPS origins');
    }
    origins.add(origin);
  }
  return origins;
}

async function pinDns(
  hostname: string,
  deadline: number,
): Promise<{ readonly ip: string; readonly remainingMs: number } | undefined> {
  const left = Math.floor(deadline - performance.now());
  if (left <= 0) return undefined;
  const answers = await new Promise<readonly string[] | undefined>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(undefined), left);
    function finish(value: readonly string[] | undefined): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    void Promise.resolve()
      .then(() => resolve4(hostname))
      .then(
        (value) => finish(value),
        () => finish(undefined),
      );
  });
  const remainingMs = Math.floor(deadline - performance.now());
  if (
    remainingMs <= 0 ||
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_DNS_A ||
    answers.some((ip) => parsePublicIpv4TextCandidate(ip) === undefined)
  ) {
    return undefined;
  }
  return { ip: answers[0]!, remainingMs };
}

function fetchPinned(
  href: string,
  hostname: string,
  ip: string,
  maxBytes: number,
  timeoutMs: number,
  range: SegmentPlanEntry['byterange'],
): Promise<SegmentFetchResult> {
  return new Promise((resolve) => {
    let settled = false;
    let req: ClientRequest | undefined;
    const timer = setTimeout(() => finish(rejected('UNREACHABLE')), timeoutMs);
    function finish(result: SegmentFetchResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(result);
    }
    try {
      req = httpsRequest(
        href,
        {
          method: 'GET',
          agent: false,
          family: 4,
          servername: hostname,
          rejectUnauthorized: true,
          maxHeaderSize: 8192,
          headers:
            range === undefined
              ? {}
              : { Range: 'bytes=' + range.offset + '-' + (range.offset + range.length - 1) },
          lookup: (observedHost, options, callback) => {
            if (observedHost !== hostname || options.all === true) {
              callback(new Error('S4 pinned hostname changed'), '', 4);
              return;
            }
            callback(null, ip, 4);
          },
        },
        (response: IncomingMessage) => {
          const peer = response.socket as TLSSocket;
          if (peer.encrypted !== true || peer.authorized !== true || peer.remoteAddress !== ip) {
            finish(rejected('UNREACHABLE'));
            return;
          }
          if (response.statusCode !== (range === undefined ? 200 : 206)) {
            finish(rejected('UNREACHABLE'));
            return;
          }
          if (range !== undefined) {
            const value = response.headers['content-range'];
            const match =
              typeof value === 'string' ? /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value) : null;
            if (
              match === null ||
              Number(match[1]) !== range.offset ||
              Number(match[2]) !== range.offset + range.length - 1
            ) {
              finish(rejected('FAILED'));
              return;
            }
          }
          const declared = response.headers['content-length'];
          if (
            declared !== undefined &&
            (typeof declared !== 'string' ||
              !/^\d+$/u.test(declared) ||
              !Number.isSafeInteger(Number(declared)) ||
              Number(declared) > maxBytes ||
              (range !== undefined && Number(declared) !== range.length))
          ) {
            finish(rejected('TRUNCATED'));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            if (!Buffer.isBuffer(chunk)) {
              finish(rejected('FAILED'));
              return;
            }
            size += chunk.length;
            if (size > maxBytes || (range !== undefined && size > range.length)) {
              finish(rejected('TRUNCATED'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', () => finish(rejected('UNREACHABLE')));
          response.on('aborted', () => finish(rejected('UNREACHABLE')));
          response.on('end', () => {
            if (settled) return;
            if (
              size === 0 ||
              (declared !== undefined && size !== Number(declared)) ||
              (range !== undefined && size !== range.length)
            ) {
              finish(rejected('TRUNCATED'));
              return;
            }
            const data = Buffer.concat(chunks, size);
            finish({ ok: true, bytes: new Uint8Array(data) });
          });
        },
      );
      req.on('socket', (socket) => {
        const peer = socket as TLSSocket;
        peer.once('secureConnect', () => {
          if (peer.encrypted !== true || peer.authorized !== true || peer.remoteAddress !== ip) {
            finish(rejected('UNREACHABLE'));
          }
        });
      });
      req.on('error', () => finish(rejected('UNREACHABLE')));
      req.end();
    } catch {
      finish(rejected('UNREACHABLE'));
    }
  });
}

/** Privileged host port; bounds are frozen on construction, not on first fetch. */
export function createPinnedPublicHlsSegmentFetcher(
  authority: HttpSegmentSourceAuthority,
): AsyncSegmentFetcherPort {
  const maxBytes = authority.maxBytes;
  const timeoutMs = authority.timeoutMs;
  const origins = checkedOrigins({
    maxBytes,
    timeoutMs,
    allowedOrigins: authority.allowedOrigins,
    allowLoopbackHttpFixture: authority.allowLoopbackHttpFixture,
  });
  return Object.freeze({
    fetcherId: 's4-pinned-public-https-segment-v1',
    maxResponseBytes: maxBytes,
    async fetch(entry: SegmentPlanEntry): Promise<SegmentFetchResult> {
      const source = parsePublicHlsUriCandidate(entry.locator.locator.uri, 'mpegts-segment');
      if (source === undefined || !origins.has(source.origin)) {
        return rejected('UNREACHABLE');
      }
      const range = entry.byterange;
      if (
        range !== undefined &&
        (!Number.isSafeInteger(range.offset) ||
          range.offset < 0 ||
          !Number.isSafeInteger(range.length) ||
          range.length < 1 ||
          range.length > maxBytes ||
          !Number.isSafeInteger(range.offset + range.length - 1))
      ) {
        return rejected('FAILED');
      }
      const pinned = await pinDns(source.hostname, performance.now() + timeoutMs);
      if (pinned === undefined) return rejected('UNREACHABLE');
      return fetchPinned(
        source.href,
        source.hostname,
        pinned.ip,
        maxBytes,
        pinned.remainingMs,
        range,
      );
    },
  });
}
