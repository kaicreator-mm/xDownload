/**
 * T003 corpus registries for the frozen PRD §33 experiment corpora
 * (Natural, Collection, Hard, Holdout) with stable corpus/task-case
 * identities across S1–S6 (frozen PRD §28).
 *
 * Registries are deterministic, offline, code-loadable data: every definition
 * is decoded from untrusted input and fails closed; every task case is
 * content-digested so mutating content under a reused identity is detected
 * and rejected instead of silently reinterpreted.
 */

import {
  andThen,
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  requireArrayOfStrings,
  requireLiteral,
  requireNonEmptyString,
  SCOPE_PRIMITIVES,
  SUPPORT_SLICE_IDS,
  type DomainValidationResult,
  type ScopePrimitive,
  type SupportSliceId,
} from '@xdownload/domain-contracts';
import { stableDigest } from './canonical-json.ts';
import { fixtureResource } from './fixtures.ts';
import {
  isCanonicalCorpusId,
  isCanonicalJourneyId,
  isCanonicalOracleId,
  makeCorpusId,
  makeTaskCaseId,
  type CorpusId,
  type FixtureResourceId,
  type TaskCaseId,
} from './identity.ts';

export type CorpusPurpose =
  | 'ORDINARY_IN_SCOPE_TASKS_ACROSS_S1_S6'
  | 'CURRENT_PAGE_GALLERY_PLAYLIST_AND_CONTINUATION'
  | 'DETERMINISTIC_TEMPLATE_PATH_INSUFFICIENT'
  | 'NEW_PAGES_SESSIONS_FOR_GENERALIZATION';

export interface TaskCaseDefinition {
  readonly taskCaseId: TaskCaseId;
  readonly title: string;
  /** Canonical support slices required by the case (frozen PRD §28 registry). */
  readonly supportSlices: readonly SupportSliceId[];
  /** Canonical scope primitive the case exercises. */
  readonly scopeKind: ScopePrimitive;
  /** Controlled fixture resources backing the case (must exist in the fixture registry). */
  readonly fixtures: readonly FixtureResourceId[];
  /** Counterexample oracles pre-registered against this case (C01–C34 subset). */
  readonly linkedOracleIds: readonly string[];
  /** Critical journeys exercised by this case (CJ-01..CJ-09 subset). */
  readonly linkedJourneyIds: readonly string[];
}

export interface CorpusDefinition {
  readonly corpusId: CorpusId;
  readonly title: string;
  readonly purpose: CorpusPurpose;
  readonly taskCases: readonly TaskCaseDefinition[];
}

export interface TaskCaseRecord extends TaskCaseDefinition {
  readonly corpusId: CorpusId;
  /** Content digest binding identity to content (mutation detector). */
  readonly contentDigest: string;
}

export interface CorpusRecord {
  readonly corpusId: CorpusId;
  readonly title: string;
  readonly purpose: CorpusPurpose;
  /** Digest over the frozen corpus definition including all task cases. */
  readonly contentDigest: string;
  readonly taskCases: readonly TaskCaseRecord[];
}

export interface CorpusRegistry {
  readonly corpora: readonly CorpusRecord[];
  taskCase(taskCaseId: string): TaskCaseRecord | undefined;
}

const PURPOSE_BY_CORPUS_ID: Readonly<Record<string, CorpusPurpose>> = Object.freeze({
  'corpus.natural': 'ORDINARY_IN_SCOPE_TASKS_ACROSS_S1_S6',
  'corpus.collection': 'CURRENT_PAGE_GALLERY_PLAYLIST_AND_CONTINUATION',
  'corpus.hard': 'DETERMINISTIC_TEMPLATE_PATH_INSUFFICIENT',
  'corpus.holdout': 'NEW_PAGES_SESSIONS_FOR_GENERALIZATION',
});

const CASE_KEYS: readonly string[] = [
  'taskCaseId',
  'title',
  'supportSlices',
  'scopeKind',
  'fixtures',
  'linkedOracleIds',
  'linkedJourneyIds',
];

const CORPUS_KEYS: readonly string[] = ['corpusId', 'title', 'purpose', 'taskCases'];

