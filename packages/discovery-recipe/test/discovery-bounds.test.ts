/**
 * T011 TEST_MATRIX suites `continuation-scope-none-r01`,
 * `declared-continuation-bounds` and `discovery-budget-semantics` —
 * current-page snapshot freezing (PRD §10.1 R01), exact declared bounds
 * (batch/page-range/natural-end, §10.2 tuples, §10.3 page anchoring) and
 * budget-as-external-stop semantics (PRD §15.4) without a ledger.
 */
import { describe, expect, it } from 'vitest';
import { canStartNewDiscoveryWork } from '@xdownload/domain-contracts';
import {
  classifyDiscoveryOutcome,
  initiateDiscovery,
  stepDiscovery,
  frozenTargetsEligibleForTransfer,
  admitContinuationRequest,
} from '../src/index.ts';
import {
  budgetsDiscoveryExhausted,
  budgetsGlobalExhausted,
  budgetsOpen,
  budgetsTransferExhausted,
  confirmedCurrentPageContract,
  confirmedPageRangeContract,
  confirmedPlaylistContract,
  snapshotFor,
} from './fixtures.ts';

describe('suite: continuation-scope-none-r01 (S5 default)', () => {
  it('freezes membership from the confirmed current-page snapshot without executing any continuation action', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001', 'member-002', 'member-003']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (session.ok) {
      expect(session.value.frozenMemberIds).toEqual(['member-001', 'member-002', 'member-003']);
      expect(session.value.continuationScopeKind).toBe('NONE');
      expect(session.value.status).toBe('RUNNING');
    }
  });

  it('keeps scroll-revealed/load-more/continuation-edge members outside the contract', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001', 'member-002']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const step = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-scroll-revealed', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(step.admittedMemberId).toBeUndefined();
    expect(step.rejections).toEqual([
      {
        kind: 'CONTINUATION_NOT_AUTHORIZED',
        memberId: 'member-scroll-revealed',
        reason: 'CONTINUATION_SCOPE_NONE',
      },
    ]);
    expect(step.state.resolvedMemberIds).toEqual([]);
    expect(step.state.status).toBe('RUNNING');
  });

  it('passive completion of evidence for an already-frozen member may continue and never adds a new member', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001', 'member-002']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const detail = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_DETAIL_PAGE_OBSERVED', memberId: 'member-001' },
      budgetsOpen,
    );
    expect(detail.state.status).toBe('RUNNING');
    const reobserve = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-001', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    expect(reobserve.state.resolvedMemberIds).toEqual(['member-001']);
    expect(reobserve.state.frozenMemberIds).toEqual(['member-001', 'member-002']);
  });

  it('a later load-more request against continuation_scope=NONE is refused and routes to successor identity', () => {
    const contract = confirmedCurrentPageContract();
    const decision = admitContinuationRequest({
      contract: contract,
      requestKind: 'LOAD_MORE',
      declaredBoundConsumed: false,
    });
    expect(decision).toEqual({
      decision: 'SUCCESSOR_REQUIRED',
      reason: 'CONTINUATION_SCOPE_NONE',
    });
  });

  it('never creates a frontier: no API accepts a URL list, domain or crawl scope', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    // Event kinds are a closed union: there is no "visit URL"/"follow link"
    // event. The feed only carries member/page/detail/iframe/load-more/
    // natural-end/enumeration/failure facts, so a frontier is unrepresentable.
    const memberStep = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-001', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    expect(memberStep.state.status).toBe('RUNNING');
    // A page failure stops truthfully; it never opens navigation authority.
    const failedStep = stepDiscovery(contract, session.value, { kind: 'PAGE_FAILED' }, budgetsOpen);
    expect(failedStep.state.status).toBe('STOPPED');
    expect(failedStep.state.stop).toEqual({
      kind: 'CONTINUATION_UNCLOSABLE',
      cause: 'FAILED_NEXT_PAGE',
    });
  });
});

