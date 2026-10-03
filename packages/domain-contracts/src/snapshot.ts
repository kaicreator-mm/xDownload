/**
 * T002 SelectionSnapshot — frozen selection authority after confirmation.
 *
 * After preview/selection is confirmed the snapshot freezes requested scope,
 * continuation, coverage target and selected member identities (PRD §12).
 * Retry/resume reuses the same snapshot; failed-item retry cannot add or
 * replace members; changed collection/profile/version or later continuation
 * expansion requires successor snapshot identity. Silent member drift and
 * count-equality completeness are rejected (PRD §11, C01/C11/C12).
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { currentSchemaIdentity, decodeSchemaIdentity, type SchemaIdentity } from './version.ts';
import {
  identitySetEquals,
  makeAuthorizationContextRef,
  makeCollectionId,
  makeContractId,
  makeMemberId,
  makeProfileContextRef,
  makeSnapshotId,
  type AuthorizationContextRef,
  type CollectionId,
  type ContractId,
  type MemberId,
  type ProfileContextRef,
  type SnapshotId,
} from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireArrayOfStrings,
  requireIsoTimestamp,
  requireInteger,
  requireLiteral,
  requireNonEmptyString,
  requireOptionalString,
} from './decode.ts';
import type { ConfirmationType } from './evidence.ts';
import {
  decodeContinuationScope,
  decodeRequestedScope,
  sameScopeIdentity,
  type ContinuationScope,
  type RequestedScope,
  type ScopePrimitive,
} from './scope.ts';

export type MemberBasisKind =
  'EXPLICIT_IDENTITIES' | 'CONFIRMED_PAGE_SNAPSHOT' | 'SUPPORTED_COLLECTION_MEMBERSHIP';

export type MemberBasis =
  | { readonly kind: 'EXPLICIT_IDENTITIES'; readonly memberIds: readonly MemberId[] }
  | { readonly kind: 'CONFIRMED_PAGE_SNAPSHOT' }
  | { readonly kind: 'SUPPORTED_COLLECTION_MEMBERSHIP' };

export type AuthAccessibleBasis = MemberBasis | { readonly kind: 'UNKNOWN' };

/**
 * Primary CoverageTarget (PRD §17): collection identity + immutable
 * requested scope + snapshot version. The AuthorizationContextRef is
 * recorded alongside as context and never redefines the target.
 */
export interface CoverageTarget {
  readonly collectionIdentity: CollectionId | null;
  readonly scopeKind: ScopePrimitive;
  readonly scopeIdentityKey: string;
  readonly snapshotVersion: number;
}

export interface SelectionClaim {
  readonly kind: 'SINGLE' | 'BATCH';
  readonly confirmationType: ConfirmationType;
  readonly memberRefs: readonly MemberId[];
}

export interface SelectionSnapshot {
  readonly schemaIdentity: SchemaIdentity;
  readonly snapshotId: SnapshotId;
  readonly contractId: ContractId;
  readonly collectionIdentity?: CollectionId;
  readonly requestedScope: RequestedScope;
  readonly continuationScope: ContinuationScope;
  readonly coverageTarget: CoverageTarget;
  readonly requestedMemberBasis: MemberBasis;
  readonly authAccessibleBasis: AuthAccessibleBasis;
  readonly selectedMemberIds: readonly MemberId[];
  readonly authorizationContextRef: AuthorizationContextRef;
  readonly profileContextRef: ProfileContextRef;
  readonly selectionClaims: readonly SelectionClaim[];
  readonly sourceMarker: { readonly system: string; readonly version: string };
  readonly createdAt: string;
  readonly supersedesSnapshotId?: SnapshotId;
}

export type SnapshotSuccessorReason =
  | 'COLLECTION_CHANGED'
  | 'PROFILE_CHANGED'
  | 'MEMBERSHIP_REENUMERATION_REQUIRED'
  | 'CONTINUATION_EXPANSION';

