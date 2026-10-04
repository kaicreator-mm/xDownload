/**
 * TEST_MATRIX suite `baseline-pre-registration-enforcement` (frozen PRD
 * §32.2 R03 + §33 Baseline rule; C33).
 */
import { describe, expect, it } from 'vitest';
import {
  applyPostExposureChange,
  assertFrozenPlanUnchanged,
  defaultPhaseASelection,
  freezeG0BaselinePlan,
  openPhaseB,
  registerCandidateBaseline,
  registerG0BaselinePlan,
  selectBaselinePerPlan,
  stableDigest,
} from '../src/index.ts';
import { frozenG0Plan, rawG0BaselinePlan } from './helpers.ts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';

function codes(result: { ok: boolean; diagnostics?: readonly { code: string }[] }): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.diagnostics!.map((d) => d.code);
}

describe('G0BaselinePlan — every §32.2 field is required before freeze', () => {
  it('the canonical plan decodes and freezes deterministically', () => {
    const draft = unwrapOrThrow(registerG0BaselinePlan(rawG0BaselinePlan()));
    const frozenA = freezeG0BaselinePlan(draft);
    const frozenB = freezeG0BaselinePlan(
      unwrapOrThrow(registerG0BaselinePlan(rawG0BaselinePlan())),
    );
    expect(frozenA.contentDigest).toBe(frozenB.contentDigest);
    expect(frozenA.frozen).toBe(true);
    expect(frozenA.plan.tie_break_rule).toBe('LEXICAL_BASELINE_ID');
    expect(frozenA.plan.frozen_at).toBe('2026-10-04T00:00:00.000Z');
  });

  const requiredFields = [
    'g0_baseline_plan_id',
    'candidate_baseline_registry',
    'support_slice_or_task_class_rules',
    'applicability_criteria',
    'baseline_selection_rule',
    'fixed_comparison_sets_if_any',
    'baseline_version_or_identity',
    'configuration_profile_assumptions',
    'same_task_same_auth_same_scope_constraints',
    'tie_break_rule',
    'frozen_at',
  ];

  for (const field of requiredFields) {
    it(`rejects a plan missing '${field}'`, () => {
      const raw = rawG0BaselinePlan();
      delete raw[field];
      const rejected = registerG0BaselinePlan(raw);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.diagnostics.length).toBeGreaterThan(0);
        expect([
          'MISSING_REQUIRED_FIELD',
          'MALFORMED_REQUIRED_FIELD',
          'UNKNOWN_ENUM_VALUE',
        ]).toContain(rejected.diagnostics[0]!.code);
      }
    });
  }

  it("accepts a plan without 'metric_aggregation_rule' when no comparison set is fixed", () => {
    const raw = rawG0BaselinePlan();
    delete raw['metric_aggregation_rule'];
    expect(registerG0BaselinePlan(raw).ok).toBe(true);
  });

  it('rejects an empty candidate baseline registry', () => {
    const rejected = registerG0BaselinePlan(rawG0BaselinePlan({ candidate_baseline_registry: [] }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.invariant).toBe('PRD-§32.2');
    }
  });

  it('rejects a duplicate baseline identity', () => {
    const raw = rawG0BaselinePlan();
    const registry = raw['candidate_baseline_registry'] as Record<string, unknown>[];
    registry.push({ ...registry[0]! });
    expect(codes(registerG0BaselinePlan(raw))).toContain('DUPLICATE_IDENTITY');
  });
});

describe('G0BaselinePlan — selection rules must be deterministic (§32.2 steps 3–4)', () => {
  it('non-deterministic and post-exposure rule kinds are unrepresentable', () => {
    for (const kind of [
      'RANDOM',
      'POST_EXPOSURE_JUDGMENT',
      'BEST_PHASE_B_RESULT',
      'TEAM_DISCRETION',
    ]) {
      const rejected = registerG0BaselinePlan(
        rawG0BaselinePlan({ baseline_selection_rule: { kind } }),
      );
      const result = rejected;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]!.code).toBe('ADMISSION_REJECTED');
        expect(result.diagnostics[0]!.invariant).toBe('PRD-§32.2');
      }
    }
  });

  it('a Phase-A precedence that is not a total order is rejected', () => {
    const rejected = registerG0BaselinePlan(
      rawG0BaselinePlan({
        baseline_selection_rule: {
          kind: 'PHASE_A_DETERMINISTIC',
          precedence: ['CORRECT_COMPLETION_DESC', 'CORRECT_COMPLETION_DESC'],
        },
      }),
    );
    expect(codes(rejected)).toContain('ADMISSION_REJECTED');
  });

  it('an unknown precedence direction is rejected', () => {
    const rejected = registerG0BaselinePlan(
      rawG0BaselinePlan({
        baseline_selection_rule: {
          kind: 'PHASE_A_DETERMINISTIC',
          precedence: ['TEAM_VIBES'],
        },
      }),
    );
    expect(codes(rejected)).toContain('UNKNOWN_ENUM_VALUE');
  });
});

