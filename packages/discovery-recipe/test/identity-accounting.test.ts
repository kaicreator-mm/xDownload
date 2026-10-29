/**
 * T011 TEST_MATRIX suite `member-identity-and-completeness` — identity
 * correspondence instead of count equality (C01/C04/C10/C18), provenance-
 * bound member detail/CDN transitions (C07/C29) and truthful accounting for
 * the requested scope.
 */
import { describe, expect, it } from 'vitest';
import {
  bindLocator,
  decodeTerminalResult,
  unwrapOrThrow,
  validateTerminalResult,
  type CoverageEvidence,
  type LocatorBinding,
} from '@xdownload/domain-contracts';
import {
  accountRequestedScope,
  coverageEvidenceForAccounting,
  describeAccounting,
  resolveMemberDeliveryHop,
} from '../src/index.ts';
import { SCHEMA, independentEvidence, memberSubjects } from './fixtures.ts';

const requested = ['member-a', 'member-b', 'member-c'];

describe('identity correspondence, never count equality', () => {
  it('C01: duplicate-replaces-missing with equal count is never VERIFIED_COMPLETE', () => {
    const accounting = accountRequestedScope({
      requestedMemberIds: requested,
      acquiredValidatedIds: ['member-a', 'member-b', 'member-b'],
    });
    expect(accounting.duplicateReplacesMissingDetected).toBe(true);
    expect(accounting.identityCorrespondenceHolds).toBe(false);
    expect(accounting.unaccountedIds).toEqual(['member-c']);
    const evidence = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: {
        kind: 'DECLARED_TOTAL_WITH_CLOSURE',
        declaredTotal: 3,
        closure: 'CONTINUATION_CLOSED',
      },
    });
    expect(evidence.kind).toBe('INSUFFICIENT');
    // The canonical result layer rejects VERIFIED_COMPLETE on that evidence.
    const result = unwrapOrThrow(
      decodeTerminalResult({
        schemaIdentity: SCHEMA,
        contractId: 'contract-finite-set',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'USER_SCOPE_REACHED',
        validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
        recordedAt: '2026-10-04T03:00:00Z',
      }),
    );
    const verdict = validateTerminalResult(result, {
      intentType: 'COLLECTION',
      scopeKind: 'explicit_member_set',
      selectedMemberCount: 3,
      coverageEvidence: evidence as CoverageEvidence,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.diagnostics.some((d) => d.code === 'COVERAGE_EVIDENCE_INSUFFICIENT')).toBe(
        true,
      );
    }
  });

  it('C04: natural-end VERIFIED_COMPLETE requires independent identity/membership closure evidence, not no-more-found alone', () => {
    const accounting = accountRequestedScope({
      requestedMemberIds: ['member-1', 'member-2', 'member-3', 'member-4'],
      acquiredValidatedIds: ['member-1', 'member-2', 'member-3', 'member-4'],
    });
    expect(accounting.identityCorrespondenceHolds).toBe(true);
    const noClosure = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: { kind: 'NO_CLOSURE', reason: 'NO_MORE_FOUND_WITHOUT_CLOSURE' },
    });
    expect(noClosure).toEqual({ kind: 'INSUFFICIENT', basis: 'NO_MORE_FOUND_WITHOUT_CLOSURE' });
    const authoritativeList = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: {
        kind: 'AUTHORITATIVE_IDENTITY_LIST',
        identities: ['member-1', 'member-2', 'member-3', 'member-4'],
      },
    });
    expect(authoritativeList.kind).toBe('SUFFICIENT');
  });

  it('C18: same-bytes/same-name members never collapse distinct logical identities', () => {
    const accounting = accountRequestedScope({
      requestedMemberIds: ['episode-01', 'episode-02'],
      acquiredValidatedIds: ['episode-01', 'episode-02'],
    });
    // Both identities accounted even if their bytes/filenames were identical.
    expect(accounting.acquiredValidatedIds).toEqual(['episode-01', 'episode-02']);
    expect(accounting.requestedAccountedCount).toBe(2);
    // Duplicate observations of the same identity do not split accounting either.
    const duplicated = accountRequestedScope({
      requestedMemberIds: ['episode-01', 'episode-02'],
      acquiredValidatedIds: ['episode-01', 'episode-01', 'episode-02'],
    });
    expect(duplicated.acquiredValidatedIds).toEqual(['episode-01', 'episode-02']);
  });

  it('acquired identities outside the requested scope never widen R', () => {
    const accounting = accountRequestedScope({
      requestedMemberIds: ['member-a', 'member-b'],
      acquiredValidatedIds: ['member-a', 'member-b', 'member-outside'],
    });
    expect(accounting.acquiredValidatedIds).toEqual(['member-a', 'member-b']);
    expect(accounting.identityCorrespondenceHolds).toBe(false);
  });
});

