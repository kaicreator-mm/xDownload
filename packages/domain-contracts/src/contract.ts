/**
 * T002 AcquisitionContract — the one authoritative per-task contract.
 *
 * Required fields and immutability follow frozen PRD §8: requested scope and
 * continuation scope are immutable after confirmation; semantic changes
 * require successor contract identity. Collection admission follows PRD §9;
 * budget/scope separation follows PRD §10/§15.
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
  makeAuthorizationContextRef,
  makeCollectionId,
  makeContractId,
  makeLogicalTargetId,
  makeSnapshotId,
  type AuthorizationContextRef,
  type CollectionId,
  type ContractId,
  type LogicalTargetId,
  type SnapshotId,
} from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireIsoTimestamp,
  requireLiteral,
  requireNonEmptyString,
  requireOptionalString,
} from './decode.ts';
import { decodeBudgetProfile, type BudgetProfile } from './budget.ts';
import type { ValidationLayer } from './evidence.ts';
import {
  decodeContinuationScope,
  decodeMembershipBasisRef,
  decodeRequestedScope,
  sameContinuationIdentity,
  sameScopeIdentity,
  validateScopeContinuationPair,
  type ContinuationScope,
  type MembershipBasisRef,
  type RequestedScope,
  type ScopePrimitive,
} from './scope.ts';

export type ContractStatus = 'DRAFT' | 'CONFIRMED';

export type ContractIntentType = 'SINGLE_RESOURCE' | 'COLLECTION';

export type AutomationMode = 'AUTO' | 'ASSISTED' | 'MANUAL_SELECTION';

/**
 * Exploration permission vocabulary (PRD §9): navigation can only follow
 * collection/member/declared continuation edges. An arbitrary URL frontier
 * is not a representable permission.
 */
export type ExplorationPermission =
  'NONE' | 'COLLECTION_MEMBER_EDGES' | 'DECLARED_CONTINUATION_EDGES';

export interface SelectionPolicy {
  readonly basis: 'ENTIRE_REQUESTED_SCOPE' | 'EXPLICIT_USER_SELECTION';
  readonly allowsBatchSelection: boolean;
}

export interface ValidationPolicy {
  readonly requiredLayers: readonly ValidationLayer[];
}

export interface StopPolicy {
  /** GlobalSafetyBudget always has highest stop precedence (PRD §15.3/§15.4). */
  readonly globalSafetyPrecedence: 'HIGHEST';
}

export interface ResultPolicy {
  /** Terminal results are multidimensional; a single success boolean is forbidden (PRD §16). */
  readonly requireMultidimensionalResult: true;
}

export type SuccessorJustification =
  | 'SCOPE_CHANGE'
  | 'CONTINUATION_ADDITION'
  | 'AUTHORIZATION_MATERIALLY_CHANGED'
  | 'MEMBERSHIP_REENUMERATION_REQUIRED';

export interface AcquisitionContract {
  readonly schemaIdentity: SchemaIdentity;
  readonly contractId: ContractId;
  readonly status: ContractStatus;
  readonly intentType: ContractIntentType;
  readonly requestedTarget: LogicalTargetId;
  readonly collectionIdentity?: CollectionId;
  readonly membershipBasis?: MembershipBasisRef;
  readonly requestedScope: RequestedScope;
  readonly continuationScope: ContinuationScope;
  readonly selectionPolicy: SelectionPolicy;
  readonly automationMode: AutomationMode;
  readonly explorationPermission: ExplorationPermission;
  readonly budgetProfile: BudgetProfile;
  readonly authorizationContextRef: AuthorizationContextRef;
  readonly selectionSnapshotRef?: SnapshotId;
  readonly validationPolicy: ValidationPolicy;
  readonly stopPolicy: StopPolicy;
  readonly resultPolicy: ResultPolicy;
  readonly supersedesContractId?: ContractId;
  readonly confirmedAt?: string;
}

