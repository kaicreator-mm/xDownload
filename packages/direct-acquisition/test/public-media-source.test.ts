import { describe, expect, it } from 'vitest';
import {
  digestPublicMediaSourceProfile,
  pinPublicMediaSourcePolicy,
  type PublicMediaSourceProfile,
} from '../src/public-media-source.ts';

const profile: PublicMediaSourceProfile = {
  profileId: 'public-mp4-v1',
  revision: '1',
  origins: [{ scheme: 'https', hostname: 'media.example.test', port: 443 }],
  redirectOrigins: [{ scheme: 'https', hostname: 'cdn.example.test', port: 443 }],
};

function policy() {
  return pinPublicMediaSourcePolicy(profile, digestPublicMediaSourceProfile(profile));
}

describe('S3 Core-pinned public-only source profile', () => {
  it('admits only an exact declared primary media file', () => {
    const result = policy().admitInitial('https://media.example.test/media/clip_01.mp4');
    expect(result).toEqual({
      ok: true,
      uri: 'https://media.example.test/media/clip_01.mp4',
    });
    expect(policy().admitInitial('https://cdn.example.test/media/clip_01.mp4').ok).toBe(false);
  });

  it('treats redirect origins independently from primary origins', () => {
    const guard = policy();
    expect(guard.admitRedirect('https://cdn.example.test/media/clip_01.mp4').ok).toBe(true);
    expect(guard.admitRedirect('https://media.example.test/media/clip_01.mp4').ok).toBe(false);
    expect(guard.admitRedirect('https://foreign.example.test/media/clip_01.mp4').ok).toBe(false);
  });

  it.each([
    'https://media.example.test/clip.mp4',
    'https://media.example.test/media/t0.mp4?token=x',
    'https://media.example.test/media/%63lip.mp4',
    'https://media.example.test/media/clip_01.mp4#x',
    'https://media.example.test/media/clip_01.mp4/extra',
    'https://alice:secret@media.example.test/media/clip_01.mp4',
    'https://media.example.test/media/path-1/clip.mp4',
    'https://media.example.test/media/clip_01.mp4/../other.mp4',
    'https://media.example.test/media/clip_01.MP4',
    'http://media.example.test/media/clip_01.mp4',
    'https://media.example.test//media/clip_01.mp4',
    'https://media.example.test/media/clip_01.mp4%3fpassword',
    'https://media.example.test/media/🔥.mp4',
    'https://MEDIA.example.test/media/clip_01.mp4',
    'https://other.example.test/media/clip_01.mp4',
    'https://media.example.test:8443/media/clip_01.mp4',
  ])('rejects unsafe/non-public candidate before transport: %s', (uri) => {
    expect(policy().admitInitial(uri)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_PUBLIC_SOURCE',
    });
  });

  it('rejects changed Core profile revision or origin against digest pin', () => {
    const pinned = digestPublicMediaSourceProfile(profile);
    expect(() => pinPublicMediaSourcePolicy({ ...profile, revision: '2' }, pinned)).toThrow(
      'digest mismatch',
    );
    expect(() =>
      pinPublicMediaSourcePolicy(
        { ...profile, origins: [{ scheme: 'https', hostname: 'evil.example.test', port: 443 }] },
        pinned,
      ),
    ).toThrow('digest mismatch');
  });

  it('rejects wildcard origins, duplicate origins, non-canonical hostname and HTTP', () => {
    const invalid: PublicMediaSourceProfile[] = [
      { ...profile, origins: [{ scheme: 'https', hostname: '*.example.test', port: 443 }] },
      { ...profile, origins: [...profile.origins, ...profile.origins] },
      { ...profile, origins: [{ scheme: 'https', hostname: 'MEDIA.example.test', port: 443 }] },
      { ...profile, origins: [{ scheme: 'http' as 'https', hostname: '127.0.0.1', port: 80 }] },
    ];
    for (const value of invalid) {
      expect(() => digestPublicMediaSourceProfile(value)).toThrow();
    }
  });

  it('does not mistake caller-computed profile digest for an existing Core pin', () => {
    const attackerProfile: PublicMediaSourceProfile = {
      ...profile,
      origins: [{ scheme: 'https', hostname: 'attacker.example.test', port: 443 }],
    };
    const expectedByCore = digestPublicMediaSourceProfile(profile);
    expect(() => pinPublicMediaSourcePolicy(attackerProfile, expectedByCore)).toThrow(
      'digest mismatch',
    );
  });
});
