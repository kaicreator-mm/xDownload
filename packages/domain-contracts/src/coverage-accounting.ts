/**
 * T007 requested-scope CoverageAccounting (frozen L2 §6.7, PRD §17/§19).
 *
 * The three §17 views stay distinct: requested-scope coverage is the only
 * authoritative view; accessible-subset accounting records auth-accessible
 * and auth-inaccessible identities; parent-collection coverage is optional
 * secondary information that never replaces requested-scope coverage. The
 * §17.2 accounting tuple is computed from identity sets, never from bare
 * counts (identity correspondence, PRD §11/§19, counterexample C01).
 * `AuthorizationContextRef` is recorded as opaque context only; it never
 * redefines or shrinks the requested reference set.
 */

import { deepFreeze, diagnostic, fail, ok, type DomainValidationResult } from './diagnostics.ts';
import {
  makeEvidenceId,
  type AuthorizationContextRef,
  type CollectionId,
  type EvidenceId,
  type MemberId,
} from './ids.ts';
import { canServeAsIndependentValidationOracle, type EvidenceRecord } from './evidence.ts';
import type { CoverageStatus } from './result.ts';
import type { CoverageTarget } from './snapshot.ts';
import type { EvidenceLedger } from './ledger.ts';

/** A requested member that is known and classified as auth-inaccessible. */
export interface AuthInaccessibleMember {
  readonly memberId: MemberId;
  /**
   * Evidence record (already in the ledger) that independently evidences the
   * identity and authorization status. Without oracle-grade evidence the
   * member cannot count as accounted coverage (PRD §19).
   */
  readonly classificationEvidenceId?: EvidenceId;
}

export interface ClassifiedAuthInaccessibleMember extends AuthInaccessibleMember {
  /** True only when the classification evidence is oracle-grade independent. */
  readonly independentlyAccounted: boolean;
}

export interface CoverageAccountingInput {
  /** Primary CoverageTarget the accounting is bound to (PRD §17). */
  readonly coverageTarget: CoverageTarget;
  /** The immutable requested reference set R. Never shrunk or redefined here. */
  readonly requestedMemberIds: readonly MemberId[];
  /** Requested members whose identity/accounting is independently resolved. */
  readonly resolvedMemberIds: readonly MemberId[];
  readonly authAccessibleMemberIds: readonly MemberId[];
  readonly authInaccessibleMembers: readonly AuthInaccessibleMember[];
  /** The frozen selected set S (subset of the resolved requested members). */
  readonly selectedMemberIds: readonly MemberId[];
  /** Members with a durably accepted, required-validation-passing result. */
  readonly validatedMemberIds: readonly MemberId[];
  /** Opaque authorization context reference — context only, never scope. */
  readonly authorizationContextRef?: AuthorizationContextRef;
  /**
   * Optional parent-collection view; informational only (PRD §17 view 3),
   * never a substitute for requested-scope coverage.
   */
  readonly parentCollectionCoverage?: {
    readonly collectionIdentity: CollectionId;
    readonly status: CoverageStatus;
  };
}

export interface CoverageAccounting {
  readonly coverageTarget: CoverageTarget;
  readonly authorizationContextRef?: AuthorizationContextRef;
  /** View 1 — authoritative requested-scope reference set (verbatim input). */
  readonly requested: readonly MemberId[];
  /** View 2 — accessible-subset accounting. */
  readonly authAccessible: readonly MemberId[];
  readonly authInaccessible: readonly ClassifiedAuthInaccessibleMember[];
  /** Requested members independently resolved (accessible + evidenced inaccessible). */
  readonly resolved: readonly MemberId[];
  /** The frozen selected set S. */
  readonly selected: readonly MemberId[];
  readonly validated: readonly MemberId[];
  /** accounted = validated ∪ independently-evidenced inaccessible members. */
  readonly accounted: readonly MemberId[];
  readonly parentCollectionCoverage?: {
    readonly collectionIdentity: CollectionId;
    readonly status: CoverageStatus;
  };
  readonly counts: {
    readonly requested: number;
    readonly accounted: number;
    readonly authAccessible: number;
    readonly authInaccessible: number;
    readonly selected: number;
    readonly validated: number;
  };
}

function assertNoDuplicates(ids: readonly string[], field: string): DomainValidationResult<void> {
  if (new Set(ids).size !== ids.length) {
    return fail([
      diagnostic(
        'DUPLICATE_IDENTITY',
        field,
        'accounting operates on identity sets; duplicate logical identities are rejected (PRD §11)',
      ),
    ]);
  }
  return ok(undefined);
}

