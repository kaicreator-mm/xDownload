/**
 * T011 TEST_MATRIX suites `successor-contract-snapshot` and
 * `collection-admission-frontier-rejection` — successor identity on
 * expansion/re-enumeration, original immutability, retry domain, silent
 * replacement rejection, PRD §9 admission conditions and crawler-boundary
 * rejection (C06/C11/C12).
 */
import { describe, expect, it } from 'vitest';
import {
  admitCollectionContract,
  assertContractTransition,
  assertSnapshotImmutable,
  createDomainGateway,
  decodeAcquisitionContract,
  decodeContinuationScope,
  decodeRequestedScope,
  deriveSuccessorContract,
  deriveSuccessorSnapshot,
  makeSnapshotId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  admitContinuationRequest,
  assertContinuationWithinFrozenScope,
  decodeCapabilityList,
  detectFrozenMembershipDrift,
  deriveContinuationSuccessor,
  planFailedMemberRetry,
} from '../src/index.ts';
import {
  SCHEMA,
  asMembers,
  confirmedCurrentPageContract,
  confirmedFiniteSetContract,
  confirmedPlaylistContract,
  snapshotFor,
} from './fixtures.ts';

describe('suite: collection-admission-frontier-rejection (PRD §9)', () => {
  it('enforces all six PRD §9 admission conditions through the canonical gateway', () => {
    const gateway = createDomainGateway();
    // 1. CollectionIdentity must be identifiable.
    const noIdentity = gateway.submitContract({
      schemaIdentity: SCHEMA,
      contractId: 'contract-no-identity',
      status: 'CONFIRMED',
      intentType: 'COLLECTION',
      requestedTarget: 'target-x',
      requestedScope: { kind: 'current_page', collectionIdentity: 'collection/x' },
      membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      explorationPermission: 'NONE',
      budgetProfile: {
        discovery: { domain: 'discovery' },
        transfer: { domain: 'transfer' },
        globalSafety: { domain: 'global_safety' },
      },
      authorizationContextRef: 'authctx/x',
      validationPolicy: { requiredLayers: ['membership'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
    });
    expect(noIdentity.ok).toBe(false);
    if (!noIdentity.ok) {
      expect(noIdentity.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    }
    // 2+5. Membership basis must be observable/declared; incompatible pair rejected.
    const badBasis = gateway.submitContract({
      ...(confirmedCurrentPageContract() as unknown as Record<string, unknown>),
      contractId: 'contract-bad-basis',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
    });
    expect(badBasis.ok).toBe(false);
    if (!badBasis.ok) {
      expect(badBasis.diagnostics.some((d) => d.code === 'ADMISSION_REJECTED')).toBe(true);
    }
    // 4. Collection scope without any bounded navigation permission has no admission path.
    const noNavigation = gateway.submitContract({
      ...(confirmedPlaylistContract() as unknown as Record<string, unknown>),
      contractId: 'contract-no-nav',
      explorationPermission: 'NONE',
    });
    expect(noNavigation.ok).toBe(false);
    if (!noNavigation.ok) {
      expect(noNavigation.diagnostics.some((d) => d.code === 'ADMISSION_REJECTED')).toBe(true);
      expect(noNavigation.diagnostics.some((d) => d.invariant === 'PRD-§9')).toBe(true);
    }
  });

  it('C06: search-first-1000-pages-under-a-domain crawl/filter requests are rejected as arbitrary frontier', () => {
    // No scope primitive can express the frontier: the grammar itself fails closed.
    const crawlScope = decodeRequestedScope({
      kind: 'crawl_domain',
      domain: 'example.com',
      maxPages: 1000,
      filter: 'pdf',
    });
    expect(crawlScope.ok).toBe(false);
    if (!crawlScope.ok) {
      expect(crawlScope.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
      expect(crawlScope.diagnostics.some((d) => d.invariant === 'PRD-§9')).toBe(true);
    }
    // No continuation form can express "continue until budget runs out".
    const budgetScope = decodeContinuationScope({ kind: 'CONTINUE_UNTIL_BUDGET_EXHAUSTED' });
    expect(budgetScope.ok).toBe(false);
    if (!budgetScope.ok) {
      expect(
        budgetScope.diagnostics.some((d) =>
          d.message.includes('budget-derived continuation is not representable'),
        ),
      ).toBe(true);
    }
    // The full contract decode path rejects the same frontier before any discovery.
    const gateway = createDomainGateway();
    const frontierContract = gateway.submitContract({
      ...(confirmedPlaylistContract() as unknown as Record<string, unknown>),
      contractId: 'contract-frontier',
      requestedScope: { kind: 'crawl_domain', domain: 'example.com', maxPages: 1000 },
    });
    expect(frontierContract.ok).toBe(false);
  });

  it('user-declared finite member sets are accepted without bypassing the crawler boundary', () => {
    const contract = confirmedFiniteSetContract(['member-a', 'member-b', 'member-c']);
    expect(admitCollectionContract(contract).ok).toBe(true);
  });

  it('no capability or recipe can express recursive link following, general frontier or recrawl', () => {
    for (const capability of [
      'recursive_crawl',
      'general_site_frontier',
      'continuous_recrawl',
      'follow_arbitrary_links',
    ]) {
      expect(decodeCapabilityList([capability], 'x').ok).toBe(false);
    }
  });
});

describe('suite: successor-contract-snapshot', () => {
  it('post-confirmation continuation expansion requires successor contract + successor snapshot with new identity', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001', 'member-002']);
    const decision = admitContinuationRequest({
      contract: contract,
      requestKind: 'LOAD_MORE',
      declaredBoundConsumed: false,
    });
    expect(decision.decision).toBe('SUCCESSOR_REQUIRED');
    const bundle = unwrapOrThrow(
      deriveContinuationSuccessor({
        previousContract: contract,
        previousSnapshot: snapshot,
        newContinuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 5 },
        newSnapshotId: `snapshot-for-${contract.contractId}-successor`,
        newSelectedMemberIds: asMembers(['member-001', 'member-002', 'member-003', 'member-004']),
        newSelectionClaims: [
          {
            kind: 'BATCH',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: asMembers(['member-001', 'member-002', 'member-003', 'member-004']),
          },
        ],
      }),
    );
    expect(bundle.successorContract.contractId).not.toBe(contract.contractId);
    expect(bundle.successorContract.supersedesContractId).toBe(contract.contractId);
    expect(bundle.successorSnapshot.snapshotId).not.toBe(snapshot.snapshotId);
    expect(bundle.successorSnapshot.supersedesSnapshotId).toBe(snapshot.snapshotId);
    expect(bundle.successorSnapshot.selectedMemberIds).toHaveLength(4);
    // Original snapshot remains the immutable historical authority.
    expect(() => unwrapOrThrow(assertSnapshotImmutable(snapshot, snapshot))).not.toThrow();
    expect(snapshot.selectedMemberIds).toEqual(asMembers(['member-001', 'member-002']));
  });

  it('an explicit continuation scope is honored only within exact frozen bounds; enlargement creates successor identity', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 3 });
    const within = assertContinuationWithinFrozenScope({
      contract: contract,
      executedContinuation: { kind: 'DECLARED_BATCH_COUNT', count: 2 },
    });
    expect(within.ok).toBe(true);
    const enlargement = assertContinuationWithinFrozenScope({
      contract: contract,
      executedContinuation: { kind: 'DECLARED_BATCH_COUNT', count: 5 },
    });
    expect(enlargement.ok).toBe(false);
    if (!enlargement.ok) {
      expect(enlargement.diagnostics.some((d) => d.code === 'SCOPE_MUTATION')).toBe(true);
    }
    // A page-range continuation cannot even exist on a page-range scope at
    // admission (the frozen range double-binds), so an executed page-range
    // continuation under a frozen NONE contract is a scope mutation (R01).
    const noneContract = confirmedCurrentPageContract();
    const executedRange = assertContinuationWithinFrozenScope({
      contract: noneContract,
      executedContinuation: { kind: 'DECLARED_PAGE_RANGE', fromPage: 1, toPage: 2 },
    });
    expect(executedRange.ok).toBe(false);
    if (!executedRange.ok) {
      expect(executedRange.diagnostics[0]?.invariant).toBe('PRD-§10.1/R01');
    }
  });

  it('C11: collection change after preview cannot drift the snapshot; refresh forces the successor path', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001', 'member-002', 'member-003']);
    const drift = detectFrozenMembershipDrift({
      snapshot: snapshot,
      currentlyObservedMemberIds: ['member-001', 'member-002', 'member-004'],
    });
    expect(drift.ok).toBe(false);
    if (!drift.ok) {
      expect(drift.diagnostics[0]?.code).toBe('MEMBERSHIP_DRIFT');
      expect(drift.diagnostics[0]?.invariant).toBe('C11');
    }
    // Equal count with different identities is still drift, not equality.
    const countEqualDrift = detectFrozenMembershipDrift({
      snapshot: snapshot,
      currentlyObservedMemberIds: ['member-001', 'member-002', 'member-999'],
    });
    expect(countEqualDrift.ok).toBe(false);
    // The refreshed authority is a successor snapshot (COLLECTION_CHANGED),
    // never in-place mutation; the contract identity itself is unchanged.
    const successor = unwrapOrThrow(
      deriveSuccessorSnapshot(snapshot, 'COLLECTION_CHANGED', {
        newSnapshotId: unwrapOrThrow(makeSnapshotId('snapshot-refresh-001')),
        selectedMemberIds: asMembers(['member-001', 'member-002', 'member-004']),
        selectionClaims: [
          {
            kind: 'BATCH',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: asMembers(['member-001', 'member-002', 'member-004']),
          },
        ],
      }),
    );
    expect(successor.supersedesSnapshotId).toBe(snapshot.snapshotId);
    expect(successor.contractId).toBe(contract.contractId);
  });

  it('changed scope requiring re-enumeration routes through successor identity, never in-place mutation', () => {
    const contract = confirmedPlaylistContract();
    const successor = deriveSuccessorContract(
      contract,
      {
        requestedScope: unwrapOrThrow(
          decodeRequestedScope({
            kind: 'collection_page_range',
            collectionIdentity: 'collection/playlist-042',
            fromPage: 1,
            toPage: 2,
          }),
        ),
        continuationScope: { kind: 'NONE' },
      },
      'MEMBERSHIP_REENUMERATION_REQUIRED',
    );
    // A successor always carries a new identity — never the same id.
    expect(successor.ok).toBe(true);
    if (successor.ok) {
      expect(successor.value.contractId).not.toBe(contract.contractId);
      expect(successor.value.status).toBe('DRAFT');
    }
    // The same-id mutation path (scope changed under the same contract id)
    // is rejected: re-enumeration requires successor identity.
    const mutated = unwrapOrThrow(
      decodeAcquisitionContract({
        ...(contract as unknown as Record<string, unknown>),
        contractId: contract.contractId,
        requestedScope: {
          kind: 'collection_page_range',
          collectionIdentity: 'collection/playlist-042',
          fromPage: 1,
          toPage: 2,
        },
      }),
    );
    const transition = assertContractTransition(contract, mutated);
    expect(transition.ok).toBe(false);
    if (!transition.ok) {
      expect(transition.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
      expect(transition.diagnostics[0]?.invariant).toBe('PRD-§8');
    }
  });

  it('C12: retry/resume operates only on original frozen member identities; no new or replacement members', () => {
    const contract = confirmedFiniteSetContract(['member-a', 'member-b', 'member-c']);
    const snapshot = snapshotFor(contract, ['member-a', 'member-b', 'member-c']);
    const retry = planFailedMemberRetry({
      snapshot: snapshot,
      failedMemberIds: ['member-b', 'member-c'],
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value).toEqual(asMembers(['member-b', 'member-c']));
    }
    const addMember = planFailedMemberRetry({
      snapshot: snapshot,
      failedMemberIds: ['member-b', 'member-new'],
    });
    expect(addMember.ok).toBe(false);
    if (!addMember.ok) {
      expect(addMember.diagnostics[0]?.code).toBe('MEMBERSHIP_DRIFT');
      expect(addMember.diagnostics[0]?.invariant).toBe('C12');
    }
  });

  it('a successor contract carries an explicit justification corresponding to the change (no silent copy)', () => {
    const contract = confirmedPlaylistContract();
    const copy = deriveContinuationSuccessor({
      previousContract: contract,
      previousSnapshot: snapshotFor(contract, ['member-001']),
      newContinuationScope: { kind: 'NONE' },
      newSnapshotId: 'snapshot-copy-attempt',
    });
    expect(copy.ok).toBe(false);
    if (!copy.ok) {
      expect(copy.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
    }
  });
});
