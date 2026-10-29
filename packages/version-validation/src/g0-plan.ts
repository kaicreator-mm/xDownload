/**
 * T003 G0BaselinePlan registration and pre-registration enforcement
 * (frozen PRD §32.2 R03 / §33 Baseline rule; C33).
 *
 * The plan carries every §32.2 field, freezes content-addressed before any
 * Phase B exposure, and can never be mutated afterwards: post-exposure
 * protocol/baseline/selection/comparison-set/aggregation change is
 * representable ONLY as run invalidation requiring a new independent run.
 * There is no API to add favorable baselines or rewrite selection criteria
 * after exposure. All selection logic is a deterministic total order over
 * Phase-A metrics only; the wall clock is never read.
 */

import {
  andThen,
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  requireIsoTimestamp,
  requireLiteral,
  requireNonEmptyString,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { stableDigest } from './canonical-json.ts';
import {
  makeBaselineId,
  makeBaselinePlanId,
  makeRunId,
  type BaselineId,
  type BaselinePlanId,
  type RunId,
} from './identity.ts';

/** One candidate conventional baseline; identity = id + version + configuration. */
export interface CandidateBaseline {
  readonly baselineId: BaselineId;
  readonly version: string;
  /** Digest of the baseline configuration/workflow assumptions (part of identity). */
  readonly configurationDigest: string;
  readonly workflowAssumptions: readonly string[];
}

export interface G0BaselinePlanFields {
  readonly g0_baseline_plan_id: BaselinePlanId;
  readonly candidate_baseline_registry: readonly CandidateBaseline[];
  /** Per support-slice/task-class declarations, pre-registered as data. */
  readonly support_slice_or_task_class_rules: readonly string[];
  readonly applicability_criteria: readonly string[];
  readonly baseline_selection_rule: BaselineSelectionRule;
  readonly fixed_comparison_sets_if_any: readonly FixedComparisonSet[];
  readonly baseline_version_or_identity: string;
  readonly configuration_profile_assumptions: readonly string[];
  readonly same_task_same_auth_same_scope_constraints: readonly string[];
  readonly metric_aggregation_rule: MetricAggregationRule | undefined;
  readonly tie_break_rule: 'LEXICAL_BASELINE_ID';
  readonly frozen_at: string;
}

export type PhaseAMetricDirection =
  'CORRECT_COMPLETION_DESC' | 'ACTIVE_USER_TIME_ASC' | 'MANUAL_ACTIONS_ASC' | 'BASELINE_ID_LEXICAL';

/** Pre-registered deterministic Phase-A selection rule (PRD §32.2 step 3/4). */
export interface PhaseASelectionRule {
  readonly kind: 'PHASE_A_DETERMINISTIC';
  /** A permutation of the four objective metric directions; a total order. */
  readonly precedence: readonly PhaseAMetricDirection[];
}

export interface FixedComparisonSelectionRule {
  readonly kind: 'FIXED_COMPARISON_SET';
}

export type BaselineSelectionRule = PhaseASelectionRule | FixedComparisonSelectionRule;

export interface FixedComparisonSet {
  readonly taskClass: string;
  readonly baselineIds: readonly BaselineId[];
}

/** Pre-registered aggregation over a fixed comparison set (PRD §32.2 step 5). */
export type MetricAggregationRule =
  'MEAN_OF_SET' | 'MEDIAN_OF_SET' | 'BEST_OF_SET' | 'REPORT_ALL_SEPARATELY';

const DEFAULT_PRECEDENCE: readonly PhaseAMetricDirection[] = Object.freeze([
  'CORRECT_COMPLETION_DESC',
  'ACTIVE_USER_TIME_ASC',
  'MANUAL_ACTIONS_ASC',
  'BASELINE_ID_LEXICAL',
]);

const PLAN_KEYS: readonly string[] = [
  'g0_baseline_plan_id',
  'candidate_baseline_registry',
  'support_slice_or_task_class_rules',
  'applicability_criteria',
  'baseline_selection_rule',
  'fixed_comparison_sets_if_any',
  'baseline_version_or_identity',
  'configuration_profile_assumptions',
  'same_task_same_auth_same_scope_constraints',
  'metric_aggregation_rule',
  'tie_break_rule',
  'frozen_at',
];

const BASELINE_KEYS: readonly string[] = [
  'baselineId',
  'version',
  'configurationDigest',
  'workflowAssumptions',
];

const COMPARISON_KEYS: readonly string[] = ['taskClass', 'baselineIds'];
const SELECTION_RULE_KEYS: readonly string[] = ['kind', 'precedence'];

/** Selection-rule kinds that are non-deterministic or post-exposure and therefore unrepresentable. */
const FORBIDDEN_SELECTION_KINDS: readonly string[] = [
  'RANDOM',
  'POST_EXPOSURE_JUDGMENT',
  'BEST_PHASE_B_RESULT',
  'TEAM_DISCRETION',
];

function decodeCandidateBaseline(
  value: unknown,
  path: string,
): DomainValidationResult<CandidateBaseline> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, BASELINE_KEYS, path), () => {
      const baselineIdRaw = requireNonEmptyString(record, 'baselineId', path);
      if (!baselineIdRaw.ok) {
        return baselineIdRaw;
      }
      const version = requireNonEmptyString(record, 'version', path);
      if (!version.ok) {
        return version;
      }
      const configurationDigest = requireNonEmptyString(record, 'configurationDigest', path);
      if (!configurationDigest.ok) {
        return configurationDigest;
      }
      const assumptions = requireNonEmptyString(record, 'workflowAssumptions', path);
      if (!assumptions.ok) {
        return assumptions;
      }
      const baselineId = makeBaselineId(baselineIdRaw.value);
      if (!baselineId.ok) {
        return baselineId;
      }
      return ok(
        deepFreeze({
          baselineId: baselineId.value,
          version: version.value,
          configurationDigest: configurationDigest.value,
          workflowAssumptions: deepFreeze(assumptions.value.split('|')),
        }),
      );
    }),
  );
}

