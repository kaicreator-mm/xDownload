import { describe, expect, it } from 'vitest';
import { parsePublicHlsUriCandidate } from '../src/public-uri-candidate.ts';

describe('S4 public HLS URI candidate syntax (non-authoritative)', () => {
  it('accepts a canonical public HTTPS manifest candidate and frozen typed identity', () => {
    const value = parsePublicHlsUriCandidate('https://media.example.org/hls/master.m3u8', 'manifest');
    expect(value).toEqual({
      href: 'https://media.example.org/hls/master.m3u8',
      origin: 'https://media.example.org',
      hostname: 'media.example.org',
      kind: 'manifest',
    });
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('admits only the MPEG-TS segment suffix for the explicit first profile', () => {
    expect(parsePublicHlsUriCandidate('https://cdn.example.org/chunk-001.ts', 'mpegts-segment')).toMatchObject({
      hostname: 'cdn.example.org',
      kind: 'mpegts-segment',
    });
    expect(parsePublicHlsUriCandidate('https://cdn.example.org/chunk-001.ts', 'manifest')).toBeUndefined();
    expect(parsePublicHlsUriCandidate('https://cdn.example.org/chunk-001.m4s', 'mpegts-segment')).toBeUndefined();
    expect(parsePublicHlsUriCandidate('https://cdn.example.org/hls/live.m3u8', 'mpegts-segment')).toBeUndefined();
  });

  it.each([
    'http://media.example.org/hls/master.m3u8',
    'https://user:pass@media.example.org/master.m3u8',
    'https://user@media.example.org/master.m3u8',
    'https://media.example.org/master.m3u8?token=secret',
    'https://media.example.org/master.m3u8?',
    'https://media.example.org/master.m3u8#position',
    'https://media.example.org/master.m3u8#',
    'https://media.example.org:8443/master.m3u8',
    'https://media.example.org:443/master.m3u8',
    'https://media.example.org/a%2fb/master.m3u8',
    'https://media.example.org/a%2e%2e/master.m3u8',
    'https://media.example.org/a/../master.m3u8',
    'https://media.example.org/a//master.m3u8',
    'https://media.example.org\\@evil.example.net/master.m3u8',
    'https://127.0.0.1/master.m3u8',
    'https://10.1.2.3/master.m3u8',
    'https://[::1]/master.m3u8',
    'https://2130706433/master.m3u8',
    'https://metadata.google.internal/master.m3u8',
    'https://localhost/master.m3u8',
    'https://media.local/master.m3u8',
    'https://media.onion/master.m3u8',
    'https://media.example.org./master.m3u8',
    'https://MEDIA.example.org/master.m3u8',
    'https://bücher.example.org/master.m3u8',
    'https://media.example.org/master.M3U8',
    'https://media.example.org/master.m3u8 ',
    ' https://media.example.org/master.m3u8',
    'https://media.example.org/master.m3u8\n',
    '//media.example.org/master.m3u8',
    'https://one-label/master.m3u8',
  ])('rejects ambiguous/credentialed/non-public candidate: %s', (raw) => {
    expect(parsePublicHlsUriCandidate(raw, 'manifest')).toBeUndefined();
  });

  it('rejects malformed API inputs and over-budget URL text', () => {
    expect(parsePublicHlsUriCandidate({}, 'manifest')).toBeUndefined();
    expect(parsePublicHlsUriCandidate(null, 'manifest')).toBeUndefined();
    expect(parsePublicHlsUriCandidate('https://media.example.org/master.m3u8', 'not-a-kind' as never)).toBeUndefined();
    expect(parsePublicHlsUriCandidate('https://media.example.org/' + 'a'.repeat(2050) + '.m3u8', 'manifest')).toBeUndefined();
  });

  it('does not infer authority from a parsed CDN host', () => {
    // Parsing a "public-looking" hostname proves nothing about Core-owned
    // origin policy, playlist ancestry, DNS or connected-IP pinning.
    const candidate = parsePublicHlsUriCandidate('https://unapproved.example.net/seg.ts', 'mpegts-segment');
    expect(candidate?.hostname).toBe('unapproved.example.net');
    expect(candidate).not.toHaveProperty('authorized');
    expect(candidate).not.toHaveProperty('ip');
    expect(candidate).not.toHaveProperty('mediaPass');
  });
});