function decodeTaskCase(value: unknown, path: string): DomainValidationResult<TaskCaseDefinition> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, CASE_KEYS, path), () => {
      const taskCaseIdRaw = requireNonEmptyString(record, 'taskCaseId', path);
      if (!taskCaseIdRaw.ok) {
        return taskCaseIdRaw;
      }
      const title = requireNonEmptyString(record, 'title', path);
      if (!title.ok) {
        return title;
      }
      const scopeKind = requireLiteral(record, 'scopeKind', SCOPE_PRIMITIVES, path);
      if (!scopeKind.ok) {
        return scopeKind;
      }
      const slices = requireArrayOfStrings(record, 'supportSlices', path);
      if (!slices.ok) {
        return slices;
      }
      const fixtures = requireArrayOfStrings(record, 'fixtures', path);
      if (!fixtures.ok) {
        return fixtures;
      }
      const oracleIds = requireArrayOfStrings(record, 'linkedOracleIds', path);
      if (!oracleIds.ok) {
        return oracleIds;
      }
      const journeyIds = requireArrayOfStrings(record, 'linkedJourneyIds', path);
      if (!journeyIds.ok) {
        return journeyIds;
      }
      const taskCaseId = makeTaskCaseId(taskCaseIdRaw.value);
      if (!taskCaseId.ok) {
        return taskCaseId;
      }
      for (const slice of slices.value) {
        if (!SUPPORT_SLICE_IDS.includes(slice as SupportSliceId)) {
          return fail([
            diagnostic(
              'UNKNOWN_ENUM_VALUE',
              `${path}.supportSlices`,
              `unknown support slice '${slice}'; the v0.1.0 registry is exactly S1–S6 (PRD §28)`,
              'PRD-§28',
            ),
          ]);
        }
      }
      if (slices.value.length === 0) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.supportSlices`,
            'a task case must declare at least one support slice',
          ),
        ]);
      }
      for (const fixtureId of fixtures.value) {
        const fixture = fixtureResource(fixtureId);
        if (!fixture.ok) {
          return fail(fixture.diagnostics.map((d) => ({ ...d, path: `${path}.fixtures` })));
        }
      }
      for (const oracleId of oracleIds.value) {
        if (!isCanonicalOracleId(oracleId)) {
          return fail([
            diagnostic(
              'UNKNOWN_ENUM_VALUE',
              `${path}.linkedOracleIds`,
              `unknown counterexample identity '${oracleId}'; the frozen corpus is exactly C01–C34 (PRD §35)`,
              'PRD-§35',
            ),
          ]);
        }
      }
      for (const journeyId of journeyIds.value) {
        if (!isCanonicalJourneyId(journeyId)) {
          return fail([
            diagnostic(
              'UNKNOWN_ENUM_VALUE',
              `${path}.linkedJourneyIds`,
              `unknown critical journey '${journeyId}'; the frozen set is exactly CJ-01..CJ-09 (PRD §31)`,
              'PRD-§31',
            ),
          ]);
        }
      }
      return ok(
        deepFreeze({
          taskCaseId: taskCaseId.value,
          title: title.value,
          supportSlices: deepFreeze([...slices.value] as readonly SupportSliceId[]),
          scopeKind: scopeKind.value,
          fixtures: deepFreeze(fixtures.value.map((id) => id as FixtureResourceId)),
          linkedOracleIds: deepFreeze([...oracleIds.value]),
          linkedJourneyIds: deepFreeze([...journeyIds.value]),
        }),
      );
    }),
  );
}

export function decodeCorpusDefinition(value: unknown): DomainValidationResult<CorpusDefinition> {
  const path = 'corpus';
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, CORPUS_KEYS, path), () => {
      const corpusIdRaw = requireNonEmptyString(record, 'corpusId', path);
      const title = requireNonEmptyString(record, 'title', path);
      const purpose = requireLiteral(record, 'purpose', Object.values(PURPOSE_BY_CORPUS_ID), path);
      const rawCases = record['taskCases'];
      if (!corpusIdRaw.ok || !title.ok || !purpose.ok) {
        return fail([
          ...(corpusIdRaw.ok ? [] : corpusIdRaw.diagnostics),
          ...(title.ok ? [] : title.diagnostics),
          ...(purpose.ok ? [] : purpose.diagnostics),
        ]);
      }
      const corpusId = makeCorpusId(corpusIdRaw.value);
      if (!corpusId.ok) {
        return corpusId;
      }
      if (!isCanonicalCorpusId(corpusId.value)) {
        return fail([
          diagnostic(
            'UNKNOWN_ENUM_VALUE',
            `${path}.corpusId`,
            `unknown experiment corpus '${corpusId.value}'; the frozen PRD §33 set is Natural/Collection/Hard/Holdout`,
            'PRD-§33',
          ),
        ]);
      }
      const expectedPurpose = PURPOSE_BY_CORPUS_ID[corpusId.value]!;
      if (purpose.value !== expectedPurpose) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.purpose`,
            `corpus '${corpusId.value}' must carry its frozen PRD §33 purpose '${expectedPurpose}'`,
            'PRD-§33',
          ),
        ]);
      }
      if (!Array.isArray(rawCases) || rawCases.length === 0) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.taskCases`,
            'a corpus must declare at least one task case',
          ),
        ]);
      }
      const cases: TaskCaseDefinition[] = [];
      for (const [index, rawCase] of rawCases.entries()) {
        const decoded = decodeTaskCase(rawCase, `${path}.taskCases[${index}]`);
        if (!decoded.ok) {
          return decoded;
        }
        cases.push(decoded.value);
      }
      return ok(
        deepFreeze({
          corpusId: corpusId.value,
          title: title.value,
          purpose: purpose.value,
          taskCases: deepFreeze(cases),
        }),
      );
    }),
  );
}

function caseRecord(corpusId: CorpusId, definition: TaskCaseDefinition): TaskCaseRecord {
  return deepFreeze({ ...definition, corpusId, contentDigest: stableDigest(definition) });
}

/**
 * Load a corpus registry from untrusted definitions. The registry must
 * contain exactly the four frozen PRD §33 corpora, each exactly once, with
 * globally unique task-case identities.
 */
export function loadCorpusRegistry(
  definitions: readonly unknown[],
): DomainValidationResult<CorpusRegistry> {
  if (!Array.isArray(definitions)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'corpusRegistry',
        'expected an array of corpus definitions',
      ),
    ]);
  }
  const corpora: CorpusRecord[] = [];
  const caseIndex = new Map<string, TaskCaseRecord>();
  const seenCorpora = new Set<string>();
  for (const [index, raw] of definitions.entries()) {
    const decoded = decodeCorpusDefinition(raw);
    if (!decoded.ok) {
      return fail(
        decoded.diagnostics.map((d) => ({ ...d, path: `corpusRegistry[${index}].${d.path}` })),
      );
    }
    const definition = decoded.value;
    if (seenCorpora.has(definition.corpusId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          `corpusRegistry[${index}].corpusId`,
          `corpus identity '${definition.corpusId}' registered twice`,
        ),
      ]);
    }
    seenCorpora.add(definition.corpusId);
    const cases = definition.taskCases.map((taskCase) => caseRecord(definition.corpusId, taskCase));
    for (const taskCase of cases) {
      const existing = caseIndex.get(taskCase.taskCaseId);
      if (existing !== undefined) {
        return fail([
          diagnostic(
            'DUPLICATE_IDENTITY',
            'corpusRegistry.taskCaseId',
            `task-case identity '${taskCase.taskCaseId}' registered twice (${existing.corpusId} and ${taskCase.corpusId})`,
          ),
        ]);
      }
      caseIndex.set(taskCase.taskCaseId, taskCase);
    }
    corpora.push(
      deepFreeze({
        corpusId: definition.corpusId,
        title: definition.title,
        purpose: definition.purpose,
        contentDigest: stableDigest(definition),
        taskCases: deepFreeze(cases),
      }),
    );
  }
  for (const requiredId of Object.keys(PURPOSE_BY_CORPUS_ID)) {
    if (!seenCorpora.has(requiredId)) {
      return fail([
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'corpusRegistry',
          `frozen PRD §33 corpus '${requiredId}' is missing from the registry`,
          'PRD-§33',
        ),
      ]);
    }
  }
  corpora.sort((a, b) => (a.corpusId < b.corpusId ? -1 : 1));
  const registry: CorpusRegistry = deepFreeze({
    corpora: deepFreeze(corpora),
    taskCase: (taskCaseId: string) => caseIndex.get(taskCaseId),
  });
  return ok(registry);
}

/**
 * Identity-stability rule: a task-case identity always binds to the same
 * content. Re-registering changed content under a reused identity is a
 * pre-registration mutation and fails closed.
 */
export function assertTaskCaseIdentityStable(
  previous: TaskCaseRecord,
  current: TaskCaseRecord,
): DomainValidationResult<void> {
  if (previous.taskCaseId !== current.taskCaseId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'taskCase.taskCaseId',
        'identity-stability check requires the same task-case identity',
      ),
    ]);
  }
  if (previous.contentDigest !== current.contentDigest) {
    return fail([
      diagnostic(
        'DUPLICATE_IDENTITY',
        'taskCase.contentDigest',
        `task-case identity '${previous.taskCaseId}' was reused for changed content (${previous.contentDigest} -> ${current.contentDigest}); a new identity is required`,
        'PRD-§33/§35',
      ),
    ]);
  }
  return ok(undefined);
}
