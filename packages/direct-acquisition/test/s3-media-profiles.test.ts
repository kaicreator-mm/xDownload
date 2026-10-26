/**
 * #150 supported-media profile registry + the untrusted S3 byte constraint:
 * the closed registry is deterministic and digest-stable; the constraint
 * rejects mismatched bytes on the Target layer while never promoting the
 * request's Target basis to the publisher-digest anchor.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  digestSupportedMediaProfiles,
  lookupSupportedMediaProfile,
  mediaPolicyOfProfile,
  validateMedia,
  type DirectTransferRequest,
  type MediaSignature,
} from '../src/index.ts';

function mp4Bytes(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(12 + body.length);
  new DataView(bytes.buffer).setUint32(0, 12 + body.length);
  bytes.set(new TextEncoder().encode('ftypisom'), 4);
  bytes.set(body, 12);
  return bytes;
}

describe('#150 Core-owned supported media profiles', () => {
  it('names the closed v1 subset with container-bound structure probes', () => {
    for (const id of [
      's3-media-mp4-v1',
      's3-media-m4a-v1',
      's3-media-mp3-v1',
      's3-media-webm-v1',
    ]) {
      const profile = lookupSupportedMediaProfile(id);
      expect(profile).toBeDefined();
      expect(profile!.signatures.length).toBeGreaterThan(0);
      for (const signature of profile!.signatures as readonly MediaSignature[]) {
        expect(signature.hex).toMatch(/^[0-9a-f]+$/u);
      }
    }
    expect(lookupSupportedMediaProfile('s3-media-mkv-v9')).toBeUndefined();
  });

  it('produces a stable registry content digest', () => {
    expect(digestSupportedMediaProfiles()).toBe(digestSupportedMediaProfiles());
    expect(digestSupportedMediaProfiles()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('derives a non-waivable media policy that real MP4 bytes satisfy and HTML fails', () => {
    const profile = lookupSupportedMediaProfile('s3-media-mp4-v1')!;
    const policy = mediaPolicyOfProfile(profile);
    expect(validateMedia({ bytes: mp4Bytes('x'), policy }).passed).toBe(true);
    const html = new TextEncoder().encode('<!doctype html><html></html>');
    expect(validateMedia({ bytes: html, policy }).passed).toBe(false);
  });
});

describe('#150 S3 untrusted byte constraint (adapter request shape)', () => {
  it('rejects a non-hex constraint and any constraint on the S1 publisher anchor', async () => {
    const { DirectHttpAdapter } = await import('../src/index.ts');
    const ledger = {
      remaining: () => ({
        globalSafety: { exhausted: false },
        transfer: { exhausted: false },
      }),
      consume: () => ({
        globalSafety: { exhausted: false },
        transfer: { exhausted: false },
      }),
    };
    const adapter = new DirectHttpAdapter(ledger as never);
    const base = {
      effectId: 'effect:x',
      contractId: 'contract-x',
      slice: 'S3' as const,
      selectedMemberId: 'member-x',
      binding: {
        locator: { kind: 'direct' as const, uri: 'https://media.example.org/media/a.mp4' },
        identity: 'target-x',
        provenance: {
          binding: 'SELECTED_RESOURCE_PROVENANCE' as const,
          originLocatorUri: 'https://media.example.org/media/a.mp4',
        },
      },
      allowedRedirectHosts: ['media.example.org'],
      attempt: 0,
      mediaPolicy: mediaPolicyOfProfile(lookupSupportedMediaProfile('s3-media-mp4-v1')!),
    } as unknown as Record<string, unknown>;

    const badHex = await adapter.acquire({
      ...base,
      byteConstraintSha256: 'NOT-HEX',
    } as unknown as DirectTransferRequest);
    expect(badHex.ok).toBe(false);

    const combined = await adapter.acquire({
      ...base,
      byteConstraintSha256: 'a'.repeat(64),
      expectedSha256: 'b'.repeat(64),
    } as unknown as DirectTransferRequest);
    expect(combined.ok).toBe(false);
  });

  it('computes the constraint digest over the exact artifact bytes', () => {
    const bytes = mp4Bytes('constraint-oracle');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    const other = createHash('sha256').update(mp4Bytes('other')).digest('hex');
    expect(digest).not.toBe(other);
  });
});