describe('C10: known inaccessible members count as accounted coverage, never acquired', () => {
  it('accounts 2 validated + 1 independently evidenced inaccessible; requested scope remains 3', () => {
    const subjects = memberSubjects(['member-a', 'member-b', 'member-c']);
    const inaccessibleEvidence = independentEvidence(
      'evidence-auth-status-member-c',
      subjects[2]!,
      'AUTHORIZATION',
    );
    const accounting = accountRequestedScope({
      requestedMemberIds: requested,
      acquiredValidatedIds: ['member-a', 'member-b'],
      inaccessibleMembers: [{ memberId: 'member-c', evidence: inaccessibleEvidence }],
    });
    expect(accounting.acquiredValidatedIds).toEqual(['member-a', 'member-b']);
    expect(accounting.knownInaccessibleIds).toEqual(['member-c']);
    expect(accounting.requestedAccountedCount).toBe(3);
    expect(accounting.unaccountedIds).toEqual([]);
    const summary = describeAccounting(accounting);
    expect(summary.requestedScopeRemains).toBe(3);
    expect(summary.authInaccessibleCount).toBe(1);
    expect(summary.explanation).toContain('2 of 3 requested members were acquired and validated');
    expect(summary.explanation).toContain('The requested scope remains all 3 members');
  });

  it('inaccessible members without independently evidenced status stay unaccounted', () => {
    const discoveryAuthClaim = independentEvidence(
      'evidence-not-independent',
      { kind: 'MEMBER', ref: 'member-c' },
      'AUTHORIZATION',
    );
    const doctored = {
      ...discoveryAuthClaim,
      sourceType: 'DISCOVERY_INFERENCE',
      independenceFromDiscovery: 'DISCOVERY_DERIVED',
    } as typeof discoveryAuthClaim;
    const accounting = accountRequestedScope({
      requestedMemberIds: requested,
      acquiredValidatedIds: ['member-a', 'member-b'],
      inaccessibleMembers: [{ memberId: 'member-c', evidence: doctored }],
    });
    expect(accounting.knownInaccessibleIds).toEqual([]);
    expect(accounting.unaccountedIds).toEqual(['member-c']);
    expect(accounting.requestedAccountedCount).toBe(2);
  });
});

describe('C07/C29: member detail/CDN transitions are provenance-bound locator changes', () => {
  const memberPage: LocatorBinding = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: 'https://x.test/gallery/member-a' }, 'member-a', {
      binding: 'MEMBER_DELIVERY_EDGE',
      originLocatorUri: 'https://x.test/gallery/',
    }),
  );

  it('a declared CDN hop descending from the member locator preserves logical member identity', () => {
    const hop = resolveMemberDeliveryHop({
      memberLocator: memberPage,
      nextLocator: { kind: 'cdn', uri: 'https://cdn.x.test/files/member-a.bin' },
      nextProvenance: {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://x.test/gallery/member-a',
      },
    });
    expect(hop.ok).toBe(true);
    if (hop.ok) {
      expect(hop.value.identity).toBe('member-a');
      expect(hop.value.locator.uri).toBe('https://cdn.x.test/files/member-a.bin');
    }
  });

  it('an unrelated redirect/locator substitution cannot inherit the member identity', () => {
    const hop = resolveMemberDeliveryHop({
      memberLocator: memberPage,
      nextLocator: { kind: 'redirect', uri: 'https://tracker.example/interstitial' },
      nextProvenance: {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://unrelated.example/other-page',
      },
    });
    expect(hop.ok).toBe(false);
    if (!hop.ok) {
      expect(hop.diagnostics[0]?.code).toBe('LOCATOR_SUBSTITUTION_REJECTED');
      expect(hop.diagnostics[0]?.invariant).toBe('C07/C29');
    }
  });

  it('a CDN hop whose origin is not the previous locator is rejected (provenance chain retained)', () => {
    const hop = resolveMemberDeliveryHop({
      memberLocator: memberPage,
      nextLocator: { kind: 'cdn', uri: 'https://cdn.x.test/files/member-a-2.bin' },
      nextProvenance: {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://cdn.x.test/files/some-other.bin',
      },
    });
    expect(hop.ok).toBe(false);
  });
});