describe('G0BaselinePlan — fixed comparison sets require pre-registered aggregation (step 5)', () => {
  it('a comparison set without an aggregation rule is rejected', () => {
    const raw = rawG0BaselinePlan({
      baseline_selection_rule: { kind: 'FIXED_COMPARISON_SET' },
      fixed_comparison_sets_if_any: [
        { taskClass: 'S5/S6', baselineIds: ['baseline/browser-native', 'baseline/yt-dlp'] },
      ],
      metric_aggregation_rule: undefined,
    });
    delete raw['metric_aggregation_rule'];
    expect(codes(registerG0BaselinePlan(raw))).toContain('MISSING_REQUIRED_FIELD');
  });

  it('a comparison set referencing an unregistered baseline is rejected', () => {
    const raw = rawG0BaselinePlan({
      baseline_selection_rule: { kind: 'FIXED_COMPARISON_SET' },
      fixed_comparison_sets_if_any: [
        { taskClass: 'S5/S6', baselineIds: ['baseline/not-registered'] },
      ],
      metric_aggregation_rule: 'REPORT_ALL_SEPARATELY',
    });
    expect(codes(registerG0BaselinePlan(raw))).toContain('CONTRACT_BINDING_MISMATCH');
  });

  it('a complete fixed-comparison plan freezes with its pre-registered aggregation', () => {
    const frozen = frozenG0Plan({
      baseline_selection_rule: { kind: 'FIXED_COMPARISON_SET' },
      fixed_comparison_sets_if_any: [
        { taskClass: 'S5/S6', baselineIds: ['baseline/browser-native', 'baseline/yt-dlp'] },
      ],
      metric_aggregation_rule: 'REPORT_ALL_SEPARATELY',
    });
    expect(frozen.plan.metric_aggregation_rule).toBe('REPORT_ALL_SEPARATELY');
  });
});

describe('G0BaselinePlan — frozen plans are immutable', () => {
  it('mutating any plan value after freeze is detected with the frozen bytes preserved', () => {
    const frozen = frozenG0Plan();
    const tampered = rawG0BaselinePlan({
      baseline_selection_rule: { kind: 'FIXED_COMPARISON_SET' },
    });
    const rejection = assertFrozenPlanUnchanged(frozen, tampered);
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('SNAPSHOT_MUTATION');
      expect(rejection.diagnostics[0]!.invariant).toBe('PRD-§32.2/C33');
    }
    expect(frozen.contentDigest).toBe(stableDigest(frozen.plan));
    expect(frozen.plan.baseline_selection_rule.kind).toBe('PHASE_A_DETERMINISTIC');
  });

  it('frozen plan structures cannot be mutated in place', () => {
    const frozen = frozenG0Plan();
    expect(Object.isFrozen(frozen.plan)).toBe(true);
    expect(Object.isFrozen(frozen.plan.candidate_baseline_registry)).toBe(true);
    expect(() => {
      (frozen.plan as unknown as Record<string, unknown>)['tie_break_rule'] = 'MUTATED';
    }).toThrow();
    expect(frozen.plan.tie_break_rule).toBe('LEXICAL_BASELINE_ID');
  });

  it('identical content yields the identical digest; different content does not', () => {
    const frozenA = frozenG0Plan();
    const frozenB = frozenG0Plan();
    const frozenC = frozenG0Plan({ frozen_at: '2026-10-05T00:00:00.000Z' });
    expect(frozenA.contentDigest).toBe(frozenB.contentDigest);
    expect(frozenA.contentDigest).not.toBe(frozenC.contentDigest);
  });
});