export interface SuccessorPatch {
  readonly requestedScope?: RequestedScope;
  readonly continuationScope?: ContinuationScope;
  readonly authorizationContextRef?: AuthorizationContextRef;
}

const CONTRACT_KEYS: readonly string[] = [
  'schemaIdentity',
  'contractId',
  'status',
  'intentType',
  'requestedTarget',
  'collectionIdentity',
  'membershipBasis',
  'requestedScope',
  'continuationScope',
  'selectionPolicy',
  'automationMode',
  'explorationPermission',
  'budgetProfile',
  'authorizationContextRef',
  'selectionSnapshotRef',
  'validationPolicy',
  'stopPolicy',
  'resultPolicy',
  'supersedesContractId',
  'confirmedAt',
];

const SELECTION_POLICY_KEYS: readonly string[] = ['basis', 'allowsBatchSelection'];
const VALIDATION_POLICY_KEYS: readonly string[] = ['requiredLayers'];
const STOP_POLICY_KEYS: readonly string[] = ['globalSafetyPrecedence'];
const RESULT_POLICY_KEYS: readonly string[] = ['requireMultidimensionalResult'];

const VALIDATION_LAYERS: readonly ValidationLayer[] = [
  'transfer',
  'format',
  'media',
  'target',
  'membership',
  'coverage',
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

function decodeSelectionPolicy(value: unknown): DomainValidationResult<SelectionPolicy> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'selectionPolicy'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'selectionPolicy'), diagnostics);
  pushAll(rejectUnknownFields(record, SELECTION_POLICY_KEYS, 'selectionPolicy'), diagnostics);
  const basis = unwrap(
    requireLiteral(
      record,
      'basis',
      ['ENTIRE_REQUESTED_SCOPE', 'EXPLICIT_USER_SELECTION'] as const,
      'selectionPolicy',
    ),
    diagnostics,
  );
  const allowsBatchSelection = record['allowsBatchSelection'];
  if (typeof allowsBatchSelection !== 'boolean') {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'selectionPolicy.allowsBatchSelection',
        'expected boolean',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ basis: basis!, allowsBatchSelection: allowsBatchSelection as boolean }));
}

function decodeValidationPolicy(value: unknown): DomainValidationResult<ValidationPolicy> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'validationPolicy'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'validationPolicy'), diagnostics);
  pushAll(rejectUnknownFields(record, VALIDATION_POLICY_KEYS, 'validationPolicy'), diagnostics);
  const rawLayers = record['requiredLayers'];
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'validationPolicy.requiredLayers',
        'at least one layer is required',
      ),
    );
    return fail(diagnostics);
  }
  const requiredLayers: ValidationLayer[] = [];
  for (const raw of rawLayers) {
    const layer = unwrap(
      requireLiteral({ layer: raw }, 'layer', VALIDATION_LAYERS, 'validationPolicy'),
      diagnostics,
    );
    if (layer === undefined) {
      return fail(diagnostics);
    }
    if (requiredLayers.includes(layer)) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          'validationPolicy.requiredLayers',
          `duplicate layer '${layer}'`,
        ),
      );
      return fail(diagnostics);
    }
    requiredLayers.push(layer);
  }
  return ok(deepFreeze({ requiredLayers }));
}

function decodeStopPolicy(value: unknown): DomainValidationResult<StopPolicy> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'stopPolicy'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, STOP_POLICY_KEYS, 'stopPolicy'), diagnostics);
  const precedence = unwrap(
    requireLiteral(record, 'globalSafetyPrecedence', ['HIGHEST'] as const, 'stopPolicy'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ globalSafetyPrecedence: precedence! }));
}

function decodeResultPolicy(value: unknown): DomainValidationResult<ResultPolicy> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'resultPolicy'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, RESULT_POLICY_KEYS, 'resultPolicy'), diagnostics);
  const multidimensional = record['requireMultidimensionalResult'];
  if (multidimensional !== true) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'resultPolicy.requireMultidimensionalResult',
        'canonical result policy requires multidimensional terminal truth',
        'PRD-§16',
      ),
    );
    return fail(diagnostics);
  }
  return ok(deepFreeze({ requireMultidimensionalResult: true }));
}