function assertWithinRequested(
  ids: readonly string[],
  requested: ReadonlySet<string>,
  field: string,
): DomainValidationResult<void> {
  const outside = ids.filter((id) => !requested.has(id));
  if (outside.length > 0) {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        field,
        `identity set contains non-requested members (${outside.join(', ')}); accounting subsets stay within the immutable requested scope (C12/PRD-§17)`,
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Build the requested-scope accounting from identity sets plus the evidence
 * ledger. Fails closed on duplicate identities, on any set escaping the
 * immutable requested scope, or on selected/validated members outside the
 * resolved view. Inaccessible members without oracle-grade independent
 * classification evidence are kept but marked not independently accounted —
 * they never count as accounted coverage and never as fulfilled.
 */
export function buildCoverageAccounting(
  input: CoverageAccountingInput,
  ledger: EvidenceLedger,
): DomainValidationResult<CoverageAccounting> {
  const requested = input.requestedMemberIds;
  const requestedSet = new Set(requested);

  const checks = [
    assertNoDuplicates(requested, 'requestedMemberIds'),
    assertNoDuplicates(input.resolvedMemberIds, 'resolvedMemberIds'),
    assertNoDuplicates(input.authAccessibleMemberIds, 'authAccessibleMemberIds'),
    assertNoDuplicates(input.selectedMemberIds, 'selectedMemberIds'),
    assertNoDuplicates(input.validatedMemberIds, 'validatedMemberIds'),
    assertWithinRequested(input.resolvedMemberIds, requestedSet, 'resolvedMemberIds'),
    assertWithinRequested(input.authAccessibleMemberIds, requestedSet, 'authAccessibleMemberIds'),
    assertWithinRequested(
      input.authInaccessibleMembers.map((member) => member.memberId),
      requestedSet,
      'authInaccessibleMembers',
    ),
    assertWithinRequested(input.selectedMemberIds, requestedSet, 'selectedMemberIds'),
    assertWithinRequested(input.validatedMemberIds, requestedSet, 'validatedMemberIds'),
  ];
  for (const check of checks) {
    if (!check.ok) {
      return check;
    }
  }

  const selectedSet = new Set(input.selectedMemberIds);
  const outsideSelection = input.validatedMemberIds.filter((id) => !selectedSet.has(id));
  if (outsideSelection.length > 0) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'validatedMemberIds',
        `validated members outside the frozen selected set (${outsideSelection.join(', ')}) cannot enter accounting (PRD §19)`,
      ),
    ]);
  }

  const authInaccessible: ClassifiedAuthInaccessibleMember[] = input.authInaccessibleMembers.map(
    (member) => {
      let evidence: EvidenceRecord | undefined;
      if (member.classificationEvidenceId !== undefined) {
        const evidenceId = makeEvidenceId(member.classificationEvidenceId);
        if (evidenceId.ok) {
          evidence = ledger.findByEvidenceId(evidenceId.value);
        }
      }
      const independent = evidence !== undefined && canServeAsIndependentValidationOracle(evidence);
      return { ...member, independentlyAccounted: independent };
    },
  );
  const overlapping = input.authAccessibleMemberIds.filter((id) =>
    authInaccessible.some((member) => member.memberId === id),
  );
  if (overlapping.length > 0) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'authAccessibleMemberIds',
        `members cannot be both auth-accessible and auth-inaccessible (${overlapping.join(', ')})`,
      ),
    ]);
  }

  const evidencedInaccessible = authInaccessible
    .filter((member) => member.independentlyAccounted)
    .map((member) => member.memberId);
  const resolved = [...new Set([...input.resolvedMemberIds, ...evidencedInaccessible])].sort();
  const accounted = [...new Set([...input.validatedMemberIds, ...evidencedInaccessible])].sort();

  return ok(
    deepFreeze({
      coverageTarget: input.coverageTarget,
      authorizationContextRef: input.authorizationContextRef,
      requested: [...requested].sort(),
      authAccessible: [...input.authAccessibleMemberIds].sort(),
      authInaccessible: deepFreeze(authInaccessible),
      resolved,
      selected: [...input.selectedMemberIds].sort(),
      validated: [...input.validatedMemberIds].sort(),
      accounted,
      parentCollectionCoverage: input.parentCollectionCoverage,
      counts: deepFreeze({
        requested: requested.length,
        accounted: accounted.length,
        authAccessible: input.authAccessibleMemberIds.length,
        authInaccessible: authInaccessible.length,
        selected: input.selectedMemberIds.length,
        validated: input.validatedMemberIds.length,
      }),
    }),
  );
}

/** Identity correspondence: accounted set equals the requested set as sets. */
export function requestedScopeFullyAccounted(accounting: CoverageAccounting): boolean {
  return (
    accounting.accounted.length === accounting.requested.length &&
    accounting.accounted.every((id) => accounting.requested.includes(id))
  );
}
