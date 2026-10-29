/**
 * T011 collection/member identity handling and requested-scope accounting
 * (PRD §11/§17/§19, L2 ADR-011, C01/C04/C07/C10/C18/C29).
 *
 * Completeness accounting uses identity correspondence, never count
 * equality; member detail/CDN transitions are provenance-bound locator
 * changes that preserve logical member identity; unrelated locator
 * substitution may not inherit identity; same-bytes/same-name members never
 * collapse distinct logical identities.
 */

import {
  assertLocatorTransitionPreservesTarget,
  canServeAsIndependentValidationOracle,
  deepFreeze,
  diagnostic,
  fail,
  identitySetEquals,
  type CoverageEvidence,
  type DomainValidationResult,
  type EvidenceRecord,
  type LocatorBinding,
  type ResourceLocator,
  type LocatorProvenance,
} from '@xdownload/domain-contracts';

/** One member's accounting outcome within the requested scope R. */
export interface MemberAccountingEntry {
  readonly memberId: string;
  readonly outcome: 'ACQUIRED_VALIDATED' | 'KNOWN_INACCESSIBLE' | 'UNACCOUNTED';
  /**
   * For KNOWN_INACCESSIBLE: independently evidenced identity/auth status.
   * Inaccessible members count as accounted-for coverage only with this
   * evidence and never as acquired (PRD §19).
   */
  readonly inaccessibleEvidence?: EvidenceRecord;
}

export interface RequestedScopeAccounting {
  readonly requestedMemberIds: readonly string[];
  readonly acquiredValidatedIds: readonly string[];
  readonly knownInaccessibleIds: readonly string[];
  readonly unaccountedIds: readonly string[];
  readonly requestedScopeCount: number;
  readonly requestedAccountedCount: number;
  /** Identity correspondence holds: sets correspond, not merely counts. */
  readonly identityCorrespondenceHolds: boolean;
  readonly duplicateReplacesMissingDetected: boolean;
}

/**
 * Account the requested scope R by identity correspondence:
 *
 * - every acquired/validated identity must belong to R (discovery and
 *   acquisition never widen R);
 * - inaccessible members count as accounted only with independently
 *   evidenced identity/auth status;
 * - a duplicate replacing a missing member with an equal total count is
 *   detected and never passes as completeness (C01);
 * - duplicate observations of the same identity collapse to one accounted
 *   identity — accounting is set-based, so same bytes/names never merge two
 *   logical members nor split one (C18).
 */
export function accountRequestedScope(input: {
  readonly requestedMemberIds: readonly string[];
  readonly acquiredValidatedIds: readonly string[];
  readonly inaccessibleMembers?: readonly {
    readonly memberId: string;
    readonly evidence: EvidenceRecord;
  }[];
}): RequestedScopeAccounting {
  const requested = new Set(input.requestedMemberIds);
  const acquiredSet = new Set<string>();
  for (const id of input.acquiredValidatedIds) {
    if (requested.has(id)) {
      acquiredSet.add(id);
    }
  }
  const inaccessible: MemberAccountingEntry[] = [];
  const inaccessibleSet = new Set<string>();
  for (const member of input.inaccessibleMembers ?? []) {
    if (
      requested.has(member.memberId) &&
      !acquiredSet.has(member.memberId) &&
      canServeAsIndependentValidationOracle(member.evidence)
    ) {
      inaccessibleSet.add(member.memberId);
      inaccessible.push({
        memberId: member.memberId,
        outcome: 'KNOWN_INACCESSIBLE',
        inaccessibleEvidence: member.evidence,
      });
    }
  }
  const unaccounted: string[] = [];
  for (const id of input.requestedMemberIds) {
    if (!acquiredSet.has(id) && !inaccessibleSet.has(id) && !unaccounted.includes(id)) {
      unaccounted.push(id);
    }
  }
  // Duplicate/substitution detection (C01): if the raw validated entry count
  // equals the requested count while the identity sets differ, an equal
  // count stood in for missing identities — counts matched, correspondence
  // did not. Same-bytes/same-name duplicates never merge or replace logical
  // identities (C18): accounting compares identity sets.
  const acquiredDedup = deduplicate(input.acquiredValidatedIds);
  const duplicateReplacesMissing =
    input.acquiredValidatedIds.length === requested.size &&
    !identitySetEquals(acquiredDedup, [...requested]);
  const identityCorrespondenceHolds =
    !duplicateReplacesMissing && acquiredDedup.every((id) => requested.has(id));
  return deepFreeze({
    requestedMemberIds: deepFreeze(deduplicate(input.requestedMemberIds)),
    acquiredValidatedIds: deepFreeze([...acquiredSet]),
    knownInaccessibleIds: deepFreeze([...inaccessibleSet]),
    unaccountedIds: deepFreeze(unaccounted),
    requestedScopeCount: requested.size,
    requestedAccountedCount: acquiredSet.size + inaccessibleSet.size,
    identityCorrespondenceHolds: identityCorrespondenceHolds,
    duplicateReplacesMissingDetected: duplicateReplacesMissing,
  });
}

