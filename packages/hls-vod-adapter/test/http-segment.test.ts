import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
import { preflightSelectedHlsVod } from '../src/selected-preflight.ts';
import { createAuthorizedHttpSegmentFetcher } from '../src/http-segment.ts';
import type { SegmentPlanEntry } from '../src/plan.ts';

let server: Server;
let origin = '';
let forbiddenVisited = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/media/ok.ts':
        res.writeHead(200, { 'content-length': '4' });
        res.end('abcd');
        break;
      case '/media/redirect.ts':
        res.writeHead(302, { location: '/media/forbidden.ts' });
        res.end();
        break;
      case '/media/forbidden.ts':
        forbiddenVisited += 1;
        res.writeHead(200);
        res.end('wrong');
        break;
      case '/media/range.ts':
        res.writeHead(206, {
          'content-length': '3',
          'content-range': 'bytes 2-4/9',
        });
        res.end('234');
        break;
      case '/media/range-wrong.ts':
        res.writeHead(206, {
          'content-length': '3',
          'content-range': 'bytes 0-2/9',
        });
        res.end('234');
        break;
      case '/media/oversize.ts':
        res.writeHead(200);
        res.end('12345678901234567890');
        break;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no test socket');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function segment(path: string, range?: { readonly offset: number; readonly length: number }) {
  const target = unwrapOrThrow(makeLogicalTargetId('s4-real-http-fixture-001'));
  const manifestUri = `${origin}/master.m3u8`;
  const manifestLocator = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: manifestUri }, target, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: manifestUri,
    }),
  );
  const planned = preflightSelectedHlsVod({
    logicalTargetId: target,
    manifestLocator,
    masterText: [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="xdv1-video"',
      'v360/index.m3u8',
    ].join('\n'),
    selectedRenditionUri: `${origin}/v360/index.m3u8`,
    mediaText: [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:4.0,',
      '../media/ok.ts',
      '#EXT-X-ENDLIST',
    ].join('\n'),
  });
  if (!planned.ok) {
    throw new Error(planned.diagnostics.map((x) => x.message).join(';'));
  }
  const original = planned.value.segmentPlan.entries[0]!;
  return {
    ...original,
    locator: {
      ...original.locator,
      locator: { kind: 'direct' as const, uri: `${origin}${path}` },
    },
    ...(range === undefined ? {} : { byterange: range }),
  } as SegmentPlanEntry;
}

function transport(maxBytes = 64) {
  return createAuthorizedHttpSegmentFetcher({
    allowedOrigins: [origin],
    maxBytes,
    timeoutMs: 2_000,
    allowLoopbackHttpFixture: true,
  });
}

describe('S4 authorized asynchronous HTTP segment transport', () => {
  it('fetches real bytes from the explicitly pinned fixture origin', async () => {
    const result = await transport().fetch(segment('/media/ok.ts'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe('abcd');
  });

  it('does not follow an unapproved redirect or contact the redirected path', async () => {
    const before = forbiddenVisited;
    const result = await transport().fetch(segment('/media/redirect.ts'));
    expect(result).toMatchObject({ ok: false, failure: 'UNREACHABLE' });
    expect(forbiddenVisited).toBe(before);
  });

  it('enforces a byte cap while reading, even without Content-Length', async () => {
    const result = await transport(8).fetch(segment('/media/oversize.ts'));
    expect(result).toMatchObject({ ok: false, failure: 'TRUNCATED' });
  });

  it('requires strong exact 206 range correspondence for a byterange', async () => {
    const range = { offset: 2, length: 3 };
    const ok = await transport().fetch(segment('/media/range.ts', range));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(new TextDecoder().decode(ok.bytes)).toBe('234');
    const denied = await transport().fetch(segment('/media/range-wrong.ts', range));
    expect(denied).toMatchObject({ ok: false, failure: 'FAILED' });
  });

  it('rejects query secrets, unapproved origins and invalid source configuration', async () => {
    expect(
      await transport().fetch(segment('/media/ok.ts?signature=secret')),
    ).toMatchObject({ ok: false, failure: 'UNREACHABLE' });
    expect(
      await transport().fetch({
        ...segment('/media/ok.ts'),
        locator: {
          ...segment('/media/ok.ts').locator,
          locator: { kind: 'direct', uri: 'https://unapproved.example.test/media/ok.ts' },
        },
      }),
    ).toMatchObject({ ok: false, failure: 'UNREACHABLE' });
    expect(() =>
      createAuthorizedHttpSegmentFetcher({
        allowedOrigins: [origin],
        maxBytes: 64,
        timeoutMs: 2_000,
      }),
    ).toThrow('trusted source origins');
  });
});
