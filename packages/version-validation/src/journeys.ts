/**
 * T003 Critical Journey harness definitions (frozen PRD §31).
 *
 * CJ-01..CJ-09 each get a pre-registered harness definition: corpus linkage,
 * required support slices, expected stop/statuses (canonical-bound) and the
 * frozen scope invariants of its journey (e.g. CJ-04 continuation_scope=NONE,
 * CJ-05 declared-natural-end truthfulness). Definitions reference task-case
 * identities and slices only — they never implement product behavior and
 * cannot silently add scope/continuation beyond the frozen contract
 * semantics.
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
  requireNonEmptyString,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { decodeExpectedTuple, type ExpectedTerminalStatusTuple } from './canonical-probe.ts';
import type { CorpusRegistry } from './corpora.ts';
import {
  CANONICAL_JOURNEY_IDS,
  isCanonicalJourneyId,
  makeJourneyId,
  type JourneyId,
} from './identity.ts';
import { decodeTruthSource, type TruthSource } from './truth-source.ts';

export interface JourneyScopeInvariants {
  /** CJ-04: frozen NONE — no scroll/load-more may add members. */
  readonly continuationScope?: 'NONE';
  /** CJ-05: budget stop before declared natural end must return truthful PARTIAL/TRUNCATED. */
  readonly declaredNaturalEndTruthful?: boolean;
  /** CJ-06: retry/resume original targets only, no budget reset. */
  readonly retryOriginalTargetsOnly?: boolean;
  /** CJ-09: original requested_scope preserved; accessible/inaccessible accounting separated. */
  readonly preserveRequestedScope?: boolean;
}

export interface JourneyDefinition {
  readonly journeyId: JourneyId;
  readonly title: string;
  readonly prdRef: string;
  readonly corpusRef: { readonly corpusId: string; readonly taskCaseId: string };
  readonly requiredSupportSlices: readonly string[];
  readonly expectedStop: ExpectedTerminalStatusTuple['stopReason'];
  readonly expectedResultStatuses: ExpectedTerminalStatusTuple;
  readonly truthSource: TruthSource;
  readonly scopeInvariants: JourneyScopeInvariants;
}

export interface JourneyRegistry {
  readonly journeys: readonly JourneyDefinition[];
  byId(journeyId: string): JourneyDefinition | undefined;
}

const JOURNEY_KEYS: readonly string[] = [
  'journeyId',
  'title',
  'prdRef',
  'corpusRef',
  'requiredSupportSlices',
  'expectedStop',
  'expectedResultStatuses',
  'truthSource',
  'scopeInvariants',
];

const INVARIANT_KEYS: readonly string[] = [
  'continuationScope',
  'declaredNaturalEndTruthful',
  'retryOriginalTargetsOnly',
  'preserveRequestedScope',
];

const SCOPE_REF_KEYS: readonly string[] = ['corpusId', 'taskCaseId'];

/**
 * CJ-07 upward canonical-vocabulary mapping (frozen PRD §31/CJ-07).
 *
 * The PRD journey token `NEEDS_USER_ACTION` has no literal in the canonical
 * StopReason enum of `@xdownload/domain-contracts`. CJ-07 therefore
 * pre-registers the encodable canonical subset — coverage UNKNOWN, stop
 * UNSUPPORTED, validation NOT_PERFORMED (the shipped CJ-07 record below).
 * The literal itself is deliberately unrepresentable as a terminal status
 * here; surfacing it literally requires an upward canonical-vocabulary
 * change in `@xdownload/domain-contracts`, never a local redeclaration.
 */
export const CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING = deepFreeze({
  prdToken: 'NEEDS_USER_ACTION',
  prdRef: 'PRD-§31/CJ-07',
  canonicalEncoding: deepFreeze({
    coverage: 'UNKNOWN',
    stopReason: 'UNSUPPORTED',
    validationSummaryStatus: 'NOT_PERFORMED',
  }),
});

/**
 * Frozen per-journey required scope invariants (PRD §31). A definition that
 * omits a required invariant, or adds scope/continuation beyond it, fails
 * closed.
 */
const REQUIRED_INVARIANTS: Readonly<Record<string, JourneyScopeInvariants>> = Object.freeze({
  'CJ-01': Object.freeze({}),
  'CJ-02': Object.freeze({}),
  'CJ-03': Object.freeze({}),
  'CJ-04': Object.freeze({ continuationScope: 'NONE' }),
  'CJ-05': Object.freeze({ declaredNaturalEndTruthful: true }),
  'CJ-06': Object.freeze({ retryOriginalTargetsOnly: true }),
  'CJ-07': Object.freeze({}),
  'CJ-08': Object.freeze({}),
  'CJ-09': Object.freeze({ preserveRequestedScope: true }),
});