/** Decode an AcquisitionContract from untrusted input, enforcing structural + semantic rules. */
export function decodeAcquisitionContract(
  value: unknown,
): DomainValidationResult<AcquisitionContract> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'contract'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'contract'), diagnostics);
  pushAll(rejectUnknownFields(record, CONTRACT_KEYS, 'contract'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const contractIdRaw = unwrap(
    requireNonEmptyString(record, 'contractId', 'contract'),
    diagnostics,
  );
  const contractId =
    contractIdRaw === undefined ? undefined : unwrap(makeContractId(contractIdRaw), diagnostics);
  const status = unwrap(
    requireLiteral(record, 'status', ['DRAFT', 'CONFIRMED'], 'contract'),
    diagnostics,
  );
  const intentType = unwrap(
    requireLiteral(record, 'intentType', ['SINGLE_RESOURCE', 'COLLECTION'], 'contract'),
    diagnostics,
  );
  const requestedTargetRaw = unwrap(
    requireNonEmptyString(record, 'requestedTarget', 'contract'),
    diagnostics,
  );
  const requestedTarget =
    requestedTargetRaw === undefined
      ? undefined
      : unwrap(makeLogicalTargetId(requestedTargetRaw), diagnostics);
  const collectionIdentityRaw = unwrap(
    requireOptionalString(record, 'collectionIdentity', 'contract'),
    diagnostics,
  );
  const collectionIdentity =
    collectionIdentityRaw === undefined
      ? undefined
      : unwrap(makeCollectionId(collectionIdentityRaw), diagnostics);
  let membershipBasis: MembershipBasisRef | undefined;
  if ('membershipBasis' in record && record['membershipBasis'] !== undefined) {
    membershipBasis = unwrap(decodeMembershipBasisRef(record['membershipBasis']), diagnostics);
  }
  const requestedScope = unwrap(decodeRequestedScope(record['requestedScope']), diagnostics);
  let continuationScope: ContinuationScope | undefined;
  if ('continuationScope' in record && record['continuationScope'] !== undefined) {
    continuationScope = unwrap(decodeContinuationScope(record['continuationScope']), diagnostics);
  } else {
    continuationScope = deepFreeze({ kind: 'NONE' as const });
  }
  const selectionPolicy = unwrap(decodeSelectionPolicy(record['selectionPolicy']), diagnostics);
  const automationMode = unwrap(
    requireLiteral(record, 'automationMode', ['AUTO', 'ASSISTED', 'MANUAL_SELECTION'], 'contract'),
    diagnostics,
  );
  const explorationPermission = unwrap(
    requireLiteral(
      record,
      'explorationPermission',
      ['NONE', 'COLLECTION_MEMBER_EDGES', 'DECLARED_CONTINUATION_EDGES'],
      'contract',
    ),
    diagnostics,
  );
  const budgetProfile = unwrap(decodeBudgetProfile(record['budgetProfile']), diagnostics);
  const authorizationContextRefRaw = unwrap(
    requireNonEmptyString(record, 'authorizationContextRef', 'contract'),
    diagnostics,
  );
  const authorizationContextRef =
    authorizationContextRefRaw === undefined
      ? undefined
      : unwrap(makeAuthorizationContextRef(authorizationContextRefRaw), diagnostics);
  let selectionSnapshotRef: SnapshotId | undefined;
  const snapshotRefRaw = unwrap(
    requireOptionalString(record, 'selectionSnapshotRef', 'contract'),
    diagnostics,
  );
  if (snapshotRefRaw !== undefined) {
    selectionSnapshotRef = unwrap(makeSnapshotId(snapshotRefRaw), diagnostics);
  }
  const validationPolicy = unwrap(decodeValidationPolicy(record['validationPolicy']), diagnostics);
  const stopPolicy = unwrap(decodeStopPolicy(record['stopPolicy']), diagnostics);
  const resultPolicy = unwrap(decodeResultPolicy(record['resultPolicy']), diagnostics);
  let supersedesContractId: ContractId | undefined;
  const supersedesRaw = unwrap(
    requireOptionalString(record, 'supersedesContractId', 'contract'),
    diagnostics,
  );
  if (supersedesRaw !== undefined) {
    supersedesContractId = unwrap(makeContractId(supersedesRaw), diagnostics);
  }
  let confirmedAt: string | undefined;
  if ('confirmedAt' in record && record['confirmedAt'] !== undefined) {
    confirmedAt = unwrap(requireIsoTimestamp(record, 'confirmedAt', 'contract'), diagnostics);
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const contract: AcquisitionContract = {
    schemaIdentity: schemaIdentity!,
    contractId: contractId!,
    status: status! as ContractStatus,
    intentType: intentType! as ContractIntentType,
    requestedTarget: requestedTarget!,
    collectionIdentity,
    membershipBasis,
    requestedScope: requestedScope!,
    continuationScope: continuationScope!,
    selectionPolicy: selectionPolicy!,
    automationMode: automationMode! as AutomationMode,
    explorationPermission: explorationPermission! as ExplorationPermission,
    budgetProfile: budgetProfile!,
    authorizationContextRef: authorizationContextRef!,
    selectionSnapshotRef,
    validationPolicy: validationPolicy!,
    stopPolicy: stopPolicy!,
    resultPolicy: resultPolicy!,
    supersedesContractId,
    confirmedAt,
  };
  const semantics = validateContractSemantics(contract);
  if (!semantics.ok) {
    return semantics as DomainValidationResult<AcquisitionContract>;
  }
  return ok(deepFreeze(contract));
}

/** Cross-field semantic rules every contract must satisfy regardless of construction path. */
export function validateContractSemantics(
  contract: AcquisitionContract,
): DomainValidationResult<void> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (
    contract.intentType === 'SINGLE_RESOURCE' &&
    contract.requestedScope.kind !== 'single_resource'
  ) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'requestedScope.kind',
        'SINGLE_RESOURCE intent requires single_resource scope',
      ),
    );
  }
  if (contract.intentType === 'COLLECTION') {
    if (contract.requestedScope.kind === 'single_resource') {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'requestedScope.kind',
          'COLLECTION intent cannot use single_resource scope',
        ),
      );
    }
    if (contract.collectionIdentity === undefined || contract.membershipBasis === undefined) {
      diagnostics.push(
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'contract.collectionIdentity',
          'COLLECTION intent requires collectionIdentity and membershipBasis',
          'PRD-§8',
        ),
      );
    }
    const scopeCollection =
      'collectionIdentity' in contract.requestedScope
        ? contract.requestedScope.collectionIdentity
        : undefined;
    if (
      contract.collectionIdentity !== undefined &&
      scopeCollection !== undefined &&
      scopeCollection !== contract.collectionIdentity
    ) {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'requestedScope.collectionIdentity',
          'scope collection identity must match the contract collection identity',
        ),
      );
    }
  }
  pushAll(
    validateScopeContinuationPair(contract.requestedScope, contract.continuationScope),
    diagnostics,
  );
  if (contract.status === 'CONFIRMED' && contract.confirmedAt === undefined) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'contract.confirmedAt',
        'confirmed contracts require confirmedAt',
      ),
    );
  }
  if (contract.status === 'DRAFT' && contract.confirmedAt !== undefined) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'contract.confirmedAt',
        'draft contracts must not carry confirmedAt',
      ),
    );
  }
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/**
 * Confirmation freezes requested + continuation scope (PRD §8). The
 * confirmed value is a new frozen identity state of the same contract;
 * scope/continuation are thereafter immutable.
 */
