/**
 * T003 gate instrumentation for G0 and G1a–G1d (frozen PRD §32) plus the
 * §34 ablation layer definitions for collection value attribution.
 *
 * Metric definitions and PASS-rule evaluators consume recorded evidence.
 * Evaluators fail closed: missing or insufficient confirmation evidence
 * yields FAIL or INSUFFICIENT_EVIDENCE, never PASS, and every frozen §32
 * PASS-rule conjunct is enforced on the evidence before PASS can be emitted
 * (strict reduction comparators, baseline parity, scope no-regression,
 * critical-defect blocking, confirmation-burden accounting and
 * independent-truth-documented compensation). Every real gate result on the
 * T003 candidate remains NOT_RUN — evaluation executes only later, against a
 * product candidate, in Validation owned by T020–T023.
 */

import {
  andThen,
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  requireBoolean,
  requireLiteral,
  requireNonEmptyString,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import { makeGateId, type GateId, type JourneyId } from './identity.ts';
import { decodeTruthSource, type TruthSource } from './truth-source.ts';

export type GateResult = 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';

/** NOT_RUN is the standing T003-candidate status: no gate execution happens here. */
export type GateStatus = GateResult | 'NOT_RUN';

export type MetricId =
  | 'CORRECT_COMPLETION'
  | 'ACTIVE_USER_TIME'
  | 'MANUAL_ACTIONS'
  | 'RECOVERY_EFFORT'
  | 'FALSE_SUCCESS_RATE'
  | 'BATCH_EFFORT_REDUCTION'
  | 'NAVIGATION_EFFORT_REDUCTION'
  | 'SELECTION_EFFORT_REDUCTION'
  | 'WRONG_TARGET_RATE'
  | 'CONFIRMATION_BURDEN'
  | 'MODEL_USE_REDUCTION'
  | 'ACTIVE_USER_TIME_REDUCTION'
  | 'REPAIR_EFFORT_REDUCTION';

export interface GateMetricDefinition {
  readonly metric: MetricId;
  readonly title: string;
  readonly unit: string;
}

export interface GateDefinition {
  readonly gateId: GateId;
  readonly title: string;
  readonly prdRef: string;
  readonly applicability:
    | 'REQUIRED'
    | 'REQUIRED_FOR_S5_S6'
    | 'REQUIRED_WHEN_S6_CONTINUATION'
    | 'REQUIRED_WHEN_SEMANTIC_SELECTION'
    | 'RECOMMENDED_NON_BLOCKING'
    | 'CONDITIONAL'
    | 'DEFERRED_NOT_A_V010_RELEASE_GATE';
  readonly metrics: readonly GateMetricDefinition[];
}

function metric(metric: MetricId, title: string, unit: string): GateMetricDefinition {
  return deepFreeze({ metric, title, unit });
}

/** Frozen gate/metric definitions (PRD §32 G0, G1a–G1d; G2–G4 statuses recorded). */
export const GATE_DEFINITIONS: readonly GateDefinition[] = deepFreeze([
  {
    gateId: 'G0' as GateId,
    title: 'Product Value',
    prdRef: 'PRD-§32/G0',
    applicability: 'REQUIRED',
    metrics: [
      metric('CORRECT_COMPLETION', 'correct end-to-end task fulfillment', 'rate'),
      metric('ACTIVE_USER_TIME', 'active user time', 'ms'),
      metric('MANUAL_ACTIONS', 'manual actions', 'count'),
      metric('RECOVERY_EFFORT', 'recovery effort', 'count'),
      metric('FALSE_SUCCESS_RATE', 'false-success rate', 'rate'),
    ],
  },
  {
    gateId: 'G1a' as GateId,
    title: 'Batch Acquisition Increment',
    prdRef: 'PRD-§32/G1a',
    applicability: 'REQUIRED_FOR_S5_S6',
    metrics: [
      metric(
        'BATCH_EFFORT_REDUCTION',
        'strict reduction in active user actions/time vs baseline',
        'delta',
      ),
      metric('CORRECT_COMPLETION', 'correct completion parity', 'rate'),
      metric('FALSE_SUCCESS_RATE', 'no new critical false-success', 'rate'),
    ],
  },
  {
    gateId: 'G1b' as GateId,
    title: 'Navigation Increment',
    prdRef: 'PRD-§32/G1b',
    applicability: 'REQUIRED_WHEN_S6_CONTINUATION',
    metrics: [
      metric(
        'NAVIGATION_EFFORT_REDUCTION',
        'strict effort/time reduction with no scope expansion',
        'delta',
      ),
      metric('CORRECT_COMPLETION', 'no correctness regression', 'rate'),
    ],
  },
  {
    gateId: 'G1c' as GateId,
    title: 'Semantic Selection Increment',
    prdRef: 'PRD-§32/G1c',
    applicability: 'REQUIRED_WHEN_SEMANTIC_SELECTION',
    metrics: [
      metric('SELECTION_EFFORT_REDUCTION', 'strict selection effort/time reduction', 'delta'),
      metric('WRONG_TARGET_RATE', 'no increase in wrong-target rate', 'rate'),
      metric('CONFIRMATION_BURDEN', 'confirmation burden included in cost', 'count'),
    ],
  },
  {
    gateId: 'G1d' as GateId,
    title: 'Organization Increment',
    prdRef: 'PRD-§32/G1d',
    applicability: 'RECOMMENDED_NON_BLOCKING',
    metrics: [metric('CORRECT_COMPLETION', 'correctness/provenance rules satisfied', 'rate')],
  },
  {
    gateId: 'G2' as GateId,
    title: 'AI Increment',
    prdRef: 'PRD-§32/G2',
    applicability: 'CONDITIONAL',
    metrics: [metric('CORRECT_COMPLETION', 'incremental correctly resolved hard tasks', 'rate')],
  },
  {
    gateId: 'G3' as GateId,
    title: 'Local Knowledge Compounding',
    prdRef: 'PRD-§32/G3',
    applicability: 'RECOMMENDED_NON_BLOCKING',
    metrics: [
      metric('CORRECT_COMPLETION', 'correctness does not regress', 'rate'),
      metric('MODEL_USE_REDUCTION', 'strict reduction in model use', 'delta'),
      metric('ACTIVE_USER_TIME_REDUCTION', 'strict reduction in active time', 'delta'),
      metric('REPAIR_EFFORT_REDUCTION', 'strict reduction in repair effort', 'delta'),
    ],
  },
  {
    gateId: 'G4' as GateId,
    title: 'Shared Knowledge',
    prdRef: 'PRD-§32/G4',
    applicability: 'DEFERRED_NOT_A_V010_RELEASE_GATE',
    metrics: [],
  },
]);

/** §34 capability ablation layers; each layer credited only for its own increment. */
export const ABLATION_LAYERS: readonly {
  readonly layer: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  readonly addsCapability: string;
  readonly creditRule: 'OWN_INCREMENT_ONLY';
}[] = deepFreeze([
  { layer: 'A0', addsCapability: 'single/manual acquisition', creditRule: 'OWN_INCREMENT_ONLY' },
  { layer: 'A1', addsCapability: 'current-page batch', creditRule: 'OWN_INCREMENT_ONLY' },
  {
    layer: 'A2',
    addsCapability: 'bounded declared collection continuation',
    creditRule: 'OWN_INCREMENT_ONLY',
  },
  { layer: 'A3', addsCapability: 'semantic filtering/selection', creditRule: 'OWN_INCREMENT_ONLY' },
  { layer: 'A4', addsCapability: 'organization', creditRule: 'OWN_INCREMENT_ONLY' },
]);

const EVIDENCE_KEYS: readonly string[] = [
  'gateId',
  'baselinePlanRef',
  'journeyConfirmationCoverage',
  'metrics',
  'criticalDefects',
  'baselineComparison',
  'navigationRequiringCasePresent',
];

const METRIC_VALUE_KEYS: readonly string[] = ['metric', 'value'];
const DEFECT_KEYS: readonly string[] = ['unresolvedCriticalFalseSuccess', 'unresolvedWrongTarget'];
const COMPARISON_KEYS: readonly string[] = [
  'baselineId',
  'correctCompletionDelta',
  'collectionEffortDelta',
  'compensatingCorrectnessImprovement',
  'compensatingImprovementTruth',
  'scopeExpansionObserved',
];
const JOURNEY_COVERAGE_KEYS: readonly string[] = ['journeyId', 'confirmationEvidencePresent'];

export interface RecordedCriticalDefects {
  readonly unresolvedCriticalFalseSuccess: boolean;
  readonly unresolvedWrongTarget: boolean;
}

export interface RecordedBaselineComparison {
  readonly baselineId: string;
  readonly correctCompletionDelta: number;
  /** Required for G0 (§32/G0 conjunct 4). */
  readonly collectionEffortDelta?: number;
  /** G0 only: only honorable with `compensatingImprovementTruth` (independent truth). */
  readonly compensatingCorrectnessImprovement?: boolean;
  /** G0 only: independent-truth documentation of the compensating improvement. */
  readonly compensatingImprovementTruth?: TruthSource;
  /** Required for G1b/G3 PASS (no scope expansion / scope does not regress). */
  readonly scopeExpansionObserved?: boolean;
}

export interface RecordedGateEvidence {
  readonly gateId: GateId;
  /** Required for G0: the frozen G0BaselinePlan the comparison is bound to. */
  readonly baselinePlanRef?: string;
  readonly journeyConfirmationCoverage?: readonly {
    readonly journeyId: JourneyId;
    readonly confirmationEvidencePresent: boolean;
  }[];
  readonly metrics: readonly {
    readonly metric: MetricId;
    readonly value: number | 'UNAVAILABLE';
  }[];
  readonly criticalDefects?: RecordedCriticalDefects;
  readonly baselineComparison?: RecordedBaselineComparison;
  readonly navigationRequiringCasePresent?: boolean;
}

export interface GateEvaluation {
  readonly gateId: GateId;
  readonly result: GateResult;
  readonly diagnostics: readonly string[];
}

function metricAvailable(evidence: RecordedGateEvidence, metric: MetricId): boolean {
  return evidence.metrics.some((entry) => entry.metric === metric && entry.value !== 'UNAVAILABLE');
}

function metricValue(evidence: RecordedGateEvidence, metric: MetricId): number | undefined {
  const entry = evidence.metrics.find(
    (candidate) => candidate.metric === metric && candidate.value !== 'UNAVAILABLE',
  );
  return entry !== undefined && typeof entry.value === 'number' ? entry.value : undefined;
}

type MutableGateEvidence = {
  -readonly [K in keyof RecordedGateEvidence]: RecordedGateEvidence[K];
};

function decodeCriticalDefects(
  raw: unknown,
  path: string,
): DomainValidationResult<RecordedCriticalDefects> {
  return andThen(asRecord(raw, `${path}.criticalDefects`), (defectRecord) =>
    andThen(rejectUnknownFields(defectRecord, DEFECT_KEYS, `${path}.criticalDefects`), () => {
      const falseSuccess = requireBoolean(
        defectRecord,
        'unresolvedCriticalFalseSuccess',
        `${path}.criticalDefects`,
      );
      const wrongTarget = requireBoolean(
        defectRecord,
        'unresolvedWrongTarget',
        `${path}.criticalDefects`,
      );
      if (!falseSuccess.ok || !wrongTarget.ok) {
        return fail([
          ...(falseSuccess.ok ? [] : falseSuccess.diagnostics),
          ...(wrongTarget.ok ? [] : wrongTarget.diagnostics),
        ]);
      }
      return ok(
        deepFreeze({
          unresolvedCriticalFalseSuccess: falseSuccess.value,
          unresolvedWrongTarget: wrongTarget.value,
        }),
      );
    }),
  );
}

function decodeBaselineComparison(
  raw: unknown,
  path: string,
): DomainValidationResult<RecordedBaselineComparison> {
  return andThen(asRecord(raw, `${path}.baselineComparison`), (comparisonRecord) =>
    andThen(
      rejectUnknownFields(comparisonRecord, COMPARISON_KEYS, `${path}.baselineComparison`),
      (): DomainValidationResult<RecordedBaselineComparison> => {
        const baselineId = requireNonEmptyString(
          comparisonRecord,
          'baselineId',
          `${path}.baselineComparison`,
        );
        const problems: ValidationDiagnostic[] = [];
        if (!baselineId.ok) {
          problems.push(...baselineId.diagnostics);
        }
        const completionRaw = comparisonRecord['correctCompletionDelta'];
        if (typeof completionRaw !== 'number') {
          problems.push(
            diagnostic(
              'MALFORMED_REQUIRED_FIELD',
              `${path}.baselineComparison.correctCompletionDelta`,
              'correctCompletionDelta must be a number',
            ),
          );
        }
        let collectionEffortDelta: number | undefined;
        const effortRaw = comparisonRecord['collectionEffortDelta'];
        if (effortRaw !== undefined) {
          if (typeof effortRaw !== 'number') {
            problems.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                `${path}.baselineComparison.collectionEffortDelta`,
                'collectionEffortDelta must be a number',
              ),
            );
          } else {
            collectionEffortDelta = effortRaw;
          }
        }
        let compensating: boolean | undefined;
        const compensatingRaw = comparisonRecord['compensatingCorrectnessImprovement'];
        if (compensatingRaw !== undefined) {
          const decoded = requireBoolean(
            comparisonRecord,
            'compensatingCorrectnessImprovement',
            `${path}.baselineComparison`,
          );
          if (!decoded.ok) {
            problems.push(...decoded.diagnostics);
          } else {
            compensating = decoded.value;
          }
        }
        let scopeExpansion: boolean | undefined;
        const scopeRaw = comparisonRecord['scopeExpansionObserved'];
        if (scopeRaw !== undefined) {
          if (typeof scopeRaw !== 'boolean') {
            problems.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                `${path}.baselineComparison.scopeExpansionObserved`,
                'scopeExpansionObserved must be a boolean',
              ),
            );
          } else {
            scopeExpansion = scopeRaw;
          }
        }
        let improvementTruth: TruthSource | undefined;
        const truthRaw = comparisonRecord['compensatingImprovementTruth'];
        if (truthRaw !== undefined) {
          const decoded = decodeTruthSource(
            truthRaw,
            `${path}.baselineComparison.compensatingImprovementTruth`,
          );
          if (!decoded.ok) {
            problems.push(...decoded.diagnostics);
          } else {
            improvementTruth = decoded.value;
          }
        }
        if (problems.length > 0) {
          return fail(problems);
        }
        const baselineIdValue = baselineId.ok ? baselineId.value : '';
        return ok(
          deepFreeze({
            baselineId: baselineIdValue,
            correctCompletionDelta: completionRaw as number,
            collectionEffortDelta,
            compensatingCorrectnessImprovement: compensating,
            compensatingImprovementTruth: improvementTruth,
            scopeExpansionObserved: scopeExpansion,
          }),
        );
      },
    ),
  );
}

