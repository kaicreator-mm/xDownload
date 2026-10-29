/**
 * T016 continuation / successor / retry orchestration lane (PRD §10.1/§12,
 * C08/C11/C12; frozen L2 invariant on snapshot immutability).
 *
 * The T011 continuation machinery is the ONLY continuation path. This lane
 * sequences it and adds two composition rules without changing any semantic:
 *
 * 1. A continuation request may enter only as an EXPLICIT USER REQUEST; a
 *    budget-exhaustion "justification" is refused outright — budget
 *    exhaustion is a stop reason and never creates, implies or expands
 *    continuation scope (C23/C28).
 * 2. A legitimate expansion derives successor contract/snapshot identity via
 *    `deriveContinuationSuccessor` and confirms the successor draft; the
 *    original contract/snapshot remain immutable historical authority.
 *
 * Drift detection and failed-member retry pass through verbatim: retry
 * operates on the original frozen member identities only, and any membership
 * drift forces the successor path instead of silent mutation.
 */

import {
  confirmContract,
  makeMemberId,
  ok,
  unwrapOrThrow,
  type AcquisitionContract,
  type DomainValidationResult,
  type MemberId,
  type SelectionClaim,
  type SelectionSnapshot,
} from '@xdownload/domain-contracts';
import {
  admitContinuationRequest,
  assertContinuationWithinFrozenScope,
  deriveContinuationSuccessor,
  detectFrozenMembershipDrift,
  planFailedMemberRetry,
  type ContinuationRequestKind,
  type ContinuationSuccessorBundle,
} from '@xdownload/discovery-recipe';

/** Why a continuation request reaches the composed lane. */
export type ContinuationJustification =
  | { readonly kind: 'EXPLICIT_USER_REQUEST'; readonly requestKind: ContinuationRequestKind }
  | {
      readonly kind: 'BUDGET_EXHAUSTED';
      readonly domain: 'discovery' | 'transfer' | 'global_safety';
    };

export type ContinuationLaneDecision =
  | { readonly action: 'RUN_WITHIN_FROZEN_SCOPE' }
  | {
      readonly action: 'SUCCESSOR_REQUIRED';
      readonly reason:
        | 'CONTINUATION_SCOPE_NONE'
        | 'FROZEN_BOUND_ALREADY_CONSUMED'
        | 'SCOPE_ENLARGEMENT_REQUIRES_SUCCESSOR';
    }
  | { readonly action: 'REFUSED'; readonly reason: 'BUDGET_IS_NOT_CONTINUATION_AUTHORITY' };

/**
 * Composed continuation admission. The admission verdict is the verbatim
 * T011 `admitContinuationRequest` decision; the lane only refuses the
 * budget-exhaustion justification, which is not a representable user scope.
 */
export function requestContinuation(input: {
  readonly contract: AcquisitionContract;
  readonly declaredBoundConsumed: boolean;
  readonly justification: ContinuationJustification;
}): ContinuationLaneDecision {
  if (input.justification.kind === 'BUDGET_EXHAUSTED') {
    return { action: 'REFUSED', reason: 'BUDGET_IS_NOT_CONTINUATION_AUTHORITY' };
  }
  const admission = admitContinuationRequest({
    contract: input.contract,
    requestKind: input.justification.requestKind,
    declaredBoundConsumed: input.declaredBoundConsumed,
  });
  if (admission.decision === 'ADMITTED_WITHIN_FROZEN_SCOPE') {
    return { action: 'RUN_WITHIN_FROZEN_SCOPE' };
  }
  return { action: 'SUCCESSOR_REQUIRED', reason: admission.reason };
}

export interface ContinuationExpansionInput {
  readonly previousContract: AcquisitionContract;
  readonly previousSnapshot: SelectionSnapshot;
  readonly newContinuationScope: AcquisitionContract['continuationScope'];
  readonly newContractScope?: AcquisitionContract['requestedScope'];
  readonly newSnapshotId: string;
  readonly newSelectedMemberIds?: readonly string[];
  readonly newSelectionClaims?: readonly SelectionClaim[];
  readonly confirmedAt: string;
}

export type ContinuationExpansionBundle = ContinuationSuccessorBundle & {
  /** The successor DRAFT after canonical confirmation (CONFIRMED). */
  readonly confirmedSuccessorContract: AcquisitionContract;
};

/**
 * Derive and confirm the successor contract + snapshot for a legitimate
 * continuation expansion. The original contract/snapshot are never mutated;
 * the successor carries fresh identity and links back.
 */
export function expandThroughSuccessor(
  input: ContinuationExpansionInput,
): DomainValidationResult<ContinuationExpansionBundle> {
  const bundle = deriveContinuationSuccessor({
    previousContract: input.previousContract,
    previousSnapshot: input.previousSnapshot,
    ...(input.newContractScope === undefined ? {} : { newContractScope: input.newContractScope }),
    newContinuationScope: input.newContinuationScope,
    newSnapshotId: input.newSnapshotId,
    ...(input.newSelectedMemberIds === undefined
      ? {}
      : {
          newSelectedMemberIds: input.newSelectedMemberIds.map(
            (id) => unwrapOrThrow(makeMemberId(id)) as MemberId,
          ),
        }),
    ...(input.newSelectionClaims === undefined
      ? {}
      : { newSelectionClaims: input.newSelectionClaims }),
  });
  if (!bundle.ok) {
    return bundle;
  }
  const confirmed = confirmContract(bundle.value.successorContract, input.confirmedAt);
  if (!confirmed.ok) {
    return confirmed as DomainValidationResult<ContinuationExpansionBundle>;
  }
  return ok({ ...bundle.value, confirmedSuccessorContract: confirmed.value });
}

// Verbatim pass-through of the remaining T011 continuation authorities, so
// every composed consumer goes through one lane surface without any semantic
// change: drift detection and retry planning are upstream-owned decisions.
export { assertContinuationWithinFrozenScope, detectFrozenMembershipDrift, planFailedMemberRetry };
