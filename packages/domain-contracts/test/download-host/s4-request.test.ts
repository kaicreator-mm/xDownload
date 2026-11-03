/**
 * TEST_MATRIX S4-DTO-EXACT-01 — the S4/media Host request validates the exact
 * selection tuple, rendition, expiry and digest facts, fail-closed.
 */
import { describe, expect, it } from 'vitest';
import { validateS4HostAcquisitionRequest } from '../../src/index.ts';
import { expectCode } from '../helpers.ts';
import { DIGEST_B, rawS4Request, S4_NOW } from './fixtures.ts';

function withSelection(patch: Record<string, unknown>): Record<string, unknown> {
  const raw = rawS4Request();
  raw.selection = { ...(raw.selection as Record<string, unknown>), ...patch };
  return raw;
}

describe('S4-DTO-EXACT-01: exact-key acceptance', () => {
  it('accepts the exact frozen key set with a currently valid selection', () => {
    const result = validateS4HostAcquisitionRequest(rawS4Request(), S4_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allowedOperation).toBe('media.acquire');
    expect(result.value.selection.mediaProfileId).toBe('BASIC_HLS_VOD_MPEGTS_H264_AAC_V1');
    expect(result.value).not.toHaveProperty('digestAnchor');
  });

  it('rejects unknown keys on the request and on the selection (no-widening)', () => {
    expectCode(
      validateS4HostAcquisitionRequest({ ...rawS4Request(), uiHint: 'x' }, S4_NOW),
      'SCOPE_WIDENING_REFUSED',
    );
    expectCode(
      validateS4HostAcquisitionRequest(withSelection({ extraFact: 'x' }), S4_NOW),
      'SCOPE_WIDENING_REFUSED',
    );
    expectCode(
      validateS4HostAcquisitionRequest(
        withSelection({ caller: { actor: 'a', sessionRef: 's' } }),
        S4_NOW,
      ),
      'SCOPE_WIDENING_REFUSED',
    );
  });

  it('rejects missing required selection facts', () => {
    for (const key of [
      'confirmedSelectionId',
      'previewId',
      'snapshotId',
      'memberId',
      'manifestUri',
      'mediaProfileId',
      'renditionKey',
      'renditionUri',
      'displayedTupleDigest',
      'confirmedAt',
      'expiresAt',
    ] as const) {
      const raw = rawS4Request();
      const selection = { ...(raw.selection as Record<string, unknown>) };
      delete selection[key];
      raw.selection = selection;
      expectCode(validateS4HostAcquisitionRequest(raw, S4_NOW), 'MISSING_REQUIRED_FIELD');
    }
  });
});

describe('S4-DTO-EXACT-01: selection tuple, rendition and digest grammar', () => {
  it('rejects a media profile outside the frozen S4 profile', () => {
    expectCode(
      validateS4HostAcquisitionRequest(
        withSelection({ mediaProfileId: 'OTHER_PROFILE_V1' }),
        S4_NOW,
      ),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects rendition keys outside the rend-<n> grammar', () => {
    for (const renditionKey of ['rend-x', 'rend-01x', 'variant-0', '', 'rend-']) {
      expectCode(
        validateS4HostAcquisitionRequest(withSelection({ renditionKey }), S4_NOW),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
    expect(
      validateS4HostAcquisitionRequest(withSelection({ renditionKey: 'rend-12' }), S4_NOW).ok,
    ).toBe(true);
  });

  it('rejects non-canonical playlist URIs (credentials, query, non-m3u8, relative)', () => {
    for (const manifestUri of [
      'https://user:pass@media.example/master.m3u8',
      'https://media.example/master.m3u8?token=1',
      'https://media.example/master.m3u8#frag',
      'https://media.example/master.mp4',
      'media.example/master.m3u8',
      '/srv/master.m3u8',
      'ftp://media.example/master.m3u8',
    ]) {
      expectCode(
        validateS4HostAcquisitionRequest(withSelection({ manifestUri }), S4_NOW),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });

  it('rejects tuple digests outside lowercase 64-hex grammar', () => {
    for (const displayedTupleDigest of ['A'.repeat(64), 'a'.repeat(63), 'z'.repeat(64), 42]) {
      expectCode(
        validateS4HostAcquisitionRequest(withSelection({ displayedTupleDigest }), S4_NOW),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
    expect(
      validateS4HostAcquisitionRequest(withSelection({ displayedTupleDigest: DIGEST_B }), S4_NOW)
        .ok,
    ).toBe(true);
  });

  it("rejects any allowedOperation other than 'media.acquire'", () => {
    const raw = { ...rawS4Request(), allowedOperation: 'acquisition.acquire' };
    expectCode(validateS4HostAcquisitionRequest(raw, S4_NOW), 'CONTRACT_BINDING_MISMATCH');
  });
});

describe('S4-DTO-EXACT-01: expiry and freshness fail closed', () => {
  it('rejects an expired selection', () => {
    expectCode(
      validateS4HostAcquisitionRequest(
        withSelection({ expiresAt: '2026-11-02T00:00:00.000Z' }),
        S4_NOW,
      ),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects a future-dated confirmation', () => {
    expectCode(
      validateS4HostAcquisitionRequest(
        withSelection({ confirmedAt: '2026-11-03T01:00:00.000Z' }),
        S4_NOW,
      ),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects expiresAt at or before confirmedAt', () => {
    expectCode(
      validateS4HostAcquisitionRequest(
        withSelection({
          confirmedAt: '2026-11-02T00:00:00.000Z',
          expiresAt: '2026-11-02T00:00:00.000Z',
        }),
        S4_NOW,
      ),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects non-ISO timestamps', () => {
    expectCode(
      validateS4HostAcquisitionRequest(withSelection({ expiresAt: 'tomorrow' }), S4_NOW),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('honours an injected clock (deterministic freshness)', () => {
    const raw = rawS4Request();
    expect(validateS4HostAcquisitionRequest(raw, S4_NOW).ok).toBe(true);
    const later = Date.parse('2026-11-05T00:00:00.000Z');
    expectCode(validateS4HostAcquisitionRequest(raw, later), 'MALFORMED_REQUIRED_FIELD');
  });
});