function decodeScopeInvariants(
  value: unknown,
  path: string,
  journeyId: string,
): DomainValidationResult<JourneyScopeInvariants> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, INVARIANT_KEYS, path), () => {
      const continuationScope = record['continuationScope'];
      if (continuationScope !== undefined && continuationScope !== 'NONE') {
        return fail([
          diagnostic(
            'SCOPE_MUTATION',
            `${path}.continuationScope`,
            `journey '${journeyId}' cannot declare continuation beyond the frozen contract semantics; only 'NONE' is representable`,
            'PRD-§10.1/§31',
          ),
        ]);
      }
      for (const flag of [
        'declaredNaturalEndTruthful',
        'retryOriginalTargetsOnly',
        'preserveRequestedScope',
      ]) {
        const flagValue = record[flag];
        if (flagValue !== undefined && typeof flagValue !== 'boolean') {
          return fail([
            diagnostic(
              'MALFORMED_REQUIRED_FIELD',
              `${path}.${flag}`,
              'scope invariant flags must be booleans',
            ),
          ]);
        }
      }
      const invariants: JourneyScopeInvariants = {
        continuationScope: continuationScope === 'NONE' ? 'NONE' : undefined,
        declaredNaturalEndTruthful:
          record['declaredNaturalEndTruthful'] === true ? true : undefined,
        retryOriginalTargetsOnly: record['retryOriginalTargetsOnly'] === true ? true : undefined,
        preserveRequestedScope: record['preserveRequestedScope'] === true ? true : undefined,
      };
      const required = REQUIRED_INVARIANTS[journeyId];
      if (required === undefined) {
        return fail([
          diagnostic(
            'UNKNOWN_ENUM_VALUE',
            `${path}`,
            `unknown journey id '${journeyId}' for scope invariants`,
            'PRD-§31',
          ),
        ]);
      }
      for (const [key, requiredValue] of Object.entries(required)) {
        const actual = invariants[key as keyof JourneyScopeInvariants];
        if (actual !== requiredValue) {
          return fail([
            diagnostic(
              'MISSING_REQUIRED_FIELD',
              `${path}.${key}`,
              `journey '${journeyId}' must pre-register its frozen scope invariant '${key}=${String(requiredValue)}'`,
              'PRD-§31',
            ),
          ]);
        }
      }
      return ok(deepFreeze(invariants));
    }),
  );
}