export function confirmContract(
  draft: AcquisitionContract,
  confirmedAt: string,
): DomainValidationResult<AcquisitionContract> {
  if (draft.status !== 'DRAFT') {
    return fail([
      diagnostic('SCOPE_MUTATION', 'contract.status', 'only DRAFT contracts can be confirmed'),
    ]);
  }
  const confirmed: AcquisitionContract = { ...draft, status: 'CONFIRMED', confirmedAt };
  const semantics = validateContractSemantics(confirmed);
  if (!semantics.ok) {
    return semantics as DomainValidationResult<AcquisitionContract>;
  }
  return ok(deepFreeze(confirmed));
}

/**
 * Contract transition rule (PRD §8/§10.1): the same contract identity can
 * never change requested/continuation scope or materially change
 * authorization after confirmation; such changes require a successor
 * identity (counterexamples C08/C11/R01).
 */
export function assertContractTransition(
  previous: AcquisitionContract,
  next: AcquisitionContract,
): DomainValidationResult<void> {
  if (previous.contractId === next.contractId) {
    const diagnostics: ValidationDiagnostic[] = [];
    if (!sameScopeIdentity(previous.requestedScope, next.requestedScope)) {
      diagnostics.push(
        diagnostic(
          'SCOPE_MUTATION',
          'requestedScope',
          'requested scope changed under the same contract identity; a successor contract is required',
          'PRD-§8',
        ),
      );
    }
    if (!sameContinuationIdentity(previous.continuationScope, next.continuationScope)) {
      diagnostics.push(
        diagnostic(
          'SCOPE_MUTATION',
          'continuationScope',
          'continuation scope changed under the same contract identity; a successor contract is required',
          'C08',
        ),
      );
    }
    if (
      previous.authorizationContextRef !== next.authorizationContextRef &&
      previous.status === 'CONFIRMED'
    ) {
      diagnostics.push(
        diagnostic(
          'SCOPE_MUTATION',
          'authorizationContextRef',
          'authorization context materially changed under the same confirmed contract identity',
          'PRD-§8',
        ),
      );
    }
    return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
  }
  if (next.supersedesContractId !== previous.contractId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'contract.supersedesContractId',
        'a different contract identity must explicitly supersede the previous contract',
        'PRD-§8',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Derive a successor draft contract. The original stays untouched historical
 * authority; the successor carries a new identity and an explicit
 * justification for the semantic change (PRD §8, §10.1, §12).
 */
export function deriveSuccessorContract(
  previous: AcquisitionContract,
  patch: SuccessorPatch,
  justification: SuccessorJustification,
): DomainValidationResult<AcquisitionContract> {
  if (previous.status !== 'CONFIRMED') {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'contract.status',
        'successors derive only from confirmed contracts',
      ),
    ]);
  }
  const successorIdSource = `${previous.contractId}-successor`;
  const successorId = makeContractId(successorIdSource);
  if (!successorId.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'contractId',
        'successor id could not be derived from the previous id',
      ),
    ]);
  }
  const successor: AcquisitionContract = {
    ...previous,
    contractId: successorId.value,
    status: 'DRAFT',
    confirmedAt: undefined,
    supersedesContractId: previous.contractId,
    requestedScope: patch.requestedScope ?? previous.requestedScope,
    continuationScope: patch.continuationScope ?? previous.continuationScope,
    authorizationContextRef: patch.authorizationContextRef ?? previous.authorizationContextRef,
  };
  const semantics = validateContractSemantics(successor);
  if (!semantics.ok) {
    return semantics as DomainValidationResult<AcquisitionContract>;
  }
  // Every patched field must actually differ semantically, and the
  // justification must correspond to the kind of semantic change made.
  const scopeChanged =
    patch.requestedScope !== undefined &&
    !sameScopeIdentity(patch.requestedScope, previous.requestedScope);
  const continuationChanged =
    patch.continuationScope !== undefined &&
    !sameContinuationIdentity(patch.continuationScope, previous.continuationScope);
  const authChanged =
    patch.authorizationContextRef !== undefined &&
    patch.authorizationContextRef !== previous.authorizationContextRef;
  const changedKinds: readonly ('scope' | 'continuation' | 'authorization')[] = [
    ...(scopeChanged ? (['scope'] as const) : []),
    ...(continuationChanged ? (['continuation'] as const) : []),
    ...(authChanged ? (['authorization'] as const) : []),
  ];
  const justificationKinds: Readonly<Record<SuccessorJustification, readonly string[]>> = {
    SCOPE_CHANGE: ['scope'],
    CONTINUATION_ADDITION: ['continuation'],
    AUTHORIZATION_MATERIALLY_CHANGED: ['authorization'],
    MEMBERSHIP_REENUMERATION_REQUIRED: ['scope', 'continuation', 'authorization'],
  };
  if (
    changedKinds.length === 0 ||
    !changedKinds.every((kind) => justificationKinds[justification].includes(kind))
  ) {
    return fail([
      diagnostic(
        'SCOPE_MUTATION',
        'successorPatch',
        `justification '${justification}' does not correspond to a semantic change in the successor patch`,
        'PRD-§8',
      ),
    ]);
  }
  return ok(deepFreeze(successor));
}

