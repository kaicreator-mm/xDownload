/**
 * T003 gate instrumentation for G0 and G1a–G1d (frozen PRD §32) plus the
 * §34 ablation layer definitions for collection value attribution.
 *
 * Metric definitions and PASS-rule evaluators consume recorded evidence.
 * Evaluators fail closed: missing or insufficient confirmation evidence
 * yields FAIL or INSUFFICIENT_EVIDENCE, never PASS. Every real gate result
 * on the T003 candidate remains NOT_RUN — evaluation executes only later,
 * against a product candidate, in Validation owned by T020–T023.
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
  | 'CONFIRMATION_BURDEN';

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
    metrics: [metric('CORRECT_COMPLETION', 'correctness and scope do not regress', 'rate')],
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
];
const JOURNEY_COVERAGE_KEYS: readonly string[] = ['journeyId', 'confirmationEvidencePresent'];

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
  readonly criticalDefects?: {
    readonly unresolvedCriticalFalseSuccess: boolean;
    readonly unresolvedWrongTarget: boolean;
  };
  readonly baselineComparison?: {
    readonly baselineId: string;
    readonly correctCompletionDelta: number;
    readonly collectionEffortDelta: number;
    readonly compensatingCorrectnessImprovement?: boolean;
  };
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

/**
 * Evaluate one gate from recorded evidence. Fail-closed rule: any missing or
 * unavailable required input yields INSUFFICIENT_EVIDENCE; PASS requires the
 * full PRD §32 PASS-rule inputs to hold.
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
      const evidenceRecord: {
        -readonly [K in keyof RecordedGateEvidence]: RecordedGateEvidence[K];
      } = {
        gateId: gateId.value,
        metrics,
        baselinePlanRef:
          typeof record['baselinePlanRef'] === 'string' ? record['baselinePlanRef'] : undefined,
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
          const decoded = andThen(asRecord(rawDefects, `${path}.criticalDefects`), (defectRecord) =>
            andThen(
              rejectUnknownFields(defectRecord, DEFECT_KEYS, `${path}.criticalDefects`),
              () => {
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
              },
            ),
          );
          if (!decoded.ok) {
            return decoded;
          }
          evidenceRecord.criticalDefects = decoded.value;
        } else {
          notes.push('critical defect accounting absent');
        }
        const rawComparison = record['baselineComparison'];
        if (rawComparison !== undefined) {
          const decoded = andThen(
            asRecord(rawComparison, `${path}.baselineComparison`),
            (comparisonRecord) =>
              andThen(
                rejectUnknownFields(
                  comparisonRecord,
                  COMPARISON_KEYS,
                  `${path}.baselineComparison`,
                ),
                () => {
                  const baselineId = requireNonEmptyString(
                    comparisonRecord,
                    'baselineId',
                    `${path}.baselineComparison`,
                  );
                  const completionDelta = comparisonRecord['correctCompletionDelta'];
                  const effortDelta = comparisonRecord['collectionEffortDelta'];
                  if (
                    !baselineId.ok ||
                    typeof completionDelta !== 'number' ||
                    typeof effortDelta !== 'number'
                  ) {
                    return fail([
                      diagnostic(
                        'MALFORMED_REQUIRED_FIELD',
                        `${path}.baselineComparison`,
                        'baseline comparison requires baselineId and numeric deltas',
                      ),
                    ]);
                  }
                  let compensating: boolean | undefined;
                  if (comparisonRecord['compensatingCorrectnessImprovement'] !== undefined) {
                    const decodedCompensating = requireBoolean(
                      comparisonRecord,
                      'compensatingCorrectnessImprovement',
                      `${path}.baselineComparison`,
                    );
                    if (!decodedCompensating.ok) {
                      return decodedCompensating;
                    }
                    compensating = decodedCompensating.value;
                  }
                  return ok(
                    deepFreeze({
                      baselineId: baselineId.value,
                      correctCompletionDelta: completionDelta,
                      collectionEffortDelta: effortDelta,
                      compensatingCorrectnessImprovement: compensating,
                    }),
                  );
                },
              ),
          );
          if (!decoded.ok) {
            return decoded;
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
        const defects = evidenceRecord.criticalDefects!;
        const comparison = evidenceRecord.baselineComparison!;
        const pass =
          !defects.unresolvedCriticalFalseSuccess &&
          !defects.unresolvedWrongTarget &&
          comparison.correctCompletionDelta >= 0 &&
          (comparison.collectionEffortDelta <= 0 ||
            comparison.compensatingCorrectnessImprovement === true);
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: pass ? 'PASS' : 'FAIL',
            diagnostics: deepFreeze([]),
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
        if (!metricAvailable(evidenceRecord, 'NAVIGATION_EFFORT_REDUCTION')) {
          return ok(missing('NAVIGATION_EFFORT_REDUCTION'));
        }
        const effortDelta = metricValue(evidenceRecord, 'NAVIGATION_EFFORT_REDUCTION')!;
        return ok(
          deepFreeze({
            gateId: gateId.value,
            result: effortDelta < 0 ? 'FAIL' : 'PASS',
            diagnostics: deepFreeze([]),
          }),
        );
      }

      // G1a / G1c / G1d / G2 / G3: reduction/parity metrics with fail-closed defaults.
      const requiredMetrics = definition.metrics
        .filter((entry) => entry.metric !== 'CONFIRMATION_BURDEN')
        .map((entry) => entry.metric);
      for (const required of requiredMetrics) {
        if (!metricAvailable(evidenceRecord, required)) {
          notes.push(`${required} unavailable`);
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
      let pass = true;
      for (const entry of evidenceRecord.metrics) {
        if (entry.value === 'UNAVAILABLE') {
          pass = false;
          continue;
        }
        if (
          (entry.metric === 'BATCH_EFFORT_REDUCTION' ||
            entry.metric === 'NAVIGATION_EFFORT_REDUCTION' ||
            entry.metric === 'SELECTION_EFFORT_REDUCTION') &&
          entry.value <= 0
        ) {
          pass = false;
        }
        if (entry.metric === 'WRONG_TARGET_RATE' && entry.value > 0) {
          pass = false;
        }
        if (entry.metric === 'FALSE_SUCCESS_RATE' && entry.value > 0) {
          pass = false;
        }
      }
      return ok(
        deepFreeze({
          gateId: gateId.value,
          result: pass ? 'PASS' : 'FAIL',
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
