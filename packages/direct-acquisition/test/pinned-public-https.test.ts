import { EventEmitter } from 'node:events';
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  digestPublicMediaSourceProfile,
  pinPublicMediaSourcePolicy,
  type PinnedPublicMediaSourcePolicy,
  type PublicMediaSourceProfile,
} from '../src/public-media-source.ts';
import { createPinnedPublicS3HttpsReader } from '../src/pinned-public-https.ts';

vi.mock('node:dns/promises', () => ({ resolve4: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

const ORIGIN = 'https://media.example.org/media/clip.mp4';
const REDIRECT = 'https://cdn.example.org/media/clip.mp4';
const profile: PublicMediaSourceProfile = {
  profileId: 'installed-s3-profile',
  revision: '1',
  origins: [{ scheme: 'https', hostname: 'media.example.org', port: 443 }],
  redirectOrigins: [{ scheme: 'https', hostname: 'cdn.example.org', port: 443 }],
};
const policy = pinPublicMediaSourcePolicy(profile, digestPublicMediaSourceProfile(profile));
type Reply = {
  status?: number;
  location?: string;
  body?: Uint8Array;
  headerLength?: string;
  peerIp?: string;
  authorized?: boolean;
  contentType?: string;
};
let nextReplies: Reply[] = [];
const seen: { uri: string; opts: Record<string, unknown> }[] = [];

function reader(pinnedPolicy: PinnedPublicMediaSourcePolicy = policy, timeoutMs = 1000) {
  return createPinnedPublicS3HttpsReader(pinnedPolicy, {
    maxBytes: 1024,
    timeoutMs,
    maxRedirects: 2,
  });
}
beforeEach(() => {
  vi.mocked(resolve4).mockResolvedValue(['8.8.8.8']);
  nextReplies = [];
  seen.length = 0;
  vi.mocked(httpsRequest).mockImplementation((uri, options, callback) => {
    const href = String(uri);
    const opts = options as unknown as Record<string, unknown>;
    seen.push({ uri: href, opts });
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    req.destroy = vi.fn();
    req.end = () => {
      queueMicrotask(() => {
        const reply = nextReplies.shift() ?? { status: 200, body: Uint8Array.from([0, 1, 2]) };
        const socket = Object.assign(new EventEmitter(), {
          encrypted: true,
          authorized: reply.authorized ?? true,
          remoteAddress: reply.peerIp ?? '8.8.8.8',
        });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const response = Object.assign(new EventEmitter(), {
          statusCode: reply.status ?? 200,
          socket,
          headers: {
            ...(reply.location ? { location: reply.location } : {}),
            ...((reply.status ?? 200) === 200
              ? {
                  'content-length': reply.headerLength ??
                    String((reply.body ?? Uint8Array.from([0, 1, 2])).length),
                  'content-type': reply.contentType ?? 'video/mp4',
                }
              : {}),
          },
        });
        (callback as (value: unknown) => void)(response);
        queueMicrotask(() => {
          if ((reply.status ?? 200) === 200 && reply.body !== undefined) {
            response.emit('data', Buffer.from(reply.body));
          } else if ((reply.status ?? 200) === 200) {
            response.emit('data', Buffer.from([0, 1, 2]));
          }
          response.emit('end');
        });
      });
    };
    return req as never;
  });
});
afterEach(() => vi.resetAllMocks());

describe('#150 S3 pinned HTTPS byte transport (not installed Core authority)', () => {
  it('reads exact bounded public media bytes using strict DNS lookup and validated TLS socket', async () => {
    nextReplies.push({ body: Uint8Array.from([1, 2, 3, 4]) });
    const outcome = await reader().read(ORIGIN);
    expect(outcome).toMatchObject({
      ok: true,
      bytes: Uint8Array.from([1, 2, 3, 4]),
      visited: [ORIGIN],
      contentType: 'video/mp4',
    });
    expect(resolve4).toHaveBeenCalledWith('media.example.org');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.opts).toMatchObject({
      method: 'GET', agent: false, family: 4,
      servername: 'media.example.org', rejectUnauthorized: true,
    });
    const lookup = seen[0]?.opts['lookup'] as (
      host: string, options: { all: boolean },
      cb: (error: Error | null, ip?: string, family?: number) => void,
    ) => void;
    let chosen: unknown;
    lookup('media.example.org', { all: false }, (_error, ip, family) => {
      chosen = [ip, family];
    });
    expect(chosen).toEqual(['8.8.8.8', 4]);
  });

  it('re-pins each independently admitted explicit redirect instead of following automatically', async () => {
    nextReplies.push({ status: 302, location: REDIRECT });
    nextReplies.push({ status: 200, body: Uint8Array.from([1, 2]) });
    const value = await reader().read(ORIGIN);
    expect(value).toMatchObject({ ok: true, visited: [ORIGIN, REDIRECT] });
    expect(seen.map((x) => x.uri)).toEqual([ORIGIN, REDIRECT]);
    expect(resolve4).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['private A', ['8.8.8.8', '127.0.0.1']],
    ['link local', ['169.254.169.254']],
    ['private v4', ['10.1.2.3']],
    ['test-net', ['203.0.113.1']],
    ['IPv6', ['2001:4860:4860::8888']],
    ['ambiguous v4', ['008.008.008.008']],
    ['empty', []],
  ])('rejects %s DNS answer sets before any socket is created', async (_name, answers) => {
    vi.mocked(resolve4).mockResolvedValue(answers);
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'DNS_REJECTED' });
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('refuses changed actual remote IP, unauthorized TLS, and forged host lookups', async () => {
    nextReplies.push({ peerIp: '1.1.1.1' });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'TLS_REJECTED' });
    nextReplies.push({ authorized: false });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'TLS_REJECTED' });
    const lookup = seen[0]?.opts['lookup'] as (
      host: string, options: { all: boolean },
      cb: (error: Error | null) => void,
    ) => void;
    let denied = false;
    lookup('evil.example.org', { all: false }, (error) => {
      denied = error instanceof Error;
    });
    expect(denied).toBe(true);
  });

  it.each([
    'http://127.0.0.1/media/clip.mp4',
    'https://media.example.org/media/clip.mp4?auth=secret',
    'https://alice:secret@media.example.org/media/clip.mp4',
    'https://media.example.org/media/%63lip.mp4',
    'https://other.example.org/media/clip.mp4',
  ])('refuses unapproved original URI without DNS/network: %s', async (uri) => {
    expect(await reader().read(uri)).toEqual({ ok: false, reason: 'SOURCE_REJECTED' });
    expect(resolve4).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rejects redirect to private URI/unknown CDN and never issues the second request', async () => {
    nextReplies.push({ status: 302, location: 'https://127.0.0.1/media/secret.mp4' });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'SOURCE_REJECTED' });
    expect(seen).toHaveLength(1);
    nextReplies.push({ status: 302, location: 'https://unknown.example.org/media/clip.mp4' });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'SOURCE_REJECTED' });
    expect(seen).toHaveLength(2);
  });

  it('enforces media bytes/declared length and hard bounds without claiming format/media PASS', async () => {
    nextReplies.push({ body: Uint8Array.from([1, 2]), headerLength: '4' });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'BODY_INVALID' });
    nextReplies.push({ body: new Uint8Array(1025), headerLength: '1025' });
    expect(await reader().read(ORIGIN)).toEqual({ ok: false, reason: 'OVERSIZE' });
    expect(() => createPinnedPublicS3HttpsReader(policy, {
      maxBytes: 128 * 1024 * 1024, timeoutMs: 100, maxRedirects: 5,
    })).toThrow();
  });

  it('bounds hung DNS by the same monotonic wall deadline without attempting network', async () => {
    vi.mocked(resolve4).mockImplementation(() => new Promise(() => {}));
    expect(await reader(policy, 5).read(ORIGIN)).toEqual({ ok: false, reason: 'DNS_REJECTED' });
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});