describe('suite: declared-continuation-bounds — DECLARED_BATCH_COUNT', () => {
  it('admits at most n members and reaching the bound is USER_SCOPE_REACHED, not natural end', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 2 });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const first = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-002', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(first.admittedMemberId).toBe('member-002');
    expect(first.state.continuationMembersAdmitted).toBe(1);
    const second = stepDiscovery(
      contract,
      first.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-003', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(second.admittedMemberId).toBe('member-003');
    expect(second.state.continuationMembersAdmitted).toBe(2);
    const third = stepDiscovery(
      contract,
      second.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-004', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(third.admittedMemberId).toBeUndefined();
    expect(third.rejections[0]).toEqual({
      kind: 'DECLARED_BOUND_REACHED',
      memberId: 'member-004',
      bound: 'DECLARED_BATCH_COUNT',
      count: 2,
    });
    expect(third.state.status).toBe('STOPPED');
    expect(third.state.stop).toEqual({ kind: 'USER_SCOPE_REACHED' });
    const outcome = classifyDiscoveryOutcome(third.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    expect(outcome).toEqual({
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
  });

  it('a consumed declared bound requires successor identity for any further continuation', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 2 });
    const decision = admitContinuationRequest({
      contract: contract,
      requestKind: 'INCLUDE_MORE',
      declaredBoundConsumed: true,
    });
    expect(decision).toEqual({
      decision: 'SUCCESSOR_REQUIRED',
      reason: 'FROZEN_BOUND_ALREADY_CONSUMED',
    });
  });

  it('batch bound is never sized or extended by budget headroom', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 1 });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    // Budgets wide open: the declared bound still admits exactly one member.
    const first = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-002', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(first.admittedMemberId).toBe('member-002');
    const second = stepDiscovery(
      contract,
      first.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-003', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(second.state.stop).toEqual({ kind: 'USER_SCOPE_REACHED' });
    expect(second.state.continuationMembersAdmitted).toBe(1);
  });
});