describe('G0BaselinePlan — post-exposure change is representable only as run invalidation (C33)', () => {
  it('no API exists to add a candidate baseline to a frozen plan', () => {
    // The type system refuses FrozenG0BaselinePlan; the draft path stays the
    // only registration route and duplicates are rejected there.
    const draft = unwrapOrThrow(registerG0BaselinePlan(rawG0BaselinePlan()));
    const rejected = registerCandidateBaseline(draft, {
      baselineId: 'baseline/browser-native',
      version: '1.0.0',
      configurationDigest: 'digest-browser-native-v1',
      workflowAssumptions: 'manual per-file download in a standard browser',
    });
    expect(codes(rejected)).toContain('DUPLICATE_IDENTITY');
    const accepted = registerCandidateBaseline(draft, {
      baselineId: 'baseline/gopeed',
      version: '1.4.0',
      configurationDigest: 'digest-gopeed-v1',
      workflowAssumptions: 'gui download manager defaults',
    });
    expect(accepted.ok).toBe(true);
  });

  it('a post-exposure baseline identity change invalidates the exposed run', () => {
    const frozen = frozenG0Plan();
    const exposure = unwrapOrThrow(
      openPhaseB(frozen, 'run-2026-10-04-a', '2026-10-04T01:00:00.000Z'),
    );
    const result = applyPostExposureChange(
      exposure,
      frozenG0Plan({ frozen_at: '2026-10-05T00:00:00.000Z' }),
      'baseline identity changed after Phase B exposure',
    );
    // mismatched plan binding itself fails closed
    expect(codes(result)).toContain('BASELINE_IDENTITY_CHANGED');
  });

  it('a post-exposure change on the same plan always yields invalidation, never mutation', () => {
    const frozen = frozenG0Plan();
    const exposure = unwrapOrThrow(
      openPhaseB(frozen, 'run-2026-10-04-b', '2026-10-04T01:00:00.000Z'),
    );
    const result = unwrapOrThrow(
      applyPostExposureChange(
        exposure,
        frozen,
        'comparison-set aggregation rule rewritten after exposure',
      ),
    );
    expect(result.invalidatedRunId).toBe(exposure.runId);
    expect(result.requiresNewIndependentRun).toBe(true);
    expect(result.prdRef).toBe('PRD-§32.2 step 7');
    // the plan is untouched: the frozen digest still matches
    expect(assertFrozenPlanUnchanged(frozen, structuredClone(frozen.plan)).ok).toBe(true);
  });
});

describe('G0BaselinePlan — deterministic Phase-A selection (default rule)', () => {
  const metrics = [
    {
      baselineId: 'baseline/yt-dlp',
      correctCompletion: 0.8,
      activeUserTimeMs: 90_000,
      manualActionCount: 2,
    },
    {
      baselineId: 'baseline/browser-native',
      correctCompletion: 0.9,
      activeUserTimeMs: 120_000,
      manualActionCount: 5,
    },
    {
      baselineId: 'baseline/gopeed',
      correctCompletion: 0.9,
      activeUserTimeMs: 100_000,
      manualActionCount: 4,
    },
    {
      baselineId: 'baseline/jdownloader',
      correctCompletion: 0.9,
      activeUserTimeMs: 100_000,
      manualActionCount: 4,
    },
  ];

  it('applies completion desc → time asc → actions asc → lexical id, deterministically', () => {
    const first = unwrapOrThrow(defaultPhaseASelection(metrics));
    const second = unwrapOrThrow(defaultPhaseASelection([...metrics].reverse()));
    expect(first).toEqual(second);
    expect(first[0]).toBe('baseline/gopeed'); // ties with jdownloader resolve lexically
    expect(first[1]).toBe('baseline/jdownloader');
    expect(first[2]).toBe('baseline/browser-native');
    expect(first[3]).toBe('baseline/yt-dlp');
  });

  it('selectBaselinePerPlan binds selection to the frozen rule', () => {
    const frozen = frozenG0Plan();
    const selected = unwrapOrThrow(selectBaselinePerPlan(frozen, metrics));
    expect(selected).toEqual({ outcome: 'SELECTED', baselineId: 'baseline/gopeed' });

    const comparisonFrozen = frozenG0Plan({
      baseline_selection_rule: { kind: 'FIXED_COMPARISON_SET' },
      fixed_comparison_sets_if_any: [
        { taskClass: 'S5/S6', baselineIds: ['baseline/browser-native', 'baseline/yt-dlp'] },
      ],
      metric_aggregation_rule: 'REPORT_ALL_SEPARATELY',
    });
    const comparison = unwrapOrThrow(selectBaselinePerPlan(comparisonFrozen, metrics));
    expect(comparison).toEqual({
      outcome: 'COMPARISON_SET',
      baselineIds: ['baseline/browser-native', 'baseline/yt-dlp'],
    });
  });
});
