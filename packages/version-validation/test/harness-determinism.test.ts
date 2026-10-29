/**
 * TEST_MATRIX suite `harness-self-tests` — determinism, fail-closed behavior
 * and the no-gate-truth rule for every shipped harness surface.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDenominatorFromRaw,
  defaultPhaseASelection,
  evaluateGate,
  formatEvidenceRecord,
  gateStatusBoard,
  loadCorpusRegistry,
  loadJourneyRegistry,
  loadOracleCorpus,
  captureEvidence,
  oracleCorpusRecords,
  corpusRegistryRecords,
  journeyRegistryRecords,
  stableDigest,
} from '../src/index.ts';
import {
  decodeOk,
  loadedCorpusRegistry,
  loadedJourneyRegistry,
  loadedOracleCorpus,
  rawEvidence,
  rawG0Evidence,
  rawRun,
} from './helpers.ts';

describe('harness self-tests — deterministic and offline on the exact candidate', () => {
  it('the full load pipeline (corpora + oracles + journeys) is byte-identical across runs', () => {
    const runOne = {
      corpora: loadedCorpusRegistry().corpora,
      oracles: loadedOracleCorpus().oracles,
      journeys: loadedJourneyRegistry().journeys,
    };
    const runTwo = {
      corpora: decodeOk(loadCorpusRegistry(corpusRegistryRecords())).corpora,
      oracles: decodeOk(
        loadOracleCorpus(
          oracleCorpusRecords(),
          decodeOk(loadCorpusRegistry(corpusRegistryRecords())),
          {
            knownG0PlanIds: ['g0-plan/v0.1.0-primary'],
          },
        ),
      ).oracles,
      journeys: decodeOk(
        loadJourneyRegistry(
          journeyRegistryRecords(),
          decodeOk(loadCorpusRegistry(corpusRegistryRecords())),
        ),
      ).journeys,
    };
    expect(stableDigest(runOne)).toBe(stableDigest(runTwo));
  });

  it('denominator computation is stable for identical inputs', () => {
    const runs = [
      rawRun({ runId: 'd-1' }),
      rawRun({
        runId: 'd-2',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'XDOWNLOAD_FRICTION' },
      }),
    ];
    const first = computeDenominatorFromRaw(runs);
    const second = computeDenominatorFromRaw(structuredClone(runs));
    expect(first).toEqual(second);
  });

  it('gate evaluation and Phase-A selection are stable for identical inputs', () => {
    const evidence = rawG0Evidence();
    expect(evaluateGate(evidence)).toEqual(evaluateGate(structuredClone(evidence)));
    const metrics = [
      { baselineId: 'b/one', correctCompletion: 1, activeUserTimeMs: 10, manualActionCount: 1 },
      { baselineId: 'b/two', correctCompletion: 1, activeUserTimeMs: 10, manualActionCount: 1 },
    ];
    expect(defaultPhaseASelection(metrics)).toEqual(defaultPhaseASelection([...metrics].reverse()));
  });

  it('evidence formatting is byte-identical across repeated captures', () => {
    const recordA = decodeOk(captureEvidence(rawEvidence()));
    const recordB = decodeOk(captureEvidence(structuredClone(rawEvidence())));
    expect(formatEvidenceRecord(recordA)).toBe(formatEvidenceRecord(recordB));
  });
});

describe('harness self-tests — failure modes fail closed with typed diagnostics', () => {
  const malformedInputs: readonly [string, () => unknown][] = [
    ['corpus registry', () => loadCorpusRegistry([{ nope: true }])],
    ['oracle corpus', () => loadOracleCorpus([{ nope: true }], loadedCorpusRegistry())],
    ['journey registry', () => loadJourneyRegistry([{ nope: true }], loadedCorpusRegistry())],
    ['gate evidence', () => evaluateGate({ nope: true })],
    ['evidence capture', () => captureEvidence({ nope: true })],
    ['run record', () => computeDenominatorFromRaw([{ nope: true }])],
    ['null input', () => loadCorpusRegistry(null as never)],
  ];

  for (const [name, run] of malformedInputs) {
    it(`${name} rejects malformed input with typed diagnostics instead of throwing`, () => {
      let result: unknown;
      expect(() => {
        result = run();
      }).not.toThrow();
      const typed = result as { ok: boolean; diagnostics?: readonly unknown[] };
      expect(typed.ok).toBe(false);
      expect(typed.diagnostics!.length).toBeGreaterThan(0);
    });
  }

  it('no partial results survive a failed load', () => {
    const records = [...oracleCorpusRecords()];
    const bad = structuredClone(records) as Record<string, unknown>[];
    (bad[20] as Record<string, unknown>)['oracleId'] = 'C99';
    const result = loadOracleCorpus(bad, loadedCorpusRegistry());
    expect(result.ok).toBe(false);
  });
});

describe('harness self-tests — no harness output is represented as Product gate truth', () => {
  it('the oracle corpus, journeys and gate board carry expectations/NOT_RUN, never real gate results', () => {
    expect(loadedOracleCorpus().executionStatus).toBe('NOT_RUN');
    // Journey definitions carry pre-registered expectations only; they expose
    // no execution result field at all.
    for (const journey of loadedJourneyRegistry().journeys) {
      expect(Object.keys(journey)).not.toContain('result');
      expect(Object.keys(journey)).not.toContain('gateResult');
    }
    // The standing gate board is NOT_RUN for every instrumented gate.
    expect(gateStatusBoard().every((entry) => entry.status === 'NOT_RUN')).toBe(true);
  });
});
