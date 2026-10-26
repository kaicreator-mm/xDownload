/**
 * S6 explicit finite playlist/gallery confirmed-collection admission for the
 * existing T016 per-member Core acquisition flow (#154, frozen L2 S6
 * successor).
 *
 * This is a non-public composition port: installed Core must provide the
 * actually confirmed contract and snapshot from its trusted durable store
 * (the CONFIRM_S6_COLLECTION COMMIT record). A browser page or generated
 * Recipe never creates these authority objects. The declared page range on
 * the confirmed contract is the ONLY navigation bound — the frozen
 * `validateScopeContinuationPair` requires continuationScope NONE for
 * `collection_page_range`, and this admission enforces exactly that frozen
 * pair (a `DECLARED_PAGE_RANGE` continuation would double-bind the range).
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

export interface ConfirmedS6Collection {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly MemberId[];
}

export function validateConfirmedS6Collection(
  contract: AcquisitionContract,
  snapshot: SelectionSnapshot,
): DomainValidationResult<ConfirmedS6Collection> {
  const conformance = assertSliceCollectionConformance('S6', contract);
  if (!conformance.ok) return fail(conformance.diagnostics);
  if (
    contract.status !== 'CONFIRMED' ||
    contract.intentType !== 'COLLECTION' ||
    contract.requestedScope.kind !== 'collection_page_range' ||
    snapshot.requestedScope.kind !== 'collection_page_range' ||
    contract.continuationScope.kind !== 'NONE' ||
    snapshot.continuationScope.kind !== 'NONE' ||
    (contract.membershipBasis?.basis !== 'SUPPORTED_TEMPLATE' &&
      contract.membershipBasis?.basis !== 'DECLARED_FINITE_SET') ||
    snapshot.requestedMemberBasis.kind !== 'SUPPORTED_COLLECTION_MEMBERSHIP'
  ) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'requestedScope',
        'S6 requires one confirmed finite collection_page_range scope with continuation NONE and a supported/declared membership basis',
      ),
    ]);
  }
  if (
    contract.requestedScope.fromPage !== snapshot.requestedScope.fromPage ||
    contract.requestedScope.toPage !== snapshot.requestedScope.toPage
  ) {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'snapshot.requestedScope',
        'S6 confirmed snapshot must bind the exact confirmed page range',
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
        'S6 selected members must belong to this confirmed contract and authorization',
      ),
    ]);
  }
  const selected = snapshot.selectedMemberIds;
  const unique = new Set(selected);
  if (selected.length === 0 || selected.length > 80 || unique.size !== selected.length) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'snapshot.selectedMemberIds',
        'S6 selected member set must be nonempty, unique and bounded',
      ),
    ]);
  }
  // A Core-confirmed collection selection is ONE BATCH covering every
  // selected member EXACTLY ONCE (the identical S5 discipline): conflicting
  // or multiple claims are ambiguous and cannot be silently replayed as one
  // approved group.
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
        'S6 must preserve the exact Core-confirmed batch selection claim',
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
export async function runConfirmedS6Collection(
  input: Omit<CollectionFlowInput, 'slice'>,
): Promise<CollectionFlowOutcome> {
  const admitted = validateConfirmedS6Collection(input.contract, input.snapshot);
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
            'S6 cannot redefine a confirmed member set or inject a new confirmation source',
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
    slice: 'S6',
    confirmationSource: {
      resolve: ({ confirmationType, memberRefs }) => {
        if (
          confirmationType !== 'CONFIRM_SELECTION' ||
          memberRefs.length === 0 ||
          memberRefs.length !== selectedIds.size ||
          memberRefs.some((id) => !selectedIds.has(id)) ||
          new Set(memberRefs).size !== selectedIds.size
        ) {
          return { kind: 'NOT_AVAILABLE', reason: 'S6_CONFIRMED_MEMBER_SET_MISMATCH' };
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
