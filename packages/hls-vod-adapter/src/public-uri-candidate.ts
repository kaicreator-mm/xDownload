/**
 * S4 candidate URI syntax preflight for the public, credential-free HLS
 * profile. This is NOT an authorization or SSRF security boundary by itself.
 *
 * A successful parse only proves canonical public-looking URL *syntax*.
 * Core still must verify the trusted installation origin registry, actual
 * selected-playlist provenance, every redirect, DNS answer and pinned TLS
 * connected IP before any real network effect. Never use this result as
 * permission to call fetch() or to claim media validation.
 */
import { isIP } from 'node:net';

export type PublicHlsUriKind = 'manifest' | 'mpegts-segment';

export interface PublicHlsUriCandidate {
  readonly href: string;
  readonly origin: string;
  readonly hostname: string;
  readonly kind: PublicHlsUriKind;
}

const MAX_PUBLIC_HLS_URL_LENGTH = 2048;
const FORBIDDEN_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.invalid',
  '.test',
  '.example',
  '.onion',
  '.arpa',
] as const;

function hasCanonicalPublicHost(hostname: string): boolean {
  if (hostname.length < 4 || hostname.length > 253 || hostname.endsWith('.')) return false;
  if (isIP(hostname) !== 0) return false;
  if (FORBIDDEN_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
  );
}

/**
 * Parse one absolute HTTPS manifest or MPEG-TS segment URI. Never resolves
 * DNS, follows redirects, fetches remote bytes, or registers Core intent.
 *
 * Reject-on-ambiguity is intentional: queries, fragments, percent-encoded
 * paths, non-ASCII/raw IDNA, ports, userinfo and local/IP hosts are excluded
 * from this first public-only v0.1 profile.
 */
export function parsePublicHlsUriCandidate(
  raw: unknown,
  kind: PublicHlsUriKind,
): PublicHlsUriCandidate | undefined {
  if (
    typeof raw !== 'string' ||
    raw.length < 14 ||
    raw.length > MAX_PUBLIC_HLS_URL_LENGTH ||
    kind !== 'manifest' && kind !== 'mpegts-segment'
  ) {
    return undefined;
  }
  // WHATWG URL silently normalizes some dangerous/ambiguous input. Refuse
  // those representations rather than trusting an equivalent parsed URL.
  if (!/^[\x21-\x7e]+$/u.test(raw) || /[?#%\\@]/u.test(raw)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.href !== raw ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.port !== '' ||
    parsed.host !== parsed.hostname ||
    !hasCanonicalPublicHost(parsed.hostname) ||
    parsed.pathname.includes('//') ||
    parsed.pathname.endsWith('/')
  ) {
    return undefined;
  }
  if (kind === 'manifest' && !parsed.pathname.endsWith('.m3u8')) return undefined;
  if (kind === 'mpegts-segment' && !parsed.pathname.endsWith('.ts')) return undefined;
  return Object.freeze({
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    kind,
  });
}