function decodeJourney(
  value: unknown,
  path: string,
  registry: CorpusRegistry,
): DomainValidationResult<JourneyDefinition> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, JOURNEY_KEYS, path), () => {
      const journeyIdRaw = requireNonEmptyString(record, 'journeyId', path);
      if (!journeyIdRaw.ok) {
        return journeyIdRaw;
      }
      const title = requireNonEmptyString(record, 'title', path);
      if (!title.ok) {
        return title;
      }
      const prdRef = requireNonEmptyString(record, 'prdRef', path);
      if (!prdRef.ok) {
        return prdRef;
      }
      const expectedStopRaw = record['expectedStop'];
      if (typeof expectedStopRaw !== 'string' || expectedStopRaw.length === 0) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.expectedStop`,
            'expectedStop must be a canonical StopReason string',
          ),
        ]);
      }
      const slices = requireArrayOfStrings(record, 'requiredSupportSlices', path);
      if (!slices.ok) {
        return slices;
      }
      const journeyId = makeJourneyId(journeyIdRaw.value);
      if (!journeyId.ok) {
        return journeyId;
      }
      if (!isCanonicalJourneyId(journeyId.value)) {
        return fail([
          diagnostic(
            'UNKNOWN_ENUM_VALUE',
            `${path}.journeyId`,
            `unknown critical journey '${journeyId.value}'; the frozen PRD §31 set is exactly CJ-01..CJ-09`,
            'PRD-§31',
          ),
        ]);
      }
      if (!prdRef.value.startsWith('PRD-§31')) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            `${path}.prdRef`,
            `journey '${journeyId.value}' must reference its frozen PRD §31 definition`,
            'PRD-§31',
          ),
        ]);
      }
      if (slices.value.length === 0) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.requiredSupportSlices`,
            'a journey must declare at least one required support slice',
          ),
        ]);
      }
      const scopeRefRecord = asRecord(record['corpusRef'], `${path}.corpusRef`);
      if (!scopeRefRecord.ok) {
        return scopeRefRecord;
      }
      const unknownScope = rejectUnknownFields(
        scopeRefRecord.value,
        SCOPE_REF_KEYS,
        `${path}.corpusRef`,
      );
      if (!unknownScope.ok) {
        return unknownScope;
      }
      const corpusId = requireNonEmptyString(scopeRefRecord.value, 'corpusId', `${path}.corpusRef`);
      const taskCaseId = requireNonEmptyString(
        scopeRefRecord.value,
        'taskCaseId',
        `${path}.corpusRef`,
      );
      if (!corpusId.ok || !taskCaseId.ok) {
        return fail([
          ...(corpusId.ok ? [] : corpusId.diagnostics),
          ...(taskCaseId.ok ? [] : taskCaseId.diagnostics),
        ]);
      }
      const caseRecord = registry.taskCase(taskCaseId.value);
      if (caseRecord === undefined || caseRecord.corpusId !== corpusId.value) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            `${path}.corpusRef`,
            `journey '${journeyId.value}' corpus ref ('${corpusId.value}', '${taskCaseId.value}') does not resolve to a registered task case`,
            'PRD-§31',
          ),
        ]);
      }
      for (const slice of slices.value) {
        if (!(caseRecord.supportSlices as readonly string[]).includes(slice)) {
          return fail([
            diagnostic(
              'INVALID_RESULT_COMBINATION',
              `${path}.requiredSupportSlices`,
              `journey '${journeyId.value}' requires slice '${slice}' which task case '${taskCaseId.value}' does not declare`,
              'PRD-§31',
            ),
          ]);
        }
      }
      const statuses = decodeExpectedTuple(
        record['expectedResultStatuses'],
        `${path}.expectedResultStatuses`,
      );
      if (!statuses.ok) {
        return statuses;
      }
      // `expectedStop` is canonically validated through the pre-registered
      // tuple: an unknown stop literal can never equal a canonical stop.
      if (statuses.value.stopReason !== expectedStopRaw) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.expectedStop`,
            `journey '${journeyId.value}' expected stop '${expectedStopRaw}' does not match the pre-registered tuple stop '${statuses.value.stopReason}'`,
            'PRD-§31',
          ),
        ]);
      }
      const truthSource = decodeTruthSource(record['truthSource'], `${path}.truthSource`);
      if (!truthSource.ok) {
        return truthSource;
      }
      const invariants = decodeScopeInvariants(
        record['scopeInvariants'],
        `${path}.scopeInvariants`,
        journeyId.value,
      );
      if (!invariants.ok) {
        return invariants;
      }
      return ok(
        deepFreeze({
          journeyId: journeyId.value,
          title: title.value,
          prdRef: prdRef.value,
          corpusRef: deepFreeze({ corpusId: corpusId.value, taskCaseId: taskCaseId.value }),
          requiredSupportSlices: deepFreeze([...slices.value]),
          expectedStop: statuses.value.stopReason,
          expectedResultStatuses: statuses.value,
          truthSource: truthSource.value,
          scopeInvariants: invariants.value,
        }),
      );
    }),
  );
}

/**
 * Load the complete CJ-01..CJ-09 journey registry from untrusted records.
 * Every canonical journey must appear exactly once with resolvable corpus
 * linkage and canonical-bound expectations.
 */
export function loadJourneyRegistry(
  records: readonly unknown[],
  registry: CorpusRegistry,
): DomainValidationResult<JourneyRegistry> {
  if (!Array.isArray(records)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'journeys',
        'expected an array of journey definitions',
      ),
    ]);
  }
  const journeys: JourneyDefinition[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of records.entries()) {
    const decoded = decodeJourney(raw, `journeys[${index}]`, registry);
    if (!decoded.ok) {
      return decoded;
    }
    const journey = decoded.value;
    if (seen.has(journey.journeyId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          `journeys[${index}].journeyId`,
          `journey identity '${journey.journeyId}' registered twice`,
          'PRD-§31',
        ),
      ]);
    }
    seen.add(journey.journeyId);
    journeys.push(journey);
  }
  const missing = CANONICAL_JOURNEY_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return fail(
      missing.map((id) =>
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'journeys',
          `critical journey '${id}' is missing from the registry; the frozen PRD §31 set is exactly CJ-01..CJ-09`,
          'PRD-§31',
        ),
      ),
    );
  }
  journeys.sort((a, b) => (a.journeyId < b.journeyId ? -1 : 1));
  const byId = new Map<string, JourneyDefinition>(
    journeys.map((journey) => [journey.journeyId, journey]),
  );
  return ok(
    deepFreeze({
      journeys: deepFreeze(journeys),
      byId: (journeyId: string) => byId.get(journeyId),
    }),
  );
}
