/**
 * T012 TEST_MATRIX suite `model-offline-fallback`: provider outage, timeout
 * and malformed/unusable responses degrade truthfully to the deterministic
 * path or ASK_USER/ABORT; degraded runs surface typed unavailability and
 * never mark partial or failed work complete; model unavailability never
 * widens behavior; the deterministic fallback requires no model round-trip
 * and works with the provider absent.
 */
import { describe, expect, it } from 'vitest';
import { createAiProposalAdapter, resolveDeterministicFallback } from '../src/index.ts';
import { deterministicFakeProvider, type DeterministicFakeProvider } from './fakeProvider.ts';
import {
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  GAP_REF,
  gapEnvelopeInput,
  legalProposalBytes,
} from './fixtures.ts';

function propose(
  provider: DeterministicFakeProvider | undefined,
  gap: unknown = gapEnvelopeInput(),
) {
  return createAiProposalAdapter(
    provider === undefined ? {} : { provider: provider },
  ).proposeRecipe({
    gap: gap,
    expectedGapRef: GAP_REF,
    expectedContractRef: CONTRACT_REF,
    contract: CONTINUATION_CONTRACT,
  });
}

describe('T012 model-offline fallback (TEST_MATRIX model-offline-fallback)', () => {
  it('provider outage degrades truthfully: typed unavailability plus the declared deterministic fallback', () => {
    const provider = deterministicFakeProvider({
      unavailable: { reason: 'OUTAGE', detail: 'connection refused by provider endpoint' },
    });
    return propose(provider).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('OUTAGE');
        expect(path.detail).toBe('connection refused by provider endpoint');
        expect(path.fallback).toEqual({
          kind: 'ASK_USER',
          via: 'DETERMINISTIC_PATH',
          description:
            'model unavailable: ask the user to resolve the gap on the deterministic path',
        });
      }
    });
  });

  it('provider timeout degrades truthfully and never resolves as success', () => {
    const provider = deterministicFakeProvider({
      unavailable: {
        reason: 'TIMEOUT',
        detail: 'provider did not respond within the declared bound',
      },
    });
    return propose(provider).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('TIMEOUT');
      }
      expect(path.kind).not.toBe('PROPOSAL_ACCEPTED');
    });
  });

  it('malformed/unusable provider responses degrade truthfully instead of guessing a proposal', () => {
    const provider = deterministicFakeProvider({
      unavailable: {
        reason: 'MALFORMED_RESPONSE',
        detail: 'response was not decodable proposal data',
      },
    });
    return propose(provider).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('MALFORMED_RESPONSE');
      }
    });
  });

  it('thrown provider failures degrade truthfully to typed outage (never partial success)', () => {
    const provider = deterministicFakeProvider({ throwWith: new Error('transport exploded') });
    return propose(provider).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('OUTAGE');
        expect(path.detail).toBe('transport exploded');
      }
    });
  });

  it('provider absent: the adapter stays complete and truthful with no model configured', () => {
    return propose(undefined).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.reason).toBe('PROVIDER_ABSENT');
        expect(path.fallback.kind).toBe('ASK_USER');
        expect(path.fallback.via).toBe('DETERMINISTIC_PATH');
      }
    });
  });

  it('gap-declared ABORT fallback is honored verbatim; behavior never widens on degradation', () => {
    const abortGap = gapEnvelopeInput();
    const gap = abortGap['gap'] as Record<string, unknown>;
    gap['fallbackPreference'] = 'ABORT';
    return propose(undefined, abortGap).then((path) => {
      expect(path.kind).toBe('MODEL_UNAVAILABLE');
      if (path.kind === 'MODEL_UNAVAILABLE') {
        expect(path.fallback.kind).toBe('ABORT');
        expect(path.fallback.via).toBe('DETERMINISTIC_PATH');
      }
    });
  });

  it('deterministic fallback resolution requires no model round-trip and is pure', () => {
    const gap = {
      gapId: 'gap/x',
      gapKind: 'CONTINUATION_UNCLOSABLE',
      description: 'gap',
      fallbackPreference: 'ASK_USER',
    } as const;
    const resolved = resolveDeterministicFallback(gap, 'PROVIDER_ABSENT', 'no provider');
    const again = resolveDeterministicFallback(gap, 'PROVIDER_ABSENT', 'no provider');
    expect(resolved).toEqual(again);
    expect(resolved.fallback).toEqual({
      kind: 'ASK_USER',
      via: 'DETERMINISTIC_PATH',
      description: 'model unavailable: ask the user to resolve the gap on the deterministic path',
    });
  });

  it('degraded runs never rewrite failure into success: unavailability is surfaced as unknown/unavailable state', () => {
    const provider = deterministicFakeProvider({
      unavailable: { reason: 'OUTAGE', detail: 'down' },
    });
    return Promise.all([
      propose(provider),
      propose(undefined),
      propose(deterministicFakeProvider({ throwWith: new Error('x') })),
    ]).then((paths) => {
      for (const path of paths) {
        expect(path.kind).toBe('MODEL_UNAVAILABLE');
        expect(path.kind).not.toBe('PROPOSAL_ACCEPTED');
      }
    });
  });

  it('hostile-but-schema-valid responses still route through the deterministic policy, not around it', () => {
    // The provider returns a legal-looking envelope bound to ANOTHER gap; the
    // adapter rejects it through the same deterministic policy (no widening).
    const bytes = legalProposalBytes();
    const provenance = bytes['provenance'] as Record<string, unknown>;
    provenance['gapRef'] = 'gap/other-999';
    const provider = deterministicFakeProvider({ payload: bytes });
    return propose(provider).then((path) => {
      expect(path.kind).toBe('PROPOSAL_REJECTED');
      if (path.kind === 'PROPOSAL_REJECTED') {
        expect(path.diagnostics.map((d) => d.code)).toContain('PROVENANCE_BINDING_REJECTED');
      }
    });
  });
});