const SNAPSHOT_KEYS: readonly string[] = [
  'schemaIdentity',
  'snapshotId',
  'contractId',
  'collectionIdentity',
  'requestedScope',
  'continuationScope',
  'coverageTarget',
  'requestedMemberBasis',
  'authAccessibleBasis',
  'selectedMemberIds',
  'authorizationContextRef',
  'profileContextRef',
  'selectionClaims',
  'sourceMarker',
  'createdAt',
  'supersedesSnapshotId',
];

const MEMBER_BASIS_KEYS: readonly string[] = ['kind', 'memberIds'];
const COVERAGE_TARGET_KEYS: readonly string[] = [
  'collectionIdentity',
  'scopeKind',
  'scopeIdentityKey',
  'snapshotVersion',
];
const SELECTION_CLAIM_KEYS: readonly string[] = ['kind', 'confirmationType', 'memberRefs'];
const SOURCE_MARKER_KEYS: readonly string[] = ['system', 'version'];

const MEMBER_BASIS_KINDS: readonly string[] = [
  'EXPLICIT_IDENTITIES',
  'CONFIRMED_PAGE_SNAPSHOT',
  'SUPPORTED_COLLECTION_MEMBERSHIP',
];

const CONFIRMATION_TYPES: readonly ConfirmationType[] = [
  'CONFIRM_RESOURCE_IDENTITY',
  'CONFIRM_MEMBERSHIP',
  'CONFIRM_SELECTION',
  'CONFIRM_QUALITY_CHOICE',
  'ACCEPT_TARGET_CHANGE',
];

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}

function pushAll(result: DomainValidationResult<void>, diagnostics: ValidationDiagnostic[]): void {
  if (!result.ok) {
    diagnostics.push(...result.diagnostics);
  }
}

/** Deterministic scope identity key so coverage targets compare by identity, not serialization. */
export function scopeIdentityKey(scope: RequestedScope): string {
  const collection = 'collectionIdentity' in scope ? scope.collectionIdentity : undefined;
  switch (scope.kind) {
    case 'single_resource':
      return `single_resource:${scope.targetId}`;
    case 'current_page':
      return `current_page:${collection ?? ''}`;
    case 'explicit_member_set':
    case 'selected_collection_members': {
      const members = [...scope.memberIds].sort().join(',');
      return `${scope.kind}:${collection ?? ''}:${members}`;
    }
    case 'entire_supported_collection':
      return `entire_supported_collection:${collection ?? ''}`;
    case 'collection_page_range':
      return `collection_page_range:${collection ?? ''}:${String(scope.fromPage)}..${String(scope.toPage)}`;
    default:
      return `unknown`;
  }
}

/** Primary CoverageTarget for a snapshot version (PRD §17). */
export function coverageTargetFor(scope: RequestedScope, snapshotVersion: number): CoverageTarget {
  return deepFreeze({
    collectionIdentity:
      ('collectionIdentity' in scope ? scope.collectionIdentity : undefined) ?? null,
    scopeKind: scope.kind,
    scopeIdentityKey: scopeIdentityKey(scope),
    snapshotVersion,
  });
}

function decodeMemberBasis(
  value: unknown,
  allowUnknown: boolean,
  path: string,
): DomainValidationResult<AuthAccessibleBasis> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, path), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, path), diagnostics);
  const kind = record['kind'];
  if (allowUnknown && kind === 'UNKNOWN') {
    pushAll(rejectUnknownFields(record, ['kind'], path), diagnostics);
    if (diagnostics.length > 0) {
      return fail(diagnostics);
    }
    return ok(deepFreeze({ kind: 'UNKNOWN' as const }));
  }
  if (typeof kind !== 'string' || !MEMBER_BASIS_KINDS.includes(kind)) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        `${path}.kind`,
        `unknown member basis kind '${String(kind)}'`,
      ),
    );
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, MEMBER_BASIS_KEYS, path), diagnostics);
  if (kind === 'EXPLICIT_IDENTITIES') {
    const raws = unwrap(requireArrayOfStrings(record, 'memberIds', path), diagnostics);
    if (raws === undefined) {
      return fail(diagnostics);
    }
    const memberIds: MemberId[] = [];
    for (const raw of raws) {
      const id = unwrap(makeMemberId(raw), diagnostics);
      if (id === undefined) {
        return fail(diagnostics);
      }
      memberIds.push(id);
    }
    if (new Set(memberIds).size !== memberIds.length) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          `${path}.memberIds`,
          'duplicate member identity',
          'PRD-§11',
        ),
      );
      return fail(diagnostics);
    }
    return ok(deepFreeze({ kind: 'EXPLICIT_IDENTITIES' as const, memberIds }));
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(
    deepFreeze(
      kind === 'CONFIRMED_PAGE_SNAPSHOT'
        ? { kind: 'CONFIRMED_PAGE_SNAPSHOT' as const }
        : { kind: 'SUPPORTED_COLLECTION_MEMBERSHIP' as const },
    ),
  );
}

