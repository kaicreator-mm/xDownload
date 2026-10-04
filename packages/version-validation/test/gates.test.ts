/**
 * TEST_MATRIX suite `gate-instrumentation` (frozen PRD §32 + §34).
 */
import { describe, expect, it } from 'vitest';
import { ABLATION_LAYERS, evaluateGate, GATE_DEFINITIONS, gateStatusBoard } from '../src/index.ts';
import { rawG0Evidence } from './helpers.ts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';

describe('gate definitions (PRD §32)', () => {
  it('G0 and G1a–G1d exist with their PRD references', () => {
    const ids = GATE_DEFINITIONS.map((gate) => gate.gateId);
    expect(ids).toEqual(['G0', 'G1a', 'G1b', 'G1c', 'G1d', 'G2', 'G3', 'G4']);
    expect(GATE_DEFINITIONS.find((gate) => gate.gateId === 'G0')!.prdRef).toBe('PRD-§32/G0');
  });

  it('G0 defines the primary correctness and secondary cost metric set', () => {
    const metrics = GATE_DEFINITIONS.find((gate) => gate.gateId === 'G0')!.metrics.map(
      (m) => m.metric,
    );
    expect(metrics).toEqual([
      'CORRECT_COMPLETION',
      'ACTIVE_USER_TIME',
      'MANUAL_ACTIONS',
      'RECOVERY_EFFORT',
      'FALSE_SUCCESS_RATE',
    ]);
  });

  it('ablation layers A0–A4 each receive credit only for their own increment (§34)', () => {
    expect(ABLATION_LAYERS.map((layer) => layer.layer)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
    for (const layer of ABLATION_LAYERS) {
      expect(layer.creditRule).toBe('OWN_INCREMENT_ONLY');
    }
  });
});

describe('gate evaluation — fail-closed on missing evidence (never PASS)', () => {
  it('empty metrics yield INSUFFICIENT_EVIDENCE, never PASS', () => {
    const result = unwrapOrThrow(evaluateGate({ gateId: 'G1a', metrics: [] }));
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('gate metrics');
  });

  it('an UNAVAILABLE metric yields INSUFFICIENT_EVIDENCE', () => {
    const result = unwrapOrThrow(
      evaluateGate(
        rawG0Evidence({
          metrics: [{ metric: 'CORRECT_COMPLETION', value: 'UNAVAILABLE' }],
        }),
      ),
    );
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('CORRECT_COMPLETION unavailable');
  });

  it('G0 without the frozen G0BaselinePlan reference yields INSUFFICIENT_EVIDENCE', () => {
    const raw = rawG0Evidence();
    delete raw['baselinePlanRef'];
    const result = unwrapOrThrow(evaluateGate(raw));
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('G0BaselinePlan');
  });

  it('G0 without per-journey confirmation coverage yields INSUFFICIENT_EVIDENCE', () => {
    const raw = rawG0Evidence();
    delete raw['journeyConfirmationCoverage'];
    expect(unwrapOrThrow(evaluateGate(raw)).result).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('G0 with one journey lacking confirmation evidence yields INSUFFICIENT_EVIDENCE naming it', () => {
    const raw = rawG0Evidence();
    const coverage = raw['journeyConfirmationCoverage'] as {
      journeyId: string;
      confirmationEvidencePresent: boolean;
    }[];
    coverage[4]!.confirmationEvidencePresent = false;
    const result = unwrapOrThrow(evaluateGate(raw));
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('CJ-05');
  });

  it('G0 without baseline comparison or defect accounting yields INSUFFICIENT_EVIDENCE', () => {
    const raw = rawG0Evidence();
    delete raw['baselineComparison'];
    expect(unwrapOrThrow(evaluateGate(raw)).result).toBe('INSUFFICIENT_EVIDENCE');
    const raw2 = rawG0Evidence();
    delete raw2['criticalDefects'];
    expect(unwrapOrThrow(evaluateGate(raw2)).result).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('an unknown gate id and an unknown metric fail closed', () => {
    const rejected = evaluateGate({ gateId: 'G9', metrics: [] });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('UNKNOWN_ENUM_VALUE');
    }
    const wrongMetric = evaluateGate({
      gateId: 'G1a',
      metrics: [{ metric: 'NOT_A_METRIC', value: 1 }],
    });
    expect(wrongMetric.ok).toBe(false);
    if (!wrongMetric.ok) {
      expect(wrongMetric.diagnostics[0]!.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });
});

describe('gate evaluation — PASS/FAIL rules on complete recorded evidence', () => {
  it('G0 with complete evidence, no defects and baseline parity evaluates PASS', () => {
    const result = unwrapOrThrow(evaluateGate(rawG0Evidence()));
    expect(result.result).toBe('PASS');
    expect(result.diagnostics).toEqual([]);
  });

  it('G0 with an unresolved critical false-success evaluates FAIL', () => {
    const result = unwrapOrThrow(
      evaluateGate(
        rawG0Evidence({
          criticalDefects: { unresolvedCriticalFalseSuccess: true, unresolvedWrongTarget: false },
        }),
      ),
    );
    expect(result.result).toBe('FAIL');
  });

  it('G0 with lower completion than the frozen baseline result evaluates FAIL', () => {
    const result = unwrapOrThrow(
      evaluateGate(
        rawG0Evidence({
          baselineComparison: {
            baselineId: 'baseline/yt-dlp',
            correctCompletionDelta: -0.1,
            collectionEffortDelta: -5,
          },
        }),
      ),
    );
    expect(result.result).toBe('FAIL');
  });

  it('G0 with more collection effort than baseline fails unless compensated by independent correctness improvement', () => {
    const uncompensated = unwrapOrThrow(
      evaluateGate(
        rawG0Evidence({
          baselineComparison: {
            baselineId: 'baseline/yt-dlp',
            correctCompletionDelta: 0,
            collectionEffortDelta: 10,
          },
        }),
      ),
    );
    expect(uncompensated.result).toBe('FAIL');
    const compensated = unwrapOrThrow(
      evaluateGate(
        rawG0Evidence({
          baselineComparison: {
            baselineId: 'baseline/yt-dlp',
            correctCompletionDelta: 0.05,
            collectionEffortDelta: 10,
            compensatingCorrectnessImprovement: true,
          },
        }),
      ),
    );
    expect(compensated.result).toBe('PASS');
  });

  it('G1b with no navigation-requiring S6 case is INSUFFICIENT_EVIDENCE by the frozen rule', () => {
    const result = unwrapOrThrow(
      evaluateGate({
        gateId: 'G1b',
        metrics: [{ metric: 'NAVIGATION_EFFORT_REDUCTION', value: 100 }],
        navigationRequiringCasePresent: false,
      }),
    );
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('S6 must be narrowed before release');
  });

  it('G1b with a navigation case evaluates on the effort reduction metric', () => {
    const pass = unwrapOrThrow(
      evaluateGate({
        gateId: 'G1b',
        metrics: [{ metric: 'NAVIGATION_EFFORT_REDUCTION', value: 5000 }],
        navigationRequiringCasePresent: true,
      }),
    );
    expect(pass.result).toBe('PASS');
    const fail = unwrapOrThrow(
      evaluateGate({
        gateId: 'G1a',
        metrics: [
          { metric: 'BATCH_EFFORT_REDUCTION', value: -1 },
          { metric: 'CORRECT_COMPLETION', value: 0.9 },
          { metric: 'FALSE_SUCCESS_RATE', value: 0 },
        ],
      }),
    );
    expect(fail.result).toBe('FAIL');
  });

  it('G1c requires wrong-target and burden accounting', () => {
    const result = unwrapOrThrow(
      evaluateGate({
        gateId: 'G1c',
        metrics: [{ metric: 'SELECTION_EFFORT_REDUCTION', value: 100 }],
      }),
    );
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('WRONG_TARGET_RATE unavailable');
  });
});

describe('gate status board — no harness output is Product gate truth', () => {
  it('every gate is NOT_RUN on the exact T003 candidate', () => {
    const board = gateStatusBoard();
    expect(board.map((entry) => entry.gateId)).toEqual(GATE_DEFINITIONS.map((gate) => gate.gateId));
    for (const entry of board) {
      expect(entry.status).toBe('NOT_RUN');
    }
    expect(board.some((entry) => entry.status === 'PASS' || entry.status === 'FAIL')).toBe(false);
  });
});
