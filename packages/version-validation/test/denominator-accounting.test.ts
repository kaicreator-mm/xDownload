/**
 * TEST_MATRIX suite `denominator-accounting` (frozen PRD §32.1; C32).
 */
import { describe, expect, it } from 'vitest';
import {
  assertDenominatorInvariants,
  classifyTaskRun,
  computeDenominator,
  computeDenominatorFromRaw,
  decodeTaskRunRecord,
  SAMPLE_UNIT,
  type TaskRunRecord,
} from '../src/index.ts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';

const PRD_TRUTH = { kind: 'PRE_REGISTERED_AUTHORITATIVE_METADATA', ref: 'PRD-§32.1' } as const;

function rawRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sampleUnit: SAMPLE_UNIT,
    taskCaseId: 'natural/s5-current-page-collection',
    runId: 'run-001',
    outcome: 'SUCCESS',
    truthAvailable: true,
    truthSource: PRD_TRUTH,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): TaskRunRecord {
  return unwrapOrThrow(decodeTaskRunRecord(rawRun(overrides)));
}

describe('denominator accounting — sample unit (PRD §32.1)', () => {
  it('the sample unit is one end-to-end task; per-file counting is unrepresentable', () => {
    expect(run().sampleUnit).toBe('END_TO_END_ACQUISITION_TASK');
    const rejected = decodeTaskRunRecord(rawRun({ sampleUnit: 'DOWNLOADED_FILE' }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.invariant).toBe('PRD-§32.1');
    }
  });
});

describe('denominator accounting — success requires independent pre-registered truth (C34)', () => {
  it('a success without available truth is rejected as self-certification', () => {
    const rejected = decodeTaskRunRecord(rawRun({ truthAvailable: false, truthSource: undefined }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('SELF_CERTIFICATION');
      expect(rejected.diagnostics[0]!.invariant).toBe('C34/PRD-§32.1');
    }
  });

  it('a success whose truth source is missing is rejected', () => {
    const raw = rawRun();
    delete raw['truthSource'];
    expect(decodeTaskRunRecord(raw).ok).toBe(false);
  });

  it('a success with an unregistered/self-generated truth kind is rejected', () => {
    const rejected = decodeTaskRunRecord(
      rawRun({ truthSource: { kind: 'UI_SUGGESTION', ref: 'ui/label' } }),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('SELF_CERTIFICATION');
    }
  });
});

describe('denominator accounting — §32.1 rule truth table (C32)', () => {
  it('success counts once per end-to-end task in the primary denominator', () => {
    const report = computeDenominator([
      run({ runId: 'r1' }),
      run({ runId: 'r2', outcome: 'FAILED', truthSource: PRD_TRUTH }),
    ]);
    expect(report.primaryDenominator).toBe(2);
    expect(report.successes).toBe(1);
    expect(report.failures).toBe(1);
  });

  it('out-of-scope tasks are excluded from the primary denominator but reported', () => {
    const report = computeDenominator([
      run({ runId: 'r1' }),
      run({ runId: 'r2', outcome: 'OUT_OF_SCOPE' }),
    ]);
    expect(report.primaryDenominator).toBe(1);
    expect(report.successes).toBe(1);
    expect(report.outOfScope).toBe(1);
    expect(assertDenominatorInvariants(report).ok).toBe(true);
  });

  it('scope-classification errors count against scope/UX correctness', () => {
    const report = computeDenominator([
      run({ runId: 'r2', outcome: 'OUT_OF_SCOPE', scopeClassificationError: true }),
    ]);
    expect(report.outOfScope).toBe(1);
    expect(report.scopeClassificationErrors).toBe(1);
    expect(report.primaryDenominator).toBe(0);
  });

  it('UNKNOWN is not success and remains in the denominator when truth is available', () => {
    const report = computeDenominator([
      run({ runId: 'r1', outcome: 'UNKNOWN', truthSource: PRD_TRUTH }),
    ]);
    expect(report.unknownInDenominator).toBe(1);
    expect(report.successes).toBe(0);
    expect(report.primaryDenominator).toBe(1);
    expect(report.insufficientEvidence).toBe(0);
  });

  it('UNKNOWN with unavailable independent truth moves to INSUFFICIENT_EVIDENCE (out of denominator, reported)', () => {
    const report = computeDenominator([
      run({ runId: 'r1', outcome: 'UNKNOWN', truthAvailable: false, truthSource: undefined }),
    ]);
    expect(report.insufficientEvidence).toBe(1);
    expect(report.unknownInDenominator).toBe(0);
    expect(report.primaryDenominator).toBe(0);
    expect(report.successes).toBe(0);
  });

  it('friction-caused abandonment is a non-success in the denominator', () => {
    const report = computeDenominator([
      run({
        runId: 'r1',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'XDOWNLOAD_FRICTION' },
      }),
    ]);
    expect(report.abandonmentNonSuccess).toBe(1);
    expect(report.primaryDenominator).toBe(1);
    expect(report.successes).toBe(0);
  });

  it('external cancellation is excluded only with a pre-recorded reason', () => {
    const excluded = computeDenominator([
      run({
        runId: 'r1',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'EXTERNAL_UNRELATED', reasonPreRecorded: true },
      }),
    ]);
    expect(excluded.externalCancellationsExcluded).toBe(1);
    expect(excluded.primaryDenominator).toBe(0);

    const notExcluded = computeDenominator([
      run({
        runId: 'r1',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'EXTERNAL_UNRELATED', reasonPreRecorded: false },
      }),
    ]);
    expect(notExcluded.externalCancellationsExcluded).toBe(0);
    expect(notExcluded.abandonmentNonSuccess).toBe(1);
    expect(notExcluded.primaryDenominator).toBe(1);
  });

  it('repeated runs of the same unchanged task are not independent sample units', () => {
    const report = computeDenominator([
      run({ runId: 'r1' }),
      run({ runId: 'r1-retry', repeatOf: { priorRunId: 'r1', taskUnchanged: true } }),
      run({ runId: 'r2', repeatOf: { priorRunId: 'r1', taskUnchanged: false } }),
    ]);
    expect(report.repeatedRuns).toBe(1);
    expect(report.primaryDenominator).toBe(2);
    expect(report.successes).toBe(2);
  });

  it('the canonical C32 mixed confirmation set applies every rule exactly', () => {
    const report = computeDenominator([
      run({ runId: 'c32-1' }), // success
      run({ runId: 'c32-2', outcome: 'FAILED', truthSource: PRD_TRUTH }), // failure
      run({
        runId: 'c32-3',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'XDOWNLOAD_FRICTION' },
      }), // friction abandonment
      run({ runId: 'c32-4', outcome: 'UNKNOWN', truthSource: PRD_TRUTH }), // unknown in denominator
      run({ runId: 'c32-5', outcome: 'OUT_OF_SCOPE' }), // out of scope
      run({
        runId: 'c32-6',
        outcome: 'UNKNOWN',
        truthAvailable: false,
        truthSource: undefined,
      }), // insufficient evidence
      run({ runId: 'c32-7', repeatOf: { priorRunId: 'c32-1', taskUnchanged: true } }), // repeated
      run({
        runId: 'c32-8',
        outcome: 'ABANDONED',
        truthAvailable: false,
        truthSource: undefined,
        abandonment: { cause: 'EXTERNAL_UNRELATED', reasonPreRecorded: true },
      }), // excluded external cancellation
    ]);
    expect(report.primaryDenominator).toBe(4);
    expect(report.successes).toBe(1);
    expect(report.failures).toBe(1);
    expect(report.unknownInDenominator).toBe(1);
    expect(report.abandonmentNonSuccess).toBe(1);
    expect(report.outOfScope).toBe(1);
    expect(report.insufficientEvidence).toBe(1);
    expect(report.repeatedRuns).toBe(1);
    expect(report.externalCancellationsExcluded).toBe(1);
    expect(assertDenominatorInvariants(report).ok).toBe(true);
  });
});