function decodeCoverageTarget(value: unknown): DomainValidationResult<CoverageTarget> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'coverageTarget'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, COVERAGE_TARGET_KEYS, 'coverageTarget'), diagnostics);
  const scopeKindRaw = record['scopeKind'];
  const scopeIdentityKeyRaw = unwrap(
    requireNonEmptyString(record, 'scopeIdentityKey', 'coverageTarget'),
    diagnostics,
  );
  const snapshotVersion = unwrap(
    requireInteger(record, 'snapshotVersion', 'coverageTarget'),
    diagnostics,
  );
  let collectionIdentity: CollectionId | null = null;
  if ('collectionIdentity' in record && record['collectionIdentity'] !== undefined) {
    const raw = unwrap(
      requireNonEmptyString(record, 'collectionIdentity', 'coverageTarget'),
      diagnostics,
    );
    if (raw !== undefined) {
      collectionIdentity = unwrap(makeCollectionId(raw), diagnostics) ?? null;
    }
  }
  if (
    typeof scopeKindRaw !== 'string' ||
    ![
      'single_resource',
      'current_page',
      'explicit_member_set',
      'entire_supported_collection',
      'selected_collection_members',
      'collection_page_range',
    ].includes(scopeKindRaw)
  ) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'coverageTarget.scopeKind',
        `unknown scope kind '${String(scopeKindRaw)}'`,
      ),
    );
  }
  if (diagnostics.length > 0 || snapshotVersion === undefined || snapshotVersion < 1) {
    if (diagnostics.length === 0) {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'coverageTarget.snapshotVersion',
          'snapshotVersion must be >= 1',
        ),
      );
    }
    return fail(diagnostics);
  }
  return ok(
    deepFreeze({
      collectionIdentity,
      scopeKind: scopeKindRaw as ScopePrimitive,
      scopeIdentityKey: scopeIdentityKeyRaw!,
      snapshotVersion,
    }),
  );
}

function decodeSelectionClaim(value: unknown): DomainValidationResult<SelectionClaim> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'selectionClaims[]'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'selectionClaims[]'), diagnostics);
  pushAll(rejectUnknownFields(record, SELECTION_CLAIM_KEYS, 'selectionClaims[]'), diagnostics);
  const kind = unwrap(
    requireLiteral(record, 'kind', ['SINGLE', 'BATCH'] as const, 'selectionClaims[]'),
    diagnostics,
  );
  const confirmationType = unwrap(
    requireLiteral(record, 'confirmationType', CONFIRMATION_TYPES, 'selectionClaims[]'),
    diagnostics,
  );
  const rawRefs = unwrap(
    requireArrayOfStrings(record, 'memberRefs', 'selectionClaims[]'),
    diagnostics,
  );
  if (diagnostics.length > 0 || rawRefs === undefined) {
    return fail(diagnostics);
  }
  const memberRefs: MemberId[] = [];
  for (const raw of rawRefs) {
    const id = unwrap(makeMemberId(raw), diagnostics);
    if (id === undefined) {
      return fail(diagnostics);
    }
    memberRefs.push(id);
  }
  if (memberRefs.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'selectionClaims[].memberRefs',
        'selection claims must reference members',
      ),
    );
    return fail(diagnostics);
  }
  return ok(deepFreeze({ kind: kind!, confirmationType: confirmationType!, memberRefs }));
}

