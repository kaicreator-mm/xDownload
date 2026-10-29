/**
 * #91 — successor T003 oracle protocol.
 *
 * The historical registry remains unchanged; these tests exercise only the
 * additive successor freeze/evaluation layer.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateCJ08Behavior,
  freezeSuccessorJourneyOracle,
  journeyRegistryRecords,
  stableDigest,
  T003_SUCCESSOR_ORACLE_PROTOCOL_DIGEST,
  T003_SUCCESSOR_ORACLE_PROTOCOL_ID,
} from '../src/index.ts';
import { loadedJourneyRegistry } from './helpers.ts';

function expectations(
  ids: readonly string[],
  result: 'VALIDATED' | 'VALIDATION_FAILED' | 'NOT_VALIDATED' = 'VALIDATED',
) {
  return ids.map((memberId) => ({ memberId, expectedResult: result }));
}

function freeze(journeyId: string, ids: readonly string[], expected = expectations(ids)) {
  const journey = loadedJourneyRegistry().byId(journeyId)!;
  return freezeSuccessorJourneyOracle(
    {
      oracleId: `successor/${journeyId.toLowerCase()}/fresh-001`,
      journeyId,
      taskCaseId: journey.corpusRef.taskCaseId,
      selectedMemberIds: ids,
      expectedMemberValidation: expected,
    },
    journey,
  );
}

describe('T003 successor oracle protocol identity and history preservation', () => {
  it('has a deterministic protocol identity/digest and does not rewrite the historical registry', () => {
    const before = stableDigest(journeyRegistryRecords());
    expect(T003_SUCCESSOR_ORACLE_PROTOCOL_ID).toBe('t003-successor-oracle/v0.1.0-r1');
    expect(T003_SUCCESSOR_ORACLE_PROTOCOL_DIGEST).toHaveLength(64);
    expect(stableDigest(journeyRegistryRecords())).toBe(before);

    const historicalCj08 = loadedJourneyRegistry().byId('CJ-08')!;
    expect(historicalCj08.expectedResultStatuses.targetResolution).toBe('BLOCKED');
    expect(historicalCj08.expectedResultStatuses.stopReason).toBe('NO_PROGRESS');
  });

  it('freezes exact selected identities and independent expected truth into the oracle digest', () => {
    const ids = ['member-001', 'member-002', 'member-003'];
    const first = freeze('CJ-04', ids);
    const second = freeze('CJ-04', ids);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.oracleDigest).toBe(second.value.oracleDigest);
      expect(Object.isFrozen(first.value)).toBe(true);
      expect(Object.isFrozen(first.value.selectedMemberIds)).toBe(true);
    }
  });
});

describe('member-scale terminal expectations are derived from pre-registered identities', () => {
  it('covers a one-member all-passed control', () => {
    const result = freeze('CJ-01', ['single-001']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expectedTerminal?.validationSummary).toEqual({
        status: 'ALL_PASSED',
        passedCount: 1,
        failedCount: 0,
      });
    }
  });

  it('covers a three-member all-passed control without the historical fixed 1/0 count', () => {
    const ids = ['m-1', 'm-2', 'm-3'];
    const result = freeze('CJ-04', ids);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expectedTerminal?.validationSummary).toEqual({
        status: 'ALL_PASSED',
        passedCount: 3,
        failedCount: 0,
      });
    }
  });

  it('covers a four-member partial failure control', () => {
    const ids = ['m-1', 'm-2', 'm-3', 'm-4'];
    const result = freeze('CJ-04', ids, [
      { memberId: 'm-1', expectedResult: 'VALIDATED' },
      { memberId: 'm-2', expectedResult: 'VALIDATED' },
      { memberId: 'm-3', expectedResult: 'VALIDATED' },
      { memberId: 'm-4', expectedResult: 'VALIDATION_FAILED' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expectedTerminal?.validationSummary).toEqual({
        status: 'PARTIAL',
        passedCount: 3,
        failedCount: 1,
      });
    }
  });

  it('covers all-failed and unproven evidence controls', () => {
    const failed = freeze(
      'CJ-04',
      ['m-1', 'm-2', 'm-3'],
      expectations(['m-1', 'm-2', 'm-3'], 'VALIDATION_FAILED'),
    );
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.expectedTerminal?.validationSummary).toEqual({
        status: 'FAILED',
        passedCount: 0,
        failedCount: 3,
      });
    }

    const unproven = freeze(
      'CJ-04',
      ['m-1', 'm-2', 'm-3', 'm-4'],
      [
        { memberId: 'm-1', expectedResult: 'VALIDATED' },
        { memberId: 'm-2', expectedResult: 'VALIDATED' },
        { memberId: 'm-3', expectedResult: 'VALIDATED' },
        { memberId: 'm-4', expectedResult: 'NOT_VALIDATED' },
      ],
    );
    expect(unproven.ok).toBe(true);
    if (unproven.ok) {
      expect(unproven.value.expectedTerminal?.validationSummary).toEqual({
        status: 'INSUFFICIENT_EVIDENCE',
        passedCount: 3,
        failedCount: 0,
      });
    }
  });
});

describe('CJ-08 successor uses behavioral fail-closed predicates, not an impossible terminal tuple', () => {
  it('freezes CJ-08 without expectedTerminal and with the behavioral oracle contract', () => {
    const result = freeze('CJ-08', []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expectedTerminal).toBeUndefined();
      expect(result.value.cj08BehavioralOracle?.terminalTupleRequired).toBe(false);
      expect(result.value.cj08BehavioralOracle?.mode).toBe('BEHAVIORAL_PRE_TERMINAL');
    }
  });

  it('passes the fail-closed path when stale assumptions are rejected before acquisition', () => {
    expect(
      evaluateCJ08Behavior({
        staleAssumptionRejected: true,
        silentStaleTargetReuse: false,
        silentStaleMembershipReuse: false,
        acquisitionStartedBeforeRepairOrConfirmation: false,
        boundedRepairOrUserConfirmationOffered: true,
      }),
    ).toEqual({ verdict: 'PASS', violations: [] });
  });

  it('fails silent reuse, premature acquisition and missing bounded repair independently', () => {
    const result = evaluateCJ08Behavior({
      staleAssumptionRejected: false,
      silentStaleTargetReuse: true,
      silentStaleMembershipReuse: true,
      acquisitionStartedBeforeRepairOrConfirmation: true,
      boundedRepairOrUserConfirmationOffered: false,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.violations).toEqual([
      'STALE_ASSUMPTION_NOT_REJECTED',
      'SILENT_STALE_TARGET_REUSE',
      'SILENT_STALE_MEMBERSHIP_REUSE',
      'ACQUISITION_STARTED_BEFORE_REPAIR_OR_CONFIRMATION',
      'NO_BOUNDED_REPAIR_OR_USER_CONFIRMATION',
    ]);
  });
});

describe('successor oracle freezes fail closed on identity/provenance defects', () => {
  it('rejects duplicate selected identities', () => {
    const result = freeze(
      'CJ-04',
      ['m-1', 'm-1'],
      [
        { memberId: 'm-1', expectedResult: 'VALIDATED' },
        { memberId: 'm-1', expectedResult: 'VALIDATED' },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
    }
  });

  it('rejects truth expectations outside the selected identity set', () => {
    const result = freeze(
      'CJ-04',
      ['m-1'],
      [{ memberId: 'm-outside', expectedResult: 'VALIDATED' }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
    }
  });

  it('rejects a missing truth expectation instead of defaulting it post hoc', () => {
    const result = freeze(
      'CJ-04',
      ['m-1', 'm-2'],
      [{ memberId: 'm-1', expectedResult: 'VALIDATED' }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  it('rejects a task-case binding mismatch', () => {
    const journey = loadedJourneyRegistry().byId('CJ-04')!;
    const result = freezeSuccessorJourneyOracle(
      {
        oracleId: 'successor/cj-04/bad-binding',
        journeyId: 'CJ-04',
        taskCaseId: 'hard/site-template-mismatch',
        selectedMemberIds: ['m-1'],
        expectedMemberValidation: [{ memberId: 'm-1', expectedResult: 'VALIDATED' }],
      },
      journey,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('CONTRACT_BINDING_MISMATCH');
    }
  });
});
