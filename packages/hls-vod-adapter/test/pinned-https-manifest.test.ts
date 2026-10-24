import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ resolve4: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ resolve4: network.resolve4 }));
vi.mock('node:https', () => ({ request: network.request }));

import { createPinnedPublicHlsManifestPort } from '../src/pinned-https-manifest.ts';

const ORIGIN = 'https://media.example.org';
const MANIFEST = ORIGIN + '/vod/master.m3u8';

interface TestRequestOptions {
  readonly agent: boolean;
  readonly family: number;
  readonly autoSelectFamily: boolean;
  readonly servername: string;
  readonly rejectUnauthorized: boolean;
  readonly lookup: (
    hostname: string,
    options: { readonly all?: boolean },
    cb: (error: Error | null, address: string, family: number) => void,
  ) => void;
}

interface ResponseStub {
  readonly remoteAddress?: string;
  readonly authorized?: boolean;
  readonly statusCode?: number;
  readonly body?: string;
  readonly declaredLength?: string;
}

function transport() {
  return createPinnedPublicHlsManifestPort({
    allowedOrigins: [ORIGIN],
    maxBytes: 128,
    timeoutMs: 2000,
  });
}

function simulateTlsResponse(overrides: ResponseStub = {}) {
  let observed: TestRequestOptions | undefined;
  const destroys = vi.fn();
  network.request.mockImplementation(
    (_url: unknown, rawOptions: unknown, onResponse: unknown) => {
      const options = rawOptions as TestRequestOptions;
      observed = options;
      const req = new EventEmitter() as EventEmitter & {
        destroy: () => void;
        end: () => void;
      };
      req.destroy = destroys;
      req.end = () => {
        let pinned: string | undefined;
        options.lookup('media.example.org', { all: false }, (error, address, family) => {
          if (!error && family === 4) pinned = address;
        });
        const socket = Object.assign(new EventEmitter(), {
          remoteAddress: overrides.remoteAddress ?? pinned,
          encrypted: true,
          authorized: overrides.authorized ?? true,
        });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        if (destroys.mock.calls.length > 0) return;
        const bytes = Buffer.from(overrides.body ?? '#EXTM3U\n#EXT-X-ENDLIST\n');
        const response = Object.assign(new EventEmitter(), {
          socket,
          statusCode: overrides.statusCode ?? 200,
          headers:
            overrides.declaredLength === undefined
              ? {}
              : { 'content-length': overrides.declaredLength },
        });
        (onResponse as (result: typeof response) => void)(response);
        response.emit('data', bytes);
        response.emit('end');
      };
      return req;
    },
  );
  return {
    options: () => observed,
    destroys,
  };
}

beforeEach(() => {
  network.resolve4.mockReset().mockResolvedValue(['8.8.8.8']);
  network.request.mockReset();
});

describe('S4 pinned public HTTPS manifest transport (isolated, not Core-enabled)', () => {
  it('reads a bounded manifest only through a pinned address, original SNI and verified TLS peer', async () => {
    const spy = simulateTlsResponse();
    const result = await transport().fetchManifest(MANIFEST);
    expect(result).toEqual({
      ok: true,
      text: '#EXTM3U\n#EXT-X-ENDLIST\n',
      byteLength: 22,
    });
    expect(network.resolve4).toHaveBeenCalledExactlyOnceWith('media.example.org');
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(spy.options()).toMatchObject({
      agent: false,
      family: 4,
      autoSelectFamily: false,
      servername: 'media.example.org',
      rejectUnauthorized: true,
    });
    let resolved: string | undefined;
    spy.options()?.lookup('media.example.org', {}, (error, address) => {
      if (!error) resolved = address;
    });
    expect(resolved).toBe('8.8.8.8');
  });

  it('never makes a socket request when ANY DNS A answer is private, special or IPv6', async () => {
    for (const answers of [
      ['8.8.8.8', '127.0.0.1'],
      ['169.254.169.254'],
      ['192.0.2.1'],
      ['::ffff:8.8.8.8'],
      [],
      Array.from({ length: 17 }, () => '8.8.8.8'),
    ]) {
      network.resolve4.mockResolvedValueOnce(answers);
      expect(await transport().fetchManifest(MANIFEST)).toEqual({
        ok: false,
        reason: 'UNREACHABLE',
      });
    }
    expect(network.request).not.toHaveBeenCalled();
  });

  it('rejects unapproved URLs before DNS, and rejects untrusted authority configuration', async () => {
    for (const uri of [
      'http://media.example.org/vod/master.m3u8',
      'https://other.example.net/vod/master.m3u8',
      'https://media.example.org/vod/master.m3u8?token=secret',
      'https://media.example.org/vod/%2e%2e/master.m3u8',
      'https://127.0.0.1/vod/master.m3u8',
    ]) {
      expect(await transport().fetchManifest(uri)).toEqual({
        ok: false,
        reason: 'UNSUPPORTED',
      });
    }
    expect(network.resolve4).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
    expect(() =>
      createPinnedPublicHlsManifestPort({
        allowedOrigins: [ORIGIN],
        maxBytes: 32,
        timeoutMs: 2000,
        allowLoopbackHttpFixture: true,
      }),
    ).toThrow('bounds');
    expect(() =>
      createPinnedPublicHlsManifestPort({
        allowedOrigins: [ORIGIN, ORIGIN],
        maxBytes: 32,
        timeoutMs: 2000,
      }),
    ).toThrow('unique');
  });

  it('fails closed on TLS peer address mismatch or unauthenticated peer', async () => {
    simulateTlsResponse({ remoteAddress: '10.0.0.3' });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    });
    simulateTlsResponse({ authorized: false });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    });
  });

  it('rejects redirect, oversize, truncation, HTML and DNS failures without positive media truth', async () => {
    simulateTlsResponse({ statusCode: 302 });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    });
    simulateTlsResponse({ declaredLength: '500' });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'OVERSIZE',
    });
    simulateTlsResponse({ declaredLength: '99' });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'INVALID_MANIFEST',
    });
    simulateTlsResponse({ body: '<html>not media</html>' });
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'INVALID_MANIFEST',
    });
    network.resolve4.mockRejectedValueOnce(new Error('DNS blocked'));
    expect(await transport().fetchManifest(MANIFEST)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    });
  });

  it('binds the lookup to the expected hostname, never a different DNS hostname', async () => {
    const spy = simulateTlsResponse();
    await transport().fetchManifest(MANIFEST);
    let refused: Error | null = null;
    spy.options()?.lookup('attacker.example.net', {}, (error) => {
      refused = error;
    });
    expect(refused).toBeInstanceOf(Error);
  });
});
