/**
 * T003 harness self-test fixtures. Builders return RAW plain objects so
 * every test exercises the untrusted-input decode path, matching the T002
 * test conventions.
 */

import {
  loadCorpusRegistry,
  loadJourneyRegistry,
  loadOracleCorpus,
  registerG0BaselinePlan,
  freezeG0BaselinePlan,
  type CorpusRegistry,
  type FrozenG0BaselinePlan,
  type OracleCorpus,
  type JourneyRegistry,
} from '../src/index.ts';
import { corpusRegistryRecords } from '../src/index.ts';
import { oracleCorpusRecords } from '../src/index.ts';
import { journeyRegistryRecords } from '../src/index.ts';
import { unwrapOrThrow, type DomainValidationResult } from '@xdownload/domain-contracts';

export const PRIMARY_G0_PLAN_ID = 'g0-plan/v0.1.0-primary';

/** Load the full shipped corpus registry (frozen PRD §33 data). */
export function loadedCorpusRegistry(): CorpusRegistry {
  return unwrapOrThrow(loadCorpusRegistry(corpusRegistryRecords()));
}

/** Load the full shipped C01–C34 oracle corpus bound to the corpus registry. */
export function loadedOracleCorpus(
  registry: CorpusRegistry = loadedCorpusRegistry(),
): OracleCorpus {
  return unwrapOrThrow(
    loadOracleCorpus(oracleCorpusRecords(), registry, {
      knownG0PlanIds: [PRIMARY_G0_PLAN_ID],
    }),
  );
}

/** Load the full shipped CJ-01..CJ-09 journey registry bound to the corpus registry. */
export function loadedJourneyRegistry(
  registry: CorpusRegistry = loadedCorpusRegistry(),
): JourneyRegistry {
  return unwrapOrThrow(loadJourneyRegistry(journeyRegistryRecords(), registry));
}

/** The canonical valid G0BaselinePlan raw record (PRD §32.2). */
export function rawG0BaselinePlan(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    g0_baseline_plan_id: PRIMARY_G0_PLAN_ID,
    candidate_baseline_registry: [
      {
        baselineId: 'baseline/browser-native',
        version: '1.0.0',
        configurationDigest: 'digest-browser-native-v1',
        workflowAssumptions: 'manual per-file download in a standard browser',
      },
      {
        baselineId: 'baseline/yt-dlp',
        version: '2026.09.14',
        configurationDigest: 'digest-yt-dlp-v1',
        workflowAssumptions: 'cli invocation with default format selection',
      },
    ],
    support_slice_or_task_class_rules: [
      'S1: browser-native, yt-dlp',
      'S5/S6: browser-native, yt-dlp',
    ],
    applicability_criteria: [
      'same task shape',
      'same requested scope',
      'same authorization assumptions',
    ],
    baseline_selection_rule: {
      kind: 'PHASE_A_DETERMINISTIC',
      precedence: [
        'CORRECT_COMPLETION_DESC',
        'ACTIVE_USER_TIME_ASC',
        'MANUAL_ACTIONS_ASC',
        'BASELINE_ID_LEXICAL',
      ],
    },
    fixed_comparison_sets_if_any: [],
    baseline_version_or_identity: 'baseline-registry@2026-10-04',
    configuration_profile_assumptions: ['default profiles', 'no acceleration plugins'],
    same_task_same_auth_same_scope_constraints: [
      'identical task set',
      'identical auth context',
      'identical scope',
    ],
    metric_aggregation_rule: undefined,
    tie_break_rule: 'LEXICAL_BASELINE_ID',
    frozen_at: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

/** A frozen canonical plan for tamper/immutability tests. */
export function frozenG0Plan(overrides: Record<string, unknown> = {}): FrozenG0BaselinePlan {
  const draft = unwrapOrThrow(registerG0BaselinePlan(rawG0BaselinePlan(overrides)));
  return freezeG0BaselinePlan(draft);
}

/** A valid raw evidence record (PRD §20 claim model). */
export function rawEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    evidenceId: 'evidence/t003-001',
    claimType: 'RESOURCE_IDENTITY',
    claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-fixture-001' },
    sourceType: 'INDEPENDENT_VALIDATOR',
    provenance: { sourceIdentity: 'validator/t003-oracle-001' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'BATCH_DOWNLOAD' },
    certaintyClass: 'DECISIVE',
    ...overrides,
  };
}

/** A valid raw G0 gate-evidence record with all required inputs present. */
export function rawG0Evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const coverage = [
    'CJ-01',
    'CJ-02',
    'CJ-03',
    'CJ-04',
    'CJ-05',
    'CJ-06',
    'CJ-07',
    'CJ-08',
    'CJ-09',
  ].map((journeyId) => ({ journeyId, confirmationEvidencePresent: true }));
  return {
    gateId: 'G0',
    baselinePlanRef: PRIMARY_G0_PLAN_ID,
    journeyConfirmationCoverage: coverage,
    metrics: [
      { metric: 'CORRECT_COMPLETION', value: 0.9 },
      { metric: 'ACTIVE_USER_TIME', value: 120_000 },
      { metric: 'MANUAL_ACTIONS', value: 3 },
      { metric: 'RECOVERY_EFFORT', value: 1 },
      { metric: 'FALSE_SUCCESS_RATE', value: 0 },
    ],
    criticalDefects: { unresolvedCriticalFalseSuccess: false, unresolvedWrongTarget: false },
    baselineComparison: {
      baselineId: 'baseline/yt-dlp',
      correctCompletionDelta: 0,
      collectionEffortDelta: 0,
    },
    ...overrides,
  };
}

/** A valid raw §32.1 task-run record. */
export function rawRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sampleUnit: 'END_TO_END_ACQUISITION_TASK',
    taskCaseId: 'natural/s5-current-page-collection',
    runId: 'run-001',
    outcome: 'SUCCESS',
    truthAvailable: true,
    truthSource: { kind: 'PRE_REGISTERED_AUTHORITATIVE_METADATA', ref: 'PRD-§32.1' },
    ...overrides,
  };
}

/** Unwrap or fail the test. */
export function decodeOk<T>(result: DomainValidationResult<T>): T {
  return unwrapOrThrow(result);
}
