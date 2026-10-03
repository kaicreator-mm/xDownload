/**
 * T002 scope grammar — immutable requested scope and explicit continuation.
 *
 * Scope and Budget are different concepts (PRD §10): budgets constrain
 * execution inside confirmed scope but never define, enlarge, narrow or
 * rewrite it. Confirmed requested/continuation scope is immutable; any
 * semantic change requires successor contract identity (PRD §8/§10.1).
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import {
  hasNoDuplicates,
  makeCollectionId,
  makeMemberId,
  makeLogicalTargetId,
  type CollectionId,
  type LogicalTargetId,
  type MemberId,
} from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireArrayOfStrings,
  requireInteger,
  requireNonEmptyString,
  requireOptionalString,
} from './decode.ts';

export const SCOPE_PRIMITIVES = [
  'single_resource',
  'current_page',
  'explicit_member_set',
  'entire_supported_collection',
  'selected_collection_members',
  'collection_page_range',
] as const;

export type ScopePrimitive = (typeof SCOPE_PRIMITIVES)[number];

export type ContinuationScope =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'DECLARED_BATCH_COUNT'; readonly count: number }
  | { readonly kind: 'DECLARED_PAGE_RANGE'; readonly fromPage: number; readonly toPage: number }
  | { readonly kind: 'DECLARED_NATURAL_END' };

export type MembershipBasisKind =
  'SUPPORTED_TEMPLATE' | 'DECLARED_FINITE_SET' | 'CONFIRMED_PAGE_SNAPSHOT';

export interface MembershipBasisRef {
  readonly basis: MembershipBasisKind;
  /** Required when basis is SUPPORTED_TEMPLATE: opaque reference to the supported template. */
  readonly templateRef?: string;
}

export type RequestedScope =
  | { readonly kind: 'single_resource'; readonly targetId: LogicalTargetId }
  | { readonly kind: 'current_page'; readonly collectionIdentity: CollectionId }
  | {
      readonly kind: 'explicit_member_set';
      readonly collectionIdentity?: CollectionId;
      readonly memberIds: readonly MemberId[];
    }
  | {
      readonly kind: 'entire_supported_collection';
      readonly collectionIdentity: CollectionId;
    }
  | {
      readonly kind: 'selected_collection_members';
      readonly collectionIdentity: CollectionId;
      readonly memberIds: readonly MemberId[];
    }
  | {
      readonly kind: 'collection_page_range';
      readonly collectionIdentity: CollectionId;
      readonly fromPage: number;
      readonly toPage: number;
    };

const SCOPE_KEYS_BY_KIND: Readonly<Record<ScopePrimitive, readonly string[]>> = Object.freeze({
  single_resource: ['kind', 'targetId'],
  current_page: ['kind', 'collectionIdentity'],
  explicit_member_set: ['kind', 'collectionIdentity', 'memberIds'],
  entire_supported_collection: ['kind', 'collectionIdentity'],
  selected_collection_members: ['kind', 'collectionIdentity', 'memberIds'],
  collection_page_range: ['kind', 'collectionIdentity', 'fromPage', 'toPage'],
});

const CONTINUATION_KEYS_BY_KIND: Readonly<Record<string, readonly string[]>> = Object.freeze({
  NONE: ['kind'],
  DECLARED_BATCH_COUNT: ['kind', 'count'],
  DECLARED_PAGE_RANGE: ['kind', 'fromPage', 'toPage'],
  DECLARED_NATURAL_END: ['kind'],
});

const MEMBERSHIP_BASIS_KEYS: readonly string[] = ['basis', 'templateRef'];

/**
 * Decode the continuation scope. "Continue until budget runs out" is not a
 * representable user scope — only explicit bounded declarations exist
 * (PRD §10.1).
 */
