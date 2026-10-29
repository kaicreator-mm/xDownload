/**
 * v0.2 T05 — bounded optional advisory opinions.
 *
 * An AdvisoryOpinion is a SUGGESTIVE hint that may enter the semantic lane
 * only as contestation: it can raise ambiguity (force the
 * requiresConfirmation branch) and nothing else. It is structurally and
 * operationally incapable of granting authority:
 *
 * - its declared field set is disjoint from the confirmed-intent and C
 *   operation vocabularies; any grant-shaped field (grant, targetRef,
 *   allowedOperation, operationId, ...) is refused at validation time with
 *   EVIDENCE_SCOPE_PROMOTION_FORBIDDEN;
 * - its certainty is capped at SUGGESTIVE — a DECISIVE/PROBATIVE advisory is
 *   refused as an evidence-scope promotion attempt;
 * - passing an advisory where an authority is required is refused at run
 *   time by refuseAdvisoryAsAuthority, and refused by the compiler because
 *   AdvisoryOpinion shares no structural overlap with
 *   ConfirmedDownloadIntent / EffectEnvelope / OperationDeclaration;
 * - applyAdvisories can only add contested members to an evaluation, so no
 *   composition of advisories can turn a requiresConfirmation branch into a
 *   selection (advisory never self-grants).
 *
 * The opinions themselves are LLM-shaped data that MAY be injected by a
 * caller; the lane itself never produces them (zero-LLM default path).
 */
import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type MemberId,
} from '@xdownload/domain-contracts';

import {
  compareCodeUnitOrder,
  memberIsInScope,
  type FiniteMemberSet,
} from './finite-membership.ts';
import type { RecipeEvaluation } from './recipe-eval.ts';

/** Advisory certainty is capped at SUGGESTIVE (CertaintyClass vocabulary reuse). */
export const ADVISORY_CERTAINTY_CEILING = 'SUGGESTIVE';

/** Nominal brand marking every advisory value (absent from any authority type). */
export const ADVISORY_KIND = 'ADVISORY_OPINION';

/** Frozen advisory opinion kinds (finite vocabulary). */
export const ADVISORY_OPINION_KINDS = ['RANK_HINT', 'RELEVANCE_HINT', 'COVERAGE_HINT'] as const;
export type AdvisoryOpinionKind = (typeof ADVISORY_OPINION_KINDS)[number];

export interface AdvisoryOpinion {
  readonly advisoryKind: typeof ADVISORY_KIND;
  readonly opinionId: string;
  readonly opinionKind: AdvisoryOpinionKind;
  /** The declared member the hint is about (bounded identifier). */
  readonly aboutMemberId: string;
  /** Always exactly SUGGESTIVE — an advisory is never decisive evidence. */
  readonly certainty: typeof ADVISORY_CERTAINTY_CEILING;
  /** Optional bounded human-readable note. */
  readonly note?: string;
}

