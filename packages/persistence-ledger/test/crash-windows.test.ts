/**
 * TEST_MATRIX suite `process-kill-restart-persistence`.
 *
 * Real child processes are hard-killed (SIGKILL-class) at injected
 * durable-fact boundaries against a REAL SQLite file and REAL temp artifact
 * directories; the parent reopens the ledger and asserts the deterministic
 * recovery classification. No in-memory database and no mocked store. Claims
 * stay bounded to the process-death/reopen tuple actually exercised on this
 * host (TEST_MATRIX `process-kill-restart-persistence`; FAILURE_MATRIX
 * `durability-overclaim`).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AuthoritativeLedgerWriter,
  DURABILITY_CLAIM,
  exercisedHostTuple,
  FilesystemArtifactStore,
  LedgerConnection,
  RecoveryService,
} from '../src/index.ts';
import {
  createCrashRun,
  readSteps,
  removeCrashRun,
  runKillWindow,
  type CrashWindow,
} from './crash-harness.ts';
import { SCENARIO_BYTES } from './fixture-bytes.ts';

const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 't005-crash-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) {
    removeCrashRun(dir);
  }
});

interface WindowExpectation {
  readonly lifecycleClass: string;
  readonly fsState: string;
  readonly dbState: string;
  readonly acceptanceAllowed: boolean;
  readonly successClaimable: boolean;
  readonly automaticDispatchSuppressed: boolean;
  /** transfer.bytes remaining from the durable rows after reopen. */
  readonly transferBytesRemaining: number;
}

/**
 * Budget math from the scenario profile: 100_000 max bytes; the worker
 * reserves 40_000 at dispatch and consumes the staged byte length at staging.
 */
const RESERVED_AT_DISPATCH = 40_000;
const consumedAfterStage = RESERVED_AT_DISPATCH + SCENARIO_BYTES.length;
const fullBudget = 100_000;

const EXPECTATIONS: Record<CrashWindow, WindowExpectation> = {
  'after-submit': {
    lifecycleClass: 'NOT_DISPATCHED',
    fsState: 'ABSENT',
    dbState: 'REGISTERED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget,
  },
  'after-dispatch-mid-external-effect': {
    lifecycleClass: 'IN_FLIGHT_UNKNOWN',
    fsState: 'ABSENT',
    dbState: 'REGISTERED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - RESERVED_AT_DISPATCH,
  },
  'after-effect-observed': {
    lifecycleClass: 'PARTIAL_RECOVERABLE',
    fsState: 'ABSENT',
    dbState: 'REGISTERED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - RESERVED_AT_DISPATCH,
  },
  'after-stage-bytes': {
    lifecycleClass: 'PARTIAL_RECOVERABLE',
    fsState: 'STAGED',
    dbState: 'STAGED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - consumedAfterStage,
  },
  'after-materialize': {
    lifecycleClass: 'PARTIAL_RECOVERABLE',
    fsState: 'MATERIALIZED',
    dbState: 'MATERIALIZED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - consumedAfterStage,
  },
  'after-finalize': {
    lifecycleClass: 'SUCCEEDED_UNACCEPTED',
    fsState: 'FINALIZED',
    dbState: 'FINALIZED',
    acceptanceAllowed: true,
    successClaimable: false,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - consumedAfterStage,
  },
  'after-accept-commit': {
    lifecycleClass: 'ACCEPTED',
    fsState: 'FINALIZED',
    dbState: 'ACCEPTED',
    acceptanceAllowed: false,
    successClaimable: true,
    automaticDispatchSuppressed: false,
    transferBytesRemaining: fullBudget - consumedAfterStage,
  },
};

const FACT_KINDS_BY_STEP: Record<string, readonly string[]> = {
  dispatched: ['DISPATCH_INTENT'],
  'effect-observed': ['EXTERNAL_EFFECT_OBSERVED'],
  staged: ['FS_STAGED'],
  materialized: ['FS_MATERIALIZED'],
  finalized: ['FS_FINALIZED'],
  // Acceptance commits validation + acceptance facts in one transaction.
  accepted: ['VALIDATION_PASSED', 'ACCEPTED'],
};