function decodeSelectionRule(
  value: unknown,
  path: string,
): DomainValidationResult<BaselineSelectionRule> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, SELECTION_RULE_KEYS, path), () => {
      const kindRaw = record['kind'];
      if (typeof kindRaw === 'string' && FORBIDDEN_SELECTION_KINDS.includes(kindRaw)) {
        return fail([
          diagnostic(
            'ADMISSION_REJECTED',
            `${path}.kind`,
            `baseline selection rule '${kindRaw}' is non-deterministic or post-exposure and can never be registered (PRD §32.2 steps 3–4, §33 R03)`,
            'PRD-§32.2',
          ),
        ]);
      }
      const kind = requireLiteral(
        record,
        'kind',
        ['PHASE_A_DETERMINISTIC', 'FIXED_COMPARISON_SET'],
        path,
      );
      if (!kind.ok) {
        return kind;
      }
      if (kind.value === 'FIXED_COMPARISON_SET') {
        return ok(deepFreeze({ kind: 'FIXED_COMPARISON_SET' }));
      }
      const precedence = record['precedence'];
      if (!Array.isArray(precedence) || precedence.length === 0) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.precedence`,
            'a Phase-A deterministic rule must pre-register its full objective precedence',
            'PRD-§32.2 step 4',
          ),
        ]);
      }
      const directions: PhaseAMetricDirection[] = [];
      for (const [index, raw] of precedence.entries()) {
        const direction = requireLiteral(
          { precedence: raw },
          'precedence',
          DEFAULT_PRECEDENCE,
          `${path}.precedence[${index}]`,
        );
        if (!direction.ok) {
          return direction;
        }
        directions.push(direction.value as PhaseAMetricDirection);
      }
      // Deterministic ⟺ total order: every objective direction exactly once.
      if (new Set(directions).size !== DEFAULT_PRECEDENCE.length) {
        return fail([
          diagnostic(
            'ADMISSION_REJECTED',
            `${path}.precedence`,
            'a Phase-A selection rule must be a total order: each objective direction appears exactly once',
            'PRD-§32.2 step 4',
          ),
        ]);
      }
      return ok(deepFreeze({ kind: 'PHASE_A_DETERMINISTIC', precedence: deepFreeze(directions) }));
    }),
  );
}

function decodeStringList(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<readonly string[]> {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        `${path}.${key}`,
        `expected a non-empty array of non-empty strings for '${key}'`,
      ),
    ]);
  }
  return ok(deepFreeze(value as readonly string[]));
}

/**
 * Decode a G0BaselinePlan from untrusted input. Every §32.2 field is
 * required; a fixed comparison set requires a pre-registered aggregation
 * rule (step 5).
 */
export function decodeG0BaselinePlan(value: unknown): DomainValidationResult<G0BaselinePlanFields> {
  const path = 'g0BaselinePlan';
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, PLAN_KEYS, path), () => {
      const planIdRaw = requireNonEmptyString(record, 'g0_baseline_plan_id', path);
      if (!planIdRaw.ok) {
        return planIdRaw;
      }
      const versionIdentity = requireNonEmptyString(record, 'baseline_version_or_identity', path);
      if (!versionIdentity.ok) {
        return versionIdentity;
      }
      const frozenAt = requireIsoTimestamp(record, 'frozen_at', path);
      if (!frozenAt.ok) {
        return frozenAt;
      }
      const tieBreak = requireLiteral(record, 'tie_break_rule', ['LEXICAL_BASELINE_ID'], path);
      if (!tieBreak.ok) {
        return tieBreak;
      }
      const planId = makeBaselinePlanId(planIdRaw.value);
      if (!planId.ok) {
        return planId;
      }
      const rawRegistry = record['candidate_baseline_registry'];
      if (!Array.isArray(rawRegistry) || rawRegistry.length === 0) {
        return fail([
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            `${path}.candidate_baseline_registry`,
            'the candidate baseline registry must be fixed and non-empty before Phase B',
            'PRD-§32.2',
          ),
        ]);
      }
      const registry: CandidateBaseline[] = [];
      const seenBaselines = new Set<string>();
      for (const [index, raw] of rawRegistry.entries()) {
        const baseline = decodeCandidateBaseline(
          raw,
          `${path}.candidate_baseline_registry[${index}]`,
        );
        if (!baseline.ok) {
          return baseline;
        }
        if (seenBaselines.has(baseline.value.baselineId)) {
          return fail([
            diagnostic(
              'DUPLICATE_IDENTITY',
              `${path}.candidate_baseline_registry[${index}].baselineId`,
              `baseline identity '${baseline.value.baselineId}' registered twice`,
            ),
          ]);
        }
        seenBaselines.add(baseline.value.baselineId);
        registry.push(baseline.value);
      }
      const taskClassRules = decodeStringList(record, 'support_slice_or_task_class_rules', path);
      if (!taskClassRules.ok) {
        return taskClassRules;
      }
      const applicability = decodeStringList(record, 'applicability_criteria', path);
      if (!applicability.ok) {
        return applicability;
      }
      const profileAssumptions = decodeStringList(
        record,
        'configuration_profile_assumptions',
        path,
      );
      if (!profileAssumptions.ok) {
        return profileAssumptions;
      }
      const constraints = decodeStringList(
        record,
        'same_task_same_auth_same_scope_constraints',
        path,
      );
      if (!constraints.ok) {
        return constraints;
      }
      const selectionRule = decodeSelectionRule(
        record['baseline_selection_rule'],
        `${path}.baseline_selection_rule`,
      );
      if (!selectionRule.ok) {
        return selectionRule;
      }
      const rawComparisonSets = record['fixed_comparison_sets_if_any'];
      if (!Array.isArray(rawComparisonSets)) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.fixed_comparison_sets_if_any`,
            'must be an array (possibly empty)',
          ),
        ]);
      }
      const comparisonSets: FixedComparisonSet[] = [];
      for (const [index, raw] of rawComparisonSets.entries()) {
        const decoded = andThen(
          asRecord(raw, `${path}.fixed_comparison_sets_if_any[${index}]`),
          (setRecord) =>
            andThen(
              rejectUnknownFields(
                setRecord,
                COMPARISON_KEYS,
                `${path}.fixed_comparison_sets_if_any[${index}]`,
              ),
              () => {
                const taskClass = requireNonEmptyString(
                  setRecord,
                  'taskClass',
                  `${path}.fixed_comparison_sets_if_any[${index}]`,
                );
                if (!taskClass.ok) {
                  return taskClass;
                }
                const idList = decodeStringList(
                  setRecord,
                  'baselineIds',
                  `${path}.fixed_comparison_sets_if_any[${index}]`,
                );
                if (!idList.ok) {
                  return idList;
                }
                const baselineIds: BaselineId[] = [];
                for (const id of idList.value) {
                  if (!seenBaselines.has(id)) {
                    return fail([
                      diagnostic(
                        'CONTRACT_BINDING_MISMATCH',
                        `${path}.fixed_comparison_sets_if_any[${index}].baselineIds`,
                        `comparison set references baseline '${id}' outside the frozen candidate registry`,
                        'PRD-§32.2',
                      ),
                    ]);
                  }
                  const branded = makeBaselineId(id);
                  if (!branded.ok) {
                    return branded;
                  }
                  baselineIds.push(branded.value);
                }
                return ok(
                  deepFreeze({ taskClass: taskClass.value, baselineIds: deepFreeze(baselineIds) }),
                );
              },
            ),
        );
        if (!decoded.ok) {
          return decoded;
        }
        comparisonSets.push(decoded.value);
      }
      let aggregation: MetricAggregationRule | undefined;
      const rawAggregation = record['metric_aggregation_rule'];
      if (rawAggregation !== undefined) {
        const decodedAggregation = requireLiteral(
          record,
          'metric_aggregation_rule',
          ['MEAN_OF_SET', 'MEDIAN_OF_SET', 'BEST_OF_SET', 'REPORT_ALL_SEPARATELY'],
          path,
        );
        if (!decodedAggregation.ok) {
          return decodedAggregation;
        }
        aggregation = decodedAggregation.value;
      }
      if (comparisonSets.length > 0 && aggregation === undefined) {
        return fail([
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            `${path}.metric_aggregation_rule`,
            'a fixed comparison set requires a pre-registered metric aggregation rule; it cannot be chosen after Phase B exposure',
            'PRD-§32.2 step 5',
          ),
        ]);
      }
      const plan: G0BaselinePlanFields = deepFreeze({
        g0_baseline_plan_id: planId.value,
        candidate_baseline_registry: deepFreeze(registry),
        support_slice_or_task_class_rules: taskClassRules.value,
        applicability_criteria: applicability.value,
        baseline_selection_rule: selectionRule.value,
        fixed_comparison_sets_if_any: deepFreeze(comparisonSets),
        baseline_version_or_identity: versionIdentity.value,
        configuration_profile_assumptions: profileAssumptions.value,
        same_task_same_auth_same_scope_constraints: constraints.value,
        metric_aggregation_rule: aggregation,
        tie_break_rule: tieBreak.value,
        frozen_at: frozenAt.value,
      });
      return ok(plan);
    }),
  );
}

