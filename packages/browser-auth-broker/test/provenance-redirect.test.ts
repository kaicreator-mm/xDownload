/**
 * T010 C29 oracle: current-page attachment redirecting to a declared CDN —
 * provenance-bound locator transitions retain binding; unrelated redirect
 * substitution fails closed. Implemented on the canonical locator-transition
 * rule (frozen L2 invariant 4 via @xdownload/domain-contracts) at the
 * browser/auth seam, plus capability binding against the transitioned
 * provenance chain.
 */

import { describe, expect, it } from 'vitest';
import {
  assertLocatorTransitionPreservesTarget,
  bindLocator,
  makeLogicalTargetId,
} from '@xdownload/domain-contracts';
import { decodeCapabilityBinding, type CapabilityBinding } from '../src/index.ts';
import { BASE_BINDING, ISSUE_DECISION, brokerWith, fixedClock } from './helpers.ts';

const CDN_PROVENANCE_BASE = `${BASE_BINDING.provenanceChain}`;

describe('C29: declared-CDN redirect keeps the logical target; unrelated redirect fails closed', () => {
  const identity = makeLogicalTargetId('target-file-001');
  if (!identity.ok) throw new Error('fixture identity invalid');
  const pageLocator = { kind: 'direct' as const, uri: 'https://media.example.org/attachment/1' };
  const pageBinding = bindLocator(pageLocator, identity.value, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: 'https://media.example.org/page',
  });
  if (!pageBinding.ok) throw new Error('fixture binding invalid');

  it('S2 provenance accepts the declared-CDN transition descending from the selected resource', () => {
    const cdnTransition = assertLocatorTransitionPreservesTarget(
      pageBinding.value,
      { kind: 'cdn', uri: 'https://cdn.example.org/attachment/1' },
      { binding: 'DECLARED_DELIVERY_EDGE', originLocatorUri: pageLocator.uri },
    );
    expect(cdnTransition.ok).toBe(true);
    if (!cdnTransition.ok) return;
    // Same logical identity survives the provenance-bound locator change.
    expect(cdnTransition.value.identity).toBe('target-file-001');
    expect(cdnTransition.value.locator.uri).toBe('https://cdn.example.org/attachment/1');
  });

  it('an unrelated redirect substitution is rejected and cannot silently rebind the target', () => {
    const unrelated = assertLocatorTransitionPreservesTarget(
      pageBinding.value,
      { kind: 'redirect', uri: 'https://unrelated.example.org/download/1' },
      {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://elsewhere.example.org/other',
      },
    );
    expect(unrelated.ok).toBe(false);
    if (!unrelated.ok) {
      expect(unrelated.diagnostics.map((d) => d.code)).toContain('LOCATOR_SUBSTITUTION_REJECTED');
      expect(unrelated.diagnostics.some((d) => d.invariant === 'L2-inv4')).toBe(true);
    }
  });

  it('capability use follows the provenance chain: declared transition grants, substituted chain denies', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const declaredChain: CapabilityBinding = {
      ...BASE_BINDING,
      provenanceChain: `${CDN_PROVENANCE_BASE}>declared-cdn`,
    };
    const issued = broker.issue({
      binding: declaredChain,
      ttlMs: 60_000,
      issueDecisionToken: ISSUE_DECISION,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const useDeclared = broker.use({ ref: issued.value.ref, binding: declaredChain });
    expect(useDeclared.outcome).toBe('AUTH_GRANTED');

    // An unrelated substitution produces a different provenance chain: use fails closed.
    const useSubstituted = broker.use({
      ref: issued.value.ref,
      binding: {
        ...BASE_BINDING,
        provenanceChain: `${CDN_PROVENANCE_BASE}>unrelated-substitution`,
      },
    });
    expect(useSubstituted.outcome).toBe('AUTH_FAILED');

    // Successor identity rule: a semantically different provenance chain
    // requires a NEW issue decision — never in-place rebinding of the same
    // capability. The original capability binding is unchanged after the
    // denied use.
    const inspected = broker.inspect(issued.value.ref);
    if (inspected.ok) {
      expect(inspected.value.binding.provenanceChain).toBe(declaredChain.provenanceChain);
    }
  });

  it('binding decode keeps provenance chains required and exact', () => {
    const missing = decodeCapabilityBinding({ ...BASE_BINDING, provenanceChain: '' });
    expect(missing.ok).toBe(false);
  });
});