/** Decode a SelectionSnapshot from untrusted input. */
export function decodeSelectionSnapshot(value: unknown): DomainValidationResult<SelectionSnapshot> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'snapshot'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'snapshot'), diagnostics);
  pushAll(rejectUnknownFields(record, SNAPSHOT_KEYS, 'snapshot'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const snapshotIdRaw = unwrap(
    requireNonEmptyString(record, 'snapshotId', 'snapshot'),
    diagnostics,
  );
  const snapshotId =
    snapshotIdRaw === undefined ? undefined : unwrap(makeSnapshotId(snapshotIdRaw), diagnostics);
  const contractIdRaw = unwrap(
    requireNonEmptyString(record, 'contractId', 'snapshot'),
    diagnostics,
  );
  const contractId =
    contractIdRaw === undefined ? undefined : unwrap(makeContractId(contractIdRaw), diagnostics);
  let collectionIdentity: CollectionId | undefined;
  const collectionRaw = unwrap(
    requireOptionalString(record, 'collectionIdentity', 'snapshot'),
    diagnostics,
  );
  if (collectionRaw !== undefined) {
    collectionIdentity = unwrap(makeCollectionId(collectionRaw), diagnostics);
  }
  const requestedScope = unwrap(decodeRequestedScope(record['requestedScope']), diagnostics);
  const continuationScope = unwrap(
    decodeContinuationScope(record['continuationScope']),
    diagnostics,
  );
  const coverageTarget = unwrap(decodeCoverageTarget(record['coverageTarget']), diagnostics);
  const requestedMemberBasis = unwrap(
    decodeMemberBasis(record['requestedMemberBasis'], false, 'requestedMemberBasis'),
    diagnostics,
  );
  const authAccessibleBasis = unwrap(
    decodeMemberBasis(record['authAccessibleBasis'], true, 'authAccessibleBasis'),
    diagnostics,
  );
  const selectedRaw = unwrap(
    requireArrayOfStrings(record, 'selectedMemberIds', 'snapshot'),
    diagnostics,
  );
  let selectedMemberIds: MemberId[] | undefined;
  if (selectedRaw !== undefined) {
    selectedMemberIds = [];
    for (const raw of selectedRaw) {
      const id = unwrap(makeMemberId(raw), diagnostics);
      if (id === undefined) {
        selectedMemberIds = undefined;
        break;
      }
      selectedMemberIds.push(id);
    }
    if (
      selectedMemberIds !== undefined &&
      new Set(selectedMemberIds).size !== selectedMemberIds.length
    ) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          'snapshot.selectedMemberIds',
          'duplicate selected member identity',
          'PRD-§11',
        ),
      );
      selectedMemberIds = undefined;
    }
  }
  const authRefRaw = unwrap(
    requireNonEmptyString(record, 'authorizationContextRef', 'snapshot'),
    diagnostics,
  );
  const authorizationContextRef =
    authRefRaw === undefined
      ? undefined
      : unwrap(makeAuthorizationContextRef(authRefRaw), diagnostics);
  const profileRefRaw = unwrap(
    requireNonEmptyString(record, 'profileContextRef', 'snapshot'),
    diagnostics,
  );
  const profileContextRef =
    profileRefRaw === undefined
      ? undefined
      : unwrap(makeProfileContextRef(profileRefRaw), diagnostics);
  const claimsRaw = record['selectionClaims'];
  const selectionClaims: SelectionClaim[] = [];
  if (!Array.isArray(claimsRaw) || claimsRaw.length === 0) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'snapshot.selectionClaims',
        'at least one selection claim is required',
      ),
    );
  } else {
    for (const raw of claimsRaw) {
      const claim = unwrap(decodeSelectionClaim(raw), diagnostics);
      if (claim === undefined) {
        break;
      }
      selectionClaims.push(claim);
    }
  }
  let sourceMarker: { readonly system: string; readonly version: string } | undefined;
  const sourceRaw = unwrap(asRecord(record['sourceMarker'], 'snapshot.sourceMarker'), diagnostics);
  if (sourceRaw !== undefined) {
    pushAll(
      rejectUnknownFields(sourceRaw, SOURCE_MARKER_KEYS, 'snapshot.sourceMarker'),
      diagnostics,
    );
    const system = unwrap(
      requireNonEmptyString(sourceRaw, 'system', 'snapshot.sourceMarker'),
      diagnostics,
    );
    const version = unwrap(
      requireNonEmptyString(sourceRaw, 'version', 'snapshot.sourceMarker'),
      diagnostics,
    );
    if (system !== undefined && version !== undefined) {
      sourceMarker = deepFreeze({ system, version });
    }
  }
  const createdAt = unwrap(requireIsoTimestamp(record, 'createdAt', 'snapshot'), diagnostics);
  let supersedesSnapshotId: SnapshotId | undefined;
  const supersedesRaw = unwrap(
    requireOptionalString(record, 'supersedesSnapshotId', 'snapshot'),
    diagnostics,
  );
  if (supersedesRaw !== undefined) {
    supersedesSnapshotId = unwrap(makeSnapshotId(supersedesRaw), diagnostics);
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const snapshot: SelectionSnapshot = {
    schemaIdentity: schemaIdentity!,
    snapshotId: snapshotId!,
    contractId: contractId!,
    collectionIdentity,
    requestedScope: requestedScope!,
    continuationScope: continuationScope!,
    coverageTarget: coverageTarget!,
    requestedMemberBasis: requestedMemberBasis as MemberBasis,
    authAccessibleBasis: authAccessibleBasis as AuthAccessibleBasis,
    selectedMemberIds: selectedMemberIds!,
    authorizationContextRef: authorizationContextRef!,
    profileContextRef: profileContextRef!,
    selectionClaims: deepFreeze(selectionClaims),
    sourceMarker: sourceMarker!,
    createdAt: createdAt!,
    supersedesSnapshotId,
  };
  const semantics = validateSnapshotSemantics(snapshot);
  if (!semantics.ok) {
    return semantics as DomainValidationResult<SelectionSnapshot>;
  }
  return ok(deepFreeze(snapshot));
}