/** A decoded but not-yet-frozen plan draft; candidate baselines may still be registered. */
export interface G0BaselinePlanDraft {
  readonly plan: G0BaselinePlanFields;
  readonly frozen: false;
}

/** A frozen plan: content-addressed, immutable, opened-before-Phase-B authority. */
export interface FrozenG0BaselinePlan {
  readonly plan: G0BaselinePlanFields;
  readonly frozen: true;
  readonly contentDigest: string;
}

function draftOf(plan: G0BaselinePlanFields): G0BaselinePlanDraft {
  return deepFreeze({ plan, frozen: false });
}

/** Register a plan draft (pre-freeze). Baselines may still be added at this stage. */
export function registerG0BaselinePlan(
  value: unknown,
): DomainValidationResult<G0BaselinePlanDraft> {
  return andThen(decodeG0BaselinePlan(value), (plan) => ok(draftOf(plan)));
}

/**
 * Register an additional candidate baseline on a DRAFT plan only. There is
 * deliberately no counterpart that accepts a frozen plan: after freeze the
 * candidate registry is fixed before Phase B (PRD §32.2).
 */
export function registerCandidateBaseline(
  draft: G0BaselinePlanDraft,
  baseline: unknown,
): DomainValidationResult<G0BaselinePlanDraft> {
  if (draft.frozen) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'candidate_baseline_registry',
        'the plan is frozen; the candidate baseline registry cannot grow after freeze/exposure',
        'C33/PRD-§32.2 step 7',
      ),
    ]);
  }
  return andThen(decodeCandidateBaseline(baseline, 'candidate_baseline_registry'), (candidate) => {
    if (draft.plan.candidate_baseline_registry.some((b) => b.baselineId === candidate.baselineId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          'candidate_baseline_registry.baselineId',
          `baseline identity '${candidate.baselineId}' already registered`,
        ),
      ]);
    }
    const updated = deepFreeze({
      ...draft.plan,
      candidate_baseline_registry: deepFreeze([
        ...draft.plan.candidate_baseline_registry,
        candidate,
      ]),
    });
    return ok(draftOf(updated));
  });
}

