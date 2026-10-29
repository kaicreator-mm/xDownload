/**
 * T014 desktop command payload assembly.
 *
 * These builders assemble *command proposals* from the user's structured
 * intent and the canonical confirmation plan. Nothing here is authority:
 * payloads become canonical only when Core accepts them through its
 * fail-closed decode/admission/semantic gates. Rejections surface as typed
 * diagnostics; the adapter never "fixes" authoritative values locally.
 *
 * Identity facts (contract/target/collection/authorization references and
 * member identities) are minted through the canonical `@xdownload/domain-contracts`
 * id factories — an invalid reference fails closed before any command is
 * routed. Canonical scope/policy vocabulary is consumed read-only; the
 * desktop defaults below (validation layers, budget profile request) are
 * proposal defaults a Core admission gate is free to reject.
 */

import {
  makeAuthorizationContextRef,
  makeCollectionId,
  makeContractId,
  makeLogicalTargetId,
  makeMemberId,
  currentSchemaIdentity,
  scopeIdentityKey,
  type AcquisitionContract,
  type ConfirmationType,
  type DomainValidationResult,
  type MemberId,
} from '@xdownload/domain-contracts';
import type {
  AutomationMode,
  ContinuationScope,
  MembershipBasisRef,
  RequestedScope,
  ValidationLayer,
} from '@xdownload/domain-contracts';

/** Structured desktop intent input. Raw secrets are never representable. */
export interface DesktopIntentInput {
  /** Opaque user-facing target reference (URL/identifier handled by Core). */
  readonly targetRef: string;
  readonly intentType: 'SINGLE_RESOURCE' | 'COLLECTION';
  readonly requestedScope: RequestedScope;
  readonly continuationScope: ContinuationScope;
  readonly automationMode: AutomationMode;
  /** Opaque authorization context reference; never secret material. */
  readonly authorizationContextRef: string;
  readonly collectionIdentity?: string;
  readonly membershipBasis?: MembershipBasisRef;
  readonly validationLayers?: readonly ValidationLayer[];
}

/** Desktop proposal defaults (Core admission may reject; Core ledger governs). */
export const DESKTOP_DEFAULT_VALIDATION_LAYERS: readonly ValidationLayer[] = [
  'target',
  'transfer',
  'format',
];

export const DESKTOP_DEFAULT_BUDGET_PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 50,
    maxNavigationActions: 20,
    maxModelCalls: 5,
  },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_000_000_000,
    maxSegments: 5000,
    maxActiveTransferMs: 3_600_000,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

/**
 * Build the confirmed acquisition contract payload for the user's intent.
 * Submitted once, with status CONFIRMED: the user's scope confirmation is
 * the confirmation act; Core's acceptance is the authority act.
 */
export function buildConfirmedContractPayload(input: {
  readonly intent: DesktopIntentInput;
  readonly contractId: string;
  readonly confirmedAt: string;
}): DomainValidationResult<AcquisitionContract> {
  const intent = input.intent;
  const contractId = makeContractId(input.contractId);
  if (!contractId.ok) {
    return rebindFailure(contractId);
  }
  const requestedTarget = makeLogicalTargetId(intent.targetRef);
  if (!requestedTarget.ok) {
    return rebindFailure(requestedTarget);
  }
  let collectionIdentity: AcquisitionContract['collectionIdentity'];
  if (intent.collectionIdentity !== undefined) {
    const decoded = makeCollectionId(intent.collectionIdentity);
    if (!decoded.ok) {
      return rebindFailure(decoded);
    }
    collectionIdentity = decoded.value;
  }
  const authorizationContextRef = makeAuthorizationContextRef(intent.authorizationContextRef);
  if (!authorizationContextRef.ok) {
    return rebindFailure(authorizationContextRef);
  }
  const manualSelection = intent.automationMode === 'MANUAL_SELECTION';
  const contract: AcquisitionContract = {
    schemaIdentity: currentSchemaIdentity(),
    contractId: contractId.value,
    status: 'CONFIRMED',
    intentType: intent.intentType,
    requestedTarget: requestedTarget.value,
    collectionIdentity,
    membershipBasis: intent.membershipBasis,
    requestedScope: intent.requestedScope,
    continuationScope: intent.continuationScope,
    selectionPolicy: {
      basis: manualSelection ? 'EXPLICIT_USER_SELECTION' : 'ENTIRE_REQUESTED_SCOPE',
      allowsBatchSelection: true,
    },
    automationMode: intent.automationMode,
    explorationPermission: intent.intentType === 'COLLECTION' ? 'COLLECTION_MEMBER_EDGES' : 'NONE',
    budgetProfile: { ...DESKTOP_DEFAULT_BUDGET_PROFILE },
    authorizationContextRef: authorizationContextRef.value,
    validationPolicy: {
      requiredLayers: [...(intent.validationLayers ?? DESKTOP_DEFAULT_VALIDATION_LAYERS)],
    },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: input.confirmedAt,
  };
  return { ok: true, value: contract };
}

