import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SegmentPlanEntry } from '../src/plan.ts';

const mock = vi.hoisted(() => ({ resolve4: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ resolve4: mock.resolve4 }));
vi.mock('node:https', () => ({ request: mock.request }));

import { createPinnedPublicHlsSegmentFetcher } from '../src/pinned-https-segment.ts';

const ORIGIN = 'https://media.example.org';
const URI = ORIGIN + '/video/part-001.ts';

function entry(uri = URI, range?: { offset: number; length: number }): SegmentPlanEntry {
  return {
    locator: { locator: { kind: 'direct', uri } },
    ...(range === undefined ? {} : { byterange: range }),
  } as SegmentPlanEntry;
}

function port() {
  return createPinnedPublicHlsSegmentFetcher({
    allowedOrigins: [ORIGIN],
    maxBytes: 32,
    timeoutMs: 2000,
  });
}

type FakeResponse = {
  readonly peer?: string;
  readonly authorized?: boolean;
  readonly code?: number;
  readonly length?: string;
  readonly contentRange?: string;
  readonly body?: string;
  readonly stall?: boolean;
};
function simulate(input: FakeResponse = {}) {
  let options: Record<string, unknown> | undefined;
  const destroy = vi.fn();
  mock.request.mockImplementation((_uri: unknown, raw: unknown, onResponse: unknown) => {
    options = raw as Record<string, unknown>;
    const req = Object.assign(new EventEmitter(), {
      destroy,
      end() {
        const lookup = options?.['lookup'] as (
          hostname: string,
          opts: { all: boolean },
          callback: (err: Error | null, address: string, family: number) => void,
        ) => void;
        let resolved: string | undefined;
        lookup('media.example.org', { all: false }, (err, value, family) => {
          if (err === null && family === 4) resolved = value;
        });
        const socket = Object.assign(new EventEmitter(), {
          encrypted: true,
          authorized: input.authorized ?? true,
          remoteAddress: input.peer ?? resolved,
        });
        req.emit('socket', socket);
        if (input.stall) return;
        socket.emit('secureConnect');
        if (destroy.mock.calls.length > 0) return;
        const body = Buffer.from(input.body ?? 'segment-data');
        const response = Object.assign(new EventEmitter(), {
          socket,
          statusCode: input.code ?? 200,
          headers: {
            ...(input.length === undefined ? {} : { 'content-length': input.length }),
            ...(input.contentRange === undefined ? {} : { 'content-range': input.contentRange }),
          },
        });
        (onResponse as (message: unknown) => void)(response);
        response.emit('data', body);
        response.emit('end');
      },
    });
    return req;
  });
  return { options: () => options, destroy };
}

beforeEach(() => {
  mock.resolve4.mockReset().mockResolvedValue(['8.8.8.8']);
  mock.request.mockReset();
});

describe('S4 production pinned HTTPS MPEG-TS segments (Core-private)', () => {
  it('uses original hostname SNI, one vetted DNS IPv4, verified TLS socket and bounded bytes', async () => {
    const transport = simulate();
    const result = await port().fetch(entry());
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe('segment-data');
    expect(transport.options()).toMatchObject({
      family: 4,
      agent: false,
      servername: 'media.example.org',
      rejectUnauthorized: true,
    });
    expect(mock.resolve4).toHaveBeenCalledExactlyOnceWith('media.example.org');
    expect(mock.request).toHaveBeenCalledTimes(1);
  });

  it('rejects all mixed private/special/IPv6 answers and unauthorized source before HTTPS', async () => {
    for (const addresses of [
      ['8.8.8.8', '127.0.0.1'],
      ['169.254.169.254'],
      ['::ffff:8.8.8.8'],
      [],
    ]) {
      mock.resolve4.mockResolvedValueOnce(addresses);
      expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'UNREACHABLE' });
    }
    expect(await port().fetch(entry('http://media.example.org/video/part.ts'))).toEqual({
      ok: false,
      failure: 'UNREACHABLE',
    });
    expect(await port().fetch(entry('https://other.example.net/part.ts'))).toEqual({
      ok: false,
      failure: 'UNREACHABLE',
    });
    expect(mock.request).not.toHaveBeenCalled();
  });

  it('enforces exact 206 byterange, Content-Range and length', async () => {
    simulate({ code: 206, contentRange: 'bytes 2-5/40', length: '4', body: '2345' });
    const result = await port().fetch(entry(URI, { offset: 2, length: 4 }));
    expect(result.ok).toBe(true);
    simulate({ code: 206, contentRange: 'bytes 0-3/40', length: '4', body: '2345' });
    expect(await port().fetch(entry(URI, { offset: 2, length: 4 }))).toEqual({
      ok: false,
      failure: 'FAILED',
    });
    simulate({ code: 206, contentRange: 'bytes 2-5/40', length: '3', body: '2345' });
    expect(await port().fetch(entry(URI, { offset: 2, length: 4 }))).toEqual({
      ok: false,
      failure: 'TRUNCATED',
    });
  });

  it('rejects a TLS socket mismatch, invalid certificate, redirect and truncated body', async () => {
    simulate({ peer: '10.0.0.2' });
    expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'UNREACHABLE' });
    simulate({ authorized: false });
    expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'UNREACHABLE' });
    simulate({ code: 302 });
    expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'UNREACHABLE' });
    simulate({ length: '500' });
    expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'TRUNCATED' });
    simulate({ length: '20' });
    expect(await port().fetch(entry())).toEqual({ ok: false, failure: 'TRUNCATED' });
  });

  it('snapshots validated limits and origin allowlist before caller mutations', async () => {
    const options = { allowedOrigins: [ORIGIN], maxBytes: 4, timeoutMs: 2000 };
    const transport = createPinnedPublicHlsSegmentFetcher(options);
    options.maxBytes = Number.MAX_SAFE_INTEGER;
    options.timeoutMs = Number.POSITIVE_INFINITY;
    options.allowedOrigins.push('https://other.example.net');
    simulate({ body: '12345678' });
    expect(transport.maxResponseBytes).toBe(4);
    expect(await transport.fetch(entry())).toEqual({ ok: false, failure: 'TRUNCATED' });
    expect(await transport.fetch(entry('https://other.example.net/a.ts'))).toEqual({
      ok: false,
      failure: 'UNREACHABLE',
    });
  });

  it('fences late DNS and a stalled handshake within one request deadline', async () => {
    vi.useFakeTimers();
    try {
      let resolveDns: ((value: string[]) => void) | undefined;
      mock.resolve4.mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            resolveDns = resolve;
          }),
      );
      const before = port().fetch(entry());
      await vi.advanceTimersByTimeAsync(2001);
      expect(await before).toEqual({ ok: false, failure: 'UNREACHABLE' });
      resolveDns?.(['8.8.8.8']);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock.request).not.toHaveBeenCalled();

      const connection = simulate({ stall: true });
      const handshake = port().fetch(entry());
      await vi.advanceTimersByTimeAsync(2001);
      expect(await handshake).toEqual({ ok: false, failure: 'UNREACHABLE' });
      expect(connection.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