/**
 * Freeze a draft plan. `frozen_at` is a caller-supplied registration fact,
 * never a wall-clock read, so freezing is deterministic. The frozen record
 * is structurally immutable and content-addressed.
 */
export function freezeG0BaselinePlan(draft: G0BaselinePlanDraft): FrozenG0BaselinePlan {
  return deepFreeze({
    plan: draft.plan,
    frozen: true,
    contentDigest: stableDigest(draft.plan),
  });
}

/**
 * Tamper detection: a frozen plan's content digest is its identity. Any
 * mutation attempt (even key reordering survives via canonical form; any
 * value change is caught) fails closed and the original frozen bytes are
 * preserved untouched.
 */
export function assertFrozenPlanUnchanged(
  frozen: FrozenG0BaselinePlan,
  suspect: unknown,
): DomainValidationResult<void> {
  const suspectDigest = stableDigest(suspect);
  if (suspectDigest !== frozen.contentDigest) {
    return fail([
      diagnostic(
        'SNAPSHOT_MUTATION',
        'g0BaselinePlan',
        `frozen G0BaselinePlan '${frozen.plan.g0_baseline_plan_id}' content changed (${frozen.contentDigest} -> ${suspectDigest}); frozen plans are immutable`,
        'PRD-§32.2/C33',
      ),
    ]);
  }
  return ok(undefined);
}

