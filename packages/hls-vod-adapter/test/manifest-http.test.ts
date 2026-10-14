import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthorizedHlsManifestPort } from '../src/manifest-http.ts';

let server: Server;
let origin = '';
let followed = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/master.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXT-X-VERSION:3\n');
    } else if (request.url === '/oversized.m3u8') {
      response.writeHead(200);
      response.end('#EXTM3U\n' + 'x'.repeat(100));
    } else if (request.url === '/redirect.m3u8') {
      response.writeHead(302, { location: '/forbidden.m3u8' });
      response.end();
    } else if (request.url === '/forbidden.m3u8') {
      followed += 1;
      response.end('#EXTM3U\n');
    } else if (request.url === '/html.m3u8') {
      response.writeHead(200);
      response.end('<html>login</html>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function port(maxBytes = 64) {
  return createAuthorizedHlsManifestPort({
    allowedOrigins: [origin],
    maxBytes,
    timeoutMs: 2000,
    allowLoopbackHttpFixture: true,
  });
}

describe('S4 authorized bounded manifest HTTP transport', () => {
  it('fetches real selected manifest text under exact origin', async () => {
    const result = await port().fetchManifest(`${origin}/master.m3u8`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text.startsWith('#EXTM3U')).toBe(true);
  });

  it('rejects a redirect without contacting the destination', async () => {
    const before = followed;
    const result = await port().fetchManifest(`${origin}/redirect.m3u8`);
    expect(result).toEqual({ ok: false, reason: 'UNREACHABLE' });
    expect(followed).toBe(before);
  });

  it('rejects oversized streaming responses without accepting partial manifest', async () => {
    const result = await port(16).fetchManifest(`${origin}/oversized.m3u8`);
    expect(result).toEqual({ ok: false, reason: 'OVERSIZE' });
  });

  it('rejects HTML login and ignores untrusted body as parser proof', async () => {
    const result = await port().fetchManifest(`${origin}/html.m3u8`);
    expect(result).toEqual({ ok: false, reason: 'INVALID_MANIFEST' });
  });

  it('rejects query secrets, unknown origin and untrusted http config', async () => {
    expect(await port().fetchManifest(`${origin}/master.m3u8?sig=token`)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED',
    });
    expect(await port().fetchManifest('https://untrusted.example.test/master.m3u8')).toEqual({
      ok: false,
      reason: 'UNSUPPORTED',
    });
    expect(() =>
      createAuthorizedHlsManifestPort({
        allowedOrigins: [origin],
        maxBytes: 64,
        timeoutMs: 2000,
      }),
    ).toThrow('S4 manifest origins');
  });
});
