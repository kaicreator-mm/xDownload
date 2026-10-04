/**
 * TEST_MATRIX suite `gate-instrumentation` (frozen PRD §32 + §34).
 * Includes the review-5976989281 regression rows: every §32 PASS-rule
 * conjunct must be enforced fail-closed on recorded evidence.
 */
import { describe, expect, it } from 'vitest';
import { ABLATION_LAYERS, evaluateGate, GATE_DEFINITIONS, gateStatusBoard } from '../src/index.ts';
import { rawG0Evidence } from './helpers.ts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';

const IMPROVEMENT_TRUTH = {
  kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE',
  ref: 'PRD-§32/G0#compensating-improvement',
} as const;

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
            compensatingImprovementTruth: IMPROVEMENT_TRUTH,
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

  it('G1b with a navigation case evaluates strict reduction, parity and scope on complete evidence', () => {
    const pass = unwrapOrThrow(
      evaluateGate({
        gateId: 'G1b',
        metrics: [
          { metric: 'NAVIGATION_EFFORT_REDUCTION', value: 5000 },
          { metric: 'CORRECT_COMPLETION', value: 0.9 },
        ],
        navigationRequiringCasePresent: true,
        baselineComparison: {
          baselineId: 'baseline/manual-navigation',
          correctCompletionDelta: 0,
          scopeExpansionObserved: false,
        },
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
        baselineComparison: {
          baselineId: 'baseline/manual-batch',
          correctCompletionDelta: 0,
        },
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

describe('gate PASS rules enforce every frozen §32 conjunct (review 5976989281 regressions)', () => {
  const g1bEvidence = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    gateId: 'G1b',
    metrics: [
      { metric: 'NAVIGATION_EFFORT_REDUCTION', value: 5000 },
      { metric: 'CORRECT_COMPLETION', value: 0.9 },
    ],
    navigationRequiringCasePresent: true,
    baselineComparison: {
      baselineId: 'baseline/manual-navigation',
      correctCompletionDelta: 0,
      scopeExpansionObserved: false,
    },
    ...overrides,
  });
  const g1aEvidence = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    gateId: 'G1a',
    metrics: [
      { metric: 'BATCH_EFFORT_REDUCTION', value: 120 },
      { metric: 'CORRECT_COMPLETION', value: 0.9 },
      { metric: 'FALSE_SUCCESS_RATE', value: 0 },
    ],
    baselineComparison: {
      baselineId: 'baseline/manual-batch',
      correctCompletionDelta: 0,
    },
    ...overrides,
  });
  const g1cEvidence = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    gateId: 'G1c',
    metrics: [
      { metric: 'SELECTION_EFFORT_REDUCTION', value: 200 },
      { metric: 'WRONG_TARGET_RATE', value: 0 },
      { metric: 'CONFIRMATION_BURDEN', value: 2 },
    ],
    ...overrides,
  });
  const g2Evidence = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    gateId: 'G2',
    metrics: [{ metric: 'CORRECT_COMPLETION', value: 0.7 }],
    criticalDefects: { unresolvedCriticalFalseSuccess: false, unresolvedWrongTarget: false },
    ...overrides,
  });
  const g3Evidence = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    gateId: 'G3',
    metrics: [
      { metric: 'CORRECT_COMPLETION', value: 0.9 },
      { metric: 'MODEL_USE_REDUCTION', value: 3 },
      { metric: 'ACTIVE_USER_TIME_REDUCTION', value: 0 },
      { metric: 'REPAIR_EFFORT_REDUCTION', value: 0 },
    ],
    baselineComparison: {
      baselineId: 'baseline/no-local-knowledge',
      correctCompletionDelta: 0,
      scopeExpansionObserved: false,
    },
    ...overrides,
  });

  it('G1b P1a regression: a zero effort delta is not a strict reduction and can no longer PASS', () => {
    const result = unwrapOrThrow(
      evaluateGate(
        g1bEvidence({
          metrics: [
            { metric: 'NAVIGATION_EFFORT_REDUCTION', value: 0 },
            { metric: 'CORRECT_COMPLETION', value: 0.9 },
          ],
        }),
      ),
    );
    expect(result.result).toBe('FAIL');
    expect(result.diagnostics.join(' ')).toContain('strict reduction');
  });

  it('G1b P1b regression: missing CORRECT_COMPLETION can no longer PASS silently', () => {
    const result = unwrapOrThrow(
      evaluateGate(
        g1bEvidence({ metrics: [{ metric: 'NAVIGATION_EFFORT_REDUCTION', value: 5000 }] }),
      ),
    );
    expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnostics.join(' ')).toContain('CORRECT_COMPLETION unavailable');
  });

  it('G1b parity and scope conjuncts are required inputs (PRD-§32/G1b)', () => {
    const noComparison = g1bEvidence();
    delete (noComparison as Record<string, unknown>)['baselineComparison'];
    expect(unwrapOrThrow(evaluateGate(noComparison)).result).toBe('INSUFFICIENT_EVIDENCE');
    const noScope = structuredClone(g1bEvidence()) as Record<string, unknown>;
    (noScope['baselineComparison'] as Record<string, unknown>)['scopeExpansionObserved'] =
      undefined;
    delete (noScope['baselineComparison'] as Record<string, unknown>)['scopeExpansionObserved'];
    const noScopeResult = unwrapOrThrow(evaluateGate(noScope));
    expect(noScopeResult.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(noScopeResult.diagnostics.join(' ')).toContain('scopeExpansionObserved');
  });

  it('G1b regression: scope expansion and correctness regression now reject PASS', () => {
    const expanded = unwrapOrThrow(
      evaluateGate(
        g1bEvidence({
          baselineComparison: {
            baselineId: 'baseline/manual-navigation',
            correctCompletionDelta: 0,
            scopeExpansionObserved: true,
          },
        }),
      ),
    );
    expect(expanded.result).toBe('FAIL');
    expect(expanded.diagnostics.join(' ')).toContain('scope expansion');
    const regressed = unwrapOrThrow(
      evaluateGate(
        g1bEvidence({
          baselineComparison: {
            baselineId: 'baseline/manual-navigation',
            correctCompletionDelta: -0.1,
            scopeExpansionObserved: false,
          },
        }),
      ),
    );
    expect(regressed.result).toBe('FAIL');
    expect(regressed.diagnostics.join(' ')).toContain('correctness regression');
  });

  it('G1a P1c regression: parity is computed from the baseline comparison, not availability', () => {
    const previouslyPassing = unwrapOrThrow(
      evaluateGate(
        g1aEvidence({
          baselineComparison: {
            baselineId: 'baseline/manual-batch',
            correctCompletionDelta: -0.1,
          },
        }),
      ),
    );
    expect(previouslyPassing.result).toBe('FAIL');
    expect(previouslyPassing.diagnostics.join(' ')).toContain('PRD-§32/G1a');
    const noComparison = g1aEvidence();
    delete noComparison['baselineComparison'];
    expect(unwrapOrThrow(evaluateGate(noComparison)).result).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('G1a positive control: strict reduction with baseline parity and no false-success PASSes', () => {
    const result = unwrapOrThrow(evaluateGate(g1aEvidence()));
    expect(result.result).toBe('PASS');
    expect(result.diagnostics).toEqual([]);
  });

  it('G1c P1d regression: confirmation burden is a required cost input', () => {
    const previouslyPassing = unwrapOrThrow(
      evaluateGate(
        g1cEvidence({
          metrics: [
            { metric: 'SELECTION_EFFORT_REDUCTION', value: 200 },
            { metric: 'WRONG_TARGET_RATE', value: 0 },
          ],
        }),
      ),
    );
    expect(previouslyPassing.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(previouslyPassing.diagnostics.join(' ')).toContain('CONFIRMATION_BURDEN');
    expect(unwrapOrThrow(evaluateGate(g1cEvidence())).result).toBe('PASS');
    const noReduction = unwrapOrThrow(
      evaluateGate(
        g1cEvidence({
          metrics: [
            { metric: 'SELECTION_EFFORT_REDUCTION', value: 0 },
            { metric: 'WRONG_TARGET_RATE', value: 0 },
            { metric: 'CONFIRMATION_BURDEN', value: 2 },
          ],
        }),
      ),
    );
    expect(noReduction.result).toBe('FAIL');
  });

  it('G2 P1e regression: absent criticalDefects can no longer PASS; defects block PASS', () => {
    const previouslyPassing = g2Evidence();
    delete previouslyPassing['criticalDefects'];
    const insufficient = unwrapOrThrow(evaluateGate(previouslyPassing));
    expect(insufficient.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(insufficient.diagnostics.join(' ')).toContain('critical defect accounting');
    const falseSuccess = unwrapOrThrow(
      evaluateGate(
        g2Evidence({
          criticalDefects: { unresolvedCriticalFalseSuccess: true, unresolvedWrongTarget: false },
        }),
      ),
    );
    expect(falseSuccess.result).toBe('FAIL');
    const wrongTarget = unwrapOrThrow(
      evaluateGate(
        g2Evidence({
          criticalDefects: { unresolvedCriticalFalseSuccess: false, unresolvedWrongTarget: true },
        }),
      ),
    );
    expect(wrongTarget.result).toBe('FAIL');
    expect(wrongTarget.diagnostics.join(' ')).toContain('independent target truth');
    expect(unwrapOrThrow(evaluateGate(g2Evidence())).result).toBe('PASS');
  });

  it('G3 P1e regression: no-regression consumes parity and scope, reduction must be strict', () => {
    const previouslyPassing = g3Evidence();
    delete previouslyPassing['metrics'];
    previouslyPassing['metrics'] = [{ metric: 'CORRECT_COMPLETION', value: 0.9 }];
    const availabilityOnly = unwrapOrThrow(evaluateGate(previouslyPassing));
    expect(availabilityOnly.result).toBe('INSUFFICIENT_EVIDENCE');
    expect(availabilityOnly.diagnostics.join(' ')).toContain('MODEL_USE_REDUCTION unavailable');
    const noReduction = unwrapOrThrow(
      evaluateGate(
        g3Evidence({
          metrics: [
            { metric: 'CORRECT_COMPLETION', value: 0.9 },
            { metric: 'MODEL_USE_REDUCTION', value: 0 },
            { metric: 'ACTIVE_USER_TIME_REDUCTION', value: 0 },
            { metric: 'REPAIR_EFFORT_REDUCTION', value: -1 },
          ],
        }),
      ),
    );
    expect(noReduction.result).toBe('FAIL');
    expect(noReduction.diagnostics.join(' ')).toContain('no strict reduction');
    const correctnessRegressed = unwrapOrThrow(
      evaluateGate(
        g3Evidence({
          baselineComparison: {
            baselineId: 'baseline/no-local-knowledge',
            correctCompletionDelta: -0.2,
            scopeExpansionObserved: false,
          },
        }),
      ),
    );
    expect(correctnessRegressed.result).toBe('FAIL');
    const scopeRegressed = unwrapOrThrow(
      evaluateGate(
        g3Evidence({
          baselineComparison: {
            baselineId: 'baseline/no-local-knowledge',
            correctCompletionDelta: 0,
            scopeExpansionObserved: true,
          },
        }),
      ),
    );
    expect(scopeRegressed.result).toBe('FAIL');
    expect(scopeRegressed.diagnostics.join(' ')).toContain('scope regression');
    expect(unwrapOrThrow(evaluateGate(g3Evidence())).result).toBe('PASS');
  });

  it('G0 P2 regression: a compensating improvement claimed without independent truth fails (PRD-§32/G0 rule 4)', () => {
    const uncorroborated = unwrapOrThrow(
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
    expect(uncorroborated.result).toBe('FAIL');
    expect(uncorroborated.diagnostics.join(' ')).toContain('not documented by independent truth');
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