/**
 * Snapshot semantic invariants: selected identities must belong to the
 * explicit requested basis, and every selected identity must be covered by
 * exactly the selection claims (batch or single) — one claim set can cover
 * many members without per-item authority objects (counterexample C30).
 */
export function validateSnapshotSemantics(
  snapshot: SelectionSnapshot,
): DomainValidationResult<void> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (snapshot.requestedMemberBasis.kind === 'EXPLICIT_IDENTITIES') {
    const requested = snapshot.requestedMemberBasis.memberIds;
    for (const selected of snapshot.selectedMemberIds) {
      if (!requested.includes(selected)) {
        diagnostics.push(
          diagnostic(
            'MEMBERSHIP_DRIFT',
            'snapshot.selectedMemberIds',
            `selected member '${selected}' is not part of the explicit requested basis`,
            'PRD-§12',
          ),
        );
      }
    }
  }
  const claimed = new Set<string>();
  for (const claim of snapshot.selectionClaims) {
    for (const ref of claim.memberRefs) {
      claimed.add(ref);
    }
  }
  for (const selected of snapshot.selectedMemberIds) {
    if (!claimed.has(selected)) {
      diagnostics.push(
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'snapshot.selectionClaims',
          `selected member '${selected}' is not covered by any selection claim`,
        ),
      );
    }
  }
  for (const claim of snapshot.selectionClaims) {
    for (const ref of claim.memberRefs) {
      if (!snapshot.selectedMemberIds.includes(ref)) {
        diagnostics.push(
          diagnostic(
            'MEMBERSHIP_DRIFT',
            'snapshot.selectionClaims',
            `selection claim references member '${ref}' outside the frozen selected set`,
          ),
        );
      }
    }
  }
  const expectedKey = scopeIdentityKey(snapshot.requestedScope);
  if (snapshot.coverageTarget.scopeIdentityKey !== expectedKey) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'snapshot.coverageTarget.scopeIdentityKey',
        'coverage target must bind the snapshot requested scope identity',
        'PRD-§17',
      ),
    );
  }
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/** Snapshot binding rule: a snapshot may only freeze the confirmed contract's requested scope. */
export function sameScopeSnapshotBinding(
  snapshotScope: RequestedScope,
  contractScope: RequestedScope,
): boolean {
  return sameScopeIdentity(snapshotScope, contractScope);
}