export function decodeContinuationScope(value: unknown): DomainValidationResult<ContinuationScope> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'continuationScope'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'continuationScope'), diagnostics);
  const kind = record['kind'];
  if (typeof kind !== 'string' || !(kind in CONTINUATION_KEYS_BY_KIND)) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'continuationScope.kind',
        `unknown continuation kind '${String(kind)}'; arbitrary or budget-derived continuation is not representable`,
        'PRD-§10.1',
      ),
    );
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, CONTINUATION_KEYS_BY_KIND[kind]!, 'continuationScope'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  switch (kind) {
    case 'NONE':
      return ok(deepFreeze({ kind: 'NONE' as const }));
    case 'DECLARED_NATURAL_END':
      return ok(deepFreeze({ kind: 'DECLARED_NATURAL_END' as const }));
    case 'DECLARED_BATCH_COUNT': {
      const count = unwrap(requireInteger(record, 'count', 'continuationScope'), diagnostics);
      if (count === undefined) {
        return fail(diagnostics);
      }
      if (count < 1) {
        diagnostics.push(
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            'continuationScope.count',
            'batch count must be >= 1',
          ),
        );
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind: 'DECLARED_BATCH_COUNT' as const, count }));
    }
    case 'DECLARED_PAGE_RANGE': {
      const fromPage = unwrap(requireInteger(record, 'fromPage', 'continuationScope'), diagnostics);
      const toPage = unwrap(requireInteger(record, 'toPage', 'continuationScope'), diagnostics);
      if (fromPage === undefined || toPage === undefined) {
        return fail(diagnostics);
      }
      const rangeError = validatePageRange(fromPage, toPage);
      if (rangeError !== undefined) {
        diagnostics.push(rangeError);
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind: 'DECLARED_PAGE_RANGE' as const, fromPage, toPage }));
    }
    default:
      return fail([diagnostic('UNKNOWN_ENUM_VALUE', 'continuationScope.kind', 'unreachable')]);
  }
}

export function decodeMembershipBasisRef(
  value: unknown,
): DomainValidationResult<MembershipBasisRef> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'membershipBasis'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'membershipBasis'), diagnostics);
  pushAll(rejectUnknownFields(record, MEMBERSHIP_BASIS_KEYS, 'membershipBasis'), diagnostics);
  const basis = record['basis'];
  if (
    typeof basis !== 'string' ||
    !['SUPPORTED_TEMPLATE', 'DECLARED_FINITE_SET', 'CONFIRMED_PAGE_SNAPSHOT'].includes(basis)
  ) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'membershipBasis.basis',
        `unknown membership basis '${String(basis)}'`,
      ),
    );
    return fail(diagnostics);
  }
  let templateRef: string | undefined;
  if (basis === 'SUPPORTED_TEMPLATE') {
    const ref = unwrap(
      requireNonEmptyString(record, 'templateRef', 'membershipBasis'),
      diagnostics,
    );
    if (ref === undefined) {
      return fail(diagnostics);
    }
    templateRef = ref;
  } else if (
    unwrap(requireOptionalString(record, 'templateRef', 'membershipBasis'), diagnostics) !==
    undefined
  ) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'membershipBasis.templateRef',
        `templateRef is only valid with basis SUPPORTED_TEMPLATE`,
      ),
    );
    return fail(diagnostics);
  }
  const result: MembershipBasisRef =
    templateRef === undefined
      ? { basis: basis as MembershipBasisKind }
      : { basis: basis as MembershipBasisKind, templateRef };
  return ok(deepFreeze(result));
}

/**
 * Decode a requested scope. Unknown scope primitives — including any
 * domain/frontier-style crawl scope — fail closed, so an arbitrary frontier
 * is structurally unrepresentable (PRD §9, counterexample C06).
 */