/**
 * Re-binding helper for shared fail-closed id validation results: the value
 * is exactly the branded id assigned to the same-typed field afterwards.
 */
function rebindFailure<T>(result: DomainValidationResult<unknown>): DomainValidationResult<T> {
  return result as DomainValidationResult<T>;
}

/** Selection claims for one resolved confirmation interaction. */
export function selectionClaimsFor(input: {
  readonly level: 'SCOPE_LEVEL' | 'BATCH_GROUP' | 'MATERIAL_ITEM' | 'MANUAL_SELECTION_UI';
  readonly memberIds: readonly string[];
}): DomainValidationResult<readonly Record<string, unknown>[]> {
  const memberRefs: MemberId[] = [];
  for (const raw of input.memberIds) {
    const memberId = makeMemberId(raw);
    if (!memberId.ok) {
      return rebindFailure(memberId);
    }
    memberRefs.push(memberId.value);
  }
  const confirmationType: ConfirmationType =
    input.level === 'MATERIAL_ITEM' ? 'CONFIRM_MEMBERSHIP' : 'CONFIRM_SELECTION';
  if (input.level === 'MATERIAL_ITEM') {
    // Per-item confirmations are recorded as individual SINGLE claims; this
    // level exists only within the canonical ≤3 material-item bound.
    return {
      ok: true,
      value: memberRefs.map((memberId) => ({
        kind: 'SINGLE',
        confirmationType,
        memberRefs: [memberId],
      })),
    };
  }
  return {
    ok: true,
    value: [{ kind: 'BATCH', confirmationType, memberRefs }],
  };
}

/** Build the selection snapshot payload binding a confirmed contract. */
export function buildSnapshotPayload(input: {
  readonly contract: AcquisitionContract;
  readonly snapshotId: string;
  readonly requestedMemberIds: readonly string[];
  readonly selectedMemberIds: readonly string[];
  readonly claims: readonly Record<string, unknown>[];
  readonly createdAt: string;
}): Record<string, unknown> {
  const scope = input.contract.requestedScope;
  return {
    schemaIdentity: currentSchemaIdentity(),
    snapshotId: input.snapshotId,
    contractId: input.contract.contractId,
    collectionIdentity: input.contract.collectionIdentity,
    requestedScope: scope,
    continuationScope: input.contract.continuationScope,
    coverageTarget: {
      collectionIdentity: 'collectionIdentity' in scope ? (scope.collectionIdentity ?? null) : null,
      scopeKind: scope.kind,
      scopeIdentityKey: scopeIdentityKey(scope),
      snapshotVersion: 1,
    },
    requestedMemberBasis: {
      kind: 'EXPLICIT_IDENTITIES',
      memberIds: [...input.requestedMemberIds],
    },
    // The desktop asserts no auth accessibility knowledge; Core owns that truth.
    authAccessibleBasis: { kind: 'UNKNOWN' },
    selectedMemberIds: [...input.selectedMemberIds],
    authorizationContextRef: input.contract.authorizationContextRef,
    profileContextRef: 'profile/desktop-default',
    selectionClaims: input.claims,
    sourceMarker: { system: 'xdownload-desktop-ui', version: 'v0.1.0' },
    createdAt: input.createdAt,
  };
}