/**
 * Evaluate one gate from recorded evidence. Fail-closed rule: any missing or
 * unavailable required input yields INSUFFICIENT_EVIDENCE; PASS requires the
 * full PRD §32 PASS-rule conjuncts to hold on that evidence (strict reduction
 * comparators, baseline parity, scope no-regression, critical-defect
 * blocking, confirmation-burden accounting, independent-truth-documented
 * compensation).
 */
export function evaluateGate(evidence: unknown): DomainValidationResult<GateEvaluation> {
  const path = 'gateEvidence';
  return andThen(asRecord(evidence, path), (record) =>
    andThen(rejectUnknownFields(record, EVIDENCE_KEYS, path), () => {
      const gateIdRaw = requireNonEmptyString(record, 'gateId', path);
      if (!gateIdRaw.ok) {
        return gateIdRaw;
      }
      const gateId = makeGateId(gateIdRaw.value);
      if (!gateId.ok) {
        return gateId;
      }
      const definition = GATE_DEFINITIONS.find((gate) => gate.gateId === gateId.value);
      if (definition === undefined) {
        return fail([
          diagnostic(
            'UNKNOWN_ENUM_VALUE',
            `${path}.gateId`,
            `unknown gate id '${gateId.value}'`,
            'PRD-§32',
          ),
        ]);
      }
      const notes: string[] = [];
      const missing = (what: string): GateEvaluation =>
        deepFreeze({
          gateId: gateId.value,
          result: 'INSUFFICIENT_EVIDENCE' as const,
          diagnostics: deepFreeze([...notes, `missing required input: ${what}`]),
        });

      const rawMetrics = record['metrics'];
      if (!Array.isArray(rawMetrics) || rawMetrics.length === 0) {
        return ok(missing('gate metrics'));
      }
      const metrics: { metric: MetricId; value: number | 'UNAVAILABLE' }[] = [];
      type DecodedMetric = { readonly metric: MetricId; readonly value: number | 'UNAVAILABLE' };
      for (const [index, raw] of rawMetrics.entries()) {
        const decoded = andThen(asRecord(raw, `${path}.metrics[${index}]`), (metricRecord) =>
          andThen(
            rejectUnknownFields(metricRecord, METRIC_VALUE_KEYS, `${path}.metrics[${index}]`),
            (): DomainValidationResult<DecodedMetric> => {
              const metricId = requireLiteral(
                metricRecord,
                'metric',
                definition.metrics.map((entry) => entry.metric),
                `${path}.metrics[${index}]`,
              );
              if (!metricId.ok) {
                return metricId;
              }
              const value = metricRecord['value'];
              if (value === 'UNAVAILABLE') {
                return ok(deepFreeze({ metric: metricId.value, value: 'UNAVAILABLE' as const }));
              }
              if (typeof value !== 'number') {
                return fail([
                  diagnostic(
                    'MALFORMED_REQUIRED_FIELD',
                    `${path}.metrics[${index}].value`,
                    'metric value must be a number or UNAVAILABLE',
                  ),
                ]);
              }
              return ok(deepFreeze({ metric: metricId.value, value }));
            },
          ),
        );
        if (!decoded.ok) {
          return decoded;
        }
        metrics.push(decoded.value);
      }
      const evidenceRecord: MutableGateEvidence = {
        gateId: gateId.value,
        metrics,
        baselinePlanRef:
          typeof record['baselinePlanRef'] === 'string' ? record['baselinePlanRef'] : undefined,
      };

      const requireComparison = (): DomainValidationResult<
        RecordedBaselineComparison | undefined
      > => {
        const rawComparison = record['baselineComparison'];
        if (rawComparison === undefined) {
          return ok(undefined);
        }
        return decodeBaselineComparison(rawComparison, path);
      };

      if (gateId.value === 'G0') {
        if (evidenceRecord.baselinePlanRef === undefined) {
          return ok(missing('frozen G0BaselinePlan reference (PRD-§32.2)'));
        }
        const rawCoverage = record['journeyConfirmationCoverage'];
        if (!Array.isArray(rawCoverage)) {
          return ok(missing('journey confirmation coverage'));
        }
        const coverage: {
          readonly journeyId: JourneyId;
          readonly confirmationEvidencePresent: boolean;
        }[] = [];
        const coveredJourneys = new Set<string>();
        for (const [index, raw] of rawCoverage.entries()) {
          const decoded = andThen(
            asRecord(raw, `${path}.journeyConfirmationCoverage[${index}]`),
            (coverageRecord) =>
              andThen(
                rejectUnknownFields(
                  coverageRecord,
                  JOURNEY_COVERAGE_KEYS,
                  `${path}.journeyConfirmationCoverage[${index}]`,
                ),
                () => {
                  const journeyIdRaw = requireNonEmptyString(
                    coverageRecord,
                    'journeyId',
                    `${path}.journeyConfirmationCoverage[${index}]`,
                  );
                  const present = requireBoolean(
                    coverageRecord,
                    'confirmationEvidencePresent',
                    `${path}.journeyConfirmationCoverage[${index}]`,
                  );
                  if (!journeyIdRaw.ok || !present.ok) {
                    const problems: ValidationDiagnostic[] = [
                      ...(journeyIdRaw.ok ? [] : journeyIdRaw.diagnostics),
                      ...(present.ok ? [] : present.diagnostics),
                    ];
                    return fail(problems);
                  }
                  return ok(
                    deepFreeze({
                      journeyId: journeyIdRaw.value as JourneyId,
                      confirmationEvidencePresent: present.value,
                    }),
                  );
                },
              ),
          );
          if (!decoded.ok) {
            return decoded;
          }
          coverage.push(decoded.value);
          coveredJourneys.add(decoded.value.journeyId);
        }
        // G0 PASS rule 1: every required Critical Journey has confirmation evidence.
        for (let i = 1; i <= 9; i += 1) {
          const journeyId = `CJ-${String(i).padStart(2, '0')}`;
          const entry = coverage.find((item) => item.journeyId === journeyId);
          if (entry === undefined || !entry.confirmationEvidencePresent) {
            notes.push(`no confirmation evidence for required journey ${journeyId}`);
          }
        }
        if (!metricAvailable(evidenceRecord, 'CORRECT_COMPLETION')) {
          notes.push('CORRECT_COMPLETION unavailable');
        }
        if (!metricAvailable(evidenceRecord, 'FALSE_SUCCESS_RATE')) {
          notes.push('FALSE_SUCCESS_RATE unavailable');
        }
        const rawDefects = record['criticalDefects'];
        if (rawDefects !== undefined) {
          const decoded = decodeCriticalDefects(rawDefects, path);
          if (!decoded.ok) {
            return decoded;
          }
          evidenceRecord.criticalDefects = decoded.value;
        } else {
          notes.push('critical defect accounting absent');
        }
        const rawComparison = record['baselineComparison'];
        if (rawComparison !== undefined) {
          const decoded = decodeBaselineComparison(rawComparison, path);
          if (!decoded.ok) {
            return decoded;
          }
          if (decoded.value.collectionEffortDelta === undefined) {
            notes.push('baseline comparison missing numeric collectionEffortDelta');
          }
          evidenceRecord.baselineComparison = decoded.value;
        } else {
          notes.push('frozen baseline comparison absent');
        }
        if (notes.length > 0) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze(notes),
            }),
          );
        }
        // G0 PASS rules 2–4 (PRD-§32/G0), evaluated strictly. Rule 4: more
        // collection effort than the frozen baseline is only honorable with a
        // compensating correctness improvement documented by independent truth.
        const defects = evidenceRecord.criticalDefects!;
        const comparison = evidenceRecord.baselineComparison!;
        const failures: string[] = [];
        if (defects.unresolvedCriticalFalseSuccess) {
          failures.push('unresolved critical false-success defect exists (PRD-§32/G0 rule 2)');
        }
        if (defects.unresolvedWrongTarget) {
          failures.push('unresolved critical wrong-target defect exists (PRD-§32/G0 rule 2)');
        }
        if (comparison.correctCompletionDelta < 0) {
          failures.push(
            'correct completion lower than the frozen baseline result (PRD-§32/G0 rule 3)',
          );
        }
        if (comparison.collectionEffortDelta! > 0) {
          const compensated =
            comparison.compensatingCorrectnessImprovement === true &&
            comparison.compensatingImprovementTruth !== undefined;
          if (comparison.compensatingCorrectnessImprovement !== true) {
            failures.push(
              'collection tasks require more active user effort than the frozen baseline without a compensating correctness improvement (PRD-§32/G0 rule 4)',
            );
          } else if (!compensated) {
            failures.push(
              'compensating correctness improvement is not documented by independent truth (PRD-§32/G0 rule 4)',
            );
          }
        }
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: failures.length === 0 ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze(failures),
          }),
        );
      }

      if (gateId.value === 'G1b') {
        const rawNav = record['navigationRequiringCasePresent'];
        if (rawNav === undefined) {
          return ok(missing('navigation-requiring case presence declaration'));
        }
        const navPresent = requireBoolean(record, 'navigationRequiringCasePresent', path);
        if (!navPresent.ok) {
          return navPresent;
        }
        // PRD-§32/G1b: no navigation-requiring confirmation case → INSUFFICIENT_EVIDENCE.
        if (!navPresent.value) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze([
                'no navigation-requiring S6 confirmation case exists; S6 must be narrowed before release',
              ]),
            }),
          );
        }
        // PRD-§32/G1b conjuncts: strict effort/time reduction, no correctness
        // regression, no scope expansion. Every conjunct needs its input.
        if (!metricAvailable(evidenceRecord, 'NAVIGATION_EFFORT_REDUCTION')) {
          notes.push('NAVIGATION_EFFORT_REDUCTION unavailable');
        }
        if (!metricAvailable(evidenceRecord, 'CORRECT_COMPLETION')) {
          notes.push('CORRECT_COMPLETION unavailable');
        }
        const comparisonResult = requireComparison();
        if (!comparisonResult.ok) {
          return comparisonResult;
        }
        const comparison = comparisonResult.value;
        if (comparison === undefined) {
          notes.push('baseline comparison absent (correctness-regression parity required)');
        } else {
          evidenceRecord.baselineComparison = comparison;
          if (comparison.scopeExpansionObserved === undefined) {
            notes.push('scopeExpansionObserved absent (PRD-§32/G1b no scope expansion)');
          }
        }
        if (notes.length > 0) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze(notes),
            }),
          );
        }
        const failures: string[] = [];
        const effortDelta = metricValue(evidenceRecord, 'NAVIGATION_EFFORT_REDUCTION')!;
        if (effortDelta <= 0) {
          failures.push(
            'NAVIGATION_EFFORT_REDUCTION is not a strict reduction; PASS requires > 0 (PRD-§32/G1b)',
          );
        }
        if (comparison!.correctCompletionDelta < 0) {
          failures.push('correctness regression vs baseline comparison (PRD-§32/G1b)');
        }
        if (comparison!.scopeExpansionObserved !== false) {
          failures.push('scope expansion observed; PRD-§32/G1b forbids scope expansion');
        }
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: failures.length === 0 ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze(failures),
          }),
        );
      }

      if (gateId.value === 'G1a' || gateId.value === 'G1c') {
        // Reduction/parity gates with per-conjunct inputs (PRD-§32/G1a, §32/G1c).
        for (const defined of definition.metrics) {
          if (!metricAvailable(evidenceRecord, defined.metric)) {
            notes.push(`${defined.metric} unavailable`);
          }
        }
        if (gateId.value === 'G1a') {
          // G1a parity conjunct: correct completion not lower than baseline.
          const comparisonResult = requireComparison();
          if (!comparisonResult.ok) {
            return comparisonResult;
          }
          const comparison = comparisonResult.value;
          if (comparison === undefined) {
            notes.push('baseline comparison absent (correct-completion parity required)');
          } else {
            evidenceRecord.baselineComparison = comparison;
          }
        }
        if (notes.length > 0) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze(notes),
            }),
          );
        }
        const failures: string[] = [];
        if (gateId.value === 'G1a') {
          const comparison = evidenceRecord.baselineComparison!;
          const effortDelta = metricValue(evidenceRecord, 'BATCH_EFFORT_REDUCTION')!;
          const falseSuccess = metricValue(evidenceRecord, 'FALSE_SUCCESS_RATE')!;
          if (effortDelta <= 0) {
            failures.push(
              'BATCH_EFFORT_REDUCTION is not a strict reduction; PASS requires > 0 (PRD-§32/G1a)',
            );
          }
          if (comparison.correctCompletionDelta < 0) {
            failures.push('correct completion lower than the baseline comparison (PRD-§32/G1a)');
          }
          if (falseSuccess > 0) {
            failures.push('new critical false-success present (PRD-§32/G1a)');
          }
        } else {
          const effortDelta = metricValue(evidenceRecord, 'SELECTION_EFFORT_REDUCTION')!;
          const wrongTarget = metricValue(evidenceRecord, 'WRONG_TARGET_RATE')!;
          if (effortDelta <= 0) {
            failures.push(
              'SELECTION_EFFORT_REDUCTION is not a strict reduction; PASS requires > 0 (PRD-§32/G1c)',
            );
          }
          if (wrongTarget > 0) {
            failures.push('wrong-target rate increased (PRD-§32/G1c)');
          }
        }
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: failures.length === 0 ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze(failures),
          }),
        );
      }

      if (gateId.value === 'G2') {
        // PRD-§32/G2: incremental correctly resolved hard tasks, no critical
        // false-success increase, independent target truth.
        if (!metricAvailable(evidenceRecord, 'CORRECT_COMPLETION')) {
          notes.push('CORRECT_COMPLETION unavailable');
        }
        const rawDefects = record['criticalDefects'];
        if (rawDefects === undefined) {
          notes.push('critical defect accounting absent (PRD-§32/G2 no critical false-success)');
        } else {
          const decoded = decodeCriticalDefects(rawDefects, path);
          if (!decoded.ok) {
            return decoded;
          }
          evidenceRecord.criticalDefects = decoded.value;
        }
        if (notes.length > 0) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze(notes),
            }),
          );
        }
        const defects = evidenceRecord.criticalDefects!;
        const failures: string[] = [];
        if (defects.unresolvedCriticalFalseSuccess) {
          failures.push('critical false-success increase not excluded (PRD-§32/G2)');
        }
        if (defects.unresolvedWrongTarget) {
          failures.push(
            'unresolved wrong-target defect contradicts independent target truth (PRD-§32/G2, fail-closed)',
          );
        }
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: failures.length === 0 ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze(failures),
          }),
        );
      }

      if (gateId.value === 'G3') {
        // PRD-§32/G3: reduces model use, active time or repair effort while
        // correctness and scope do not regress. Strict fail-closed reading:
        // all three reduction dimensions must be measured; PASS requires a
        // strict reduction in at least one of them plus no correctness/scope
        // regression against the recorded baseline comparison.
        for (const defined of definition.metrics) {
          if (!metricAvailable(evidenceRecord, defined.metric)) {
            notes.push(`${defined.metric} unavailable`);
          }
        }
        const comparisonResult = requireComparison();
        if (!comparisonResult.ok) {
          return comparisonResult;
        }
        const comparison = comparisonResult.value;
        if (comparison === undefined) {
          notes.push('baseline comparison absent (correctness/scope no-regression required)');
        } else {
          evidenceRecord.baselineComparison = comparison;
          if (comparison.scopeExpansionObserved === undefined) {
            notes.push('scopeExpansionObserved absent (PRD-§32/G3 scope no-regression)');
          }
        }
        if (notes.length > 0) {
          return ok(
            deepFreeze({
              gateId: gateId.value,
              result: 'INSUFFICIENT_EVIDENCE',
              diagnostics: deepFreeze(notes),
            }),
          );
        }
        const failures: string[] = [];
        const reductions = [
          metricValue(evidenceRecord, 'MODEL_USE_REDUCTION')!,
          metricValue(evidenceRecord, 'ACTIVE_USER_TIME_REDUCTION')!,
          metricValue(evidenceRecord, 'REPAIR_EFFORT_REDUCTION')!,
        ];
        if (!reductions.some((delta) => delta > 0)) {
          failures.push(
            'no strict reduction in model use, active time or repair effort (PRD-§32/G3)',
          );
        }
        if (comparison!.correctCompletionDelta < 0) {
          failures.push('correctness regression vs baseline comparison (PRD-§32/G3)');
        }
        if (comparison!.scopeExpansionObserved !== false) {
          failures.push('scope regression observed (PRD-§32/G3)');
        }
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: failures.length === 0 ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze(failures),
          }),
        );
      }

      // G1d (and any gate without specialization): availability of its
      // defined metrics with fail-closed defaults.
      for (const defined of definition.metrics) {
        if (!metricAvailable(evidenceRecord, defined.metric)) {
          notes.push(`${defined.metric} unavailable`);
        }
      }
      if (notes.length > 0) {
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: 'INSUFFICIENT_EVIDENCE',
            diagnostics: deepFreeze(notes),
          }),
        );
      }
      return ok(
        deepFreeze({
          gateId: gateId.value,
          result: 'PASS',
          diagnostics: deepFreeze([]),
        }),
      );
    }),
  );
}

export interface GateStatusEntry {
  readonly gateId: GateId;
  readonly status: GateStatus;
  readonly note: string;
}

/**
 * The standing gate status on the exact T003 candidate: every gate NOT_RUN.
 * No PASS/FAIL is claimed or foreshadowed for any real gate (Task Pack
 * Acceptance; FAILURE_MATRIX `gate-pass-claim`).
 */
export function gateStatusBoard(): readonly GateStatusEntry[] {
  return GATE_DEFINITIONS.map((gate) =>
    deepFreeze({
      gateId: gate.gateId,
      status: 'NOT_RUN' as const,
      note: 'T003 builds instrumentation only; execution belongs to version-level Validation on the T019 candidate',
    }),
  );
}
