import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectHttpAdapter } from '../src/direct-http-adapter.ts';
import {
  digestPublicMediaSourceProfile,
  pinPublicMediaSourcePolicy,
  type PublicMediaSourceProfile,
} from '../src/public-media-source.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import { directRequest, payload, transferProfile } from './helpers/fixtures.ts';

const initial = 'https://media.example.test';
const approvedCdn = 'https://cdn.example.test';
const profile: PublicMediaSourceProfile = {
  profileId: 'installed-s3-public-media',
  revision: '1',
  origins: [{ scheme: 'https', hostname: 'media.example.test', port: 443 }],
  redirectOrigins: [{ scheme: 'https', hostname: 'cdn.example.test', port: 443 }],
};
const policy = pinPublicMediaSourcePolicy(profile, digestPublicMediaSourceProfile(profile));

function adapter() {
  return new DirectHttpAdapter(
    new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 10_000 })),
  );
}
function request(path = '/media/clip_01.mp4') {
  return directRequest(initial, path, payload(24), {
    effectId: 'effect-public-s3-001',
    slice: 'S3',
    omitExpectedSha256: true,
    allowedRedirectHosts: ['cdn.example.test', 'other.example.test'],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S3 pinned Core public-file transport applies guard before HTTP and redirects', () => {
  it('rejects a bearer-like initial URL before any transfer/HTTP', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    const rejected = await adapter().acquirePublicS3(request('/media/t0.mp4?token=x'), policy);
    expect(rejected.ok).toBe(false);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects caller claimed publisher SHA and signed-locator refresher', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    const forbiddenSha = await adapter().acquirePublicS3(
      { ...request(), expectedSha256: 'a'.repeat(64) },
      policy,
    );
    expect(forbiddenSha.ok).toBe(false);
    const refresher = await adapter().acquirePublicS3(
      { ...request(), locatorRefresher: async (value) => value },
      policy,
    );
    expect(refresher.ok).toBe(false);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('blocks a redirect with unapproved public origin BEFORE a second fetch', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource) => {
      calls.push(String(resource));
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.example.test/media/clip_01.mp4' },
      });
    });
    const result = await adapter().acquirePublicS3(request(), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toBe('REDIRECT_SCOPE_EXPANSION');
    expect(result.value.locatorChain).toHaveLength(1);
    expect(JSON.stringify(result.value)).not.toContain('other.example.test');
    expect(calls).toEqual([`${initial}/media/clip_01.mp4`]);
  });

  it('permits declared CDN redirect and then stops on HTTP auth refusal', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource) => {
      calls.push(String(resource));
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { Location: `${approvedCdn}/media/clip_01.mp4` },
          })
        : new Response(null, { status: 403 });
    });
    const result = await adapter().acquirePublicS3(request(), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toBe('AUTH_REQUIRED');
    expect(result.value.locatorChain).toHaveLength(2);
    expect(calls).toEqual([`${initial}/media/clip_01.mp4`, `${approvedCdn}/media/clip_01.mp4`]);
  });

  it('blocks signed-path/percent/query redirect even on a declared CDN', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource) => {
      calls.push(String(resource));
      return new Response(null, {
        status: 302,
        headers: { Location: `${approvedCdn}/media/%63lip_01.mp4?sig=1` },
      });
    });
    const result = await adapter().acquirePublicS3(request(), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toBe('REDIRECT_SCOPE_EXPANSION');
    expect(result.value.locatorChain).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
