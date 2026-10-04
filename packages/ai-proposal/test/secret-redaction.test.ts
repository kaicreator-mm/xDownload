/**
 * T012 TEST_MATRIX suite `secret-redaction`: model input is built only from
 * redacted bounded gaps/observations and capability facts; key-based
 * containment applies at any nesting depth; value-based sentinel
 * containment catches secret material smuggled into non-secret-named
 * fields; no provider request path can serialize raw secret material; and
 * provider responses are audited before any durable use.
 *
 * Negative cases covered here (TEST_MATRIX negative_decode_cases):
 * sentinel-bearing-value-in-non-secret-named-model-input-field.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  REDACTED_MARKER,
  auditValueContainsSentinel,
  clearSinkScrubSentinels,
  redactForSink,
  registerSinkScrubSentinel,
} from '@xdownload/browser-observation';
import { auditSecretMaterial, createAiProposalAdapter } from '../src/index.ts';
import { deterministicFakeProvider } from './fakeProvider.ts';
import {
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  GAP_REF,
  SENTINEL_SECRET,
  gapEnvelopeInput,
} from './fixtures.ts';

function propose(provider: ReturnType<typeof deterministicFakeProvider>, gap: unknown) {
  return createAiProposalAdapter({ provider: provider }).proposeRecipe({
    gap: gap,
    expectedGapRef: GAP_REF,
    expectedContractRef: CONTRACT_REF,
    contract: CONTINUATION_CONTRACT,
  });
}

afterEach(() => {
  clearSinkScrubSentinels();
});

describe('T012 secret redaction and sentinel containment (TEST_MATRIX secret-redaction)', () => {
  it('negative[sentinel-bearing-value-in-non-secret-named-model-input-field]: sentinel smuggled into a non-secret-named field is contained wholesale before the provider sees it', () => {
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const provider = deterministicFakeProvider();
    return propose(
      provider,
      gapEnvelopeInput({
        observations: {
          pageKind: 'playlist',
          layoutNote: `footer watermark ${SENTINEL_SECRET} inside a plain field`,
        },
      }),
    ).then((path) => {
      expect(path.kind).toBe('PROPOSAL_ACCEPTED');
      const request = provider.requests[0];
      expect(request).toBeDefined();
      if (request === undefined) {
        return;
      }
      // Value-based containment: the sentinel never crosses the boundary.
      expect(request.serialized.includes(SENTINEL_SECRET)).toBe(false);
      expect(request.serialized.includes(REDACTED_MARKER)).toBe(true);
      expect(request.observations['layoutNote']).toBe(REDACTED_MARKER);
      expect(request.observations['pageKind']).toBe('playlist');
    });
  });

  it('key-based containment: raw-secret-named keys carry only the redaction marker, at any depth', () => {
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const deep = {
      level1: {
        cookie: `session=${SENTINEL_SECRET}`,
        level2: {
          accessToken: 'raw-access-token',
          safe: 'ordinary fact',
          level3: [{ authorization: 'Bearer raw' }],
        },
      },
    };
    const contained = redactForSink(deep);
    const violations = auditSecretMaterial(contained);
    expect(violations).toEqual([]);
    expect(JSON.stringify(contained)).not.toContain('raw-access-token');
    expect(JSON.stringify(contained)).not.toContain(SENTINEL_SECRET);
  });

  it('no provider request path can serialize raw secret material: recorded requests audit clean', () => {
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const provider = deterministicFakeProvider();
    return propose(
      provider,
      gapEnvelopeInput({
        observations: {
          cookie: `session=${SENTINEL_SECRET}`,
          note: 'ordinary observation fact',
        },
        contractContext: {
          contractRef: CONTRACT_REF,
          scopeSummary: 'scope summary (no identity secrets)',
        },
      }),
    ).then((path) => {
      expect(path.kind).toBe('PROPOSAL_ACCEPTED');
      const request = provider.requests[0];
      expect(request).toBeDefined();
      if (request === undefined) {
        return;
      }
      // The sanctioned audit re-proves containment on the exact object and its serialized form.
      expect(auditSecretMaterial(request)).toEqual([]);
      expect(auditSecretMaterial(JSON.parse(request.serialized))).toEqual([]);
      expect(request.observations['cookie']).toBe(REDACTED_MARKER);
      expect(request.observations['note']).toBe('ordinary observation fact');
    });
  });

  it('oversized redacted model input rejects before any provider use', () => {
    const provider = deterministicFakeProvider();
    return propose(
      provider,
      gapEnvelopeInput({
        observations: { bulk: 'x'.repeat(20_000) },
      }),
    ).then((path) => {
      expect(path.kind).toBe('MODEL_INPUT_REJECTED');
      if (path.kind === 'MODEL_INPUT_REJECTED') {
        expect(path.diagnostics.map((d) => d.code)).toContain('PROPOSAL_INPUT_TOO_LARGE');
      }
      expect(provider.requests).toHaveLength(0);
    });
  });

  it('provider responses are audited for sentinel leakage before any durable use and fail closed', () => {
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const hostile: Record<string, unknown> = gapEnvelopeInput();
    hostile['exfil'] = `leaked ${SENTINEL_SECRET}`;
    const provider = deterministicFakeProvider({ payload: hostile });
    const adapter = createAiProposalAdapter({ provider: provider });
    return adapter
      .proposeRecipe({
        gap: gapEnvelopeInput(),
        expectedGapRef: GAP_REF,
        expectedContractRef: CONTRACT_REF,
        contract: CONTINUATION_CONTRACT,
      })
      .then((path) => {
        expect(path.kind).toBe('MODEL_UNAVAILABLE');
        if (path.kind === 'MODEL_UNAVAILABLE') {
          expect(path.reason).toBe('PROVIDER_RESPONSE_REJECTED');
          expect(path.detail).toContain('SENTINEL_VALUE');
          expect(path.fallback.kind).toBe('ASK_USER');
          expect(path.fallback.via).toBe('DETERMINISTIC_PATH');
        }
      });
  });

  it('secret-material audit names the violated boundary (PRD-§29 / C21) for both containment rules', () => {
    registerSinkScrubSentinel(SENTINEL_SECRET);
    const violations = auditSecretMaterial({
      nested: { token: 'raw-token-not-redacted' },
      note: `contains ${SENTINEL_SECRET}`,
    });
    expect(violations).toEqual([
      { kind: 'RAW_SECRET_KEY_VALUE', path: 'nested.token' },
      { kind: 'SENTINEL_VALUE', path: 'note' },
    ]);
    expect(auditValueContainsSentinel(`prefix ${SENTINEL_SECRET} suffix`)).toBe(true);
    expect(auditValueContainsSentinel('nothing here')).toBe(false);
  });
});
