/**
 * TEST_MATRIX suite `critical-journey-harness` (frozen PRD §31).
 */
import { describe, expect, it } from 'vitest';
import {
  assertCanonicalStatusValue,
  CANONICAL_JOURNEY_IDS,
  CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING,
  journeyRegistryRecords,
  loadJourneyRegistry,
} from '../src/index.ts';
import { loadedCorpusRegistry, loadedJourneyRegistry } from './helpers.ts';

function journeyWithId(id: string): Record<string, unknown> {
  const records = structuredClone(journeyRegistryRecords()) as Record<string, unknown>[];
  return structuredClone(
    records.find((r) => r['journeyId'] === id) as Record<string, unknown>,
  ) as Record<string, unknown>;
}

describe('critical journeys — CJ-01..CJ-09 all defined with pre-registered expectations', () => {
  const registry = loadedJourneyRegistry();

  it('all nine journeys load exactly once with canonical identities', () => {
    expect(registry.journeys).toHaveLength(9);
    expect(registry.journeys.map((journey) => journey.journeyId)).toEqual(CANONICAL_JOURNEY_IDS);
  });

  it('every journey references its frozen PRD §31 definition and a resolvable corpus case', () => {
    const corpora = loadedCorpusRegistry();
    for (const journey of registry.journeys) {
      expect(journey.prdRef.startsWith('PRD-§31/')).toBe(true);
      expect(journey.title.length).toBeGreaterThan(0);
      const taskCase = corpora.taskCase(journey.corpusRef.taskCaseId);
      expect(taskCase).toBeDefined();
      expect(taskCase!.corpusId).toBe(journey.corpusRef.corpusId);
      for (const slice of journey.requiredSupportSlices) {
        expect(taskCase!.supportSlices).toContain(slice);
      }
    }
  });

  it('every journey expectation is canonical-bound with a pre-registered truth source', () => {
    for (const journey of registry.journeys) {
      expect(journey.truthSource.kind).toBe('PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE');
      expect(journey.expectedStop).toBe(journey.expectedResultStatuses.stopReason);
      expect(journey.expectedResultStatuses.validationSummary.status).toBeDefined();
    }
  });

  it('frozen scope invariants are pre-registered per journey (CJ-04/CJ-05/CJ-06/CJ-09)', () => {
    expect(registry.byId('CJ-04')!.scopeInvariants.continuationScope).toBe('NONE');
    expect(registry.byId('CJ-05')!.scopeInvariants.declaredNaturalEndTruthful).toBe(true);
    expect(registry.byId('CJ-06')!.scopeInvariants.retryOriginalTargetsOnly).toBe(true);
    expect(registry.byId('CJ-09')!.scopeInvariants.preserveRequestedScope).toBe(true);
  });

  it('journey definitions reference identities and slices only — no product behavior', () => {
    for (const record of journeyRegistryRecords()) {
      const json = JSON.stringify(record);
      expect(json).not.toMatch(/function|=>|import\(|require\(/);
    }
  });
});

describe('critical journeys — definitions cannot silently add scope/continuation', () => {
  const registry = loadedCorpusRegistry();

  it('CJ-04 with a continuation beyond NONE is unrepresentable (SCOPE_MUTATION)', () => {
    const bad = journeyWithId('CJ-04');
    bad['scopeInvariants'] = { continuationScope: 'DECLARED_PAGE_RANGE' };
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-04' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('SCOPE_MUTATION');
      expect(result.diagnostics[0]!.invariant).toBe('PRD-§10.1/§31');
    }
  });

  it('CJ-04 without its frozen NONE invariant fails closed', () => {
    const bad = journeyWithId('CJ-04');
    bad['scopeInvariants'] = {};
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-04' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  it('CJ-05 must pre-register declared-natural-end truthfulness', () => {
    const bad = journeyWithId('CJ-05');
    bad['scopeInvariants'] = {};
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-05' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.message).toContain('declaredNaturalEndTruthful');
    }
  });

  it('an unknown field inside scope invariants fails closed', () => {
    const bad = journeyWithId('CJ-06');
    bad['scopeInvariants'] = { retryOriginalTargetsOnly: true, extraContinuation: 'NONE' };
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-06' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('UNKNOWN_FIELD');
    }
  });
});

