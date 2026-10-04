/**
 * T003 harness-local nominal identities.
 *
 * Corpus ids, task-case ids, oracle ids, journey ids, gate ids and plan ids
 * follow the same identity discipline as `@xdownload/domain-contracts`
 * (`ids.ts`): stable branded nominal identities; changed content requires a
 * new identity and is never mutated in place. These identities namespace the
 * version-validation infrastructure only — they never fork canonical
 * contract vocabulary.
 */

import { diagnostic, fail, ok, type DomainValidationResult } from '@xdownload/domain-contracts';

declare const harnessBrand: unique symbol;

export type HarnessId<T extends string, Tag extends string> = T & {
  readonly [harnessBrand]: Tag;
};

export type CorpusId = HarnessId<string, 'CorpusId'>;
export type TaskCaseId = HarnessId<string, 'TaskCaseId'>;
export type OracleCaseId = HarnessId<string, 'OracleCaseId'>;
export type JourneyId = HarnessId<string, 'JourneyId'>;
export type GateId = HarnessId<string, 'GateId'>;
export type BaselinePlanId = HarnessId<string, 'BaselinePlanId'>;
export type BaselineId = HarnessId<string, 'BaselineId'>;
export type RunId = HarnessId<string, 'RunId'>;
export type FixtureResourceId = HarnessId<string, 'FixtureResourceId'>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function brandedId<Tag extends string>(
  tag: Tag,
): (raw: string) => DomainValidationResult<HarnessId<string, Tag>> {
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
    return ok(raw as HarnessId<string, Tag>);
  };
}

export const makeCorpusId = brandedId('CorpusId');
export const makeTaskCaseId = brandedId('TaskCaseId');
export const makeOracleCaseId = brandedId('OracleCaseId');
export const makeJourneyId = brandedId('JourneyId');
export const makeGateId = brandedId('GateId');
export const makeBaselinePlanId = brandedId('BaselinePlanId');
export const makeBaselineId = brandedId('BaselineId');
export const makeRunId = brandedId('RunId');
export const makeFixtureResourceId = brandedId('FixtureResourceId');

/**
 * Closed C01–C34 registry (frozen PRD §35). Any other counterexample
 * identity is unknown and fails closed.
 */
export const CANONICAL_ORACLE_IDS: readonly string[] = Array.from(
  { length: 34 },
  (_v, i) => `C${String(i + 1).padStart(2, '0')}`,
);

/** Closed CJ-01..CJ-09 registry (frozen PRD §31). */
export const CANONICAL_JOURNEY_IDS: readonly string[] = Array.from(
  { length: 9 },
  (_v, i) => `CJ-${String(i + 1).padStart(2, '0')}`,
);

/**
 * Canonical gate ids instrumented by T003 (frozen PRD §32; G2–G4 statuses
 * recorded for completeness, none of them executed here).
 */
export const CANONICAL_GATE_IDS: readonly string[] = [
  'G0',
  'G1a',
  'G1b',
  'G1c',
  'G1d',
  'G2',
  'G3',
  'G4',
];

/** The four frozen experiment corpora (frozen PRD §33). */
export const CANONICAL_CORPUS_IDS: readonly string[] = [
  'corpus.natural',
  'corpus.collection',
  'corpus.hard',
  'corpus.holdout',
];

export function isCanonicalOracleId(raw: string): boolean {
  return CANONICAL_ORACLE_IDS.includes(raw);
}

export function isCanonicalJourneyId(raw: string): boolean {
  return CANONICAL_JOURNEY_IDS.includes(raw);
}

export function isCanonicalGateId(raw: string): boolean {
  return CANONICAL_GATE_IDS.includes(raw);
}

export function isCanonicalCorpusId(raw: string): boolean {
  return CANONICAL_CORPUS_IDS.includes(raw);
}
