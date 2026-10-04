/**
 * T002 logical identities and the logical-target/locator separation.
 *
 * Stable logical target/member/effect identities are branded nominal types:
 * a locator (redirect/CDN/signed URL) is volatile delivery data and only
 * provenance-bound transitions may preserve logical identity across locator
 * changes (frozen L2 invariant 4, ADR-011).
 */

import {
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';

declare const brand: unique symbol;

export type Branded<T extends string, Tag extends string> = T & { readonly [brand]: Tag };

export type ContractId = Branded<string, 'ContractId'>;
export type SnapshotId = Branded<string, 'SnapshotId'>;
export type LogicalTargetId = Branded<string, 'LogicalTargetId'>;
export type MemberId = Branded<string, 'MemberId'>;
export type EffectId = Branded<string, 'EffectId'>;
export type EvidenceId = Branded<string, 'EvidenceId'>;
export type ValidationRecordId = Branded<string, 'ValidationRecordId'>;
export type CollectionId = Branded<string, 'CollectionId'>;
/** Opaque reference into the local authorization broker; never carries raw secrets. */
export type AuthorizationContextRef = Branded<string, 'AuthorizationContextRef'>;
/** Opaque reference to profile/context configuration used for selection. */
export type ProfileContextRef = Branded<string, 'ProfileContextRef'>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function brandedId<Tag extends string>(
  tag: Tag,
): (raw: string) => DomainValidationResult<Branded<string, Tag>> {
  return (raw: string) => {
    if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          tag,
          `${tag} must be a non-empty identifier of at most 128 characters matching ${String(ID_PATTERN)}`,
        ),
      ]);
    }
    return ok(raw as Branded<string, Tag>);
  };
}

export const makeContractId = brandedId('ContractId');
export const makeSnapshotId = brandedId('SnapshotId');
export const makeLogicalTargetId = brandedId('LogicalTargetId');
export const makeMemberId = brandedId('MemberId');
export const makeEffectId = brandedId('EffectId');
export const makeEvidenceId = brandedId('EvidenceId');
export const makeValidationRecordId = brandedId('ValidationRecordId');
export const makeCollectionId = brandedId('CollectionId');
export const makeAuthorizationContextRef = brandedId('AuthorizationContextRef');
export const makeProfileContextRef = brandedId('ProfileContextRef');

/**
 * Identity-set equality helpers: membership semantics compare identity sets,
 * never counts (PRD §11, counterexample C01).
 */
export function identitySetEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = new Set(a);
  for (const id of b) {
    if (!left.has(id)) {
      return false;
    }
  }
  return true;
}

/** True when `ids` contains no duplicates; duplicate logical identities are rejected upstream. */
export function hasNoDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

export type LocatorKind = 'direct' | 'redirect' | 'cdn' | 'signed';

export interface ResourceLocator {
  readonly kind: LocatorKind;
  readonly uri: string;
}

/**
 * Provenance binding kinds that allow a locator change to keep its logical
 * identity: declared collection/delivery edges, provenance descending from
 * the selected resource, or member delivery edges (PRD §28 S2/S5/S6).
 */
export type LocatorProvenanceBinding =
  'DECLARED_DELIVERY_EDGE' | 'SELECTED_RESOURCE_PROVENANCE' | 'MEMBER_DELIVERY_EDGE';

export interface LocatorProvenance {
  readonly binding: LocatorProvenanceBinding;
  /** The delivery locator this new locator descends from. */
  readonly originLocatorUri: string;
}

export interface LocatorBinding<TId extends string = string> {
  readonly identity: TId;
  readonly locator: ResourceLocator;
  readonly provenance: LocatorProvenance;
}

const LOCATOR_KINDS: readonly LocatorKind[] = ['direct', 'redirect', 'cdn', 'signed'];
const PROVENANCE_BINDINGS: readonly LocatorProvenanceBinding[] = [
  'DECLARED_DELIVERY_EDGE',
  'SELECTED_RESOURCE_PROVENANCE',
  'MEMBER_DELIVERY_EDGE',
];

export function decodeLocator(
  value: unknown,
  path: string,
): DomainValidationResult<ResourceLocator> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', path, 'locator must be an object')]);
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  const uri = record['uri'];
  if (typeof kind !== 'string' || !LOCATOR_KINDS.includes(kind as LocatorKind)) {
    diagnostics.push(
      diagnostic('UNKNOWN_ENUM_VALUE', `${path}.kind`, `unknown locator kind '${String(kind)}'`),
    );
  }
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) {
    diagnostics.push(
      diagnostic('MALFORMED_REQUIRED_FIELD', `${path}.uri`, 'locator uri must be 1..2048 chars'),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok({ kind: kind as LocatorKind, uri: uri as string });
}

export function decodeProvenance(
  value: unknown,
  path: string,
): DomainValidationResult<LocatorProvenance> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'locator provenance must be an object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  const binding = record['binding'];
  const origin = record['originLocatorUri'];
  if (
    typeof binding !== 'string' ||
    !PROVENANCE_BINDINGS.includes(binding as LocatorProvenanceBinding)
  ) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        `${path}.binding`,
        `unknown provenance binding '${String(binding)}'`,
      ),
    );
  }
  if (typeof origin !== 'string' || origin.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        `${path}.originLocatorUri`,
        'origin locator uri is required',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok({ binding: binding as LocatorProvenanceBinding, originLocatorUri: origin as string });
}

/** Bind a delivery locator to a logical identity with its provenance fact. */
export function bindLocator<TId extends string>(
  locator: ResourceLocator,
  identity: TId,
  provenance: LocatorProvenance,
): DomainValidationResult<LocatorBinding<TId>> {
  if (!PROVENANCE_BINDINGS.includes(provenance.binding)) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'provenance.binding',
        `unknown provenance binding '${provenance.binding}'`,
      ),
    ]);
  }
  if (locator.uri.length === 0) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'locator.uri', 'locator uri is required')]);
  }
  return ok(deepFreezeBinding({ identity, locator, provenance }));
}

function deepFreezeBinding<TId extends string>(binding: LocatorBinding<TId>): LocatorBinding<TId> {
  return Object.freeze({
    identity: binding.identity,
    locator: Object.freeze({ ...binding.locator }),
    provenance: Object.freeze({ ...binding.provenance }),
  });
}

/**
 * Locator transition rule (frozen L2 invariant 4): the new locator keeps the
 * previous logical identity only when its provenance descends from the
 * previous locator through an allowed binding. Any unrelated substitution is
 * rejected instead of silently becoming a new truth for the same target.
 */
export function assertLocatorTransitionPreservesTarget<TId extends string>(
  previous: LocatorBinding<TId>,
  nextLocator: ResourceLocator,
  nextProvenance: LocatorProvenance,
): DomainValidationResult<LocatorBinding<TId>> {
  if (
    !PROVENANCE_BINDINGS.includes(nextProvenance.binding) ||
    nextProvenance.originLocatorUri !== previous.locator.uri
  ) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        'provenance',
        'locator change without provenance descending from the previous delivery locator cannot claim the same logical identity',
        'L2-inv4',
      ),
    ]);
  }
  return bindLocator(nextLocator, previous.identity, nextProvenance);
}