describe('denominator accounting — fail-closed decode rules', () => {
  it('an abandoned outcome must record its abandonment cause', () => {
    const rejected = decodeTaskRunRecord(
      rawRun({ outcome: 'ABANDONED', truthAvailable: false, truthSource: undefined }),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  it('an abandonment cause on a non-abandoned outcome is rejected', () => {
    const rejected = decodeTaskRunRecord(rawRun({ abandonment: { cause: 'XDOWNLOAD_FRICTION' } }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('INVALID_RESULT_COMBINATION');
    }
  });

  it('an unknown outcome literal is rejected', () => {
    const rejected = decodeTaskRunRecord(rawRun({ outcome: 'MOSTLY_FINE' }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]!.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('an unknown field on a run record is rejected', () => {
    const rejected = decodeTaskRunRecord(rawRun({ injected: true }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((d) => d.code === 'UNKNOWN_FIELD')).toBe(true);
    }
  });

  it('raw aggregation from untrusted records fails closed on any malformed record', () => {
    const result = computeDenominatorFromRaw([rawRun({ runId: 'ok-1' }), { garbage: true }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]!.path.startsWith('taskRuns[1].')).toBe(true);
    }
  });

  it('classification is total and deterministic for every class', () => {
    const classes = new Set([
      classifyTaskRun(run({ runId: 'a' })),
      classifyTaskRun(run({ runId: 'b', outcome: 'FAILED', truthSource: PRD_TRUTH })),
      classifyTaskRun(run({ runId: 'c', outcome: 'UNKNOWN', truthSource: PRD_TRUTH })),
      classifyTaskRun(
        run({ runId: 'd', outcome: 'UNKNOWN', truthAvailable: false, truthSource: undefined }),
      ),
      classifyTaskRun(
        run({
          runId: 'e',
          outcome: 'ABANDONED',
          truthAvailable: false,
          truthSource: undefined,
          abandonment: { cause: 'XDOWNLOAD_FRICTION' },
        }),
      ),
      classifyTaskRun(run({ runId: 'f', outcome: 'OUT_OF_SCOPE' })),
      classifyTaskRun(run({ runId: 'g', repeatOf: { priorRunId: 'a', taskUnchanged: true } })),
      classifyTaskRun(
        run({
          runId: 'h',
          outcome: 'ABANDONED',
          truthAvailable: false,
          truthSource: undefined,
          abandonment: { cause: 'EXTERNAL_UNRELATED', reasonPreRecorded: true },
        }),
      ),
    ]);
    expect(classes.size).toBe(8);
  });
});