/** A Phase B exposure record bound to the exact frozen plan digest. */
export interface PhaseBExposure {
  readonly runId: RunId;
  readonly planId: BaselinePlanId;
  readonly planDigest: string;
  /** Caller-supplied ISO timestamp; the harness never reads the clock. */
  readonly openedAt: string;
}

export function openPhaseB(
  frozen: FrozenG0BaselinePlan,
  runId: string,
  openedAt: string,
): DomainValidationResult<PhaseBExposure> {
  const id = makeRunId(runId);
  if (!id.ok) {
    return id;
  }
  return ok(
    deepFreeze({
      runId: id.value,
      planId: frozen.plan.g0_baseline_plan_id,
      planDigest: frozen.contentDigest,
      openedAt,
    }),
  );
}

/** The only post-exposure outcome of a protocol/baseline change: run invalidation (C33). */
export interface InvalidatedRun {
  readonly invalidatedRunId: RunId;
  readonly reason: string;
  readonly requiresNewIndependentRun: true;
  readonly prdRef: 'PRD-§32.2 step 7';
}

/**
 * Apply a post-exposure protocol/baseline/selection/comparison-set/
 * aggregation change. The change NEVER mutates the plan; it always
 * invalidates the exposed run and requires a new independent run (C33).
 */
export function applyPostExposureChange(
  exposure: PhaseBExposure,
  frozen: FrozenG0BaselinePlan,
  reason: string,
): DomainValidationResult<InvalidatedRun> {
  if (
    exposure.planDigest !== frozen.contentDigest ||
    exposure.planId !== frozen.plan.g0_baseline_plan_id
  ) {
    return fail([
      diagnostic(
        'BASELINE_IDENTITY_CHANGED',
        'phaseBExposure',
        'exposure record does not belong to this frozen plan',
        'C33',
      ),
    ]);
  }
  if (reason.trim().length === 0) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'reason', 'invalidation reason must be non-empty'),
    ]);
  }
  return ok(
    deepFreeze({
      invalidatedRunId: exposure.runId,
      reason,
      requiresNewIndependentRun: true,
      prdRef: 'PRD-§32.2 step 7',
    }),
  );
}

/** Phase-A metric record for one candidate baseline (pre-exposure data only). */
export interface PhaseABaselineMetric {
  readonly baselineId: BaselineId;
  readonly correctCompletion: number;
  readonly activeUserTimeMs: number;
  readonly manualActionCount: number;
}