function deduplicate(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Coverage evidence for the requested-scope CoverageTarget (PRD §19). The
 * sufficient bases are exactly the §19 classes; anything else — count
 * equality, page/batch limits, failed next page, pagination loop, budget
 * exhaustion, bare "no more found" — yields a typed INSUFFICIENT basis.
 */
export type RequestedScopeClosure =
  | {
      readonly kind: 'AUTHORITATIVE_IDENTITY_LIST';
      readonly identities: readonly string[];
    }
  | {
      readonly kind: 'DECLARED_TOTAL_WITH_CLOSURE';
      readonly declaredTotal: number;
      readonly closure: 'NATURAL_END_VALIDATED' | 'CONTINUATION_CLOSED';
    }
  | { readonly kind: 'USER_DECLARED_FINITE_SET' }
  | { readonly kind: 'NO_CLOSURE'; readonly reason: RequestedScopeClosureFailure };

export type RequestedScopeClosureFailure =
  | 'COUNT_EQUALITY'
  | 'MAX_ITEMS_REACHED'
  | 'PAGE_LIMIT_REACHED'
  | 'TIMEOUT'
  | 'BUDGET_EXHAUSTED'
  | 'FAILED_NEXT_PAGE'
  | 'PAGINATION_LOOP'
  | 'NO_MORE_FOUND_WITHOUT_CLOSURE';

export function coverageEvidenceForAccounting(input: {
  readonly accounting: RequestedScopeAccounting;
  readonly closure: RequestedScopeClosure;
}): CoverageEvidence {
  const { accounting } = input;
  const fullyAccounted =
    accounting.identityCorrespondenceHolds &&
    accounting.unaccountedIds.length === 0 &&
    accounting.requestedAccountedCount === accounting.requestedScopeCount;
  if (!fullyAccounted) {
    const insufficient: CoverageEvidence = {
      kind: 'INSUFFICIENT',
      basis:
        input.closure.kind === 'NO_CLOSURE'
          ? input.closure.reason
          : 'NO_MORE_FOUND_WITHOUT_CLOSURE',
    };
    return deepFreeze(insufficient);
  }
  switch (input.closure.kind) {
    case 'AUTHORITATIVE_IDENTITY_LIST': {
      const evidence: CoverageEvidence = {
        kind: 'SUFFICIENT',
        basis: {
          basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
          identities: [...input.closure.identities],
        },
      };
      return deepFreeze(evidence);
    }
    case 'DECLARED_TOTAL_WITH_CLOSURE': {
      const evidence: CoverageEvidence = {
        kind: 'SUFFICIENT',
        basis: {
          basis: 'DECLARED_TOTAL_WITH_CLOSURE',
          declaredTotal: input.closure.declaredTotal,
          accountedIdentityCount: accounting.requestedAccountedCount,
          closure: input.closure.closure,
        },
      };
      return deepFreeze(evidence);
    }
    case 'USER_DECLARED_FINITE_SET': {
      const evidence: CoverageEvidence = {
        kind: 'SUFFICIENT',
        basis: {
          basis: 'USER_DECLARED_FINITE_SET_FULLY_ACCOUNTED',
          declaredCount: accounting.requestedScopeCount,
          accountedIdentityCount: accounting.requestedAccountedCount,
        },
      };
      return deepFreeze(evidence);
    }
    case 'NO_CLOSURE': {
      const evidence: CoverageEvidence = {
        kind: 'INSUFFICIENT',
        basis: input.closure.reason,
      };
      return deepFreeze(evidence);
    }
    default: {
      const evidence: CoverageEvidence = {
        kind: 'INSUFFICIENT',
        basis: 'NO_MORE_FOUND_WITHOUT_CLOSURE',
      };
      return deepFreeze(evidence);
    }
  }
}

/**
 * Member delivery hop (member detail page / declared CDN): the new locator
 * keeps the logical member identity only when its provenance descends from
 * the previous delivery locator through an allowed binding (C07/C29). An
 * unrelated substitution is rejected instead of silently becoming the
 * member's new truth.
 */
export function resolveMemberDeliveryHop(input: {
  readonly memberLocator: LocatorBinding;
  readonly nextLocator: ResourceLocator;
  readonly nextProvenance: LocatorProvenance;
}): DomainValidationResult<LocatorBinding> {
  const transition = assertLocatorTransitionPreservesTarget(
    input.memberLocator,
    input.nextLocator,
    input.nextProvenance,
  );
  if (!transition.ok) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        'memberDelivery.provenance',
        'member detail/CDN transition without provenance descending from the previous delivery locator cannot claim the same logical member identity',
        'C07/C29',
      ),
    ]);
  }
  return transition;
}

/** Truthful requested-scope accounting summary for C10-style reporting. */
export function describeAccounting(accounting: RequestedScopeAccounting): {
  readonly requestedScopeCount: number;
  readonly requestedAccountedCount: number;
  readonly authAccessibleCount: number;
  readonly authInaccessibleCount: number;
  readonly requestedScopeRemains: number;
  readonly explanation: string;
} {
  return deepFreeze({
    requestedScopeCount: accounting.requestedScopeCount,
    requestedAccountedCount: accounting.requestedAccountedCount,
    authAccessibleCount: accounting.acquiredValidatedIds.length,
    authInaccessibleCount: accounting.knownInaccessibleIds.length,
    // The requested scope never shrinks to the accessible subset (PRD §11).
    requestedScopeRemains: accounting.requestedScopeCount,
    explanation:
      `${String(accounting.acquiredValidatedIds.length)} of ${String(accounting.requestedScopeCount)} requested members were acquired and validated. ` +
      `The requested scope remains all ${String(accounting.requestedScopeCount)} members.` +
      (accounting.knownInaccessibleIds.length > 0
        ? ` ${String(accounting.knownInaccessibleIds.length)} known requested members are inaccessible under the current authorization context; no unauthorized access was attempted.`
        : ''),
  });
}
