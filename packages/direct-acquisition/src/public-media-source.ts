/**
 * S3 public-file positive source policy (reviewed L2 §2.2, PR #119).
 *
 * This is a PURE pre-request admission predicate. It never fetches,
 * redirects, journals, logs a rejected URL, or grants a Core command.
 * The Core must pin the SHA256 digest from trusted installation config,
 * not from the task, browser, model, Recipe, or CLI envelope.
 */
import { createHash } from 'node:crypto';

export interface PublicMediaOrigin {
  readonly scheme: 'https';
  readonly hostname: string;
  readonly port: number;
}

export interface PublicMediaSourceProfile {
  readonly profileId: string;
  readonly revision: string;
  readonly origins: readonly PublicMediaOrigin[];
  readonly redirectOrigins: readonly PublicMediaOrigin[];
}

export type PublicMediaSourceDecision =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly reason: 'UNSUPPORTED_PUBLIC_SOURCE' };

export interface PinnedPublicMediaSourcePolicy {
  readonly profileId: string;
  readonly revision: string;
  readonly digest: string;
  admitInitial(uri: string): PublicMediaSourceDecision;
  admitRedirect(uri: string): PublicMediaSourceDecision;
}

const PATH = /^\/media\/[A-Za-z0-9_-]{1,64}\.(mp4|m4a|mp3|webm)$/;
const DNS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function originKey(hostname: string, port: number): string {
  return `https://${hostname}:${port}`;
}

function validateOrigins(entries: readonly PublicMediaOrigin[]): ReadonlySet<string> {
  if (entries.length > 32) throw new Error('S3 origin list exceeds trusted bound');
  const keys = new Set<string>();
  for (const entry of entries) {
    if (
      entry.scheme !== 'https' ||
      !DNS.test(entry.hostname) ||
      entry.hostname !== entry.hostname.toLowerCase() ||
      entry.hostname.includes('xn--') ||
      !Number.isSafeInteger(entry.port) ||
      entry.port < 1 ||
      entry.port > 65535
    ) {
      throw new Error('S3 profile origin is not a closed HTTPS tuple');
    }
    const key = originKey(entry.hostname, entry.port);
    if (keys.has(key)) throw new Error('duplicate S3 origin');
    keys.add(key);
  }
  return keys;
}

function canonicalProfile(profile: PublicMediaSourceProfile): string {
  if (
    !LABEL.test(profile.profileId) ||
    !REVISION.test(profile.revision) ||
    profile.origins.length < 1
  ) {
    throw new Error('S3 trusted source profile incomplete');
  }
  validateOrigins(profile.origins);
  validateOrigins(profile.redirectOrigins);
  return JSON.stringify({
    schema: 'xdownload.s3.public-media-source.v1',
    profileId: profile.profileId,
    revision: profile.revision,
    origins: profile.origins.map((item) => [item.scheme, item.hostname, item.port]),
    redirectOrigins: profile.redirectOrigins.map((item) => [
      item.scheme,
      item.hostname,
      item.port,
    ]),
  });
}

/** Hashing a profile is NOT an authority grant. Expected digest must be Core-owned. */
export function digestPublicMediaSourceProfile(profile: PublicMediaSourceProfile): string {
  return createHash('sha256').update(canonicalProfile(profile)).digest('hex');
}

/**
 * Bind an immutable Core-owned policy to the installation-pinned digest.
 * A computed caller-provided digest alone does NOT establish provenance:
 * never call with expectedDigest taken from the command or page.
 */
export function pinPublicMediaSourcePolicy(
  profile: PublicMediaSourceProfile,
  expectedDigest: string,
): PinnedPublicMediaSourcePolicy {
  const digest = digestPublicMediaSourceProfile(profile);
  if (!HEX_SHA256.test(expectedDigest) || digest !== expectedDigest) {
    throw new Error('S3 Core pinned source profile digest mismatch');
  }
  const initial = validateOrigins(profile.origins);
  const redirects = validateOrigins(profile.redirectOrigins);

  function admit(uri: string, allow: ReadonlySet<string>): PublicMediaSourceDecision {
    const deny = (): PublicMediaSourceDecision => ({
      ok: false,
      reason: 'UNSUPPORTED_PUBLIC_SOURCE',
    });
    // Raw URL checks must occur BEFORE parsing/normalization and before any
    // transport/logging. URL() may normalize hostile encoded/dot paths.
    if (
      uri.length > 2048 ||
      uri.length < 14 ||
      !/^[\x21-\x7e]+$/.test(uri) ||
      uri.includes('%') ||
      uri.includes('\\') ||
      uri.includes('?') ||
      uri.includes('#') ||
      uri.includes('@')
    ) {
      return deny();
    }
    const raw = /^https:\/\/([^/]+)(\/.*)$/.exec(uri);
    if (raw === null || !PATH.test(raw[2] ?? '')) return deny();
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return deny();
    }
    const host = parsed.hostname;
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      host !== host.toLowerCase() ||
      !DNS.test(host) ||
      host.includes('xn--') ||
      !PATH.test(parsed.pathname) ||
      parsed.pathname !== raw[2]
    ) {
      return deny();
    }
    const port = parsed.port === '' ? 443 : Number(parsed.port);
    if (!allow.has(originKey(host, port))) return deny();
    return { ok: true, uri: parsed.href };
  }

  return Object.freeze({
    profileId: profile.profileId,
    revision: profile.revision,
    digest,
    admitInitial: (uri: string) => admit(uri, initial),
    admitRedirect: (uri: string) => admit(uri, redirects),
  });
}
