/**
 * TEST_MATRIX DIRECT-DTO-EXACT-01 — the direct Host request accepts only the
 * exact frozen key set and rejects unknown/missing/invalid fields.
 */
import { describe, expect, it } from 'vitest';
import { validateDirectHostAcquisitionRequest } from '../../src/index.ts';
import { DIGEST_A } from './fixtures.ts';
import { rawDirectRequest } from './fixtures.ts';
import { expectCode } from '../helpers.ts';

describe('DIRECT-DTO-EXACT-01: exact-key acceptance', () => {
  it('accepts the minimal exact frozen key set', () => {
    const result = validateDirectHostAcquisitionRequest(rawDirectRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allowedOperation).toBe('acquisition.acquire');
    expect(result.value.slice).toBe('S1');
    expect(result.value).not.toHaveProperty('digestAnchor');
    expect(result.value).not.toHaveProperty('declaredBytes');
  });

  it('accepts the full key set with optional digest and byte facts', () => {
    const result = validateDirectHostAcquisitionRequest({
      ...rawDirectRequest(),
      digestAnchor: DIGEST_A,
      declaredBytes: 1_024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.digestAnchor).toBe(DIGEST_A);
    expect(result.value.declaredBytes).toBe(1_024);
  });

  it('rejects any unknown key (no-widening, never dropped)', () => {
    for (const extra of [
      { agentNote: 'x' },
      { uiHint: 'x' },
      { extraScope: '/tmp' },
      { caller: { actor: 'a', sessionRef: 's', deep: true } },
    ]) {
      const merged: Record<string, unknown> = { ...rawDirectRequest() };
      if (extra.caller !== undefined) {
        merged.caller = { ...(merged.caller as Record<string, unknown>), deep: true };
      } else {
        Object.assign(merged, extra);
      }
      expectCode(validateDirectHostAcquisitionRequest(merged), 'SCOPE_WIDENING_REFUSED');
    }
  });

  it('rejects every missing required field', () => {
    for (const key of [
      'requestId',
      'lineageId',
      'targetRef',
      'outputRootScope',
      'allowedOperation',
      'slice',
      'caller',
    ] as const) {
      const raw = rawDirectRequest();
      delete raw[key];
      expectCode(validateDirectHostAcquisitionRequest(raw), 'MISSING_REQUIRED_FIELD');
    }
  });

  it('rejects hostile object geometry (class instance, revoked accessors)', () => {
    class Instance {
      requestId = 'req-001';
    }
    expectCode(validateDirectHostAcquisitionRequest(new Instance()), 'MALFORMED_REQUIRED_FIELD');
    const accessor = rawDirectRequest();
    Object.defineProperty(accessor, 'requestId', {
      enumerable: true,
      get() {
        return 'req-001';
      },
    });
    expectCode(validateDirectHostAcquisitionRequest(accessor), 'MALFORMED_REQUIRED_FIELD');
  });

  it('returns a frozen canonical value', () => {
    const result = validateDirectHostAcquisitionRequest(rawDirectRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.caller)).toBe(true);
  });
});

describe('DIRECT-DTO-EXACT-01: pinned operation and slice', () => {
  it("refuses any allowedOperation other than 'acquisition.acquire'", () => {
    const raw = { ...rawDirectRequest(), allowedOperation: 'media.acquire' };
    expectCode(validateDirectHostAcquisitionRequest(raw), 'CONTRACT_BINDING_MISMATCH');
  });

  it("refuses slices outside the frozen 'S1'|'S3' vocabulary", () => {
    for (const slice of ['S4', 's1', '', 'S2']) {
      const raw = { ...rawDirectRequest(), slice };
      expectCode(validateDirectHostAcquisitionRequest(raw), 'MALFORMED_REQUIRED_FIELD');
    }
    expect(validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), slice: 'S3' }).ok).toBe(
      true,
    );
  });
});

describe('DIRECT-DTO-EXACT-01: field grammar bounds', () => {
  it('rejects malformed requestId/lineageId', () => {
    for (const bad of ['Req-001', 'req_001', '-req', 'x'.repeat(65), 42, null]) {
      expectCode(
        validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), requestId: bad }),
        'MALFORMED_REQUIRED_FIELD',
      );
      expectCode(
        validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), lineageId: bad }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });

  it('rejects digest anchors outside lowercase 64-hex grammar', () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 7]) {
      expectCode(
        validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), digestAnchor: bad }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });

  it('rejects byte counts outside (0, 1 TiB] safe integers', () => {
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1_099_511_627_777, '1024']) {
      expectCode(
        validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), declaredBytes: bad }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });

  it('rejects malformed caller identities', () => {
    expectCode(
      validateDirectHostAcquisitionRequest({
        ...rawDirectRequest(),
        caller: { actor: '', sessionRef: 's' },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateDirectHostAcquisitionRequest({
        ...rawDirectRequest(),
        caller: { actor: 'a', sessionRef: 's'.repeat(257) },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), caller: { actor: 'a' } }),
      'MISSING_REQUIRED_FIELD',
    );
  });
});