describe('suite: declared-continuation-bounds — DECLARED_PAGE_RANGE and page anchoring (PRD §10.3)', () => {
  it('walks only the frozen 1-based logical root pages and stops with USER_SCOPE_REACHED', () => {
    const contract = confirmedPageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, ['member-p1-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    let state = session.value;
    for (const page of [1, 2, 3]) {
      const step = stepDiscovery(
        contract,
        state,
        { kind: 'PAGE_OBSERVED', logicalPage: page, pageIdentity: `page-${String(page)}-sig` },
        budgetsOpen,
      );
      state = step.state;
      expect(step.pageVisited).toBe(page);
    }
    expect(state.status).toBe('STOPPED');
    expect(state.stop).toEqual({ kind: 'USER_SCOPE_REACHED' });
    expect(state.pagesVisited).toEqual([1, 2, 3]);
  });

  it('rejects pages outside the exact frozen range', () => {
    const contract = confirmedPageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, ['member-p1-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const step = stepDiscovery(
      contract,
      session.value,
      { kind: 'PAGE_OBSERVED', logicalPage: 4, pageIdentity: 'page-4-sig' },
      budgetsOpen,
    );
    expect(step.rejections).toEqual([{ kind: 'PAGE_OUTSIDE_FROZEN_RANGE', logicalPage: 4 }]);
    expect(step.state.status).toBe('RUNNING');
  });

  it('member detail pages and iframe content never increment collection page count', () => {
    const contract = confirmedPageRangeContract(1, 2);
    const snapshot = snapshotFor(contract, ['member-p1-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const afterDetail = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_DETAIL_PAGE_OBSERVED', memberId: 'member-p1-001' },
      budgetsOpen,
    );
    expect(afterDetail.state.pagesVisited).toEqual([]);
    const afterIframe = stepDiscovery(
      contract,
      afterDetail.state,
      { kind: 'IFRAME_CONTENT_OBSERVED', frameIdentity: 'frame-player-1' },
      budgetsOpen,
    );
    expect(afterIframe.state.pagesVisited).toEqual([]);
  });

  it('load-more is a continuation relation, never silently a numbered page', () => {
    const contract = confirmedPageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, ['member-p1-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const step = stepDiscovery(
      contract,
      session.value,
      { kind: 'LOAD_MORE_CONTROL_OBSERVED' },
      budgetsOpen,
    );
    expect(step.state.pagesVisited).toEqual([]);
    expect(step.state.status).toBe('RUNNING');
  });

  it('C08 shape: range 1..3 with iframe/load-more/detail edges and no continuation permission keeps scope exact; later load-more needs a successor', () => {
    const contract = confirmedPageRangeContract(1, 3);
    expect(contract.explorationPermission).toBe('COLLECTION_MEMBER_EDGES');
    const snapshot = snapshotFor(contract, ['member-p1-001', 'member-p2-001', 'member-p3-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    // Continuation-edge members stay outside: the page range is the whole scope.
    const edge = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-p4-edge', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(edge.rejections[0]?.kind).toBe('CONTINUATION_NOT_AUTHORIZED');
    const decision = admitContinuationRequest({
      contract: contract,
      requestKind: 'LOAD_MORE',
      declaredBoundConsumed: false,
    });
    expect(decision).toEqual({
      decision: 'SUCCESSOR_REQUIRED',
      reason: 'CONTINUATION_SCOPE_NONE',
    });
  });
});

describe('suite: declared-continuation-bounds — DECLARED_NATURAL_END', () => {
  it('is admitted only for a supported collection with a declared natural-end relation', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
    const snapshot = snapshotFor(contract, ['member-001']);
    const withoutRelation = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(withoutRelation.ok).toBe(false);
    if (!withoutRelation.ok) {
      expect(withoutRelation.diagnostics.some((d) => d.invariant === 'PRD-§10.1')).toBe(true);
    }
    const withRelation = initiateDiscovery({
      contract: contract,
      snapshot: snapshot,
      naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
    });
    expect(withRelation.ok).toBe(true);
  });

  it('stopping without a validated natural-end relation never claims complete', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({
      contract: contract,
      snapshot: snapshot,
      naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    // Natural-end signals from a session without a declared relation are not stop authority.
    const unbackedContract = confirmedCurrentPageContract();
    const unbackedSnapshot = snapshotFor(unbackedContract, ['member-001']);
    const unbackedSession = initiateDiscovery({
      contract: unbackedContract,
      snapshot: unbackedSnapshot,
    });
    if (unbackedSession.ok) {
      const ignored = stepDiscovery(
        unbackedContract,
        unbackedSession.value,
        { kind: 'NATURAL_END_VALIDATED', relation: 'template/unknown-end' },
        budgetsOpen,
      );
      expect(ignored.state.status).toBe('RUNNING');
    }
    // With the declared relation, the validated event is the only natural end.
    const step = stepDiscovery(
      contract,
      session.value,
      { kind: 'NATURAL_END_VALIDATED', relation: 'template/playlist-v1#end-marker' },
      budgetsOpen,
    );
    expect(step.state.status).toBe('STOPPED');
    expect(step.state.stop).toEqual({
      kind: 'NATURAL_COLLECTION_END',
      validatedRelation: 'template/playlist-v1#end-marker',
    });
    const outcome = classifyDiscoveryOutcome(step.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    expect(outcome.coverage).toBe('VERIFIED_COMPLETE');
    expect(outcome.stopReason).toBe('NATURAL_COLLECTION_END');
  });

  it('budget exhaustion under DECLARED_NATURAL_END produces exactly the PRD §10.2 tuple and is never end of user scope', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({
      contract: contract,
      snapshot: snapshot,
      naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const step = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-002', basis: 'CONTINUATION_EDGE' },
      budgetsDiscoveryExhausted,
    );
    expect(step.state.stop).toEqual({ kind: 'DISCOVERY_BUDGET_EXHAUSTED' });
    expect(step.admittedMemberId).toBeUndefined();
    const outcome = classifyDiscoveryOutcome(step.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: false,
    });
    expect(outcome).toEqual({
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
    });
  });
});

describe('suite: discovery-budget-semantics', () => {
  it('exhausted DiscoveryBudget stops new discovery while frozen S stays eligible downstream (C28)', () => {
    expect(canStartNewDiscoveryWork(budgetsDiscoveryExhausted)).toBe(false);
    expect(canStartNewDiscoveryWork(budgetsGlobalExhausted)).toBe(false);
    expect(canStartNewDiscoveryWork(budgetsOpen)).toBe(true);
    expect(frozenTargetsEligibleForTransfer(budgetsDiscoveryExhausted)).toBe(true);
    expect(frozenTargetsEligibleForTransfer(budgetsTransferExhausted)).toBe(false);
    expect(frozenTargetsEligibleForTransfer(budgetsGlobalExhausted)).toBe(false);
  });

  it('C23 shape: whole-collection discovery stops at budget with the exact tuple; never natural end or user scope', () => {
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, ['member-page1', 'member-page2']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const discovered = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-page1-extra', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    const stopped = stepDiscovery(
      contract,
      discovered.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-page3-undiscovered', basis: 'FROZEN_BASIS' },
      budgetsDiscoveryExhausted,
    );
    expect(stopped.state.stop).toEqual({ kind: 'DISCOVERY_BUDGET_EXHAUSTED' });
    const outcome = classifyDiscoveryOutcome(stopped.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: false,
    });
    expect(outcome).toEqual({
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
    });
  });

  it('budget values never create, enlarge, narrow or redefine requested scope', () => {
    // The session carries no budget-derived bound: batch count comes only
    // from the confirmed continuation scope; budget only stops.
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 3 });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.value.requestedScopeBound).toEqual({ kind: 'BATCH_COUNT', count: 3 });
    // Exhausted global safety budget stops discovery outright (highest precedence).
    const stopped = stepDiscovery(
      contract,
      session.value,
      { kind: 'MEMBER_OBSERVED', memberId: 'member-002', basis: 'CONTINUATION_EDGE' },
      budgetsGlobalExhausted,
    );
    expect(stopped.state.stop).toEqual({ kind: 'DISCOVERY_BUDGET_EXHAUSTED' });
  });
});

