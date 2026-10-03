/**
 * TEST_MATRIX suite `selection-snapshot` — immutable snapshot, retry rules,
 * successor identity and claim coverage.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSnapshotImmutable,
  coverageTargetFor,
  decodeSelectionSnapshot,
  deriveSuccessorContract,
  deriveSuccessorSnapshot,
  makeSnapshotId,
  planRetryOfFailedMembers,
  sameScopeSnapshotBinding,
  scopeIdentityKey,
  validateSnapshotSemantics,
} from '../src/index.ts';
import {
  confirmedCollectionContract,
  confirmedSnapshot,
  decodeOk,
  entireCollectionScope,
  expectCode,
  mid,
  pageRangeScope,
  rawSnapshot,
} from './helpers.ts';

describe('selection-snapshot: retry/resume keeps frozen authority', () => {
  it('retry/resume retains snapshot identity and original selected member identities', () => {
    const snapshot = confirmedSnapshot();
    const resumed = decodeOk(decodeSelectionSnapshot(rawSnapshot()));
    expect(resumed.snapshotId).toBe(snapshot.snapshotId);
    expect(resumed.selectedMemberIds).toEqual(snapshot.selectedMemberIds);
    expect(decodeOk(assertSnapshotImmutable(snapshot, resumed))).toBeUndefined();
    const retry = decodeOk(planRetryOfFailedMembers(snapshot, ['member-002']));
    expect(retry).toEqual(['member-002']);
  });

  it('failed-item retry cannot add replacement or new members (C12)', () => {
    const snapshot = confirmedSnapshot();
    expectCode(
      planRetryOfFailedMembers(snapshot, ['member-002', 'member-999']),
      'MEMBERSHIP_DRIFT',
      'C12',
    );
  });

  it('changed collection/profile/version requiring re-enumeration requires a successor snapshot (C11)', () => {
    const original = confirmedSnapshot();
    const successor = decodeOk(
      deriveSuccessorSnapshot(original, 'COLLECTION_CHANGED', {
        newSnapshotId: decodeOk(makeSnapshotId('snapshot-002')),
        selectedMemberIds: original.selectedMemberIds,
      }),
    );
    expect(successor.snapshotId).toBe('snapshot-002');
    expect(successor.supersedesSnapshotId).toBe(original.snapshotId);
    // original remains immutable
    expect(decodeOk(assertSnapshotImmutable(original, confirmedSnapshot()))).toBeUndefined();
    // minting a "successor" that reuses the original identity is rejected
    expectCode(
      deriveSuccessorSnapshot(original, 'COLLECTION_CHANGED', {
        newSnapshotId: original.snapshotId,
      }),
      'SNAPSHOT_MUTATION',
    );
  });

  it('post-confirmation continuation expansion requires successor contract AND snapshot (C08)', () => {
    const contract = confirmedCollectionContract();
    const snapshot = confirmedSnapshot();
    const successorContract = decodeOk(
      deriveSuccessorContract(
        contract,
        { continuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 2 } },
        'CONTINUATION_ADDITION',
      ),
    );
    expect(successorContract.continuationScope).toEqual({ kind: 'DECLARED_BATCH_COUNT', count: 2 });
    const successorSnapshot = decodeOk(
      deriveSuccessorSnapshot(snapshot, 'CONTINUATION_EXPANSION', {
        newSnapshotId: decodeOk(makeSnapshotId('snapshot-continuation-001')),
      }),
    );
    expect(successorSnapshot.supersedesSnapshotId).toBe(snapshot.snapshotId);
  });

  it('silent candidate replacement is forbidden: drift under the same snapshot identity', () => {
    const original = confirmedSnapshot();
    const candidate = decodeOk(
      decodeSelectionSnapshot(
        rawSnapshot({
          requestedMemberBasis: {
            kind: 'EXPLICIT_IDENTITIES',
            memberIds: [mid('member-001'), mid('member-002'), mid('member-009')],
          },
          selectedMemberIds: ['member-001', 'member-002', 'member-009'],
          selectionClaims: [
            {
              kind: 'BATCH',
              confirmationType: 'CONFIRM_SELECTION',
              memberRefs: ['member-001', 'member-002', 'member-009'],
            },
          ],
        }),
      ),
    );
    expectCode(assertSnapshotImmutable(original, candidate), 'MEMBERSHIP_DRIFT', 'C01/C11');
  });
});

describe('selection-snapshot: membership basis and claims', () => {
  it('selected identities must belong to the explicit requested basis', () => {
    const outside = decodeSelectionSnapshot(
      rawSnapshot({
        selectedMemberIds: ['member-001', 'member-042'],
        selectionClaims: [
          { kind: 'SINGLE', confirmationType: 'CONFIRM_SELECTION', memberRefs: ['member-001'] },
          { kind: 'SINGLE', confirmationType: 'CONFIRM_SELECTION', memberRefs: ['member-042'] },
        ],
        requestedMemberBasis: {
          kind: 'EXPLICIT_IDENTITIES',
          memberIds: ['member-001', 'member-002', 'member-003'],
        },
      }),
    );
    expectCode(outside, 'MEMBERSHIP_DRIFT');
  });

  it('every selected identity is covered by the selection claims; batch selection covers many members once (C30)', () => {
    const snapshot = confirmedSnapshot();
    expect(snapshot.selectionClaims).toHaveLength(1);
    expect(snapshot.selectionClaims[0]!.kind).toBe('BATCH');
    expect(snapshot.selectionClaims[0]!.memberRefs).toEqual(snapshot.selectedMemberIds);
    // a selected member without any claim is rejected
    const uncovered = decodeSelectionSnapshot(
      rawSnapshot({
        selectedMemberIds: ['member-001', 'member-002', 'member-003', 'member-004'],
      }),
    );
    expectCode(uncovered, 'MISSING_REQUIRED_FIELD');
    // a claim referencing a member outside the frozen selected set is rejected
    const phantom = decodeSelectionSnapshot(
      rawSnapshot({
        selectionClaims: [
          {
            kind: 'BATCH',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: ['member-001', 'member-002', 'member-003', 'member-004'],
          },
        ],
      }),
    );
    expectCode(phantom, 'MEMBERSHIP_DRIFT');
  });

  it('snapshot must bind the confirmed contract requested scope', () => {
    const contract = confirmedCollectionContract();
    const snapshot = confirmedSnapshot();
    expect(sameScopeSnapshotBinding(snapshot.requestedScope, contract.requestedScope)).toBe(true);
    const otherScope = pageRangeScope('collection/playlist-001', 1, 3);
    expect(sameScopeSnapshotBinding(otherScope, contract.requestedScope)).toBe(false);
    // coverage target key must equal the scope identity key
    expect(snapshot.coverageTarget.scopeIdentityKey).toBe(
      scopeIdentityKey(snapshot.requestedScope),
    );
    expect(snapshot.coverageTarget).toEqual(coverageTargetFor(snapshot.requestedScope, 1));
    const mismatched = decodeSelectionSnapshot(
      rawSnapshot({
        coverageTarget: { ...snapshot.coverageTarget, scopeIdentityKey: 'bogus-key' },
      }),
    );
    expectCode(mismatched, 'MALFORMED_REQUIRED_FIELD', 'PRD-§17');
  });

  it('coverage target is bound to the requested scope only, not the parent (C25 shape)', () => {
    const pages = pageRangeScope('collection/parent-010', 1, 3);
    const parent = entireCollectionScope('collection/parent-010');
    expect(scopeIdentityKey(pages)).not.toBe(scopeIdentityKey(parent));
    expect(coverageTargetFor(pages, 1).scopeIdentityKey).toBe(
      'collection_page_range:collection/parent-010:1..3',
    );
  });

  it('validates semantics deterministically on already-constructed snapshots', () => {
    const snapshot = confirmedSnapshot();
    expect(decodeOk(validateSnapshotSemantics(snapshot))).toBeUndefined();
  });
});
