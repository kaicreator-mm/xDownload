/**
 * S4 real HTTP byte-delivery port, with NO independent download authority.
 *
 * A Core-owned, durably registered HLS effect must provide the approved exact
 * origins and remaining transfer budget before invoking this asynchronous
 * port. This module does not schedule jobs, accept artifacts or mint evidence.
 *
 * Redirects are deliberately rejected: new CDN locations need their own
 * explicit Core-reviewed provenance transition and budget admission.
 */
import type { SegmentPlanEntry } from './plan.ts';
import type { SegmentFetchResult } from './acquire.ts';

export interface AsyncSegmentFetcherPort {
  readonly fetcherId: string;
  /** Upper bound checked against Core remaining bytes before each HTTP effect. */
  readonly maxResponseBytes: number;
  fetch(entry: SegmentPlanEntry): Promise<SegmentFetchResult>;
}

export interface HttpSegmentSourceAuthority {
  /** Exact origin tuples installed by a trusted Core/host, never page text. */
  readonly allowedOrigins: readonly string[];
  /** Per-response byte bound, also subject to the separate Core budget. */
  readonly maxBytes: number;
  readonly timeoutMs: number;
  /** Explicit fixture-only exception; a production caller MUST leave false. */
  readonly allowLoopbackHttpFixture?: boolean;
}

const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;

function isFixtureOrigin(url: URL): boolean {
  return url.protocol === 'http:' && url.hostname === '127.0.0.1';
}

function canonicalSource(url: URL, localFixture: boolean): boolean {
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname.length === 0
  ) {
    return false;
  }
  return url.protocol === 'https:' || (localFixture && isFixtureOrigin(url));
}

function rejected(failure: 'UNREACHABLE' | 'TRUNCATED' | 'FAILED'): SegmentFetchResult {
  return { ok: false, failure };
}

/**
 * Creates an exact-origin source-restricted S4 byte port.
 *
 * Reading happens only when the Core invokes fetch() INSIDE an already
 * journaled effect. The response stays untrusted until the independent
 * format+media assembly/probe has validated all planned segments.
 */
export function createAuthorizedHttpSegmentFetcher(
  options: HttpSegmentSourceAuthority,
): AsyncSegmentFetcherPort {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > MAX_SEGMENT_BYTES ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > MAX_TIMEOUT_MS ||
    options.allowedOrigins.length === 0 ||
    options.allowedOrigins.length > 32
  ) {
    throw new Error('invalid S4 trusted source bounds');
  }

  const origins = new Set<string>();
  for (const declared of options.allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(declared);
    } catch {
      throw new Error('invalid S4 trusted source origin');
    }
    if (
      !canonicalSource(parsed, options.allowLoopbackHttpFixture === true) ||
      parsed.href !== parsed.origin + '/' ||
      origins.has(parsed.origin)
    ) {
      throw new Error('S4 trusted source origins must be unique, exact and credential-free');
    }
    origins.add(parsed.origin);
  }

  return Object.freeze({
    fetcherId: 's4-authorized-http-segment-v1',
    maxResponseBytes: options.maxBytes,
    async fetch(entry: SegmentPlanEntry): Promise<SegmentFetchResult> {
      let selected: URL;
      try {
        selected = new URL(entry.locator.locator.uri);
      } catch {
        return rejected('FAILED');
      }
      if (
        !canonicalSource(selected, options.allowLoopbackHttpFixture === true) ||
        !origins.has(selected.origin)
      ) {
        return rejected('UNREACHABLE');
      }

      const range = entry.byterange;
      if (
        range !== undefined &&
        (!Number.isSafeInteger(range.offset) ||
          range.offset < 0 ||
          !Number.isSafeInteger(range.length) ||
          range.length < 1 ||
          range.length > options.maxBytes ||
          !Number.isSafeInteger(range.offset + range.length - 1))
      ) {
        return rejected('FAILED');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const headers: Record<string, string> = {};
        if (range !== undefined) {
          headers['Range'] = `bytes=${range.offset}-${range.offset + range.length - 1}`;
        }
        const response = await fetch(selected, {
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
          headers,
        });
        if (response.status >= 300 && response.status < 400) {
          return rejected('UNREACHABLE');
        }
        if (response.status !== (range === undefined ? 200 : 206)) {
          return rejected('FAILED');
        }
        if (range !== undefined) {
          const value = response.headers.get('content-range');
          const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value ?? '');
          if (
            !match ||
            Number(match[1]) !== range.offset ||
            Number(match[2]) !== range.offset + range.length - 1
          ) {
            return rejected('FAILED');
          }
        }
        const declaredLength = response.headers.get('content-length');
        if (
          declaredLength !== null &&
          (!/^\d+$/.test(declaredLength) ||
            Number(declaredLength) > options.maxBytes ||
            (range !== undefined && Number(declaredLength) !== range.length))
        ) {
          return rejected('TRUNCATED');
        }
        if (response.body === null) return rejected('FAILED');
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            total += result.value.byteLength;
            if (total > options.maxBytes) {
              await reader.cancel();
              return rejected('TRUNCATED');
            }
            parts.push(result.value);
          }
        } finally {
          reader.releaseLock();
        }
        if (
          total < 1 ||
          (declaredLength !== null && total !== Number(declaredLength)) ||
          (range !== undefined && total !== range.length)
        ) {
          return rejected('TRUNCATED');
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        return { ok: true, bytes };
      } catch {
        return rejected('UNREACHABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
