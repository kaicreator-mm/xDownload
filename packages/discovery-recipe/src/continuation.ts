/**
 * T011 continuation admission and successor admission semantics
 * (PRD §10.1/§12, C08/C11/C12).
 *
 * With `continuation_scope = NONE` any later "load more / include more"
 * requires a successor AcquisitionContract and successor SelectionSnapshot;
 * with an explicit continuation scope, continuation stays within the exact
 * frozen scope and any enlargement creates successor identity. Silent
 * candidate replacement and retry-adding-members are forbidden. The canonical
 * `deriveSuccessorContract` / `deriveSuccessorSnapshot` / `planRetryOfFailedMembers`
 * APIs are the only successor/retry authorities — this module sequences them
 * and never bypasses them.
 */

import {
  deepFreeze,
  deriveSuccessorContract,
  deriveSuccessorSnapshot,
  diagnostic,
  fail,
  identitySetEquals,
  makeSnapshotId,
  ok,
  planRetryOfFailedMembers,
  type AcquisitionContract,
  type DomainValidationResult,
  type MemberId,
  type SelectionClaim,
  type SelectionSnapshot,
  type SnapshotId,
} from '@xdownload/domain-contracts';

/** What a user continuation request can ask for. */
export type ContinuationRequestKind = 'LOAD_MORE' | 'INCLUDE_MORE' | 'CONTINUE_NEXT_PAGE';

export type ContinuationAdmissionDecision =
  | { readonly decision: 'ADMITTED_WITHIN_FROZEN_SCOPE' }
  | {
      readonly decision: 'SUCCESSOR_REQUIRED';
      readonly reason:
        | 'CONTINUATION_SCOPE_NONE'
        | 'FROZEN_BOUND_ALREADY_CONSUMED'
        | 'SCOPE_ENLARGEMENT_REQUIRES_SUCCESSOR';
    };

/**
 * Decide whether a continuation request may run inside the confirmed
 * contract. A request under `continuation_scope = NONE` is always refused
 * (successor path); under an explicit declared scope it is honored only
 * within that exact frozen scope.
 */
export function admitContinuationRequest(input: {
  readonly contract: AcquisitionContract;
  readonly requestKind: ContinuationRequestKind;
  readonly declaredBoundConsumed: boolean;
}): ContinuationAdmissionDecision {
  const continuation = input.contract.continuationScope;
  if (continuation.kind === 'NONE') {
    return { decision: 'SUCCESSOR_REQUIRED', reason: 'CONTINUATION_SCOPE_NONE' };
  }
  if (input.declaredBoundConsumed) {
    return { decision: 'SUCCESSOR_REQUIRED', reason: 'FROZEN_BOUND_ALREADY_CONSUMED' };
  }
  return { decision: 'ADMITTED_WITHIN_FROZEN_SCOPE' };
}

/**
 * Assert that an executed continuation stayed inside the exact frozen scope.
 * Any enlargement (a different continuation identity than the frozen one) is
 * rejected as a successor requirement, never silently accepted.
 */
export function assertContinuationWithinFrozenScope(input: {
  readonly contract: AcquisitionContract;
  readonly executedContinuation: AcquisitionContract['continuationScope'];
}): DomainValidationResult<void> {
  const frozen = input.contract.continuationScope;
  const executed = input.executedContinuation;
  if (
    executed.kind === 'DECLARED_BATCH_COUNT' &&
    frozen.kind === 'DECLARED_BATCH_COUNT' &&
    executed.count > frozen.count
  ) {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'continuationScope.count',
        `executed continuation batch ${String(executed.count)} exceeds the frozen declared bound ${String(frozen.count)}; any enlargement creates successor identity`,
        'PRD-§10.1',
      ),
    ]);
  }
  if (
    executed.kind === 'DECLARED_PAGE_RANGE' &&
    frozen.kind === 'DECLARED_PAGE_RANGE' &&
    (executed.fromPage < frozen.fromPage || executed.toPage > frozen.toPage)
  ) {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'continuationScope.pageRange',
        'executed continuation page range exceeds the frozen declared range; any enlargement creates successor identity',
        'PRD-§10.3',
      ),
    ]);
  }
  if (frozen.kind === 'NONE' && executed.kind !== 'NONE') {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'continuationScope',
        'continuation executed under continuation_scope=NONE; a successor contract and snapshot are required',
        'PRD-§10.1/R01',
      ),
    ]);
  }
  return ok(undefined);
}

export interface ContinuationSuccessorBundle {
  readonly successorContract: AcquisitionContract;
  readonly successorSnapshot: SelectionSnapshot;
  readonly originalContractId: string;
  readonly originalSnapshotId: SnapshotId;
}

