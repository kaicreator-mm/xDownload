/**
 * TEST_MATRIX suite `immutable-requested-scope` + collection admission.
 */
import { describe, expect, it } from 'vitest';
import {
  admitCollectionContract,
  assertContractTransition,
  confirmContract,
  decodeAcquisitionContract,
  decodeRequestedScope,
  deriveSuccessorContract,
  sameScopeIdentity,
  validateScopeContinuationPair,
} from '../src/index.ts';
import {
  confirmedCollectionContract,
  decodeOk,
  expectCode,
  pageRangeScope,
  rawCollectionContract,
  rawSingleResourceContract,
} from './helpers.ts';

describe('immutable-requested-scope', () => {
  it('confirmed requested_scope is immutable', () => {
    const contract = confirmedCollectionContract();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.requestedScope)).toBe(true);
    // in-place mutation attempts cannot change canonical truth
    expect(() => {
      (contract.requestedScope as { kind: string }).kind = 'explicit_member_set';
    }).toThrow(TypeError);
    // the same identity cannot change scope; a successor must be minted
    const mutated = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          requestedScope: {
            kind: 'collection_page_range',
            collectionIdentity: 'collection/playlist-001',
            fromPage: 1,
            toPage: 2,
          },
        }),
      ),
    );
    expectCode(assertContractTransition(contract, mutated), 'SCOPE_MUTATION');
    const successor = decodeOk(
      deriveSuccessorContract(
        contract,
        { requestedScope: pageRangeScope('collection/playlist-001', 1, 2) },
        'SCOPE_CHANGE',
      ),
    );
    expect(successor.contractId).not.toBe(contract.contractId);
    expect(successor.supersedesContractId).toBe(contract.contractId);
    // original remains untouched historical authority
    expect(contract.requestedScope.kind).toBe('entire_supported_collection');
  });

  it('continuation_scope is explicit and immutable after confirmation', () => {
    const raw = rawCollectionContract({
      continuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 5 },
    });
    delete raw['confirmedAt'];
    const draft = decodeOk(decodeAcquisitionContract({ ...raw, status: 'DRAFT' }));
    expect(draft.confirmedAt).toBeUndefined();
    const confirmed = decodeOk(confirmContract(draft, '2026-10-04T02:00:00Z'));
    expect(confirmed.continuationScope).toEqual({ kind: 'DECLARED_BATCH_COUNT', count: 5 });
    const expanded = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({ continuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 50 } }),
      ),
    );
    expectCode(assertContractTransition(confirmed, expanded), 'SCOPE_MUTATION');
  });

  it('default current_page continuation is NONE; page-range continuation is not representable for it', () => {
    const raw = rawCollectionContract({
      collectionIdentity: 'collection/current-page-001',
      membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
      requestedScope: { kind: 'current_page', collectionIdentity: 'collection/current-page-001' },
    });
    const contract = decodeOk(decodeAcquisitionContract(raw));
    expect(contract.continuationScope).toEqual({ kind: 'NONE' });
    expectCode(
      validateScopeContinuationPair(contract.requestedScope, {
        kind: 'DECLARED_PAGE_RANGE',
        fromPage: 1,
        toPage: 2,
      }),
      'SCOPE_CONTINUATION_MISMATCH',
    );
  });

  it('authorization context cannot silently shrink or rewrite requested_scope', () => {
    const eighteen = {
      kind: 'explicit_member_set',
      collectionIdentity: 'collection/playlist-001',
      memberIds: Array.from({ length: 18 }, (_, i) => `member-${String(i + 1).padStart(3, '0')}`),
    } as const;
    const contract = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          requestedScope: eighteen,
          membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        }),
      ),
    );
    const withOtherAuth = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          requestedScope: eighteen,
          membershipBasis: { basis: 'DECLARED_FINITE_SET' },
          authorizationContextRef: 'authctx/restricted-002',
        }),
      ),
    );
    // decoding keeps requested scope at 18 regardless of authorization context
    expect(contract.requestedScope).toEqual(withOtherAuth.requestedScope);
    expect(sameScopeIdentity(contract.requestedScope, withOtherAuth.requestedScope)).toBe(true);
    // mutating auth on the same confirmed identity is a forbidden scope rewrite
    expectCode(assertContractTransition(contract, withOtherAuth), 'SCOPE_MUTATION');
  });

  it('budget values cannot create, enlarge, narrow or redefine scope', () => {
    const smallBudgets = {
      discovery: { domain: 'discovery', maxGeneratedRequests: 1 },
      transfer: { domain: 'transfer', maxBytes: 1 },
      globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 1 },
    };
    const largeBudgets = {
      discovery: { domain: 'discovery', maxGeneratedRequests: 1_000_000 },
      transfer: { domain: 'transfer', maxBytes: 1_000_000_000_000 },
      globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 1_000_000_000 },
    };
    const small = decodeOk(
      decodeAcquisitionContract(rawCollectionContract({ budgetProfile: smallBudgets })),
    );
    const large = decodeOk(
      decodeAcquisitionContract(rawCollectionContract({ budgetProfile: largeBudgets })),
    );
    expect(small.requestedScope).toEqual(large.requestedScope);
    expect(sameScopeIdentity(small.requestedScope, large.requestedScope)).toBe(true);
    // budgets are not scopes structurally
    expectCode(decodeRequestedScope(smallBudgets), 'UNKNOWN_ENUM_VALUE');
  });
});

describe('collection admission (PRD §9)', () => {
  it('admits a supported-template whole-collection contract', () => {
    const contract = confirmedCollectionContract();
    expect(decodeOk(admitCollectionContract(contract))).toBeUndefined();
  });

  it('rejects membership bases incompatible with the requested scope', () => {
    const contract = confirmedCollectionContract({
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
    });
    expectCode(admitCollectionContract(contract), 'ADMISSION_REJECTED', 'PRD-§9');
  });

  it('rejects arbitrary-frontier scope shapes as unknown scope primitives (C06 shape)', () => {
    expectCode(
      decodeRequestedScope({
        kind: 'domain_frontier_filter',
        domain: 'example.com',
        filter: '*.pdf',
        maxPages: 1000,
      }),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(
      decodeAcquisitionContract(
        rawSingleResourceContract({
          explorationPermission: 'ARBITRARY_FRONTIER',
        }),
      ),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('single-resource contracts do not require collection-only fields (C16 shape)', () => {
    const contract = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
    expect(contract.collectionIdentity).toBeUndefined();
    expect(contract.membershipBasis).toBeUndefined();
    expect(decodeOk(admitCollectionContract(contract))).toBeUndefined();
  });
});
