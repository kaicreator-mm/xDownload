/**
 * TEST_MATRIX suites `coverage-accounting-three-views` and
 * `count-only-false-success-rejection` (accounting side, T007): the three
 * PRD §17 views stay distinct; the §17.2 tuple is computed from identity
 * sets; inaccessible members count as accounted coverage only with
 * independently evidenced identity/authorization status and never as
 * fulfilled/acquired; no set may escape the immutable requested scope.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCoverageAccounting,
  createEvidenceLedger,
  makeCollectionId,
  unwrapOrThrow,
  type MemberId,
} from '../src/index.ts';
import { appendMemberEvidence, accountingOf, members, t007CoverageTarget } from './t007-helpers.ts';
import { expectCode } from './helpers.ts';

describe('T007 CoverageAccounting — three §17 views and identity sets', () => {
  it('the §17.2 accounting tuple is exact for the canonical 18/16 authorization-limited case', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-c10', 18);
    const accessible = requested.slice(0, 16);
    const inaccessible = requested.slice(16);
    inaccessible.forEach((memberRef, index) => {
      appendMemberEvidence(ledger, {
        evidenceId: `evidence-c10-inacc-${index + 1}`,
        claimType: 'AUTHORIZATION',
        memberRef,
        sourceIdentity: `auth-broker/classification-${index + 1}`,
      });
    });
    const accounting = accountingOf(
      {
        requestedMemberIds: requested,
        resolvedMemberIds: requested,
        authAccessibleMemberIds: accessible,
        authInaccessibleMembers: inaccessible.map((memberId, index) => ({
          memberId,
          classificationEvidenceId: `evidence-c10-inacc-${index + 1}`,
        })),
        selectedMemberIds: accessible,
        validatedMemberIds: accessible,
        authorizationContextRef: 'authctx/t007-c10',
      },
      ledger,
    );
    expect(accounting.counts).toEqual({
      requested: 18,
      accounted: 18,
      authAccessible: 16,
      authInaccessible: 2,
      selected: 16,
      validated: 16,
    });
    // the requested scope remains all 18 — authorization never redefines it
    expect(accounting.requested).toHaveLength(18);
    // accessible-subset accounting is a distinct view
    expect(accounting.authAccessible).toHaveLength(16);
    expect(accounting.authInaccessible).toHaveLength(2);
  });

  it('inaccessible members are never counted as fulfilled/acquired', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-c10b', 4);
    const accessible = requested.slice(0, 3);
    const blocked = requested[3] as MemberId;
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-c10b-inacc-1',
      claimType: 'AUTHORIZATION',
      memberRef: blocked,
      sourceIdentity: 'auth-broker/classification-b1',
    });
    const accounting = accountingOf(
      {
        requestedMemberIds: requested,
        resolvedMemberIds: requested,
        authAccessibleMemberIds: accessible,
        authInaccessibleMembers: [
          { memberId: blocked, classificationEvidenceId: 'evidence-c10b-inacc-1' },
        ],
        selectedMemberIds: accessible,
        validatedMemberIds: accessible,
      },
      ledger,
    );
    expect(accounting.validated).toHaveLength(3);
    expect(accounting.validated).not.toContain(blocked);
    // but the evidenced inaccessible member does count as accounted coverage
    expect(accounting.accounted).toHaveLength(4);
  });

  it('inaccessible members without independently evidenced classification are marked not accounted', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-deg', 3);
    const accounting = accountingOf(
      {
        requestedMemberIds: requested,
        resolvedMemberIds: requested.slice(0, 2),
        authAccessibleMemberIds: requested.slice(0, 2),
        authInaccessibleMembers: [{ memberId: requested[2] as MemberId }],
        selectedMemberIds: requested.slice(0, 2),
        validatedMemberIds: requested.slice(0, 2),
      },
      ledger,
    );
    expect(accounting.authInaccessible[0]?.independentlyAccounted).toBe(false);
    expect(accounting.accounted).toHaveLength(2);
    expect(accounting.counts.accounted).toBe(2);
  });

  it('suggestive classification evidence is not independent accounting', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-deg2', 2);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-deg2-weak',
      claimType: 'AUTHORIZATION',
      memberRef: requested[1] as string,
      certaintyClass: 'SUGGESTIVE',
    });
    const accounting = accountingOf(
      {
        requestedMemberIds: requested,
        resolvedMemberIds: [requested[0] as MemberId],
        authAccessibleMemberIds: [requested[0] as MemberId],
        authInaccessibleMembers: [
          { memberId: requested[1] as MemberId, classificationEvidenceId: 'evidence-deg2-weak' },
        ],
        selectedMemberIds: [requested[0] as MemberId],
        validatedMemberIds: [requested[0] as MemberId],
      },
      ledger,
    );
    expect(accounting.authInaccessible[0]?.independentlyAccounted).toBe(false);
  });

  it('no accounting set may escape the immutable requested scope (C12 retry boundary)', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-c12', 3);
    const outsider = members('member-c12-newcomer', 1)[0] as MemberId;
    const rejected = buildCoverageAccounting(
      {
        coverageTarget: t007CoverageTarget('explicit_member_set:collection/t007-gallery-001'),
        requestedMemberIds: requested,
        resolvedMemberIds: requested,
        authAccessibleMemberIds: requested,
        authInaccessibleMembers: [],
        selectedMemberIds: [...requested, outsider],
        validatedMemberIds: requested,
      },
      ledger,
    );
    expectCode(rejected, 'SCOPE_MUTATION');
  });

  it('duplicate logical identities reject — accounting is identity-set based (C01/C18)', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-dup', 2);
    const rejected = buildCoverageAccounting(
      {
        coverageTarget: t007CoverageTarget('explicit_member_set:collection/t007-gallery-001'),
        requestedMemberIds: [
          requested[0] as MemberId,
          requested[0] as MemberId,
          requested[1] as MemberId,
        ],
        resolvedMemberIds: requested,
        authAccessibleMemberIds: requested,
        authInaccessibleMembers: [],
        selectedMemberIds: requested,
        validatedMemberIds: requested,
      },
      ledger,
    );
    expectCode(rejected, 'DUPLICATE_IDENTITY');
  });

  it('distinct members are never collapsed even when their content is identical (C18)', () => {
    const requested = members('member-c18', 2);
    const accounting = accountingOf({
      requestedMemberIds: requested,
      selectedMemberIds: requested,
      validatedMemberIds: requested,
    });
    expect(accounting.validated).toEqual(requested);
    expect(accounting.counts.validated).toBe(2);
  });

  it('validated members outside the frozen selected set reject (PRD §19)', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-sel', 3);
    const rejected = buildCoverageAccounting(
      {
        coverageTarget: t007CoverageTarget('explicit_member_set:collection/t007-gallery-001'),
        requestedMemberIds: requested,
        resolvedMemberIds: requested,
        authAccessibleMemberIds: requested,
        authInaccessibleMembers: [],
        selectedMemberIds: requested.slice(0, 2),
        validatedMemberIds: requested,
      },
      ledger,
    );
    expect(rejected.ok).toBe(false);
  });

  it('identity correspondence is set equality: order never matters, missing members always do', () => {
    const requested = members('member-ord', 3);
    const shuffled = [requested[2] as MemberId, requested[0] as MemberId, requested[1] as MemberId];
    const accounting = accountingOf({
      requestedMemberIds: requested,
      resolvedMemberIds: shuffled,
      authAccessibleMemberIds: shuffled,
      selectedMemberIds: shuffled,
      validatedMemberIds: shuffled,
    });
    // accounted equals requested as a SET (order-independent)
    expect([...accounting.accounted].sort()).toEqual([...accounting.requested].sort());
    const missing = accountingOf({
      requestedMemberIds: requested,
      resolvedMemberIds: requested.slice(0, 2),
      authAccessibleMemberIds: requested.slice(0, 2),
      selectedMemberIds: requested.slice(0, 2),
      validatedMemberIds: requested.slice(0, 2),
    });
    expect(missing.counts.accounted).toBe(2);
    expect(missing.counts.requested).toBe(3);
  });

  it('AuthorizationContextRef changes never redefine or shrink the requested reference set', () => {
    const requested = members('member-auth', 3);
    const first = accountingOf({
      requestedMemberIds: requested,
      authorizationContextRef: 'authctx/one',
    });
    const second = accountingOf({
      requestedMemberIds: requested,
      authorizationContextRef: 'authctx/two',
    });
    expect(first.requested).toEqual(second.requested);
    expect(first.counts).toEqual(second.counts);
    expect(first.authorizationContextRef).toBe('authctx/one');
    expect(second.authorizationContextRef).toBe('authctx/two');
  });

  it('parent-collection coverage is a separate informational view, never the authoritative one (C25)', () => {
    const requested = members('member-c25', 3);
    const accounting = accountingOf({
      requestedMemberIds: requested,
      parentCollectionCoverage: {
        collectionIdentity: unwrapOrThrow(makeCollectionId('collection/t007-parent-010')),
        status: 'VERIFIED_SUBSET',
      },
    });
    expect(accounting.parentCollectionCoverage?.status).toBe('VERIFIED_SUBSET');
    // requested-scope view is untouched by the parent view
    expect(accounting.requested).toEqual(requested);
    expect(accounting.counts.requested).toBe(3);
  });
});
