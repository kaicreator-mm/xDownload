/**
 * S5 current-page confirmed membership admission for the existing
 * T016 per-member Core acquisition flow.
 *
 * This is a non-public composition port: installed Core must provide the
 * actually confirmed contract and snapshot from its trusted durable store.
 * A browser page or generated Recipe never creates these authority objects.
 */
import {
  diagnostic,
  fail,
  ok,
  type AcquisitionContract,
  type DomainValidationResult,
  type MemberId,
  type SelectionSnapshot,
} from '@xdownload/domain-contracts';
import { assertSliceCollectionConformance } from '@xdownload/discovery-recipe';
import {
  runCollectionFlow,
  type CollectionFlowInput,
  type CollectionFlowOutcome,
} from './collection-flow.ts';

export interface ConfirmedPageGroup {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly MemberId[];
}

export function validateConfirmedPageGroup(
  contract: AcquisitionContract,
  snapshot: SelectionSnapshot,
): DomainValidationResult<ConfirmedPageGroup> {
  const conformance = assertSliceCollectionConformance('S5', contract);
  if (!conformance.ok) return fail(conformance.diagnostics);
  if (
    contract.status !== 'CONFIRMED' ||
    contract.intentType !== 'COLLECTION' ||
    contract.requestedScope.kind !== 'current_page' ||
    snapshot.requestedScope.kind !== 'current_page' ||
    contract.continuationScope.kind !== 'NONE' ||
    snapshot.continuationScope.kind !== 'NONE' ||
    contract.membershipBasis?.basis !== 'CONFIRMED_PAGE_SNAPSHOT' ||
    snapshot.requestedMemberBasis.kind !== 'CONFIRMED_PAGE_SNAPSHOT'
  ) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'requestedScope',
        'S5 group requires one confirmed current-page membership with continuation NONE',
      ),
    ]);
  }
  if (
    snapshot.contractId !== contract.contractId ||
    contract.selectionSnapshotRef !== snapshot.snapshotId ||
    snapshot.requestedScope.collectionIdentity !== contract.requestedScope.collectionIdentity ||
    snapshot.authorizationContextRef !== contract.authorizationContextRef
  ) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'snapshotId',
        'S5 selected members must belong to this confirmed contract and authorization',
      ),
    ]);
  }
  const selected = snapshot.selectedMemberIds;
  const unique = new Set(selected);
  if (selected.length === 0 || selected.length > 128 || unique.size !== selected.length) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'snapshot.selectedMemberIds',
        'S5 current-page member set must be nonempty, unique and bounded',
      ),
    ]);
  }
  // A Core-confirmed current-page group is ONE BATCH covering every
  // frozen member EXACTLY ONCE. Length and subset checks are insufficient:
  // BATCH [A,A] plus a separate SINGLE [B] must not authorize [A,B].
  // Conflicting/multiple claims are ambiguous and cannot be silently
  // replayed as one approved group.
  const matchingBatch =
    snapshot.selectionClaims.length === 1 &&
    snapshot.selectionClaims[0]?.kind === 'BATCH' &&
    snapshot.selectionClaims[0].confirmationType === 'CONFIRM_SELECTION' &&
    snapshot.selectionClaims[0].memberRefs.length === selected.length &&
    new Set(snapshot.selectionClaims[0].memberRefs).size === selected.length &&
    snapshot.selectionClaims[0].memberRefs.every((member) => unique.has(member));
  if (!matchingBatch) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'snapshot.selectionClaims',
        'S5 must preserve the exact Core-confirmed batch selection claim',
      ),
    ]);
  }
  return ok({
    contractId: contract.contractId,
    snapshotId: snapshot.snapshotId,
    selectedMemberIds: Object.freeze([...selected]),
  });
}

/**
 * Execute only after the caller's installed, privileged Core boundary has
 * provided a durable confirmed snapshot. The pre-existing T016 lane performs
 * all authorization, per-member Core effects and coverage projection.
 */
export async function runConfirmedCurrentPageGroup(
  input: Omit<CollectionFlowInput, 'slice'>,
): Promise<CollectionFlowOutcome> {
  const admitted = validateConfirmedPageGroup(input.contract, input.snapshot);
  if (!admitted.ok) {
    return {
      ok: false,
      rejection: { stage: 'MEMBERSHIP_IDENTITY', diagnostics: admitted.diagnostics },
    };
  }
  const requested = input.declaredRequestedMemberIds;
  if (
    (requested !== undefined &&
      (requested.length !== admitted.value.selectedMemberIds.length ||
        requested.some((id) => !admitted.value.selectedMemberIds.includes(id as MemberId)))) ||
    input.confirmationSource !== undefined ||
    (input.ambiguousMaterialMemberIds?.length ?? 0) > 0
  ) {
    return {
      ok: false,
      rejection: {
        stage: 'MEMBERSHIP_IDENTITY',
        diagnostics: [
          diagnostic(
            'ADMISSION_REJECTED',
            'requestedMemberIds',
            'S5 cannot redefine a confirmed member set or inject a new confirmation source',
          ),
        ],
      },
    };
  }
  // The installed Core has already persisted the confirmed BATCH selection
  // as part of the immutable snapshot above. The generic T016 runner expects
  // a confirmation outcome *source* for ASSISTED scope, even for a confirmed
  // snapshot; with no source it currently refuses before real acquisition.
  // Bridge ONLY the already validated member set. Never accept a new caller
  // confirmationSource or synthesize USER_CONFIRMATION evidence from a
  // previously persisted selection. INJECTED_SOURCE marks this internal
  // replay as distinct from a freshly observed human decision.
  const selectedIds = new Set(admitted.value.selectedMemberIds);
  return runCollectionFlow({
    ...input,
    slice: 'S5',
    confirmationSource: {
      resolve: ({ confirmationType, memberRefs }) => {
        if (
          confirmationType !== 'CONFIRM_SELECTION' ||
          memberRefs.length === 0 ||
          memberRefs.length !== selectedIds.size ||
          memberRefs.some((id) => !selectedIds.has(id)) ||
          new Set(memberRefs).size !== selectedIds.size
        ) {
          return { kind: 'NOT_AVAILABLE', reason: 'S5_CONFIRMED_MEMBER_SET_MISMATCH' };
        }
        return {
          kind: 'RESOLVED',
          origin: 'INJECTED_SOURCE',
          outcomes: memberRefs.map(() => 'CONFIRMED' as const),
        };
      },
    },
  });
}