describe('critical journeys — complete, unique, and canonically bound registry', () => {
  const registry = loadedCorpusRegistry();

  it('a missing journey fails closed', () => {
    const records = journeyRegistryRecords().filter(
      (r) => (r as Record<string, unknown>)['journeyId'] !== 'CJ-09',
    );
    const result = loadJourneyRegistry(records, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) => d.code === 'MISSING_REQUIRED_FIELD' && d.message.includes('CJ-09'),
        ),
      ).toBe(true);
    }
  });

  it('a duplicate journey identity fails closed', () => {
    const result = loadJourneyRegistry(
      [...journeyRegistryRecords(), journeyWithId('CJ-02')],
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('DUPLICATE_IDENTITY');
    }
  });

  it('an unknown journey id fails closed', () => {
    const bad = journeyWithId('CJ-01');
    bad['journeyId'] = 'CJ-10';
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-01' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('an expectedStop that is not a canonical StopReason fails closed', () => {
    const bad = journeyWithId('CJ-01');
    bad['expectedStop'] = 'WHEN_IT_FEELS_DONE';
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-01' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'INVALID_RESULT_COMBINATION')).toBe(true);
    }
  });

  it('a journey requiring a slice its task case does not declare fails closed', () => {
    const bad = journeyWithId('CJ-01');
    bad['requiredSupportSlices'] = ['S6'];
    const result = loadJourneyRegistry(
      journeyRegistryRecords().map((r) =>
        (r as Record<string, unknown>)['journeyId'] === 'CJ-01' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('INVALID_RESULT_COMBINATION');
    }
  });

  it('the shipped journey registry loads deterministically', () => {
    expect(JSON.stringify(loadedJourneyRegistry().journeys)).toBe(
      JSON.stringify(loadedJourneyRegistry().journeys),
    );
  });
});

describe('CJ-07 upward canonical-vocabulary mapping (review 5976989281 P2)', () => {
  const registry = loadedJourneyRegistry();

  it('the PRD NEEDS_USER_ACTION token maps upward to the encodable canonical subset', () => {
    expect(CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING.prdToken).toBe('NEEDS_USER_ACTION');
    expect(CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING.prdRef).toBe('PRD-§31/CJ-07');
    expect(CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING.canonicalEncoding).toEqual({
      coverage: 'UNKNOWN',
      stopReason: 'UNSUPPORTED',
      validationSummaryStatus: 'NOT_PERFORMED',
    });
  });

  it('the mapping values are canonical and match the shipped CJ-07 pre-registration', () => {
    const encoding = CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING.canonicalEncoding;
    expect(assertCanonicalStatusValue('coverage', encoding.coverage, 'cj07-mapping').ok).toBe(true);
    expect(assertCanonicalStatusValue('stopReason', encoding.stopReason, 'cj07-mapping').ok).toBe(
      true,
    );
    expect(
      assertCanonicalStatusValue(
        'validationSummary',
        { status: encoding.validationSummaryStatus, passedCount: 0, failedCount: 0 },
        'cj07-mapping',
      ).ok,
    ).toBe(true);
    const cj07 = registry.byId('CJ-07')!;
    expect(cj07.prdRef).toBe(CJ07_NEEDS_USER_ACTION_UPWARD_MAPPING.prdRef);
    expect(cj07.expectedStop).toBe(encoding.stopReason);
    expect(cj07.expectedResultStatuses.coverage).toBe(encoding.coverage);
    expect(cj07.expectedResultStatuses.validationSummary.status).toBe(
      encoding.validationSummaryStatus,
    );
  });
});
