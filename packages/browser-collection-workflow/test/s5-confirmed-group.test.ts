import { describe, expect, it } from 'vitest';
import type { AcquisitionContract, SelectionSnapshot } from '@xdownload/domain-contracts';
import {
  runConfirmedCurrentPageGroup,
  validateConfirmedPageGroup,
} from '../src/s5-confirmed-group.ts';
import type { CollectionFlowInput } from '../src/collection-flow.ts';

const members = ['member-001', 'member-002'] as const;

function contract(): AcquisitionContract {
  return {
    status: 'CONFIRMED',
    intentType: 'COLLECTION',
    contractId: 'contract-s5-001',
    requestedScope: { kind: 'current_page', collectionIdentity: 'collection-001' },
    continuationScope: { kind: 'NONE' },
    membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
    authorizationContextRef: 'auth-s5-001',
    selectionSnapshotRef: 'snapshot-s5-001',
    validationPolicy: {
      requiredLayers: ['membership', 'target', 'transfer', 'format', 'coverage'],
    },
  } as AcquisitionContract;
}

function snapshot(): SelectionSnapshot {
  return {
    contractId: 'contract-s5-001',
    snapshotId: 'snapshot-s5-001',
    requestedScope: { kind: 'current_page', collectionIdentity: 'collection-001' },
    continuationScope: { kind: 'NONE' },
    requestedMemberBasis: { kind: 'CONFIRMED_PAGE_SNAPSHOT' },
    authorizationContextRef: 'auth-s5-001',
    selectedMemberIds: [...members],
    selectionClaims: [
      {
        kind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: [...members],
      },
    ],
  } as SelectionSnapshot;
}

describe('S5 confirmed group Core admission', () => {
  it('admits exact frozen two-member current-page selection', () => {
    const result = validateConfirmedPageGroup(contract(), snapshot());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selectedMemberIds).toEqual(members);
      expect(Object.isFrozen(result.value.selectedMemberIds)).toBe(true);
    }
  });

  it('refuses a snapshot from another confirmed contract', () => {
    const result = validateConfirmedPageGroup(contract(), {
      ...snapshot(),
      contractId: 'unrelated-contract',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses added or replaced members not covered by the batch claim', () => {
    const result = validateConfirmedPageGroup(contract(), {
      ...snapshot(),
      selectedMemberIds: ['member-001', 'member-999'],
    });
    expect(result.ok).toBe(false);
  });

  it('denies hidden continuation or unsigned individual confirmations', () => {
    expect(
      validateConfirmedPageGroup(contract(), {
        ...snapshot(),
        continuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 2 },
      }).ok,
    ).toBe(false);
    expect(
      validateConfirmedPageGroup(contract(), {
        ...snapshot(),
        selectionClaims: [
          {
            kind: 'SINGLE',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: ['member-001'],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it('rejects outside-member caller substitution before any T016 effect', async () => {
    const result = await runConfirmedCurrentPageGroup({
      contract: contract(),
      snapshot: snapshot(),
      declaredRequestedMemberIds: ['member-001', 'other-003'],
    } as Omit<CollectionFlowInput, 'slice'>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.stage).toBe('MEMBERSHIP_IDENTITY');
  });
});