export function decodeRequestedScope(value: unknown): DomainValidationResult<RequestedScope> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'requestedScope'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'requestedScope'), diagnostics);
  const kind = record['kind'];
  if (typeof kind !== 'string' || !SCOPE_PRIMITIVES.includes(kind as ScopePrimitive)) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'requestedScope.kind',
        `unknown scope primitive '${String(kind)}'; no crawl/frontier scope exists in the canonical grammar`,
        'PRD-§9',
      ),
    );
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, SCOPE_KEYS_BY_KIND[kind as ScopePrimitive]!, 'requestedScope'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  switch (kind as ScopePrimitive) {
    case 'single_resource': {
      const targetId = unwrap(
        requireNonEmptyString(record, 'targetId', 'requestedScope'),
        diagnostics,
      );
      if (targetId === undefined) {
        return fail(diagnostics);
      }
      const id = unwrap(makeLogicalTargetId(targetId), diagnostics);
      if (id === undefined) {
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind: 'single_resource' as const, targetId: id }));
    }
    case 'current_page': {
      const collectionIdentity = decodeCollectionIdentity(record, diagnostics);
      if (collectionIdentity === undefined) {
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind: 'current_page' as const, collectionIdentity }));
    }
    case 'explicit_member_set':
    case 'selected_collection_members': {
      const collectionIdentity = decodeOptionalCollectionIdentity(record, diagnostics);
      if (diagnostics.length > 0) {
        return fail(diagnostics);
      }
      const memberIds = decodeMemberIdSet(record, diagnostics);
      if (memberIds === undefined) {
        return fail(diagnostics);
      }
      if (kind === 'explicit_member_set') {
        const scope: RequestedScope =
          collectionIdentity === undefined
            ? deepFreeze({ kind: 'explicit_member_set' as const, memberIds })
            : deepFreeze({ kind: 'explicit_member_set' as const, collectionIdentity, memberIds });
        return ok(scope);
      }
      if (collectionIdentity === undefined) {
        diagnostics.push(
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            'requestedScope.collectionIdentity',
            'selected_collection_members requires a collection identity',
          ),
        );
        return fail(diagnostics);
      }
      return ok(
        deepFreeze({ kind: 'selected_collection_members' as const, collectionIdentity, memberIds }),
      );
    }
    case 'entire_supported_collection': {
      const collectionIdentity = decodeCollectionIdentity(record, diagnostics);
      if (collectionIdentity === undefined) {
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind: 'entire_supported_collection' as const, collectionIdentity }));
    }
    case 'collection_page_range': {
      const collectionIdentity = decodeCollectionIdentity(record, diagnostics);
      if (collectionIdentity === undefined) {
        return fail(diagnostics);
      }
      const fromPage = unwrap(requireInteger(record, 'fromPage', 'requestedScope'), diagnostics);
      const toPage = unwrap(requireInteger(record, 'toPage', 'requestedScope'), diagnostics);
      if (fromPage === undefined || toPage === undefined) {
        return fail(diagnostics);
      }
      const rangeError = validatePageRange(fromPage, toPage);
      if (rangeError !== undefined) {
        diagnostics.push(rangeError);
        return fail(diagnostics);
      }
      return ok(
        deepFreeze({
          kind: 'collection_page_range' as const,
          collectionIdentity,
          fromPage,
          toPage,
        }),
      );
    }
    default:
      return fail([diagnostic('UNKNOWN_ENUM_VALUE', 'requestedScope.kind', 'unreachable')]);
  }
}

function decodeCollectionIdentity(
  record: Record<string, unknown>,
  diagnostics: ValidationDiagnostic[],
): CollectionId | undefined {
  const raw = unwrap(
    requireNonEmptyString(record, 'collectionIdentity', 'requestedScope'),
    diagnostics,
  );
  if (raw === undefined) {
    return undefined;
  }
  return unwrap(makeCollectionId(raw), diagnostics);
}

function decodeOptionalCollectionIdentity(
  record: Record<string, unknown>,
  diagnostics: ValidationDiagnostic[],
): CollectionId | undefined {
  const present = 'collectionIdentity' in record && record['collectionIdentity'] !== undefined;
  if (!present) {
    return undefined;
  }
  return decodeCollectionIdentity(record, diagnostics);
}

function decodeMemberIdSet(
  record: Record<string, unknown>,
  diagnostics: ValidationDiagnostic[],
): readonly MemberId[] | undefined {
  const raws = unwrap(requireArrayOfStrings(record, 'memberIds', 'requestedScope'), diagnostics);
  if (raws === undefined) {
    return undefined;
  }
  if (raws.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'requestedScope.memberIds',
        'member set must not be empty',
      ),
    );
    return undefined;
  }
  if (!hasNoDuplicates(raws)) {
    diagnostics.push(
      diagnostic(
        'DUPLICATE_IDENTITY',
        'requestedScope.memberIds',
        'duplicate member identity in scope',
        'PRD-§11',
      ),
    );
    return undefined;
  }
  const memberIds: MemberId[] = [];
  for (const raw of raws) {
    const id = unwrap(makeMemberId(raw), diagnostics);
    if (id === undefined) {
      return undefined;
    }
    memberIds.push(id);
  }
  return memberIds;
}