/**
 * Collection admission (PRD §9): collection acquisition is admitted only
 * with an identifiable collection, an observable/declared membership basis,
 * a user-understandable scope, bounded navigation and a hard stop — an
 * arbitrary frontier is structurally unrepresentable and rejected (C06).
 */
export function admitCollectionContract(
  contract: AcquisitionContract,
): DomainValidationResult<void> {
  if (contract.intentType !== 'COLLECTION') {
    return ok(undefined);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  if (contract.collectionIdentity === undefined) {
    diagnostics.push(
      diagnostic(
        'ADMISSION_REJECTED',
        'contract.collectionIdentity',
        'collection identity must be identifiable',
        'PRD-§9',
      ),
    );
  }
  const basis = contract.membershipBasis;
  const scope = contract.requestedScope;
  if (basis === undefined) {
    diagnostics.push(
      diagnostic(
        'ADMISSION_REJECTED',
        'contract.membershipBasis',
        'membership relation must be observable or user-declared',
        'PRD-§9',
      ),
    );
  } else {
    const scopeKind: ScopePrimitive = scope.kind;
    const compatible =
      (basis.basis === 'SUPPORTED_TEMPLATE' &&
        (scopeKind === 'entire_supported_collection' ||
          scopeKind === 'collection_page_range' ||
          scopeKind === 'current_page')) ||
      (basis.basis === 'DECLARED_FINITE_SET' &&
        (scopeKind === 'explicit_member_set' || scopeKind === 'selected_collection_members')) ||
      (basis.basis === 'CONFIRMED_PAGE_SNAPSHOT' && scopeKind === 'current_page');
    if (!compatible) {
      diagnostics.push(
        diagnostic(
          'ADMISSION_REJECTED',
          'contract.membershipBasis',
          `membership basis ${basis.basis} does not support scope ${scopeKind}`,
          'PRD-§9',
        ),
      );
    }
  }
  if (
    contract.explorationPermission === 'NONE' &&
    scope.kind !== 'explicit_member_set' &&
    scope.kind !== 'selected_collection_members' &&
    scope.kind !== 'single_resource' &&
    scope.kind !== 'current_page'
  ) {
    diagnostics.push(
      diagnostic(
        'ADMISSION_REJECTED',
        'contract.explorationPermission',
        'collection scope without any bounded navigation permission has no admission path',
        'PRD-§9',
      ),
    );
  }
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

/** Build a draft contract inside the package boundary (fixture/adapter helper). */
export function draftContract(
  fields: Omit<AcquisitionContract, 'schemaIdentity' | 'status'> & {
    schemaIdentity?: SchemaIdentity;
    status?: ContractStatus;
  },
): DomainValidationResult<AcquisitionContract> {
  const { schemaIdentity, status, ...rest } = fields;
  const candidate: AcquisitionContract = {
    schemaIdentity: schemaIdentity ?? currentSchemaIdentity(),
    status: status ?? 'DRAFT',
    ...rest,
  };
  return decodeAcquisitionContract(candidate);
}
