/**
 * S4 credential-free, bounded selected HLS manifest delivery.
 *
 * The trusted Core host owns the exact allowed origin/profile, and invokes
 * this read port only after a durable manifest-request intent and budget
 * reservation. This port has no authority to register effects or accept media.
 */
export interface HlsManifestAuthority {
  readonly allowedOrigins: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
  /** Only explicit real localhost test fixtures may use plaintext HTTP. */
  readonly allowLoopbackHttpFixture?: boolean;
}

export type HlsManifestFetchResult =
  | { readonly ok: true; readonly text: string; readonly byteLength: number }
  | {
      readonly ok: false;
      readonly reason: 'UNSUPPORTED' | 'UNREACHABLE' | 'OVERSIZE' | 'INVALID_MANIFEST';
    };

export interface AuthorizedHlsManifestPort {
  readonly maxResponseBytes: number;
  fetchManifest(uri: string): Promise<HlsManifestFetchResult>;
}

const HARD_MAX_BYTES = 1024 * 1024;
const HARD_MAX_TIMEOUT_MS = 30_000;

function isAllowedUrl(url: URL, allowFixture: boolean): boolean {
  const schemeAllowed =
    url.protocol === 'https:' ||
    (allowFixture && url.protocol === 'http:' && url.hostname === '127.0.0.1');
  return (
    schemeAllowed &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname.endsWith('.m3u8') &&
    !url.pathname.includes('%') &&
    !url.pathname.includes('//') &&
    !url.pathname.split('/').includes('..')
  );
}

/** Reject untrusted origin/profile configuration before any outbound effect. */
export function createAuthorizedHlsManifestPort(
  authority: HlsManifestAuthority,
): AuthorizedHlsManifestPort {
  if (
    !Number.isSafeInteger(authority.maxBytes) ||
    authority.maxBytes < 1 ||
    authority.maxBytes > HARD_MAX_BYTES ||
    !Number.isSafeInteger(authority.timeoutMs) ||
    authority.timeoutMs < 1 ||
    authority.timeoutMs > HARD_MAX_TIMEOUT_MS ||
    authority.allowedOrigins.length === 0 ||
    authority.allowedOrigins.length > 32
  ) {
    throw new Error('invalid trusted S4 manifest bounds');
  }
  const allowed = new Set<string>();
  for (const raw of authority.allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('invalid trusted S4 manifest origin');
    }
    const fixture =
      authority.allowLoopbackHttpFixture === true &&
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1';
    const validOrigin = parsed.protocol === 'https:' || fixture;
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.pathname !== '/' ||
      !validOrigin ||
      raw !== parsed.origin ||
      allowed.has(parsed.origin)
    ) {
      throw new Error('S4 manifest origins must be unique, exact and credential-free');
    }
    allowed.add(parsed.origin);
  }

  return Object.freeze({
    maxResponseBytes: authority.maxBytes,
    async fetchManifest(uri: string): Promise<HlsManifestFetchResult> {
      let selected: URL;
      try {
        selected = new URL(uri);
      } catch {
        return { ok: false, reason: 'UNSUPPORTED' };
      }
      if (
        !isAllowedUrl(selected, authority.allowLoopbackHttpFixture === true) ||
        !allowed.has(selected.origin)
      ) {
        return { ok: false, reason: 'UNSUPPORTED' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), authority.timeoutMs);
      try {
        const response = await fetch(selected, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL' },
          signal: controller.signal,
        });
        if (response.status !== 200 || response.body === null) {
          return { ok: false, reason: 'UNREACHABLE' };
        }
        const declared = response.headers.get('content-length');
        if (
          declared !== null &&
          (!/^\d+$/.test(declared) || Number(declared) > authority.maxBytes)
        ) {
          return { ok: false, reason: 'OVERSIZE' };
        }
        const chunks: Uint8Array[] = [];
        const reader = response.body.getReader();
        let size = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > authority.maxBytes) {
              await reader.cancel();
              return { ok: false, reason: 'OVERSIZE' };
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        if (size === 0 || (declared !== null && size !== Number(declared))) {
          return { ok: false, reason: 'INVALID_MANIFEST' };
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return { ok: false, reason: 'INVALID_MANIFEST' };
        }
        if (!text.startsWith('#EXTM3U') || text.includes('\0')) {
          return { ok: false, reason: 'INVALID_MANIFEST' };
        }
        // This is merely untrusted decoded text for the existing typed
        // master/media parser; never a positive Media validation outcome.
        return { ok: true, text, byteLength: size };
      } catch {
        return { ok: false, reason: 'UNREACHABLE' };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
