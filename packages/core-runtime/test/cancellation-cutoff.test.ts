/**
 * TEST_MATRIX suite `cancellation-cutoff` (+ ADR-013 matrix, L2 §11.1).
 *
 * Must prove through the composed runtime only:
 * - cancel-before-accept blocks automatic later acceptance on the same
 *   lineage (scheduler CANCELLATION_CUTOFF_VIOLATION + writer
 *   CANCELLATION_CUTOFF_BLOCKED);
 * - accept-before-cancel is not retroactively revoked; bounded
 *   reconciliation establishes truth without reopening acceptance;
 * - explicit retry/resume alone reopens processing on the same frozen
 *   lineage with remaining budgets;
 * - projected cancellation statuses follow L2 §11.1 (no fake success, no
 *   fake failure).
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectHttpAdapter } from '@xdownload/direct-acquisition';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import { type PersistenceError } from '@xdownload/persistence-ledger';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  rawSingleResourceContract,
  removeTempDir,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import {
  cancelLineage,
  executeDirectAcquisition,
  projectLineageResult,
  registerLineage,
  resumeLineage,
  schedulerTransferBudgetPort,
} from '../src/index.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = 'contract-single-001';
const SNAPSHOT = 'snapshot-001';
const TARGET = 'target-file-001';
const MEMBER = 'member-file-001';
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bindingFor(baseUri: string): LocatorBinding<LogicalTargetId> {
  const targetId = unwrapOrThrow(makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  return unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
}

/** Register + transfer + record the truthful SUCCEEDED effect, but stop before acceptance. */
async function stageSucceededLineage(
  runtime: ReturnType<typeof openRuntime>,
  baseUri: string,
  bytes: Uint8Array,
): Promise<{ readonly lineageKey: string; readonly workItemId: string }> {
  const { submission, workItemId } = registerLineage(
    runtime,
    {
      contractId: CONTRACT,
      snapshotId: SNAPSHOT,
      targetId: TARGET,
      authorizationContextRef: 'authctx/local-001',
      budgetProfile: rawSingleResourceContract()['budgetProfile'],
    },
    { commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`, memberId: MEMBER },
  );
  runtime.writer.dispatch({ workItemId, attemptId: `${workItemId}#attempt-1` });
  const attempt = runtime.scheduler.startEffectAttempt(
    submission.lineageKey,
    `${workItemId}#attempt-1`,
  );
  expect(attempt.ok).toBe(true);
  const adapter = new DirectHttpAdapter(
    schedulerTransferBudgetPort(runtime, submission.lineageKey),
  );
  const acquired = await adapter.acquire({
    effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice: 'S1',
    selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
    binding: bindingFor(baseUri),
    expectedSha256: sha256(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  });
  expect(acquired.ok).toBe(true);
  const transfer = acquired.ok ? acquired.value : undefined;
  expect(transfer?.reason).toBe('COMPLETED');
  runtime.writer.recordExternalEffectObserved(workItemId);
  const recorded = runtime.scheduler.recordEffectOutcome(submission.lineageKey, {
    attemptId: `${workItemId}#attempt-1`,
    outcome: 'SUCCEEDED',
  });
  expect(recorded.ok).toBe(true);
  return { lineageKey: submission.lineageKey, workItemId };
}

describe('T015 cancellation-cutoff', () => {
  it('blocks automatic later acceptance after cancel-before-accept (ADR-013)', async () => {
    const rootDir = makeTempDir('t015-cutoff-cancel-first');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(1024, 4);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'cutoff-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const { lineageKey, workItemId } = await stageSucceededLineage(runtime, baseUri, bytes);

      // Bytes staged/materialized/finalized BEFORE the cancellation.
      runtime.writer.stageArtifact({
        workItemId,
        artifactId: 'artifact:cutoff-001',
        bytes,
        provenance: { source: 'cutoff-suite' },
      });
      runtime.writer.materializeArtifact(workItemId, 'artifact:cutoff-001');
      runtime.writer.finalizeArtifact(workItemId, 'artifact:cutoff-001');

      // Cancel: durable USER_CANCELLED in both canonical stores.
      cancelLineage(runtime, lineageKey, 'DESKTOP_UI', workItemId);

      // Automatic later acceptance is blocked at BOTH cutoff decision points.
      const schedulerAccept = runtime.scheduler.tryAccept(lineageKey);
      expect(schedulerAccept.ok).toBe(false);
      if (!schedulerAccept.ok) {
        expect(schedulerAccept.rejection.code).toBe('CANCELLATION_CUTOFF_VIOLATION');
      }
      let blocked: PersistenceError | undefined;
      try {
        runtime.writer.acceptArtifact({
          workItemId,
          artifactId: 'artifact:cutoff-001',
          validation: { passed: true, passedCount: 3, failedCount: 0 },
        });
      } catch (error) {
        blocked = error as PersistenceError;
      }
      expect(blocked?.code).toBe('CANCELLATION_CUTOFF_BLOCKED');

      // The projected cancellation status is truthful: cancelled, no fake
      // success from the completed-but-unaccepted bytes.
      const projected = projectLineageResult(runtime, {
        lineageKey,
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        requestedMemberIds: [MEMBER],
        recordedAt: '2026-10-04T03:00:00Z',
        enumeration: { kind: 'NOT_APPLICABLE' },
      });
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.result.selectionAcquisition).toBe('CANCELLED');
        expect(projected.value.result.stopReason).toBe('USER_CANCELLED');
        expect(projected.value.result.requestFulfillment).toBe('UNSATISFIED');
      }

      // Reconciliation alone never reopens acceptance.
      const reconciled = runtime.scheduler.reconcile(lineageKey, 'STAGED_BYTES_PRESENT');
      expect(reconciled.ok).toBe(true);
      if (reconciled.ok) {
        expect(reconciled.value.stateAfter).toBe('CANCELLED_SUPPRESSED');
        expect(reconciled.value.cutoff).toBe('ACCEPTANCE_BLOCKED');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('keeps accept-before-cancel authoritative and never revokes it retroactively', async () => {
    const rootDir = makeTempDir('t015-cutoff-accept-first');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(1024, 6);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'accept-first-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await executeDirectAcquisition(runtime, {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-accept-first-001',
        memberId: MEMBER,
        artifactId: 'artifact:accept-first-001',
        transfer: {
          effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
          contractId: CONTRACT,
          slice: 'S1',
          selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
          binding: bindingFor(baseUri),
          expectedSha256: sha256(bytes),
          allowedRedirectHosts: [new URL(baseUri).host],
          attempt: 0,
        },
      });
      if (flow.attemptReplayed || flow.transfer === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.acceptance).toBeDefined();
      expect(flow.schedulerAcceptance?.ok).toBe(true);

      // A late cancellation does NOT revoke the earlier acceptance.
      cancelLineage(runtime, flow.lineageKey, 'CLI', flow.workItemId);
      const projected = projectLineageResult(runtime, {
        lineageKey: flow.lineageKey,
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        requestedMemberIds: [MEMBER],
        recordedAt: '2026-10-04T03:00:00Z',
        enumeration: { kind: 'NOT_APPLICABLE' },
      });
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.result.selectionAcquisition).toBe('COMPLETE');
        // A completed accepted lineage stopped nothing: no USER_CANCELLED
        // stop reason is fabricated (L2 §11.1 projection rules).
        expect(projected.value.result.stopReason).toBe('NONE');
      }

      // Bounded reconciliation still establishes truth without reopening.
      const reconciled = runtime.scheduler.reconcile(
        flow.lineageKey,
        'MATERIALIZATION_ESTABLISHED',
      );
      expect(reconciled.ok).toBe(true);
      if (reconciled.ok) {
        expect(reconciled.value.cutoff).toBe('ACCEPTANCE_STANDS');
        expect(reconciled.value.stateAfter).toBe('ACCEPTED');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('reopens a suppressed lineage only through explicit retry/resume with inherited budgets', async () => {
    const rootDir = makeTempDir('t015-cutoff-resume');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(1024, 8);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'resume-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const { lineageKey, workItemId } = await stageSucceededLineage(runtime, baseUri, bytes);
      runtime.writer.stageArtifact({
        workItemId,
        artifactId: 'artifact:resume-001',
        bytes,
        provenance: { source: 'resume-suite' },
      });
      runtime.writer.materializeArtifact(workItemId, 'artifact:resume-001');
      runtime.writer.finalizeArtifact(workItemId, 'artifact:resume-001');
      cancelLineage(runtime, lineageKey, 'DESKTOP_UI', workItemId);

      const remainingBefore = runtime.scheduler.remainingBudgets(lineageKey);
      expect(remainingBefore.ok).toBe(true);

      // Retry cannot invent members outside the frozen identity domain.
      const drift = runtime.scheduler.resumeLineage(lineageKey, {
        authorizedBy: 'user:local-001',
        reason: 'RETRY',
        memberScope: ['member-not-in-snapshot'],
      });
      expect(drift.ok).toBe(false);
      if (!drift.ok) {
        expect(drift.rejection.code).toBe('SNAPSHOT_DRIFT_REJECTED');
      }

      // Explicit retry/resume is the ONLY authority that reopens processing.
      const resumed = resumeLineage(runtime, lineageKey, workItemId, {
        authorizedBy: 'user:local-001',
        reason: 'RETRY',
        retryCommandId: 'cmd-retry-001',
      });
      expect(resumed.ok).toBe(true);
      if (resumed.ok) {
        // Remaining budgets are inherited unchanged — never reset.
        expect(resumed.value.inheritedRemaining).toEqual(
          remainingBefore.ok
            ? remainingBefore.value
            : (() => {
                throw new Error('unreachable');
              })(),
        );
      }

      // After the resume, the cutoff no longer blocks acceptance: the
      // durable retry fact is later than the cancellation.
      const schedulerAccept = runtime.scheduler.tryAccept(lineageKey);
      expect(schedulerAccept.ok).toBe(true);
      const writerAccept = runtime.writer.acceptArtifact({
        workItemId,
        artifactId: 'artifact:resume-001',
        validation: { passed: true, passedCount: 3, failedCount: 0 },
      });
      expect(writerAccept.alreadyAccepted).toBe(false);
    } finally {
      closeRuntime(runtime);
    }
  });
});
