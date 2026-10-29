/**
 * TEST_MATRIX suite `logical-identity-vs-locator` — branded identity
 * categories and provenance-bound locator transitions.
 */
import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import {
  assertLocatorTransitionPreservesTarget,
  bindLocator,
  decodeLocator,
  decodeProvenance,
  identitySetEquals,
  makeContractId,
  makeLogicalTargetId,
  makeMemberId,
} from '../src/index.ts';
import { decodeOk, expectCode } from './helpers.ts';

const directLocator = { kind: 'direct' as const, uri: 'https://origin.example/file.bin' };
const cdnLocator = { kind: 'cdn' as const, uri: 'https://cdn.example/file.bin' };

describe('logical-identity-vs-locator: category separation', () => {
  it('logical identity categories are nominal and not casually substitutable', () => {
    const target = decodeOk(makeLogicalTargetId('target-file-001'));
    const member = decodeOk(makeMemberId('member-001'));
    const contract = decodeOk(makeContractId('contract-001'));
    expectTypeOf(target).not.toMatchTypeOf<typeof member>();
    expectTypeOf(contract).not.toMatchTypeOf<typeof target>();
    expect(target).toBe('target-file-001');
    expect(member).toBe('member-001');
    expect(contract).toBe('contract-001');
  });

  it('identity-set equality is order-insensitive but identity-complete', () => {
    expect(identitySetEquals(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(identitySetEquals(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(identitySetEquals(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });
});

describe('logical-identity-vs-locator: provenance-bound transitions (L2-inv4)', () => {
  it('keeps the logical target across a traceable redirect/CDN change (C07/C29)', () => {
    const target = decodeOk(makeLogicalTargetId('target-file-001'));
    const original = decodeOk(
      bindLocator(directLocator, target, {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: directLocator.uri,
      }),
    );
    const transition = decodeOk(
      assertLocatorTransitionPreservesTarget(original, cdnLocator, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: directLocator.uri,
      }),
    );
    expect(transition.identity).toBe(target);
    expect(transition.locator.uri).toBe(cdnLocator.uri);
  });

  it('rejects unrelated locator substitution claiming the same target (C29)', () => {
    const target = decodeOk(makeLogicalTargetId('target-file-001'));
    const original = decodeOk(
      bindLocator(directLocator, target, {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: directLocator.uri,
      }),
    );
    expectCode(
      assertLocatorTransitionPreservesTarget(original, cdnLocator, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://unrelated.example/other.bin',
      }),
      'LOCATOR_SUBSTITUTION_REJECTED',
      'L2-inv4',
    );
    expectCode(
      assertLocatorTransitionPreservesTarget(original, cdnLocator, {
        binding: 'ARBITRARY_REWRITE' as never,
        originLocatorUri: directLocator.uri,
      }),
      'LOCATOR_SUBSTITUTION_REJECTED',
    );
  });

  it('decodes locator facts from untrusted input fail-closed', () => {
    const locator = decodeOk(
      decodeLocator({ kind: 'signed', uri: 'https://cdn.example/file?sig=x' }, 'locator'),
    );
    expect(locator.kind).toBe('signed');
    const provenance = decodeOk(
      decodeProvenance(
        { binding: 'MEMBER_DELIVERY_EDGE', originLocatorUri: 'https://origin.example/f' },
        'provenance',
      ),
    );
    expect(provenance.binding).toBe('MEMBER_DELIVERY_EDGE');
    expectCode(
      decodeLocator({ kind: 'teleport', uri: 'https://x' }, 'locator'),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(
      decodeProvenance(
        { binding: 'ARBITRARY_REWRITE', originLocatorUri: 'https://x' },
        'provenance',
      ),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('URL string equality is never the identity model: the same uri can bind different logical targets', () => {
    const a = decodeOk(makeLogicalTargetId('target-a'));
    const b = decodeOk(makeLogicalTargetId('target-b'));
    const bindingA = decodeOk(
      bindLocator(directLocator, a, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: directLocator.uri,
      }),
    );
    const bindingB = decodeOk(
      bindLocator(directLocator, b, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: directLocator.uri,
      }),
    );
    expect(bindingA.identity).not.toBe(bindingB.identity);
    expect(bindingA.locator.uri).toBe(bindingB.locator.uri);
  });

  it('logical member identity remains stable while its delivery chain changes (C07)', () => {
    const member = decodeOk(makeMemberId('member-001'));
    const detailPage = { kind: 'redirect' as const, uri: 'https://site.example/member/001/detail' };
    const cdn = { kind: 'signed' as const, uri: 'https://cdn.example/member/001/media?sig=xyz' };
    const first = decodeOk(
      bindLocator(detailPage, member, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: detailPage.uri,
      }),
    );
    const second = decodeOk(
      assertLocatorTransitionPreservesTarget(first, cdn, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: detailPage.uri,
      }),
    );
    expect(second.identity).toBe(member);
  });
});