describe('suite: page loops and failures are never natural end (C03)', () => {
  it.each([
    ['PAGE_FAILED', { kind: 'CONTINUATION_UNCLOSABLE', cause: 'FAILED_NEXT_PAGE' }],
    ['NEXT_CONTROL_MISSING', { kind: 'CONTINUATION_UNCLOSABLE', cause: 'NEXT_CONTROL_MISSING' }],
  ] as const)(
    '%s stops continuation with a truthful reason and UNKNOWN-or-TRUNCATED coverage',
    (eventKind, expectedStop) => {
      const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
      const snapshot = snapshotFor(contract, ['member-001']);
      const session = initiateDiscovery({
        contract: contract,
        snapshot: snapshot,
        naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
      });
      expect(session.ok).toBe(true);
      if (!session.ok) return;
      const observed = stepDiscovery(
        contract,
        session.value,
        { kind: 'MEMBER_OBSERVED', memberId: 'member-002', basis: 'CONTINUATION_EDGE' },
        budgetsOpen,
      );
      const failed = stepDiscovery(
        contract,
        observed.state,
        eventKind === 'PAGE_FAILED' ? { kind: 'PAGE_FAILED' } : { kind: 'NEXT_CONTROL_MISSING' },
        budgetsOpen,
      );
      expect(failed.state.stop).toEqual(expectedStop);
      const outcome = classifyDiscoveryOutcome(failed.state, {
        allFrozenSelectedSucceeded: true,
        requestedScopeFullyAccounted: false,
      });
      expect(outcome.coverage === 'TRUNCATED' || outcome.coverage === 'UNKNOWN').toBe(true);
      expect(outcome.stopReason).toBe('NO_PROGRESS');
      expect(
        outcome.stopReason === 'NATURAL_COLLECTION_END' || outcome.coverage === 'VERIFIED_COMPLETE',
      ).toBe(false);
    },
  );

  it('pagination loop is detected and never reported as natural end', () => {
    const contract = confirmedPageRangeContract(1, 5);
    const snapshot = snapshotFor(contract, ['member-p1-001']);
    const session = initiateDiscovery({ contract: contract, snapshot: snapshot });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const first = stepDiscovery(
      contract,
      session.value,
      { kind: 'PAGE_OBSERVED', logicalPage: 2, pageIdentity: 'page-sig-unique-a' },
      budgetsOpen,
    );
    const loop = stepDiscovery(
      contract,
      first.state,
      { kind: 'PAGE_OBSERVED', logicalPage: 3, pageIdentity: 'page-sig-unique-a' },
      budgetsOpen,
    );
    expect(loop.state.stop).toEqual({ kind: 'CONTINUATION_UNCLOSABLE', cause: 'PAGINATION_LOOP' });
    const outcome = classifyDiscoveryOutcome(loop.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: false,
    });
    expect(outcome.coverage).toBe('TRUNCATED');
    expect(outcome.stopReason).toBe('NO_PROGRESS');
  });

  it('an empty unclosed continuation reports UNKNOWN coverage, not success', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
    const snapshot = snapshotFor(contract, ['member-001']);
    const session = initiateDiscovery({
      contract: contract,
      snapshot: snapshot,
      naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const failed = stepDiscovery(contract, session.value, { kind: 'PAGE_FAILED' }, budgetsOpen);
    const outcome = classifyDiscoveryOutcome(failed.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: false,
    });
    expect(outcome.coverage).toBe('UNKNOWN');
  });
});