/**
 * Immutability rule (PRD §12, counterexample C11): under the same snapshot
 * identity the frozen scope, continuation and member identity sets must be
 * exactly preserved. Count equality with different identities is drift, not
 * equality (counterexample C01).
 */
export function assertSnapshotImmutable(
  original: SelectionSnapshot,
  candidate: SelectionSnapshot,
): DomainValidationResult<void> {
  if (original.snapshotId !== candidate.snapshotId) {
    return ok(undefined);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  if (!sameScopeIdentity(original.requestedScope, candidate.requestedScope)) {
    diagnostics.push(
      diagnostic(
        'SNAPSHOT_MUTATION',
        'snapshot.requestedScope',
        'requested scope mutated under the same snapshot identity',
      ),
    );
  }
  if (!identitySetEquals(original.selectedMemberIds, candidate.selectedMemberIds)) {
    diagnostics.push(
      diagnostic(
        'MEMBERSHIP_DRIFT',
        'snapshot.selectedMemberIds',
        'member identity set changed while count or snapshot identity stayed equal',
        'C01/C11',
      ),
    );
  }
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/**
 * Retry plan rule (counterexample C12): retry operates only on original
 * failed member identities already frozen in the snapshot; adding or
 * replacing members is rejected.
 */
export function planRetryOfFailedMembers(
  snapshot: SelectionSnapshot,
  failedMemberIds: readonly string[],
): DomainValidationResult<readonly MemberId[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  const plan: MemberId[] = [];
  for (const raw of failedMemberIds) {
    const id = unwrap(makeMemberId(raw), diagnostics);
    if (id === undefined) {
      return fail(diagnostics);
    }
    if (!snapshot.selectedMemberIds.includes(id)) {
      return fail([
        diagnostic(
          'MEMBERSHIP_DRIFT',
          'retry.failedMemberIds',
          `retry member '${raw}' is not in the frozen selected set; retry cannot add or replace members`,
          'C12',
        ),
      ]);
    }
    if (!plan.includes(id)) {
      plan.push(id);
    }
  }
  return ok(deepFreeze(plan));
}

/**
 * Derive a successor snapshot for a legitimate semantic change; the original
 * stays immutable historical authority and the successor links back
 * (PRD §12, counterexample C11).
 */
export function deriveSuccessorSnapshot(
  original: SelectionSnapshot,
  _reason: SnapshotSuccessorReason,
  next: {
    readonly newSnapshotId: SnapshotId;
    readonly requestedMemberBasis?: MemberBasis;
    readonly selectedMemberIds?: readonly MemberId[];
    readonly selectionClaims?: readonly SelectionClaim[];
  },
): DomainValidationResult<SelectionSnapshot> {
  if (next.newSnapshotId === original.snapshotId) {
    return fail([
      diagnostic(
        'SNAPSHOT_MUTATION',
        'snapshot.snapshotId',
        'a successor snapshot requires a new snapshot identity',
        'C11',
      ),
    ]);
  }
  const successor: SelectionSnapshot = {
    ...original,
    snapshotId: next.newSnapshotId,
    supersedesSnapshotId: original.snapshotId,
    requestedMemberBasis: next.requestedMemberBasis ?? original.requestedMemberBasis,
    selectedMemberIds: next.selectedMemberIds ?? original.selectedMemberIds,
    selectionClaims: next.selectionClaims ?? original.selectionClaims,
  };
  const semantics = validateSnapshotSemantics(successor);
  if (!semantics.ok) {
    return semantics as DomainValidationResult<SelectionSnapshot>;
  }
  return ok(deepFreeze(successor));
}

/** Build a snapshot inside the package boundary (fixture/adapter helper). */
export function buildSnapshot(
  fields: Omit<SelectionSnapshot, 'schemaIdentity'> & { schemaIdentity?: SchemaIdentity },
): DomainValidationResult<SelectionSnapshot> {
  const { schemaIdentity, ...rest } = fields;
  const candidate: SelectionSnapshot = {
    schemaIdentity: schemaIdentity ?? currentSchemaIdentity(),
    ...rest,
  };
  return decodeSelectionSnapshot(candidate);
}
