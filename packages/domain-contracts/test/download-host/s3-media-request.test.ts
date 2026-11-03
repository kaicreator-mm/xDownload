/**
 * TEST_MATRIX S3-DTO-VALID-01..09 — the S3 media Host request accepts only
 * the exact frozen key set, pins allowedOperation=media.acquire and slice=S3,
 * and rejects every widening, malformed or unbounded field.
 */
import { describe, expect, it } from 'vitest';
import { validateS3MediaHostAcquisitionRequest } from '../../src/index.ts';
import { DIGEST_A } from './fixtures.ts';
import { expectCode } from '../helpers.ts';

/** A minimal valid S3 media Host request (raw plain object). */
function rawS3MediaRequest(): Record<string, unknown> {
  return {
    requestId: 'req-001',
    lineageId: 'lin-001',
    targetRef: 'target-001',
    outputRootScope: '/var/out/root',
    allowedOperation: 'media.acquire',
    slice: 'S3',
    caller: { actor: 'local-agent', sessionRef: 'session-001' },
  };
}

describe('S3-DTO-VALID-01: valid request accepted and normalized', () => {
  it('accepts the minimal exact frozen key set', () => {
    const result = validateS3MediaHostAcquisitionRequest(rawS3MediaRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allowedOperation).toBe('media.acquire');
    expect(result.value.slice).toBe('S3');
    expect(result.value).not.toHaveProperty('digestAnchor');
    expect(result.value).not.toHaveProperty('declaredBytes');
  });

  it('accepts the full key set with optional digest and byte facts', () => {
    const result = validateS3MediaHostAcquisitionRequest({
      ...rawS3MediaRequest(),
      digestAnchor: DIGEST_A,
      declaredBytes: 1_024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.digestAnchor).toBe(DIGEST_A);
    expect(result.value.declaredBytes).toBe(1_024);
  });
});

describe('S3-DTO-OPERATION-02: pinned operation', () => {
  it("refuses any allowedOperation other than 'media.acquire'", () => {
    for (const allowedOperation of ['acquisition.acquire', 'media.acquire ', '', 'MEDIA.ACQUIRE']) {
      const raw = { ...rawS3MediaRequest(), allowedOperation };
      expectCode(validateS3MediaHostAcquisitionRequest(raw), 'CONTRACT_BINDING_MISMATCH');
    }
  });
});

describe('S3-DTO-SLICE-03: pinned slice', () => {
  it("refuses any slice other than 'S3'", () => {
    for (const slice of ['S1', 'S4', 's3', '', 'S2']) {
      const raw = { ...rawS3MediaRequest(), slice };
      expectCode(validateS3MediaHostAcquisitionRequest(raw), 'MALFORMED_REQUIRED_FIELD');
    }
  });
});

describe('S3-DTO-EXACT-04: exact-key no-widening', () => {
  it('rejects any unknown key (never dropped)', () => {
    for (const extra of [
      { agentNote: 'x' },
      { uiHint: 'x' },
      { selection: {} },
      { contractId: 'contract-001' },
    ]) {
      const raw = { ...rawS3MediaRequest(), ...extra };
      expectCode(validateS3MediaHostAcquisitionRequest(raw), 'SCOPE_WIDENING_REFUSED');
    }
  });

  it('rejects a caller with unknown keys', () => {
    const raw = {
      ...rawS3MediaRequest(),
      caller: { actor: 'a', sessionRef: 's', deep: true },
    };
    expectCode(validateS3MediaHostAcquisitionRequest(raw), 'SCOPE_WIDENING_REFUSED');
  });

  it('rejects every missing required field; optional keys stay optional', () => {
    for (const key of [
      'requestId',
      'lineageId',
      'targetRef',
      'outputRootScope',
      'allowedOperation',
      'slice',
      'caller',
    ] as const) {
      const raw = rawS3MediaRequest();
      delete raw[key];
      expectCode(validateS3MediaHostAcquisitionRequest(raw), 'MISSING_REQUIRED_FIELD');
    }
  });
});

describe('S3-DTO-TARGETREF-05: opaque targetRef grammar', () => {
  it('refuses raw URL/path locators with the dedicated diagnostic', () => {
    for (const targetRef of [
      'https://media.example/vod.m3u8',
      '/etc/passwd',
      'C:\\out\\file.bin',
    ]) {
      expectCode(
        validateS3MediaHostAcquisitionRequest({ ...rawS3MediaRequest(), targetRef }),
        'LOCATOR_SUBSTITUTION_REJECTED',
      );
    }
  });

  it('refuses malformed opaque tokens', () => {
    for (const targetRef of ['', 'x'.repeat(129), 'bad token!', 42, null]) {
      expectCode(
        validateS3MediaHostAcquisitionRequest({ ...rawS3MediaRequest(), targetRef }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });
});

describe('S3-DTO-ROOT-06: output-root containment grammar', () => {
  it('refuses relative or non-string output roots', () => {
    for (const outputRootScope of ['relative/root', '', 42]) {
      const raw = { ...rawS3MediaRequest(), outputRootScope };
      expectCode(validateS3MediaHostAcquisitionRequest(raw), 'MALFORMED_REQUIRED_FIELD');
    }
  });

  it('refuses output roots that traverse outside their scope', () => {
    expectCode(
      validateS3MediaHostAcquisitionRequest({
        ...rawS3MediaRequest(),
        outputRootScope: '/var/out/../escape',
      }),
      'OUTPUT_ROOT_ESCAPED',
    );
  });
});

describe('S3-DTO-DIGEST-BYTES-07: digest and byte-count grammar', () => {
  it('rejects digest anchors outside lowercase 64-hex grammar', () => {
    for (const digestAnchor of [
      'A'.repeat(64),
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
      7,
    ]) {
      expectCode(
        validateS3MediaHostAcquisitionRequest({ ...rawS3MediaRequest(), digestAnchor }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });

  it('rejects byte counts outside (0, 1 TiB] safe integers', () => {
    for (const declaredBytes of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      1_099_511_627_777,
      '1024',
    ]) {
      expectCode(
        validateS3MediaHostAcquisitionRequest({ ...rawS3MediaRequest(), declaredBytes }),
        'MALFORMED_REQUIRED_FIELD',
      );
    }
  });
});

describe('S3-DTO-CALLER-08: bounded caller identity', () => {
  it('rejects malformed caller actor/sessionRef', () => {
    expectCode(
      validateS3MediaHostAcquisitionRequest({
        ...rawS3MediaRequest(),
        caller: { actor: '', sessionRef: 's' },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateS3MediaHostAcquisitionRequest({
        ...rawS3MediaRequest(),
        caller: { actor: 'a', sessionRef: 's'.repeat(257) },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateS3MediaHostAcquisitionRequest({
        ...rawS3MediaRequest(),
        caller: { actor: 'a' },
      }),
      'MISSING_REQUIRED_FIELD',
    );
  });
});

describe('S3-DTO-IMMUTABLE-09: frozen canonical value, no widening', () => {
  it('returns a frozen DTO with a frozen nested caller', () => {
    const result = validateS3MediaHostAcquisitionRequest(rawS3MediaRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.caller)).toBe(true);
  });

  it('returns exactly the authorized keys, nothing widened or invented', () => {
    const result = validateS3MediaHostAcquisitionRequest({
      ...rawS3MediaRequest(),
      digestAnchor: DIGEST_A,
      declaredBytes: 1_024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(
      [
        'allowedOperation',
        'caller',
        'declaredBytes',
        'digestAnchor',
        'lineageId',
        'outputRootScope',
        'requestId',
        'slice',
        'targetRef',
      ].sort(),
    );
    expect(Object.keys(result.value.caller).sort()).toEqual(['actor', 'sessionRef']);
  });

  it('omits optional keys entirely when absent (no undefined widening)', () => {
    const result = validateS3MediaHostAcquisitionRequest(rawS3MediaRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('digestAnchor');
    expect(Object.keys(result.value)).not.toContain('declaredBytes');
  });
});