/**
 * Derive the successor contract + successor snapshot for a legitimate
 * continuation expansion. The original contract/snapshot remain immutable
 * historical authority; the successor carries new identity and links back.
 * `newSnapshotId` must be a fresh snapshot identity.
 */
export function deriveContinuationSuccessor(input: {
  readonly previousContract: AcquisitionContract;
  readonly previousSnapshot: SelectionSnapshot;
  readonly newContractScope?: AcquisitionContract['requestedScope'];
  readonly newContinuationScope: AcquisitionContract['continuationScope'];
  readonly newSnapshotId: string;
  readonly newSelectedMemberIds?: readonly MemberId[];
  readonly newSelectionClaims?: readonly SelectionClaim[];
}): DomainValidationResult<ContinuationSuccessorBundle> {
  if (input.newContinuationScope.kind === input.previousContract.continuationScope.kind) {
    const bothBatch =
      input.newContinuationScope.kind === 'DECLARED_BATCH_COUNT' &&
      input.previousContract.continuationScope.kind === 'DECLARED_BATCH_COUNT' &&
      input.newContinuationScope.count === input.previousContract.continuationScope.count;
    const bothRange =
      input.newContinuationScope.kind === 'DECLARED_PAGE_RANGE' &&
      input.previousContract.continuationScope.kind === 'DECLARED_PAGE_RANGE' &&
      input.newContinuationScope.fromPage === input.previousContract.continuationScope.fromPage &&
      input.newContinuationScope.toPage === input.previousContract.continuationScope.toPage;
    if (bothBatch || bothRange) {
      return fail([
        diagnostic(
          'SCOPE_MUTATION',
          'successor.continuationScope',
          'continuation successor must represent a semantic continuation change, not a copy of the frozen scope',
          'PRD-§10.1',
        ),
      ]);
    }
  }
  const successorContract = deriveSuccessorContract(
    input.previousContract,
    {
      continuationScope: input.newContinuationScope,
      ...(input.newContractScope === undefined ? {} : { requestedScope: input.newContractScope }),
    },
    input.newContractScope === undefined ? 'CONTINUATION_ADDITION' : 'SCOPE_CHANGE',
  );
  if (!successorContract.ok) {
    return successorContract;
  }
  const newSnapshotId = makeSnapshotId(input.newSnapshotId);
  if (!newSnapshotId.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'successor.snapshotId',
        'successor snapshot id must be a valid snapshot identity',
      ),
    ]);
  }
  const successorSnapshot = deriveSuccessorSnapshot(
    input.previousSnapshot,
    'CONTINUATION_EXPANSION',
    {
      newSnapshotId: newSnapshotId.value,
      ...(input.newSelectedMemberIds === undefined
        ? {}
        : { selectedMemberIds: input.newSelectedMemberIds }),
      ...(input.newSelectionClaims === undefined
        ? {}
        : { selectionClaims: input.newSelectionClaims }),
    },
  );
  if (!successorSnapshot.ok) {
    return successorSnapshot;
  }
  return ok(
    deepFreeze({
      successorContract: successorContract.value,
      successorSnapshot: successorSnapshot.value,
      originalContractId: input.previousContract.contractId,
      originalSnapshotId: input.previousSnapshot.snapshotId,
    }),
  );
}

/**
 * Collection-change drift detection (C11): compare the frozen member
 * identity set against the currently observed membership. Any drift forces
 * the successor-snapshot refresh path; silent in-place drift is never
 * accepted.
 */
export function detectFrozenMembershipDrift(input: {
  readonly snapshot: SelectionSnapshot;
  readonly currentlyObservedMemberIds: readonly string[];
}): DomainValidationResult<void> {
  if (!identitySetEquals(input.snapshot.selectedMemberIds, input.currentlyObservedMemberIds)) {
    return fail([
      diagnostic(
        'MEMBERSHIP_DRIFT',
        'snapshot.selectedMemberIds',
        'current observation differs from the frozen membership; the snapshot cannot silently drift — refresh via a successor snapshot',
        'C11',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Retry domain (C12): the retry plan contains exactly the original failed
 * member identities frozen in the snapshot; adding or replacing members is
 * rejected by the canonical retry planner.
 */
export function planFailedMemberRetry(input: {
  readonly snapshot: SelectionSnapshot;
  readonly failedMemberIds: readonly string[];
}): DomainValidationResult<readonly string[]> {
  return planRetryOfFailedMembers(input.snapshot, input.failedMemberIds);
}
