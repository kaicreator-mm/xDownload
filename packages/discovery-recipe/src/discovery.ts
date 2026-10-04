/**
 * T011 bounded discovery orchestration (L2 D5, PRD §10/§11/§15/§19).
 *
 * Discovery resolves/finalizes the frozen target set for an admitted,
 * confirmed collection contract and produces the candidate set C and
 * membership accounting as canonical typed values. It never creates a URL
 * frontier, never transfers bytes, never derives continuation width from
 * budgets and never reinterprets budget exhaustion as natural end or user
 * scope. All inputs are canonical values plus plain fixture feeds — pure
 * decision logic, no I/O.
 */

import {
  admitCollectionContract,
  canStartNewDiscoveryWork,
  canTransferAfterDiscoveryExhaustion,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  sameContinuationIdentity,
  sameScopeSnapshotBinding,
  validateScopeContinuationPair,
  type AcquisitionContract,
  type BudgetRemaining,
  type CoverageStatus,
  type DomainValidationResult,
  type RequestFulfillmentStatus,
  type SelectionAcquisitionStatus,
  type SelectionSnapshot,
  type StopReason,
  type TargetResolutionStatus,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

/**
 * Validated natural-end relation declared by a supported membership template.
 * DECLARED_NATURAL_END continuation is admitted only for a supported
 * collection whose natural-end relation is declared; declaring it in the
 * engine config is distinct from observing a validated natural-end event.
 */
export interface NaturalEndRelation {
  readonly declaredByTemplate: boolean;
  readonly templateRef: string;
}

export interface DiscoverySessionConfig {
  readonly contract: AcquisitionContract;
  readonly snapshot: SelectionSnapshot;
  readonly naturalEndRelation?: NaturalEndRelation;
}

/** The frozen target-set resolution inputs discovery starts from. */
export interface DiscoverySession {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly scopeKind: string;
  readonly continuationScopeKind: string;
  readonly selectionBasis: 'ENTIRE_REQUESTED_SCOPE' | 'EXPLICIT_USER_SELECTION';
  /** Frozen confirmed membership (S universe discovery resolves within). */
  readonly frozenMemberIds: readonly string[];
  /** Candidate set C resolved so far (frozen members + admitted continuation members). */
  readonly resolvedMemberIds: readonly string[];
  /** Requested members observed as inaccessible under the current authorization (independently evidenced). */
  readonly knownInaccessibleMemberIds: readonly string[];
  readonly requestedScopeBound:
    | { readonly kind: 'UNBOUNDED_WITHIN_FROZEN_SET' }
    | { readonly kind: 'BATCH_COUNT'; readonly count: number }
    | { readonly kind: 'PAGE_RANGE'; readonly fromPage: number; readonly toPage: number }
    | { readonly kind: 'NATURAL_END_PENDING_VALIDATION' };
  readonly naturalEndRelation: NaturalEndRelation | undefined;
  readonly status: 'RUNNING' | 'STOPPED';
  readonly visitedPageIdentities: readonly string[];
  readonly pagesVisited: readonly number[];
  readonly continuationMembersAdmitted: number;
  readonly stop?: DiscoveryStop;
}

/** Typed stop outcome; never derived from budget-as-scope. */
export type DiscoveryStop =
  | { readonly kind: 'USER_SCOPE_REACHED' }
  | { readonly kind: 'NATURAL_COLLECTION_END'; readonly validatedRelation: string }
  | { readonly kind: 'DISCOVERY_BUDGET_EXHAUSTED' }
  | { readonly kind: 'ENUMERATION_CLOSED' }
  | {
      readonly kind: 'CONTINUATION_UNCLOSABLE';
      readonly cause: 'FAILED_NEXT_PAGE' | 'NEXT_CONTROL_MISSING' | 'PAGINATION_LOOP';
    };

/**
 * Observation feed events. Events are structured fixture facts, not live
 * observations: page events carry a logical page index and a page identity
 * (for loop detection); member events declare the basis the member is bound
 * by; auth-inaccessible observations carry independently evidenced
 * identity/auth status; detail/iframe/load-more events never affect logical
 * page accounting.
 */
export type DiscoveryEvent =
  | {
      readonly kind: 'MEMBER_OBSERVED';
      readonly memberId: string;
      readonly basis: 'FROZEN_BASIS' | 'CONTINUATION_EDGE';
      readonly logicalPage?: number;
    }
  | { readonly kind: 'MEMBER_AUTH_INACCESSIBLE'; readonly memberId: string }
  | { readonly kind: 'PAGE_OBSERVED'; readonly logicalPage: number; readonly pageIdentity: string }
  | { readonly kind: 'MEMBER_DETAIL_PAGE_OBSERVED'; readonly memberId: string }
  | { readonly kind: 'IFRAME_CONTENT_OBSERVED'; readonly frameIdentity: string }
  | { readonly kind: 'LOAD_MORE_CONTROL_OBSERVED' }
  | { readonly kind: 'NATURAL_END_VALIDATED'; readonly relation: string }
  | { readonly kind: 'COLLECTION_ENUMERATION_CLOSED' }
  | { readonly kind: 'PAGE_FAILED' }
  | { readonly kind: 'NEXT_CONTROL_MISSING' };

/** Typed rejection of an out-of-scope observation; discovery never widens. */
export type DiscoveryRejection =
  | {
      readonly kind: 'CONTINUATION_NOT_AUTHORIZED';
      readonly memberId: string;
      readonly reason: 'CONTINUATION_SCOPE_NONE';
    }
  | {
      readonly kind: 'DECLARED_BOUND_REACHED';
      readonly memberId: string;
      readonly bound: 'DECLARED_BATCH_COUNT';
      readonly count: number;
    }
  | { readonly kind: 'MEMBER_OUTSIDE_REQUESTED_SCOPE'; readonly memberId: string }
  | { readonly kind: 'PAGE_OUTSIDE_FROZEN_RANGE'; readonly logicalPage: number }
  | { readonly kind: 'DUPLICATE_MEMBER_OBSERVED'; readonly memberId: string };

export interface DiscoveryStepResult {
  readonly state: DiscoverySession;
  readonly admittedMemberId?: string;
  readonly pageVisited?: number;
  readonly rejections: readonly DiscoveryRejection[];
}

/**
 * Initiate a bounded discovery session from canonical contract + snapshot
 * values. Fails closed when the contract is not confirmed, fails collection
 * admission, pairs scope/continuation illegally, or when the snapshot does
 * not bind exactly this contract's frozen requested/continuation scope.
 * DECLARED_NATURAL_END additionally requires a declared template relation.
 */
export function initiateDiscovery(
  config: DiscoverySessionConfig,
): DomainValidationResult<DiscoverySession> {
  const diagnostics: ValidationDiagnostic[] = [];
  const { contract, snapshot } = config;
  if (contract.status !== 'CONFIRMED') {
    diagnostics.push(
      diagnostic(
        'ADMISSION_REJECTED',
        'contract.status',
        'discovery runs only against confirmed contracts',
        'PRD-§8',
      ),
    );
  }
  const admitted = admitCollectionContract(contract);
  if (!admitted.ok) {
    diagnostics.push(...admitted.diagnostics);
  }
  const pair = validateScopeContinuationPair(contract.requestedScope, contract.continuationScope);
  if (!pair.ok) {
    diagnostics.push(...pair.diagnostics);
  }
  if (snapshot.contractId !== contract.contractId) {
    diagnostics.push(
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'snapshot.contractId',
        `snapshot binds contract '${snapshot.contractId}' but discovery was initiated for '${contract.contractId}'`,
      ),
    );
  }
  if (!sameScopeSnapshotBinding(snapshot.requestedScope, contract.requestedScope)) {
    diagnostics.push(
      diagnostic(
        'SCOPE_MUTATION',
        'snapshot.requestedScope',
        'snapshot requested scope must bind the confirmed contract requested scope',
        'PRD-§12',
      ),
    );
  }
  if (!sameContinuationIdentity(snapshot.continuationScope, contract.continuationScope)) {
    diagnostics.push(
      diagnostic(
        'SCOPE_MUTATION',
        'snapshot.continuationScope',
        'snapshot continuation scope must bind the confirmed contract continuation scope',
        'PRD-§12',
      ),
    );
  }
  let naturalEndRelation: NaturalEndRelation | undefined;
  if (contract.continuationScope.kind === 'DECLARED_NATURAL_END') {
    naturalEndRelation = config.naturalEndRelation;
    if (
      naturalEndRelation === undefined ||
      !naturalEndRelation.declaredByTemplate ||
      naturalEndRelation.templateRef.length === 0
    ) {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'discovery.naturalEndRelation',
          'DECLARED_NATURAL_END continuation is admitted only for a supported collection with a declared natural-end relation',
          'PRD-§10.1',
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  let requestedScopeBound: DiscoverySession['requestedScopeBound'];
  if (contract.requestedScope.kind === 'collection_page_range') {
    requestedScopeBound = {
      kind: 'PAGE_RANGE',
      fromPage: contract.requestedScope.fromPage,
      toPage: contract.requestedScope.toPage,
    };
  } else {
    switch (contract.continuationScope.kind) {
      case 'DECLARED_BATCH_COUNT':
        requestedScopeBound = { kind: 'BATCH_COUNT', count: contract.continuationScope.count };
        break;
      case 'DECLARED_NATURAL_END':
        requestedScopeBound = { kind: 'NATURAL_END_PENDING_VALIDATION' };
        break;
      default:
        requestedScopeBound = { kind: 'UNBOUNDED_WITHIN_FROZEN_SET' };
    }
  }
  const session: DiscoverySession = {
    contractId: contract.contractId,
    snapshotId: snapshot.snapshotId,
    scopeKind: contract.requestedScope.kind,
    continuationScopeKind: contract.continuationScope.kind,
    selectionBasis: contract.selectionPolicy.basis,
    frozenMemberIds: deepFreeze([...snapshot.selectedMemberIds]),
    resolvedMemberIds: deepFreeze([]),
    knownInaccessibleMemberIds: deepFreeze([]),
    requestedScopeBound: requestedScopeBound,
    naturalEndRelation: naturalEndRelation,
    status: 'RUNNING',
    visitedPageIdentities: deepFreeze([]),
    pagesVisited: deepFreeze([]),
    continuationMembersAdmitted: 0,
  };
  return ok(deepFreeze(session));
}

/**
 * One deterministic discovery step. The event feed is injected by the caller
 * (fixture or adapter); budget state is a canonical input. When the
 * discovery budget is gone no new discovery/navigation happens — the session
 * stops with DISCOVERY_BUDGET_EXHAUSTED and the event is not processed.
 */
export function stepDiscovery(
  contract: AcquisitionContract,
  state: DiscoverySession,
  event: DiscoveryEvent,
  budgetRemaining: BudgetRemaining,
): DiscoveryStepResult {
  if (state.status === 'STOPPED') {
    return deepFreeze({ state: state, rejections: deepFreeze([]) });
  }
  const noDiscoveryBudget = !canStartNewDiscoveryWork(budgetRemaining);
  switch (event.kind) {
    case 'MEMBER_OBSERVED': {
      const rejections: DiscoveryRejection[] = [];
      return observeMember(contract, state, event, rejections, noDiscoveryBudget);
    }
    case 'MEMBER_AUTH_INACCESSIBLE': {
      if (noDiscoveryBudget) {
        return budgetStop(state);
      }
      if (state.knownInaccessibleMemberIds.includes(event.memberId)) {
        return deepFreeze({ state: state, rejections: deepFreeze([]) });
      }
      const next: DiscoverySession = deepFreeze({
        ...state,
        knownInaccessibleMemberIds: deepFreeze([
          ...state.knownInaccessibleMemberIds,
          event.memberId,
        ]),
      });
      return deepFreeze({ state: next, rejections: deepFreeze([]) });
    }
    case 'PAGE_OBSERVED': {
      const rejections: DiscoveryRejection[] = [];
      return observePage(contract, state, event, rejections, noDiscoveryBudget);
    }
    case 'MEMBER_DETAIL_PAGE_OBSERVED':
    case 'IFRAME_CONTENT_OBSERVED':
    case 'LOAD_MORE_CONTROL_OBSERVED':
      // Detail pages, iframe content and load-more controls never increment
      // the logical collection page count (PRD §10.3); load-more is a
      // continuation relation, never silently a numbered page.
      return deepFreeze({ state: state, rejections: deepFreeze([]) });
    case 'NATURAL_END_VALIDATED':
      return naturalEndValidated(state, event);
    case 'COLLECTION_ENUMERATION_CLOSED': {
      if (noDiscoveryBudget) {
        return budgetStop(state);
      }
      const stopped: DiscoverySession = deepFreeze({
        ...state,
        status: 'STOPPED',
        stop: { kind: 'ENUMERATION_CLOSED' },
      });
      return deepFreeze({ state: stopped, rejections: deepFreeze([]) });
    }
    case 'PAGE_FAILED':
      return continuationUnclosable(state, 'FAILED_NEXT_PAGE');
    case 'NEXT_CONTROL_MISSING':
      return continuationUnclosable(state, 'NEXT_CONTROL_MISSING');
    default:
      return deepFreeze({ state: state, rejections: deepFreeze([]) });
  }
}

function observeMember(
  contract: AcquisitionContract,
  state: DiscoverySession,
  event: Extract<DiscoveryEvent, { kind: 'MEMBER_OBSERVED' }>,
  rejections: DiscoveryRejection[],
  noDiscoveryBudget: boolean,
): DiscoveryStepResult {
  if (event.basis === 'CONTINUATION_EDGE') {
    const continuation = contract.continuationScope;
    if (continuation.kind === 'NONE') {
      // Scroll/load-more/continuation-edge members stay outside a
      // continuation_scope=NONE contract; a successor contract/snapshot is
      // required to include them (PRD §10.1 R01).
      rejections.push({
        kind: 'CONTINUATION_NOT_AUTHORIZED',
        memberId: event.memberId,
        reason: 'CONTINUATION_SCOPE_NONE',
      });
      return deepFreeze({ state: state, rejections: deepFreeze(rejections) });
    }
    if (noDiscoveryBudget) {
      return budgetStop(state);
    }
    if (continuation.kind === 'DECLARED_BATCH_COUNT') {
      if (state.continuationMembersAdmitted >= continuation.count) {
        rejections.push({
          kind: 'DECLARED_BOUND_REACHED',
          memberId: event.memberId,
          bound: 'DECLARED_BATCH_COUNT',
          count: continuation.count,
        });
        const stopped: DiscoverySession = deepFreeze({
          ...state,
          status: 'STOPPED',
          stop: { kind: 'USER_SCOPE_REACHED' },
        });
        return deepFreeze({ state: stopped, rejections: deepFreeze(rejections) });
      }
      return admitMember(state, event.memberId, true);
    }
    // DECLARED_NATURAL_END admits continuation members until validated end.
    return admitMember(state, event.memberId, true);
  }
  // FROZEN_BASIS member: bound by the frozen membership basis. For scopes
  // that enumerate members explicitly, discovery cannot add identities
  // outside the requested scope (R derives from the confirmed scope only).
  if (
    (state.scopeKind === 'explicit_member_set' ||
      state.scopeKind === 'selected_collection_members') &&
    !state.frozenMemberIds.includes(event.memberId)
  ) {
    rejections.push({ kind: 'MEMBER_OUTSIDE_REQUESTED_SCOPE', memberId: event.memberId });
    return deepFreeze({ state: state, rejections: deepFreeze(rejections) });
  }
  if (state.resolvedMemberIds.includes(event.memberId)) {
    rejections.push({ kind: 'DUPLICATE_MEMBER_OBSERVED', memberId: event.memberId });
    return deepFreeze({ state: state, rejections: deepFreeze(rejections) });
  }
  if (noDiscoveryBudget) {
    // Resolving a new member from the supported basis is new discovery work;
    // re-observations of already-resolved members stay passive.
    return budgetStop(state);
  }
  const next: DiscoverySession = deepFreeze({
    ...state,
    resolvedMemberIds: deepFreeze([...state.resolvedMemberIds, event.memberId]),
  });
  // A fully resolved explicit member set has reached the exact requested scope.
  const finiteSetComplete =
    (state.scopeKind === 'explicit_member_set' ||
      state.scopeKind === 'selected_collection_members') &&
    next.frozenMemberIds.every((id) => next.resolvedMemberIds.includes(id));
  return deepFreeze({
    state: finiteSetComplete
      ? deepFreeze({ ...next, status: 'STOPPED', stop: { kind: 'USER_SCOPE_REACHED' as const } })
      : next,
    admittedMemberId: event.memberId,
    rejections: deepFreeze([]),
  });
}

function observePage(
  contract: AcquisitionContract,
  state: DiscoverySession,
  event: Extract<DiscoveryEvent, { kind: 'PAGE_OBSERVED' }>,
  rejections: DiscoveryRejection[],
  noDiscoveryBudget: boolean,
): DiscoveryStepResult {
  if (state.scopeKind !== 'collection_page_range') {
    // Page-walking exists only for collection_page_range scope; page events
    // in other scopes carry no page-accounting authority.
    return deepFreeze({ state: state, rejections: deepFreeze(rejections) });
  }
  const scope = contract.requestedScope;
  const fromPage = scope.kind === 'collection_page_range' ? scope.fromPage : 1;
  const toPage = scope.kind === 'collection_page_range' ? scope.toPage : 1;
  if (event.logicalPage < fromPage || event.logicalPage > toPage) {
    rejections.push({ kind: 'PAGE_OUTSIDE_FROZEN_RANGE', logicalPage: event.logicalPage });
    return deepFreeze({ state: state, rejections: deepFreeze(rejections) });
  }
  if (state.visitedPageIdentities.includes(event.pageIdentity)) {
    return continuationUnclosable(state, 'PAGINATION_LOOP');
  }
  if (noDiscoveryBudget) {
    return budgetStop(state);
  }
  const next: DiscoverySession = deepFreeze({
    ...state,
    visitedPageIdentities: deepFreeze([...state.visitedPageIdentities, event.pageIdentity]),
    pagesVisited: deepFreeze(
      state.pagesVisited.includes(event.logicalPage)
        ? state.pagesVisited
        : [...state.pagesVisited, event.logicalPage],
    ),
  });
  const done = next.pagesVisited.length === toPage - fromPage + 1;
  return deepFreeze({
    state: done
      ? deepFreeze({ ...next, status: 'STOPPED', stop: { kind: 'USER_SCOPE_REACHED' as const } })
      : next,
    pageVisited: event.logicalPage,
    rejections: deepFreeze(rejections),
  });
}

function naturalEndValidated(
  state: DiscoverySession,
  event: Extract<DiscoveryEvent, { kind: 'NATURAL_END_VALIDATED' }>,
): DiscoveryStepResult {
  if (
    state.continuationScopeKind !== 'DECLARED_NATURAL_END' ||
    state.naturalEndRelation === undefined ||
    !state.naturalEndRelation.declaredByTemplate
  ) {
    // A natural-end signal without a declared template relation is not a
    // stop authority; discovery keeps its declared bounds.
    return deepFreeze({ state: state, rejections: deepFreeze([]) });
  }
  const stopped: DiscoverySession = deepFreeze({
    ...state,
    status: 'STOPPED',
    stop: { kind: 'NATURAL_COLLECTION_END', validatedRelation: event.relation },
  });
  return deepFreeze({ state: stopped, rejections: deepFreeze([]) });
}

function continuationUnclosable(
  state: DiscoverySession,
  cause: 'FAILED_NEXT_PAGE' | 'NEXT_CONTROL_MISSING' | 'PAGINATION_LOOP',
): DiscoveryStepResult {
  // A failed next page, missing next control or pagination loop is never
  // natural end: continuation stops with a truthful unclosable reason (C03).
  const stopped: DiscoverySession = deepFreeze({
    ...state,
    status: 'STOPPED',
    stop: { kind: 'CONTINUATION_UNCLOSABLE', cause: cause },
  });
  return deepFreeze({ state: stopped, rejections: deepFreeze([]) });
}

function budgetStop(state: DiscoverySession): DiscoveryStepResult {
  const stopped: DiscoverySession = deepFreeze({
    ...state,
    status: 'STOPPED',
    stop: { kind: 'DISCOVERY_BUDGET_EXHAUSTED' },
  });
  return deepFreeze({ state: stopped, rejections: deepFreeze([]) });
}

function admitMember(
  state: DiscoverySession,
  memberId: string,
  fromContinuation: boolean,
): DiscoveryStepResult {
  if (state.resolvedMemberIds.includes(memberId)) {
    return deepFreeze({
      state: state,
      admittedMemberId: memberId,
      rejections: deepFreeze([]),
    });
  }
  const next: DiscoverySession = deepFreeze({
    ...state,
    resolvedMemberIds: deepFreeze([...state.resolvedMemberIds, memberId]),
    continuationMembersAdmitted: fromContinuation
      ? state.continuationMembersAdmitted + 1
      : state.continuationMembersAdmitted,
  });
  return deepFreeze({ state: next, admittedMemberId: memberId, rejections: deepFreeze([]) });
}

/**
 * Classify the truthful §10.2/§16 discovery outcome tuple from the session
 * stop state. Inputs:
 *
 * - `allFrozenSelectedSucceeded`: every already-frozen selected target
 *   succeeded (gates SelectionAcquisition COMPLETE);
 * - `requestedScopeFullyAccounted`: identity-level requested-scope closure
 *   with independent evidence (gates Coverage VERIFIED_COMPLETE).
 *
 * Budget exhaustion produces exactly the PRD §10.2 tuple and is never
 * reinterpreted as end of user scope; an unclosable continuation produces
 * UNKNOWN-or-TRUNCATED coverage, never natural end.
 */
export function classifyDiscoveryOutcome(
  session: DiscoverySession,
  facts: {
    readonly allFrozenSelectedSucceeded: boolean;
    readonly requestedScopeFullyAccounted: boolean;
  },
): {
  readonly requestFulfillment: RequestFulfillmentStatus;
  readonly targetResolution: TargetResolutionStatus;
  readonly selectionAcquisition: SelectionAcquisitionStatus;
  readonly coverage: CoverageStatus;
  readonly stopReason: StopReason;
} {
  const stop = session.stop ?? { kind: 'USER_SCOPE_REACHED' as const };
  const selectionComplete = facts.allFrozenSelectedSucceeded;
  const authLimited = session.knownInaccessibleMemberIds.length > 0;
  switch (stop.kind) {
    case 'USER_SCOPE_REACHED':
    case 'ENUMERATION_CLOSED': {
      // §17.2: an authorization-limited but fully enumerated requested scope
      // reports PARTIAL request fulfillment with AUTH_REQUIRED — never a
      // COMPLETE claim while known requested members remain inaccessible,
      // and the requested scope never shrinks to the accessible subset.
      if (authLimited) {
        return deepFreeze({
          requestFulfillment: 'PARTIAL',
          targetResolution: facts.requestedScopeFullyAccounted ? 'RESOLVED' : 'PARTIAL',
          selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
          coverage: facts.requestedScopeFullyAccounted ? 'VERIFIED_COMPLETE' : 'UNKNOWN',
          stopReason: 'AUTH_REQUIRED',
        });
      }
      return deepFreeze({
        requestFulfillment: facts.requestedScopeFullyAccounted ? 'COMPLETE' : 'PARTIAL',
        targetResolution: facts.requestedScopeFullyAccounted ? 'RESOLVED' : 'PARTIAL',
        selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
        coverage: facts.requestedScopeFullyAccounted ? 'VERIFIED_COMPLETE' : 'UNKNOWN',
        stopReason:
          stop.kind === 'ENUMERATION_CLOSED'
            ? 'USER_SCOPE_REACHED'
            : session.selectionBasis === 'EXPLICIT_USER_SELECTION'
              ? 'USER_SELECTION_COMPLETE'
              : 'USER_SCOPE_REACHED',
      });
    }
    case 'NATURAL_COLLECTION_END': {
      if (authLimited) {
        return deepFreeze({
          requestFulfillment: 'PARTIAL',
          targetResolution: facts.requestedScopeFullyAccounted ? 'RESOLVED' : 'PARTIAL',
          selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
          coverage: facts.requestedScopeFullyAccounted ? 'VERIFIED_COMPLETE' : 'TRUNCATED',
          stopReason: 'AUTH_REQUIRED',
        });
      }
      return deepFreeze({
        requestFulfillment: facts.requestedScopeFullyAccounted ? 'COMPLETE' : 'PARTIAL',
        targetResolution: facts.requestedScopeFullyAccounted ? 'RESOLVED' : 'PARTIAL',
        selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
        coverage: facts.requestedScopeFullyAccounted ? 'VERIFIED_COMPLETE' : 'TRUNCATED',
        stopReason: 'NATURAL_COLLECTION_END',
      });
    }
    case 'DISCOVERY_BUDGET_EXHAUSTED':
      // Exact PRD §10.2 tuple; budget exhaustion is never end of user scope
      // and is never upgraded to complete, whatever the accounting claims.
      return deepFreeze({
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
        coverage: 'TRUNCATED',
        stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
      });
    case 'CONTINUATION_UNCLOSABLE':
      return deepFreeze({
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
        // Truthful unknown-or-truncated coverage; never natural end.
        coverage:
          session.resolvedMemberIds.length > 0 || session.pagesVisited.length > 0
            ? 'TRUNCATED'
            : 'UNKNOWN',
        stopReason: 'NO_PROGRESS',
      });
    default:
      return deepFreeze({
        requestFulfillment: 'UNKNOWN',
        targetResolution: 'PARTIAL',
        selectionAcquisition: selectionComplete ? 'COMPLETE' : 'PARTIAL',
        coverage: 'UNKNOWN',
        stopReason: 'NO_PROGRESS',
      });
  }
}

/**
 * Already-frozen S members MAY continue transfer after discovery-budget
 * exhaustion when TransferBudget and GlobalSafetyBudget remain (PRD §15.4,
 * C28). Discovery itself performs no transfer; this predicate reports the
 * downstream eligibility fact from canonical budget inputs only.
 */
export function frozenTargetsEligibleForTransfer(budgetRemaining: BudgetRemaining): boolean {
  return canTransferAfterDiscoveryExhaustion(budgetRemaining);
}