describe('process-kill-restart-persistence', () => {
  for (const window of Object.keys(EXPECTATIONS) as CrashWindow[]) {
    const expected = EXPECTATIONS[window];
    it(
      `kill at '${window}' reopens with deterministic classification and exact budget truth`,
      { timeout: 120_000 },
      async () => {
        const paths = await runKillWindow(freshDir(), window);
        // The worker committed exactly the steps it recorded before death.
        const steps = readSteps(paths);

        const store = new FilesystemArtifactStore(paths.storeRoot);
        const connection = LedgerConnection.openWriter(paths.dbPath);
        try {
          const writer = new AuthoritativeLedgerWriter(connection, store);
          const recovery = new RecoveryService({ writer, store });
          const classification = recovery.classify('work:crash-scenario');

          expect(classification.lifecycleClass).toBe(expected.lifecycleClass);
          expect(classification.fsState).toBe(expected.fsState);
          expect(classification.dbState).toBe(expected.dbState);
          expect(classification.acceptanceAllowed).toBe(expected.acceptanceAllowed);
          expect(classification.successClaimable).toBe(expected.successClaimable);
          expect(classification.automaticDispatchSuppressed).toBe(
            expected.automaticDispatchSuppressed,
          );

          // Budgets: neither replenished nor double-consumed across the kill.
          const remaining = writer.reader.budgetRemaining('work:crash-scenario');
          expect(remaining.transfer.perLimit['bytes']).toBe(expected.transferBytesRemaining);

          // The durable transition-order facts survive in exact order.
          const facts = writer.reader.facts('work:crash-scenario');
          expect(facts.map((fact) => fact.seq)).toEqual(facts.map((_, index) => index + 1));
          const expectedFacts = steps.steps.flatMap((step) => FACT_KINDS_BY_STEP[step] ?? []);
          expect(facts.map((fact) => fact.kind)).toEqual(expectedFacts);

          // No blind replay: restart created no second effect or lineage.
          const effects = connection.database.queryAll(
            'SELECT effect_id FROM effects WHERE work_item_id = ?',
            'work:crash-scenario',
          );
          expect(effects).toHaveLength(1);
          const workItems = connection.database.queryAll('SELECT work_item_id FROM work_items');
          expect(workItems).toHaveLength(1);

          // Determinism: classifying twice from the same reopened state
          // yields the identical classification.
          expect(recovery.classify('work:crash-scenario')).toEqual(classification);
        } finally {
          connection.close();
        }
      },
    );
  }

  it(
    'an interrupted lifecycle resumes to acceptance on the same lineage after restart',
    { timeout: 120_000 },
    async () => {
      const paths = await runKillWindow(freshDir(), 'after-finalize');
      const store = new FilesystemArtifactStore(paths.storeRoot);
      const connection = LedgerConnection.openWriter(paths.dbPath);
      try {
        const writer = new AuthoritativeLedgerWriter(connection, store);
        // Explicit resume of the interrupted lifecycle on the SAME lineage.
        const outcome = writer.acceptArtifact({
          workItemId: 'work:crash-scenario',
          artifactId: 'artifact:crash-scenario',
          validation: { passed: true, passedCount: 1, failedCount: 0 },
        });
        expect(outcome.alreadyAccepted).toBe(false);
        const state = writer.reader.workItem('work:crash-scenario')?.lifecycleState;
        expect(state).toBe('ACCEPTED');
      } finally {
        connection.close();
      }
    },
  );

  it('the host OS tuple actually exercised is recorded and claims stay bounded', () => {
    const tuple = exercisedHostTuple();
    expect(tuple.platform).toBe(process.platform);
    expect(tuple.arch).toBe(process.arch);
    expect(tuple.recovery).toContain('reopen');
    expect(tuple.kill).toContain('kill');
    expect(DURABILITY_CLAIM.durabilityTuple).toBe('PROCESS_DEATH_AND_REOPEN_ONLY');
    expect(DURABILITY_CLAIM.exactlyOnceClaimed).toBe(false);
    expect(DURABILITY_CLAIM.hostPowerLossClaimed).toBe(false);
    expect(DURABILITY_CLAIM.executionSemantics).toBe(
      'RECOVERABLE_AT_LEAST_ONCE_IDEMPOTENT_ACCEPTANCE',
    );
    expect(createCrashRun('x').dbPath.endsWith('crash-ledger.sqlite')).toBe(true);
  });
});
