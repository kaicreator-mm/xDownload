/**
 * TEST_MATRIX suite `c01-c34-oracle-loading` (frozen PRD §35; T003←T002
 * canonical binding).
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ORACLE_IDS,
  loadOracleCorpus,
  oracleCorpusRecords,
  type OracleCorpus,
} from '../src/index.ts';
import {
  decodeOk,
  loadedCorpusRegistry,
  loadedOracleCorpus,
  PRIMARY_G0_PLAN_ID,
} from './helpers.ts';

function oracleWithId(id: string): Record<string, unknown> {
  const record = structuredClone(oracleCorpusRecords()) as Record<string, unknown>[];
  const oracle = record.find((r) => r['oracleId'] === id) as Record<string, unknown>;
  return structuredClone(oracle) as Record<string, unknown>;
}

describe('c01-c34 oracle loading — complete corpus with known C-identities', () => {
  const corpus: OracleCorpus = loadedOracleCorpus();

  it('all 34 oracle records load, each with its canonical C-identity', () => {
    expect(corpus.oracles).toHaveLength(34);
    expect(corpus.oracles.map((oracle) => oracle.oracleId)).toEqual(CANONICAL_ORACLE_IDS);
  });

  it('every oracle references the frozen PRD §35 authority as its truth source', () => {
    for (const oracle of corpus.oracles) {
      expect(oracle.prdRef).toBe(`PRD-§35#${oracle.oracleId}`);
      expect(oracle.requiredBehavior.length).toBeGreaterThan(0);
      expect(oracle.truthSource.kind).toMatch(/^PRE_REGISTERED_/);
      expect(oracle.truthSource.ref).toContain('PRD');
    }
  });

  it('every oracle binds to a registered corpus task case (scope pre-registration)', () => {
    const registry = loadedCorpusRegistry();
    for (const oracle of corpus.oracles) {
      const taskCase = registry.taskCase(oracle.scopeRef.taskCaseId);
      expect(taskCase).toBeDefined();
      expect(taskCase!.corpusId).toBe(oracle.scopeRef.corpusId);
      expect(taskCase!.linkedOracleIds).toContain(oracle.oracleId);
    }
  });

  it('execution against a product candidate is NOT_RUN and structurally constant', () => {
    expect(corpus.executionStatus).toBe('NOT_RUN');
    const reloaded = loadedOracleCorpus();
    expect(reloaded.executionStatus).toBe('NOT_RUN');
  });
});

describe('c01-c34 oracle loading — canonical result-vocabulary binding', () => {
  const corpus = loadedOracleCorpus();

  it('C02 pre-registers the exact PARTIAL/PARTIAL/TRUNCATED tuple from cap exhaustion', () => {
    const tuple = corpus.byId('C02')!.expectedTuples[0]!;
    expect(tuple.requestFulfillment).toBe('PARTIAL');
    expect(tuple.targetResolution).toBe('PARTIAL');
    expect(tuple.selectionAcquisition).toBe('COMPLETE');
    expect(tuple.coverage).toBe('TRUNCATED');
    expect(tuple.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
    expect(tuple.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 100,
      failedCount: 0,
    });
  });

  it('C05 pre-registers the exact §17.1 selected-subset tuple', () => {
    const tuple = corpus.byId('C05')!.expectedTuples[0]!;
    expect([
      tuple.requestFulfillment,
      tuple.targetResolution,
      tuple.selectionAcquisition,
      tuple.coverage,
      tuple.stopReason,
    ]).toEqual([
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'VERIFIED_COMPLETE',
      'USER_SELECTION_COMPLETE',
    ]);
  });

  it('C10 pre-registers the exact §17.2 authorization-limited tuple', () => {
    const oracle = corpus.byId('C10')!;
    const tuple = oracle.expectedTuples[0]!;
    expect([
      tuple.requestFulfillment,
      tuple.targetResolution,
      tuple.selectionAcquisition,
      tuple.coverage,
      tuple.stopReason,
    ]).toEqual(['PARTIAL', 'RESOLVED', 'COMPLETE', 'VERIFIED_COMPLETE', 'AUTH_REQUIRED']);
    expect(
      oracle.ruleAssertions.some(
        (rule) =>
          rule.field === 'requestFulfillment' &&
          rule.value === 'COMPLETE' &&
          rule.polarity === 'MUST_NOT',
      ),
    ).toBe(true);
  });

  it('C24 pre-registers both AUTH_REQUIRED and AUTH_FAILED stop variants (PRD §16.5)', () => {
    const variants = corpus.byId('C24')!.expectedTuples;
    expect(variants).toHaveLength(2);
    expect(variants.map((tuple) => tuple.stopReason).sort()).toEqual([
      'AUTH_FAILED',
      'AUTH_REQUIRED',
    ]);
    for (const tuple of variants) {
      expect([
        tuple.requestFulfillment,
        tuple.targetResolution,
        tuple.selectionAcquisition,
        tuple.coverage,
      ]).toEqual(['UNSATISFIED', 'BLOCKED', 'NOT_STARTED', 'UNKNOWN']);
    }
  });

  it('C01 forbids VERIFIED_COMPLETE from count equality; C14 forbids VERIFIED_COMPLETE coverage', () => {
    expect(
      corpus
        .byId('C01')!
        .ruleAssertions.some(
          (rule) =>
            rule.field === 'coverage' &&
            rule.value === 'VERIFIED_COMPLETE' &&
            rule.polarity === 'MUST_NOT',
        ),
    ).toBe(true);
    expect(
      corpus
        .byId('C14')!
        .ruleAssertions.some(
          (rule) =>
            rule.field === 'coverage' &&
            rule.value === 'VERIFIED_COMPLETE' &&
            rule.polarity === 'MUST_NOT',
        ),
    ).toBe(true);
    expect(
      corpus
        .byId('C14')!
        .ruleAssertions.some(
          (rule) =>
            rule.field === 'selectionAcquisition' &&
            rule.value === 'COMPLETE' &&
            rule.polarity === 'MUST',
        ),
    ).toBe(true);
  });

  it('every rule assertion value is a canonical status literal for its field', () => {
    const canonical: Record<string, readonly string[]> = {
      requestFulfillment: ['COMPLETE', 'PARTIAL', 'UNSATISFIED', 'UNKNOWN'],
      targetResolution: ['RESOLVED', 'PARTIAL', 'EMPTY_CONFIRMED', 'EMPTY_UNKNOWN', 'BLOCKED'],
      selectionAcquisition: ['NOT_STARTED', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED'],
      coverage: ['VERIFIED_COMPLETE', 'VERIFIED_SUBSET', 'TRUNCATED', 'UNKNOWN', 'NOT_APPLICABLE'],
      stopReason: [
        'NONE',
        'NATURAL_COLLECTION_END',
        'USER_SCOPE_REACHED',
        'USER_SELECTION_COMPLETE',
        'DISCOVERY_BUDGET_EXHAUSTED',
        'TRANSFER_BUDGET_EXHAUSTED',
        'GLOBAL_SAFETY_LIMIT',
        'NO_PROGRESS',
        'AUTH_REQUIRED',
        'AUTH_FAILED',
        'TARGET_CHANGED',
        'COLLECTION_CHANGED',
        'UNSUPPORTED',
        'USER_CANCELLED',
        'VALIDATION_FAILED',
      ],
      'validationSummary.status': [
        'ALL_PASSED',
        'PARTIAL',
        'FAILED',
        'INSUFFICIENT_EVIDENCE',
        'NOT_PERFORMED',
      ],
    };
    for (const oracle of corpus.oracles) {
      for (const rule of oracle.ruleAssertions) {
        expect(canonical[rule.field]).toBeDefined();
        expect(canonical[rule.field]).toContain(rule.value);
        expect(['MUST', 'MAY', 'MUST_NOT']).toContain(rule.polarity);
      }
    }
  });

  it('G0-involved oracles reference the applicable frozen G0BaselinePlan (§35 preamble)', () => {
    for (const oracle of corpus.oracles) {
      if ((oracle.gateRefs as readonly string[]).includes('G0')) {
        expect(oracle.g0PlanRef).toBe(PRIMARY_G0_PLAN_ID);
      } else {
        expect(oracle.g0PlanRef).toBeUndefined();
      }
    }
    expect(corpus.byId('C33')!.gateRefs).toContain('G0');
    expect(corpus.byId('C17')!.gateRefs.map(String)).toEqual(['G1a', 'G1b']);
  });
});

describe('c01-c34 oracle loading — fail-closed loading', () => {
  const registry = loadedCorpusRegistry();

  it('an unknown C-identity fails closed', () => {
    const records: unknown[] = [
      ...oracleCorpusRecords(),
      { ...oracleWithId('C34'), oracleId: 'C35' },
    ];
    const result = loadOracleCorpus(records, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
    }
  });

  it('a missing counterexample leaves the corpus incomplete and rejected', () => {
    const records = oracleCorpusRecords().filter(
      (r) => (r as Record<string, unknown>)['oracleId'] !== 'C05',
    );
    const result = loadOracleCorpus(records, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) => d.code === 'MISSING_REQUIRED_FIELD' && d.message.includes('C05'),
        ),
      ).toBe(true);
    }
  });

  it('a duplicate C-identity is rejected', () => {
    const records: unknown[] = [...oracleCorpusRecords(), oracleWithId('C07')];
    const result = loadOracleCorpus(records, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'DUPLICATE_IDENTITY')).toBe(true);
    }
  });

  it('an oracle bound to an unknown canonical status fails closed', () => {
    const bad = oracleWithId('C02');
    const tuples = bad['expectedTuples'] as Record<string, unknown>[];
    tuples[0]!['coverage'] = 'SORT_OF_COMPLETE';
    const result = loadOracleCorpus(
      oracleCorpusRecords().map((r) =>
        (r as Record<string, unknown>)['oracleId'] === 'C02' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
    }
  });

  it('a self-generated truth source fails closed (C34)', () => {
    const bad = oracleWithId('C09');
    bad['truthSource'] = { kind: 'UI_SUGGESTION', ref: 'ui/ground-truth' };
    const result = loadOracleCorpus(
      oracleCorpusRecords().map((r) =>
        (r as Record<string, unknown>)['oracleId'] === 'C09' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) => d.code === 'SELF_CERTIFICATION' && d.invariant === 'C34/PRD-§22',
        ),
      ).toBe(true);
    }
  });

  it('an oracle with no pre-registered expectation at all fails closed', () => {
    const bad = oracleWithId('C22');
    bad['expectedTuples'] = [];
    bad['ruleAssertions'] = [];
    const result = loadOracleCorpus(
      oracleCorpusRecords().map((r) =>
        (r as Record<string, unknown>)['oracleId'] === 'C22' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    }
  });

  it('an oracle scopeRef that does not resolve to a registered task case fails closed', () => {
    const bad = oracleWithId('C12');
    bad['scopeRef'] = { corpusId: 'corpus.hard', taskCaseId: 'hard/not-registered' };
    const result = loadOracleCorpus(
      oracleCorpusRecords().map((r) =>
        (r as Record<string, unknown>)['oracleId'] === 'C12' ? bad : r,
      ),
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'CONTRACT_BINDING_MISMATCH')).toBe(true);
    }
  });

  it('a G0-involved oracle without a registered g0PlanRef fails closed', () => {
    const bad = oracleWithId('C32');
    bad['g0PlanRef'] = 'g0-plan/unregistered';
    const result = loadOracleCorpus(
      oracleCorpusRecords().map((r) =>
        (r as Record<string, unknown>)['oracleId'] === 'C32' ? bad : r,
      ),
      registry,
      { knownG0PlanIds: [PRIMARY_G0_PLAN_ID] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'CONTRACT_BINDING_MISMATCH')).toBe(true);
    }
  });

  it('the shipped corpus loads clean exactly once (deterministic identity)', () => {
    const first = decodeOk(loadOracleCorpus(oracleCorpusRecords(), registry));
    const second = decodeOk(loadOracleCorpus(oracleCorpusRecords(), registry));
    expect(JSON.stringify(first.oracles)).toBe(JSON.stringify(second.oracles));
  });
});
