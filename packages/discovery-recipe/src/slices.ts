/**
 * T011 S5/S6 slice engine-behavior conformance (PRD §28).
 *
 * The T002 slice registry is representation-only; T011 binds its engine
 * behavior to those frozen declarations: supported membership relations
 * only, provenance-bound cross-origin/CDN delivery, finite or naturally
 * terminable collections, truthful partial/truncated/unknown failure and no
 * count-based completeness. Required layer contracts are respected as
 * contracts — the validators themselves are not implemented here.
 */

import {
  decodeSupportSliceRef,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type AcquisitionContract,
  type DomainValidationResult,
  type SupportSliceRepresentation,
} from '@xdownload/domain-contracts';

/** Delivery provenance bindings accepted for S5/S6 member delivery. */
export const COLLECTION_DELIVERY_BINDINGS = [
  'DECLARED_DELIVERY_EDGE',
  'MEMBER_DELIVERY_EDGE',
  'SELECTED_RESOURCE_PROVENANCE',
] as const;

export type CollectionDeliveryBinding = (typeof COLLECTION_DELIVERY_BINDINGS)[number];

/**
 * Assert a confirmed contract's collection behavior configuration conforms
 * to the frozen S5 (current-page resource collection) or S6 (explicit
 * playlist/gallery collection) slice declarations:
 *
 * - the slice must exist in the frozen registry (unknown slices fail closed);
 * - the contract's required validation layers must cover the slice's
 *   required validation layers (layer contracts without implementing them);
 * - S5: current_page scope with a confirmed page-snapshot membership basis,
 *   default continuation NONE (any explicit continuation must have been
 *   confirmed on the contract);
 * - S6: explicit collection identity with a deterministic supported
 *   membership relation (SUPPORTED_TEMPLATE) and a naturally terminable
 *   scope.
 */
export function assertSliceCollectionConformance(
  sliceId: 'S5' | 'S6',
  contract: AcquisitionContract,
): DomainValidationResult<SupportSliceRepresentation> {
  const slice = decodeSupportSliceRef({ sliceId: sliceId });
  if (!slice.ok) {
    return slice;
  }
  const diagnostics = [];
  const requiredLayers = slice.value.requiredValidationLayers;
  for (const layer of requiredLayers) {
    if (!contract.validationPolicy.requiredLayers.includes(layer)) {
      diagnostics.push(
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'validationPolicy.requiredLayers',
          `slice ${sliceId} requires the '${layer}' validation layer as a layer contract`,
          'PRD-§28',
        ),
      );
    }
  }
  if (contract.status !== 'CONFIRMED') {
    diagnostics.push(
      diagnostic(
        'ADMISSION_REJECTED',
        'contract.status',
        `slice ${sliceId} collection behavior binds confirmed contracts only`,
        'PRD-§28',
      ),
    );
  }
  if (sliceId === 'S5') {
    if (contract.requestedScope.kind !== 'current_page') {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'requestedScope.kind',
          'S5 current-page resource collection requires current_page scope',
          'PRD-§28',
        ),
      );
    }
    if (
      contract.membershipBasis !== undefined &&
      contract.membershipBasis.basis !== 'CONFIRMED_PAGE_SNAPSHOT'
    ) {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'membershipBasis.basis',
          'S5 membership is the confirmed current-page membership snapshot',
          'PRD-§28',
        ),
      );
    }
    // S5 default: continuation NONE; explicit scopes are allowed only as
    // user-confirmed declared bounds (decode already rejects any other form).
  }
  if (sliceId === 'S6') {
    if (contract.collectionIdentity === undefined) {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'collectionIdentity',
          'S6 explicit playlist/gallery collection requires an explicit CollectionIdentity',
          'PRD-§28',
        ),
      );
    }
    if (
      contract.membershipBasis !== undefined &&
      contract.membershipBasis.basis !== 'SUPPORTED_TEMPLATE' &&
      contract.membershipBasis.basis !== 'DECLARED_FINITE_SET'
    ) {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'membershipBasis.basis',
          'S6 membership must be a deterministic supported relation or a user-declared finite set',
          'PRD-§28',
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(slice.value);
}

/**
 * Member-delivery provenance check for collection slices: cross-origin/CDN
 * delivery is allowed only through provenance-bound bindings (PRD §28 S5/S6
 * "Redirect/cross-origin: allowed for member delivery with provenance").
 */
export function isProvenanceBoundCollectionDelivery(binding: CollectionDeliveryBinding): boolean {
  return COLLECTION_DELIVERY_BINDINGS.includes(binding);
}

/** Truthful failure declaration for a collection slice run (never count-based). */
export function collectionSliceFailureDeclaration(input: {
  readonly closedRequestedContinuation: boolean;
  readonly membersResolved: number;
}): {
  readonly truthful: true;
  readonly status: 'CLOSED' | 'TRUNCATED' | 'UNKNOWN';
  readonly detail: string;
} {
  if (input.closedRequestedContinuation) {
    return deepFreeze({
      truthful: true,
      status: 'CLOSED',
      detail: `requested continuation closed with ${String(input.membersResolved)} resolved member identities`,
    });
  }
  return deepFreeze({
    truthful: true,
    status: input.membersResolved > 0 ? 'TRUNCATED' : 'UNKNOWN',
    detail:
      input.membersResolved > 0
        ? `requested continuation did not close; ${String(input.membersResolved)} member identities resolved so far`
        : 'requested continuation did not close and no member identity was resolved',
  });
}