const ADVISORY_FIELDS: readonly string[] = [
  'advisoryKind',
  'opinionId',
  'opinionKind',
  'aboutMemberId',
  'certainty',
  'note',
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

/**
 * The authority vocabularies an advisory must never carry. Validation refuses
 * any of these field names BEFORE the generic unknown-field refusal so the
 * diagnostic names the actual violation: an attempt to promote suggestive
 * evidence into authority.
 */
export const ADVISORY_FORBIDDEN_AUTHORITY_FIELDS: readonly string[] = [
  // ConfirmedDownloadIntent fields (T01 canonical contract).
  'requestId',
  'lineageId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'slice',
  'digestAnchor',
  'declaredBytes',
  'caller',
  // C operation / route-table fields (T01 canonical contract).
  'operationId',
  'capabilityId',
  'handlerId',
  'effectClass',
  'externalEffect',
  'intentId',
  // Explicit grant-shaped vocabulary.
  'grant',
  'grants',
  'permission',
  'permissions',
  'authorization',
  'authority',
  'token',
  'credential',
];

/**
 * Validate an unknown value as an AdvisoryOpinion. Fail-closed and exact-key.
 * Grant-shaped fields and super-SUGGESTIVE certainty are refused as
 * evidence-scope promotion; unknown fields are refused as scope widening.
 */
export function validateAdvisoryOpinion(value: unknown): DomainValidationResult<AdvisoryOpinion> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'advisory', 'advisory opinion must be a plain object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (ADVISORY_FORBIDDEN_AUTHORITY_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
          key,
          `advisory opinion cannot carry authority field '${key}'; an advisory is suggestive evidence, never a grant`,
        ),
      ]);
    }
  }
  for (const key of keys) {
    if (!ADVISORY_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  if (record.advisoryKind !== ADVISORY_KIND) {
    return fail([
      diagnostic('UNKNOWN_ENUM_VALUE', 'advisoryKind', `advisoryKind must be '${ADVISORY_KIND}'`),
    ]);
  }
  const opinionId = record.opinionId;
  if (typeof opinionId !== 'string' || !ID_PATTERN.test(opinionId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'opinionId',
        'opinionId must match the bounded identifier grammar',
      ),
    ]);
  }
  if (!ADVISORY_OPINION_KINDS.includes(record.opinionKind as AdvisoryOpinionKind)) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'opinionKind',
        `opinionKind must be one of ${ADVISORY_OPINION_KINDS.join(', ')} (frozen vocabulary)`,
      ),
    ]);
  }
  const aboutMemberId = record.aboutMemberId;
  if (typeof aboutMemberId !== 'string' || !ID_PATTERN.test(aboutMemberId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'aboutMemberId',
        'aboutMemberId must match the bounded identifier grammar',
      ),
    ]);
  }
  if (record.certainty !== ADVISORY_CERTAINTY_CEILING) {
    return fail([
      diagnostic(
        'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
        'certainty',
        `advisory certainty is capped at '${ADVISORY_CERTAINTY_CEILING}'; '${String(record.certainty)}' is an evidence-scope promotion attempt`,
      ),
    ]);
  }
  let note: string | undefined;
  if (record.note !== undefined) {
    if (typeof record.note !== 'string' || record.note.length === 0 || record.note.length > 256) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'note',
          'note must be a bounded string of at most 256 chars',
        ),
      ]);
    }
    note = record.note;
  }
  return ok(
    deepFreeze({
      advisoryKind: ADVISORY_KIND,
      opinionId,
      opinionKind: record.opinionKind as AdvisoryOpinionKind,
      aboutMemberId,
      certainty: ADVISORY_CERTAINTY_CEILING,
      ...(note === undefined ? {} : { note }),
    }),
  );
}

/**
 * Authority-boundary guard: refuses any advisory-branded value offered where
 * an authority (confirmed intent, declared operation) is required. The
 * compile-time counterpart is structural: AdvisoryOpinion is not assignable
 * to ConfirmedDownloadIntent or any C operation shape.
 */
export function refuseAdvisoryAsAuthority(candidate: unknown): DomainValidationResult<void> {
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).advisoryKind === ADVISORY_KIND
  ) {
    return fail([
      diagnostic(
        'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
        'advisoryKind',
        'an advisory opinion was offered where an authority is required; advisories cannot be executed, converted or enforced',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Apply advisory opinions to a finished evaluation. Advisories can only
 * CONTEST members of the declared scope: a contested unique match loses its
 * uniqueness (the selection will require confirmation), and an already
 * ambiguous evaluation stays ambiguous. No advisory composition can select a
 * member — contested membership is returned for the decision layer.
 */
export function applyAdvisories(
  evaluation: RecipeEvaluation,
  scope: FiniteMemberSet,
  advisories: readonly AdvisoryOpinion[],
): DomainValidationResult<readonly MemberId[]> {
  const contested = new Set<string>();
  for (const [index, advisory] of advisories.entries()) {
    if (!memberIsInScope(scope, advisory.aboutMemberId)) {
      return fail([
        diagnostic(
          'MEMBERSHIP_DRIFT',
          `advisories[${index}].aboutMemberId`,
          `advisory about '${advisory.aboutMemberId}' is outside the declared finite scope`,
        ),
      ]);
    }
    contested.add(advisory.aboutMemberId);
  }
  const ordered = [...contested].sort(compareCodeUnitOrder);
  return ok(deepFreeze(ordered) as readonly MemberId[]);
}
