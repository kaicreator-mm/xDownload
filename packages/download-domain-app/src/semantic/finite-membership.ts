/**
 * v0.2 T05 — finite declared membership for the semantic lane.
 *
 * A semantic evaluation never discovers its own scope: it is handed an
 * explicitly declared, finite member set (the frozen `DECLARED_FINITE_SET`
 * membership basis of @xdownload/domain-contracts) with an explicit upper
 * bound. Input beyond the declared bound is refused, never truncated — a
 * silently truncated scope would be an undeclared scope widening.
 *
 * Deterministic by construction: decoding canonically sorts members, so the
 * same logical input submitted in any order decodes to one identical frozen
 * value. No wall-clock, no randomness, no network, no environment reads.
 */
import {
  deepFreeze,
  diagnostic,
  fail,
  makeCollectionId,
  makeMemberId,
  ok,
  type DomainValidationResult,
  type MemberId,
} from '@xdownload/domain-contracts';

/** Explicit upper bound for one declared finite member set (v0.2 profile). */
export const MAX_FINITE_MEMBERS = 10_000;

/** The only membership basis the semantic lane accepts (frozen vocabulary reuse). */
export const FINITE_MEMBERSHIP_BASIS = 'DECLARED_FINITE_SET';

/** A declared, finite, explicitly bounded member set (the evaluation universe). */
export interface FiniteMemberSet {
  readonly basis: typeof FINITE_MEMBERSHIP_BASIS;
  /** Canonical order (code-unit ascending), duplicate-free, at most MAX_FINITE_MEMBERS. */
  readonly memberIds: readonly MemberId[];
  /** Optional owning collection identity (bounded opaque identifier). */
  readonly collectionId?: string;
}

const FINITE_MEMBER_SET_FIELDS: readonly string[] = ['basis', 'memberIds', 'collectionId'];

/** Total code-unit ordering — deliberately NOT locale-aware (no environment dependence). */
export function compareCodeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Decode an unknown value into a canonical FiniteMemberSet. Exact-key,
 * fail-closed: unknown fields are refused (no-widening), membership beyond
 * the declared bound is refused (finite scope), duplicates are refused
 * (membership drift), and the empty set is refused (empty is not success).
 */
export function decodeFiniteMemberSet(value: unknown): DomainValidationResult<FiniteMemberSet> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'memberSet',
        'finite member set must be a plain object',
      ),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!FINITE_MEMBER_SET_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  if (record.basis !== FINITE_MEMBERSHIP_BASIS) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'basis',
        `finite member set requires basis '${FINITE_MEMBERSHIP_BASIS}'`,
      ),
    ]);
  }
  const rawMembers = record.memberIds;
  if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
    return fail([
      diagnostic(
        rawMembers !== undefined && Array.isArray(rawMembers)
          ? 'EMPTY_SET_NOT_SUCCESS'
          : 'MALFORMED_REQUIRED_FIELD',
        'memberIds',
        'finite member set requires a non-empty memberIds array (an empty set is not success)',
      ),
    ]);
  }
  if (rawMembers.length > MAX_FINITE_MEMBERS) {
    return fail([
      diagnostic(
        'MEMBERSHIP_DRIFT',
        'memberIds',
        `declared membership exceeds the finite bound (${rawMembers.length} > ${MAX_FINITE_MEMBERS}); the scope is not finite and is refused, not truncated`,
      ),
    ]);
  }
  const members: MemberId[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawMembers.length; index += 1) {
    const raw = rawMembers[index];
    const decoded = makeMemberId(typeof raw === 'string' ? raw : String(raw));
    if (!decoded.ok) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `memberIds[${index}]`,
          `member id must match the bounded identifier grammar: ${String(raw)}`,
        ),
      ]);
    }
    if (seen.has(decoded.value)) {
      return fail([
        diagnostic(
          'MEMBERSHIP_DRIFT',
          `memberIds[${index}]`,
          `duplicate member id: ${decoded.value}`,
        ),
      ]);
    }
    seen.add(decoded.value);
    members.push(decoded.value);
  }
  members.sort(compareCodeUnitOrder);
  let collectionId: string | undefined;
  if (record.collectionId !== undefined) {
    const decodedCollection = makeCollectionId(
      typeof record.collectionId === 'string' ? record.collectionId : String(record.collectionId),
    );
    if (!decodedCollection.ok) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'collectionId',
          'collectionId must match the bounded identifier grammar',
        ),
      ]);
    }
    collectionId = decodedCollection.value;
  }
  return ok(
    deepFreeze({
      basis: FINITE_MEMBERSHIP_BASIS,
      memberIds: deepFreeze(members),
      ...(collectionId === undefined ? {} : { collectionId }),
    }),
  );
}

/** Membership test against a decoded finite scope (identity-set semantics). */
export function memberIsInScope(scope: FiniteMemberSet, candidate: string): boolean {
  return scope.memberIds.includes(candidate as MemberId);
}
