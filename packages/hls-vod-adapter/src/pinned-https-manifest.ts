/**
 * S4 HTTPS-only, DNS/connected-peer pinned manifest reader.
 *
 * This is a Core-private *effect port*: callers must already possess a
 * durable Core manifest request intent, remaining budget and trusted
 * installation origin/playlist provenance. Constructing the port does not
 * grant authority to issue Core commands or access arbitrary HTTP URLs.
 *
 * Unlike the fixture-compatible legacy manifest port, production reads
 * never use global fetch(): Node HTTPS uses an exact public IPv4 lookup
 * pinned before connection, original hostname SNI/cert verification and
 * observed TLS remoteAddress equality. Redirects are NOT followed.
 */
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import {
  parsePublicHlsUriCandidate,
  type PublicHlsUriCandidate,
} from './public-uri-candidate.ts';
import { parsePublicIpv4TextCandidate } from './public-ipv4-text-candidate.ts';
import type {
  AuthorizedHlsManifestPort,
  HlsManifestAuthority,
  HlsManifestFetchResult,
} from './manifest-http.ts';

const HARD_MAX_MANIFEST_BYTES = 1024 * 1024;
const HARD_MAX_TIMEOUT_MS = 30_000;
const MAX_DNS_ANSWERS = 16;

type Refusal = Extract<HlsManifestFetchResult, { readonly ok: false }>;

function refuse(reason: Refusal['reason']): Refusal {
  return { ok: false, reason };
}

function exactOrigins(authority: HlsManifestAuthority): ReadonlySet<string> {
  if (
    !Number.isSafeInteger(authority.maxBytes) ||
    authority.maxBytes < 1 ||
    authority.maxBytes > HARD_MAX_MANIFEST_BYTES ||
    !Number.isSafeInteger(authority.timeoutMs) ||
    authority.timeoutMs < 1 ||
    authority.timeoutMs > HARD_MAX_TIMEOUT_MS ||
    !Array.isArray(authority.allowedOrigins) ||
    authority.allowedOrigins.length < 1 ||
    authority.allowedOrigins.length > 32 ||
    authority.allowLoopbackHttpFixture === true
  ) {
    throw new Error('invalid trusted pinned S4 HTTPS bounds');
  }
  const origins = new Set<string>();
  for (const origin of authority.allowedOrigins) {
    if (
      typeof origin !== 'string' ||
      parsePublicHlsUriCandidate(origin + '/__origin.m3u8', 'manifest')?.origin !== origin ||
      origins.has(origin)
    ) {
      throw new Error('pinned S4 origins must be unique canonical public HTTPS origins');
    }
    origins.add(origin);
  }
  return origins;
}

function validResponsePeer(
  response: IncomingMessage,
  pinnedAddress: string,
): boolean {
  const peer = response.socket as TLSSocket;
  return (
    peer.encrypted === true &&
    peer.authorized === true &&
    peer.remoteAddress === pinnedAddress
  );
}

function readPinnedManifest(
  source: PublicHlsUriCandidate,
  pinnedAddress: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<HlsManifestFetchResult> {
  return new Promise((resolve) => {
    let settled = false;
    let req: ClientRequest | undefined;
    const timer = setTimeout(() => finish(refuse('UNREACHABLE')), timeoutMs);

    function finish(result: HlsManifestFetchResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(result);
    }

    try {
      req = httpsRequest(
        source.href,
        {
          method: 'GET',
          agent: false,
          family: 4,
          autoSelectFamily: false,
          servername: source.hostname,
          rejectUnauthorized: true,
          maxHeaderSize: 8 * 1024,
          headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL' },
          lookup: (hostname, options, callback) => {
            // An HTTPS implementation that changes hostname or asks to
            // select from all addresses cannot bypass the pinned route.
            if (hostname !== source.hostname || options.all === true) {
              callback(new Error('pinned S4 lookup context changed'), '', 4);
              return;
            }
            callback(null, pinnedAddress, 4);
          },
        },
        (response) => {
          if (!validResponsePeer(response, pinnedAddress)) {
            finish(refuse('UNREACHABLE'));
            return;
          }
          if (response.statusCode !== 200) {
            finish(refuse('UNREACHABLE'));
            return;
          }
          const declared = response.headers['content-length'];
          if (
            (declared !== undefined &&
              (typeof declared !== 'string' ||
                !/^\d+$/u.test(declared) ||
                !Number.isSafeInteger(Number(declared)))) ||
            (typeof declared === 'string' && Number(declared) > maxBytes)
          ) {
            finish(refuse('OVERSIZE'));
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            if (!Buffer.isBuffer(chunk)) {
              finish(refuse('INVALID_MANIFEST'));
              return;
            }
            size += chunk.byteLength;
            if (size > maxBytes) {
              finish(refuse('OVERSIZE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('aborted', () => finish(refuse('UNREACHABLE')));
          response.on('error', () => finish(refuse('UNREACHABLE')));
          response.on('end', () => {
            if (settled) return;
            if (size === 0 || (declared !== undefined && Number(declared) !== size)) {
              finish(refuse('INVALID_MANIFEST'));
              return;
            }
            let text: string;
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
            } catch {
              finish(refuse('INVALID_MANIFEST'));
              return;
            }
            if (!text.startsWith('#EXTM3U') || text.includes('\0')) {
              finish(refuse('INVALID_MANIFEST'));
              return;
            }
            finish({ ok: true, text, byteLength: size });
          });
        },
      );
      req.on('socket', (socket) => {
        const peer = socket as TLSSocket;
        peer.once('secureConnect', () => {
          if (
            peer.encrypted !== true ||
            peer.authorized !== true ||
            peer.remoteAddress !== pinnedAddress
          ) {
            finish(refuse('UNREACHABLE'));
          }
        });
      });
      req.on('error', () => finish(refuse('UNREACHABLE')));
      req.end();
    } catch {
      finish(refuse('UNREACHABLE'));
    }
  });
}

/**
 * Instantiate only from a trusted Core/host installation profile.
 * No fixture HTTP escape hatch and no guest-provided DNS or TLS transport.
 */
export function createPinnedPublicHlsManifestPort(
  authority: HlsManifestAuthority,
): AuthorizedHlsManifestPort {
  const allowed = exactOrigins(authority);
  return Object.freeze({
    maxResponseBytes: authority.maxBytes,
    async fetchManifest(uri: string): Promise<HlsManifestFetchResult> {
      const source = parsePublicHlsUriCandidate(uri, 'manifest');
      if (source === undefined || !allowed.has(source.origin)) {
        return refuse('UNSUPPORTED');
      }
      let answers: readonly string[];
      try {
        answers = await resolve4(source.hostname);
      } catch {
        return refuse('UNREACHABLE');
      }
      // Reject on ANY unsafe A answer instead of selecting a safe-looking
      // address from a mixed private/public response. The actual connection
      // can use ONLY the selected, independently verified IPv4 address.
      if (
        !Array.isArray(answers) ||
        answers.length === 0 ||
        answers.length > MAX_DNS_ANSWERS ||
        answers.some((address) => parsePublicIpv4TextCandidate(address) === undefined)
      ) {
        return refuse('UNREACHABLE');
      }
      return readPinnedManifest(source, answers[0]!, authority.maxBytes, authority.timeoutMs);
    },
  });
}
