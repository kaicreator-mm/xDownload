/**
 * Pre-registered truth sources (frozen PRD §22, §32.1, §35 preamble; C34).
 *
 * Truth for any Validation comparison must be pre-registered and independent:
 * pre-registered expectations, an independent manual oracle or authoritative
 * metadata — never discovery/UI/model self-evaluation, and never a user
 * confirmation rewriting experiment truth. The closed kind registry makes
 * self-generated truth unrepresentable.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { asRecord, rejectUnknownFields, requireNonEmptyString } from '@xdownload/domain-contracts';

export const TRUTH_SOURCE_KINDS = [
  'PRE_REGISTERED_EXPECTATION_REGISTRY',
  'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE',
  'PRE_REGISTERED_AUTHORITATIVE_METADATA',
] as const;

export type TruthSourceKind = (typeof TRUTH_SOURCE_KINDS)[number];

export interface TruthSource {
  readonly kind: TruthSourceKind;
  /** Pointer to the frozen pre-registration (e.g. `PRD-§35#C01` or a registered oracle id). */
  readonly ref: string;
}

const TRUTH_SOURCE_KEYS: readonly string[] = ['kind', 'ref'];

/** Kinds that can never certify truth for the same claim (frozen PRD §22/§21, C34). */
const FORBIDDEN_SELF_TRUTH_HINTS: readonly string[] = [
  'DISCOVERY',
  'UI_SUGGESTION',
  'MODEL_SELF_EVALUATION',
  'USER_CONFIRMATION_REWRITE',
];

export function decodeTruthSource(
  value: unknown,
  path: string,
): DomainValidationResult<TruthSource> {
  const record = asRecord(value, path);
  if (!record.ok) {
    return record;
  }
  const unknownFields = rejectUnknownFields(record.value, TRUTH_SOURCE_KEYS, path);
  if (!unknownFields.ok) {
    return unknownFields;
  }
  const kind = record.value['kind'];
  if (
    typeof kind !== 'string' ||
    !TRUTH_SOURCE_KINDS.includes(kind as TruthSourceKind) ||
    FORBIDDEN_SELF_TRUTH_HINTS.some((hint) => kind.includes(hint))
  ) {
    return fail([
      diagnostic(
        'SELF_CERTIFICATION',
        `${path}.kind`,
        `truth source kind '${String(kind)}' is not a pre-registered independent truth source; discovery/UI/model self-evaluation and confirmation rewrites are invalid truth (C34)`,
        'C34/PRD-§22',
      ),
    ]);
  }
  const ref = requireNonEmptyString(record.value, 'ref', path);
  if (!ref.ok) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        `${path}.ref`,
        'a pre-registered truth source must carry an exact pre-registration reference',
        'C34/PRD-§22',
      ),
    ]);
  }
  return ok(deepFreeze({ kind: kind as TruthSourceKind, ref: ref.value }));
}

/**
 * Registry of truth sources that were pre-registered before any Phase B /
 * confirmation exposure. Using an unregistered reference fails closed.
 */
export interface TruthSourceRegistry {
  register(source: TruthSource): DomainValidationResult<void>;
  assertPreRegistered(ref: string): DomainValidationResult<TruthSource>;
  snapshot(): readonly TruthSource[];
}

export function createTruthSourceRegistry(): TruthSourceRegistry {
  const registered = new Map<string, TruthSource>();
  return deepFreeze({
    register(source: TruthSource): DomainValidationResult<void> {
      if (!TRUTH_SOURCE_KINDS.includes(source.kind)) {
        return fail([
          diagnostic(
            'SELF_CERTIFICATION',
            'truthSource.kind',
            `truth source kind '${String(source.kind)}' is not a pre-registered independent kind; discovery/UI/model outputs and confirmation rewrites can never be registered as truth`,
            'C34',
          ),
        ]);
      }
      const existing = registered.get(source.ref);
      if (existing !== undefined) {
        if (existing.kind !== source.kind) {
          return fail([
            diagnostic(
              'DUPLICATE_IDENTITY',
              'truthSource.ref',
              `truth source ref '${source.ref}' already pre-registered with a different kind`,
              'C34',
            ),
          ]);
        }
        return ok(undefined);
      }
      registered.set(source.ref, deepFreeze(source));
      return ok(undefined);
    },
    assertPreRegistered(ref: string): DomainValidationResult<TruthSource> {
      const source = registered.get(ref);
      if (source === undefined) {
        return fail([
          diagnostic(
            'INSUFFICIENT_EVIDENCE',
            'truthSource.ref',
            `truth source '${ref}' was never pre-registered; it cannot be used as ground truth`,
            'C34/PRD-§32.1',
          ),
        ]);
      }
      return ok(source);
    },
    snapshot(): readonly TruthSource[] {
      return [...registered.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1));
    },
  });
}