function validatePageRange(fromPage: number, toPage: number): ValidationDiagnostic | undefined {
  if (fromPage < 1 || toPage < 1) {
    return diagnostic(
      'MALFORMED_REQUIRED_FIELD',
      'pageRange',
      'collection pages are 1-based logical pages anchored to the collection root',
      'PRD-§10.3',
    );
  }
  if (fromPage > toPage) {
    return diagnostic('MALFORMED_REQUIRED_FIELD', 'pageRange', 'fromPage must be <= toPage');
  }
  return undefined;
}

/**
 * Scope/continuation compatibility (PRD §10). Page-range continuation exists
 * only for `collection_page_range` scope; natural-end continuation requires a
 * supported collection with a validated natural-end relation; single-resource
 * and finite member sets take no continuation.
 */
export function validateScopeContinuationPair(
  scope: RequestedScope,
  continuation: ContinuationScope,
): DomainValidationResult<void> {
  const reject = (message: string, invariant: string): DomainValidationResult<void> =>
    fail([diagnostic('SCOPE_CONTINUATION_MISMATCH', 'continuationScope', message, invariant)]);
  switch (scope.kind) {
    case 'single_resource':
      if (continuation.kind !== 'NONE') {
        return reject('single-resource scope admits no continuation', 'PRD-§10');
      }
      return ok(undefined);
    case 'explicit_member_set':
    case 'selected_collection_members':
      if (continuation.kind !== 'NONE') {
        return reject(
          'finite declared member sets are already bounded; no continuation applies',
          'PRD-§10',
        );
      }
      return ok(undefined);
    case 'collection_page_range':
      if (continuation.kind !== 'NONE') {
        return reject(
          'page-range scope is bounded by its frozen range; DECLARED_PAGE_RANGE continuation would double-bind it',
          'PRD-§10.3',
        );
      }
      return ok(undefined);
    case 'current_page':
    case 'entire_supported_collection':
      if (continuation.kind === 'DECLARED_PAGE_RANGE') {
        return reject(
          'DECLARED_PAGE_RANGE continuation is only valid with collection_page_range scope',
          'PRD-§10.1',
        );
      }
      if (continuation.kind === 'DECLARED_NATURAL_END' && scope.kind === 'current_page') {
        return reject(
          'DECLARED_NATURAL_END requires a supported collection with a validated natural-end relation',
          'PRD-§10.1',
        );
      }
      return ok(undefined);
    default:
      return reject('unknown scope kind', 'PRD-§10');
  }
}

/** Identity members of a scope; empty for scopes that do not enumerate members explicitly. */
export function scopeIdentityMembers(scope: RequestedScope): readonly MemberId[] {
  switch (scope.kind) {
    case 'explicit_member_set':
    case 'selected_collection_members':
      return scope.memberIds;
    default:
      return [];
  }
}

/**
 * Identity-level scope equality: same primitive, same collection and the
 * same identity set where members are enumerated. Member order is not
 * identity; counts alone never are (PRD §11).
 */
export function sameScopeIdentity(a: RequestedScope, b: RequestedScope): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  const collectionOf = (scope: RequestedScope): string | undefined =>
    'collectionIdentity' in scope ? scope.collectionIdentity : undefined;
  if (collectionOf(a) !== collectionOf(b)) {
    return false;
  }
  switch (a.kind) {
    case 'single_resource':
      return a.targetId === (b as typeof a).targetId;
    case 'collection_page_range':
      return a.fromPage === (b as typeof a).fromPage && a.toPage === (b as typeof a).toPage;
    case 'explicit_member_set':
    case 'selected_collection_members': {
      const other = b as typeof a;
      return identitySetsEqual(a.memberIds, other.memberIds);
    }
    case 'current_page':
    case 'entire_supported_collection':
      return true;
    default:
      return false;
  }
}

function identitySetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

/** Internal helpers shared by the decoders in this module. */
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
