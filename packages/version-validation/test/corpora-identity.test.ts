/**
 * TEST_MATRIX suite `corpus-identity` (frozen PRD §33 + §28).
 */
import { describe, expect, it } from 'vitest';
import { decodeSupportSliceRef, supportSliceRepresentations } from '@xdownload/domain-contracts';
import {
  assertTaskCaseIdentityStable,
  CANONICAL_CORPUS_IDS,
  corpusRegistryRecords,
  fixtureResource,
  fixtureResources,
  loadCorpusRegistry,
} from '../src/index.ts';
import { decodeOk } from './helpers.ts';

describe('corpus identity — corpora load with stable identities (PRD §33)', () => {
  it('all four frozen corpora load exactly once with distinct stable identities', () => {
    const registry = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    expect([...registry.corpora.map((corpus) => corpus.corpusId)].sort()).toEqual(
      [...CANONICAL_CORPUS_IDS].sort(),
    );
    const digests = registry.corpora.map((corpus) => corpus.contentDigest);
    expect(new Set(digests).size).toBe(4);
  });

  it('loading twice yields byte-identical corpus and task-case identities', () => {
    const first = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    const second = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    expect(JSON.stringify(first.corpora)).toBe(JSON.stringify(second.corpora));
    for (const corpus of first.corpora) {
      for (const taskCase of corpus.taskCases) {
        const other = second.taskCase(taskCase.taskCaseId);
        expect(other).toBeDefined();
        expect(other!.contentDigest).toBe(taskCase.contentDigest);
      }
    }
  });

  it('duplicate corpus registration is rejected', () => {
    const records = [...corpusRegistryRecords()];
    const result = loadCorpusRegistry([records[0], records[0]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'DUPLICATE_IDENTITY')).toBe(true);
    }
  });

  it('a missing frozen corpus fails closed (PRD §33 set is exactly four)', () => {
    const result = loadCorpusRegistry(corpusRegistryRecords().slice(0, 3));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    }
  });
});

describe('corpus identity — S1–S6 tagging matches the frozen §28 slice registry', () => {
  it('every task-case slice decodes against the canonical S1–S6 registry', () => {
    const registry = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    const canonicalSlices = new Set(supportSliceRepresentations().map((slice) => slice.sliceId));
    for (const corpus of registry.corpora) {
      for (const taskCase of corpus.taskCases) {
        expect(taskCase.supportSlices.length).toBeGreaterThan(0);
        for (const sliceId of taskCase.supportSlices) {
          expect(canonicalSlices.has(sliceId)).toBe(true);
          const decoded = decodeOk(decodeSupportSliceRef({ sliceId }));
          expect(decoded.sliceId).toBe(sliceId);
          expect(decoded.representationOnly).toBe(true);
        }
      }
    }
  });

  it('an unknown slice id fails closed', () => {
    const records = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    const natural = records.find((r) => r['corpusId'] === 'corpus.natural') as Record<
      string,
      unknown
    >;
    const cases = natural['taskCases'] as Record<string, unknown>[];
    cases[0]!['supportSlices'] = ['S7'];
    const result = loadCorpusRegistry(records);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.some(
          (d) => d.code === 'UNKNOWN_ENUM_VALUE' && d.path.includes('supportSlices'),
        ),
      ).toBe(true);
    }
  });
});

describe('corpus identity — mutation under a reused identity is detected and rejected', () => {
  it('re-registering changed content under the same task-case identity fails closed', () => {
    const first = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    const original = first.taskCase('natural/s1-direct-file')!;
    const mutated = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    const natural = mutated.find((r) => r['corpusId'] === 'corpus.natural') as Record<
      string,
      unknown
    >;
    const cases = natural['taskCases'] as Record<string, unknown>[];
    cases[0]!['title'] = 'mutated title under the same identity';
    const second = decodeOk(loadCorpusRegistry(mutated));
    const mutatedCase = second.taskCase('natural/s1-direct-file')!;
    expect(mutatedCase.taskCaseId).toBe(original.taskCaseId);
    const rejection = assertTaskCaseIdentityStable(original, mutatedCase);
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('DUPLICATE_IDENTITY');
      expect(rejection.diagnostics[0]!.invariant).toBe('PRD-§33/§35');
    }
  });

  it('identical content under the same identity is stable', () => {
    const registry = decodeOk(loadCorpusRegistry(corpusRegistryRecords()));
    const taskCase = registry.taskCase('collection/explicit-gallery')!;
    expect(assertTaskCaseIdentityStable(taskCase, { ...taskCase }).ok).toBe(true);
  });
});

describe('corpus identity — controlled fixtures are deterministic, offline (PRD §33)', () => {
  it('repeated fixture resolution is byte-identical with stable digests', () => {
    for (const resource of fixtureResources()) {
      const again = decodeOk(fixtureResource(resource.resourceId));
      expect(Array.from(again.bytes)).toEqual(Array.from(resource.bytes));
      expect(again.sha256).toBe(resource.sha256);
      expect(again.kind).toBe(resource.kind);
    }
  });

  it('an unknown fixture id fails closed (no live-network fallback)', () => {
    const result = fixtureResource('fixture/does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('fixture member lists are frozen and non-empty', () => {
    const members = decodeOk(fixtureResource('fixture/s5-current-page-members'));
    expect(members.memberIds!.length).toBeGreaterThan(0);
    expect(Object.isFrozen(members.memberIds)).toBe(true);
  });
});

describe('corpus identity — corrupted records fail closed with typed diagnostics', () => {
  it('an unknown field on a corpus record is rejected', () => {
    const records = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    (records[0] as Record<string, unknown>)['extraField'] = 'injected';
    const result = loadCorpusRegistry(records);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_FIELD')).toBe(true);
    }
  });

  it('a task case missing its title is rejected', () => {
    const records = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    const natural = records.find((r) => r['corpusId'] === 'corpus.natural') as Record<
      string,
      unknown
    >;
    const cases = natural['taskCases'] as Record<string, unknown>[];
    delete cases[0]!['title'];
    const result = loadCorpusRegistry(records);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    }
  });

  it('a task case referencing an unknown fixture is rejected', () => {
    const records = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    const natural = records.find((r) => r['corpusId'] === 'corpus.natural') as Record<
      string,
      unknown
    >;
    const cases = natural['taskCases'] as Record<string, unknown>[];
    cases[0]!['fixtures'] = ['fixture/live-network-injection'];
    const result = loadCorpusRegistry(records);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('an unknown linked oracle or journey identity is rejected', () => {
    const records = structuredClone(corpusRegistryRecords()) as Record<string, unknown>[];
    const natural = records.find((r) => r['corpusId'] === 'corpus.natural') as Record<
      string,
      unknown
    >;
    const cases = natural['taskCases'] as Record<string, unknown>[];
    cases[0]!['linkedOracleIds'] = ['C99'];
    expect(loadCorpusRegistry(records).ok).toBe(false);
    cases[0]!['linkedOracleIds'] = [];
    cases[0]!['linkedJourneyIds'] = ['CJ-42'];
    expect(loadCorpusRegistry(records).ok).toBe(false);
  });
});