function decodePhaseAMetric(
  value: unknown,
  path: string,
): DomainValidationResult<PhaseABaselineMetric> {
  return andThen(asRecord(value, path), (record) =>
    andThen(
      rejectUnknownFields(
        record,
        ['baselineId', 'correctCompletion', 'activeUserTimeMs', 'manualActionCount'],
        path,
      ),
      () => {
        const baselineIdRaw = requireNonEmptyString(record, 'baselineId', path);
        const completion = record['correctCompletion'];
        const activeTime = record['activeUserTimeMs'];
        const manualActions = record['manualActionCount'];
        if (
          !baselineIdRaw.ok ||
          typeof completion !== 'number' ||
          typeof activeTime !== 'number' ||
          typeof manualActions !== 'number'
        ) {
          return fail([
            diagnostic(
              'MALFORMED_REQUIRED_FIELD',
              path,
              'Phase-A metric requires baselineId and numeric correctCompletion/activeUserTimeMs/manualActionCount',
            ),
          ]);
        }
        const baselineId = makeBaselineId(baselineIdRaw.value);
        if (!baselineId.ok) {
          return baselineId;
        }
        return ok(
          deepFreeze({
            baselineId: baselineId.value,
            correctCompletion: completion,
            activeUserTimeMs: activeTime,
            manualActionCount: manualActions,
          }),
        );
      },
    ),
  );
}

/**
 * Default deterministic Phase-A selection (PRD §32.2 step 4): highest correct
 * completion → lowest active user time → lowest manual actions → lexical
 * baseline_id. A pure total order over pre-exposure metrics only.
 */
export function defaultPhaseASelection(
  metrics: readonly unknown[],
): DomainValidationResult<readonly BaselineId[]> {
  const decoded: PhaseABaselineMetric[] = [];
  for (const [index, raw] of metrics.entries()) {
    const metric = decodePhaseAMetric(raw, `phaseAMetrics[${index}]`);
    if (!metric.ok) {
      return metric;
    }
    decoded.push(metric.value);
  }
  const sorted = [...decoded].sort((a, b) => {
    if (a.correctCompletion !== b.correctCompletion) {
      return b.correctCompletion - a.correctCompletion;
    }
    if (a.activeUserTimeMs !== b.activeUserTimeMs) {
      return a.activeUserTimeMs - b.activeUserTimeMs;
    }
    if (a.manualActionCount !== b.manualActionCount) {
      return a.manualActionCount - b.manualActionCount;
    }
    return a.baselineId < b.baselineId ? -1 : a.baselineId > b.baselineId ? 1 : 0;
  });
  return ok(deepFreeze(sorted.map((metric) => metric.baselineId)));
}

/**
 * Selection binding: a frozen plan with a Phase-A deterministic rule selects
 * through the deterministic comparator; a fixed comparison set is returned
 * as the frozen comparison instead of a single pick.
 */
export function selectBaselinePerPlan(
  frozen: FrozenG0BaselinePlan,
  phaseAMetrics: readonly unknown[],
): DomainValidationResult<
  | { readonly outcome: 'SELECTED'; readonly baselineId: BaselineId }
  | { readonly outcome: 'COMPARISON_SET'; readonly baselineIds: readonly BaselineId[] }
> {
  const rule = frozen.plan.baseline_selection_rule;
  if (rule.kind === 'FIXED_COMPARISON_SET') {
    const firstSet = frozen.plan.fixed_comparison_sets_if_any[0];
    if (firstSet === undefined) {
      return fail([
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'fixed_comparison_sets_if_any',
          'FIXED_COMPARISON_SET rule requires a registered comparison set',
          'PRD-§32.2 step 3',
        ),
      ]);
    }
    return ok(deepFreeze({ outcome: 'COMPARISON_SET', baselineIds: firstSet.baselineIds }));
  }
  const selected = defaultPhaseASelection(phaseAMetrics);
  if (!selected.ok) {
    return selected;
  }
  const winner = selected.value[0];
  if (winner === undefined) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'phaseAMetrics',
        'Phase-A selection requires at least one candidate metric record',
        'PRD-§32.2 step 4',
      ),
    ]);
  }
  return ok(deepFreeze({ outcome: 'SELECTED', baselineId: winner }));
}
