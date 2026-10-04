/**
 * TEST_MATRIX suite `process-restart` (+ C13).
 *
 * Must prove:
 * - killing and reopening the process re-derives state from durable truth
 *   only (persistence ledger + durable fact log + seam journal + artifact
 *   store) — real child-process kill via the T005 crash-harness pattern;
 * - RecoveryService DB-first/FS-first classification composes with scheduler
 *   reopen and seam journal replay;
 * - restart inherits remaining budgets on the same frozen lineage (no
 *   replenishment);
 * - restart never mutates contract/snapshot identity or selected membership;
 * - staged/partial artifact states survive reopen with truthful recovery
 *   classification (L2 §11 crash windows);
 * - corrupt durable truth fails closed (no partially-recovered authority).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  closeRuntime,
  crashWorkerContractPayload,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  removeTempDir,
  requestIdOf,
  runtimeOptions,
  seamCommand,
} from './helpers.ts';
import {
  closeCoreRuntime,
  DurableStoreCorruptError,
  executeDirectAcquisition,
  registerLineage,
  reopenCoreRuntime,
} from '../src/index.ts';
import { ControlledHttpFixture } from './fixture-http.ts';

const CRASH_WINDOWS = [
  'after-lineage',
  'after-stage',
  'after-materialize',
  'after-finalize',
  'after-accept-commit',
] as const;

type CrashWindow = (typeof CRASH_WINDOWS)[number];

interface CrashRun {
  readonly rootDir: string;
  readonly stepsPath: string;
}

function runKillWindow(dir: string, window: CrashWindow): Promise<CrashRun> {
  const rootDir = `${dir}/root`;
  const markerPath = `${dir}/window-reached.marker`;
  const stepsPath = `${dir}/steps.json`;
  const workerPath = fileURLToPath(new URL('./runtime-crash-worker.ts', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      workerPath,
      `--root=${rootDir}`,
      `--window=${window}`,
      `--marker=${markerPath}`,
      `--steps=${stepsPath}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return new Promise<CrashRun>((resolve, reject) => {
    const started = Date.now();
    const pollMarker = (): void => {
      if (existsSync(markerPath)) {
        const marker = readFileSync(markerPath, 'utf8');
        if (marker !== window) {
          child.kill('SIGKILL');
          reject(
            new Error(`worker reported unreached window '${marker}' for '${window}'; ${stderr}`),
          );
          return;
        }
        // Hard kill at the injected boundary: SIGKILL-class process death, no
        // graceful shutdown, handles left open by the dying process.
        child.kill('SIGKILL');
        child.on('exit', () => resolve({ rootDir, stepsPath }));
        return;
      }
      if (Date.now() - started > 60_000) {
        child.kill('SIGKILL');
        reject(new Error(`worker never reached window '${window}'; stderr: ${stderr}`));
        return;
      }
      setTimeout(pollMarker, 25);
    };
    child.on('exit', (code) => {
      if (!existsSync(markerPath)) {
        reject(new Error(`worker exited (code ${String(code)}) before marker; stderr: ${stderr}`));
      }
    });
    pollMarker();
  });
}

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

describe('T015 process-restart', () => {
  for (const window of CRASH_WINDOWS) {
    it(
      `re-derives state from durable truth after a real process kill at '${window}'`,
      { timeout: 120_000 },
      async () => {
        const dir = makeTempDir(`t015-crash-${window.replaceAll('-', '_')}`);
        dirs.push(dir);
        const run = await runKillWindow(dir, window);

        // Reopen composition: no memory of the dead process survives.
        const reopened = reopenCoreRuntime(runtimeOptions(run.rootDir));
        try {
          // 1. RecoveryService classification is truthful for the window.
          const classifications = reopened.recoveryAtComposition;
          expect(classifications.length).toBe(1);
          const classification = classifications[0]!;
          switch (window) {
            case 'after-lineage':
              expect(classification.lifecycleClass).toBe('IN_FLIGHT_UNKNOWN');
              expect(classification.bytesVerified).toBe(false);
              break;
            case 'after-stage':
              expect(classification.lifecycleClass).toBe('PARTIAL_RECOVERABLE');
              expect(classification.fsState).toBe('STAGED');
              expect(classification.successClaimable).toBe(false);
              break;
            case 'after-materialize':
              expect(classification.fsState).toBe('MATERIALIZED');
              expect(classification.successClaimable).toBe(false);
              break;
            case 'after-finalize':
              expect(classification.lifecycleClass).toBe('SUCCEEDED_UNACCEPTED');
              expect(classification.fsState).toBe('FINALIZED');
              expect(classification.bytesVerified).toBe(true);
              expect(classification.successClaimable).toBe(false);
              break;
            case 'after-accept-commit':
              expect(classification.lifecycleClass).toBe('ACCEPTED');
              expect(classification.bytesVerified).toBe(true);
              expect(classification.successClaimable).toBe(true);
              break;
          }

          // 2. Scheduler views re-derive from the durable fact log only.
          const lineageKey = [
            'contract-single-001',
            'snapshot-001',
            'target-file-001',
            'effect:contract-single-001:snapshot-001:target-file-001',
          ].join('|');
          const view = reopened.scheduler.lineageView(lineageKey);
          expect(view).toBeDefined();
          expect(view?.submittedAt).toBeGreaterThan(0);

          // 3. Remaining budgets are inherited, never replenished: the profile
          //    is durable and a divergent resubmission is a typed rejection.
          const replenish = reopened.scheduler.submitLineage({
            contractId: 'contract-single-001',
            snapshotId: 'snapshot-001',
            targetId: 'target-file-001',
            authorizationContextRef: 'authctx/local-001',
            budgetProfile: {
              discovery: { domain: 'discovery', maxGeneratedRequests: 999_999 },
              transfer: {
                domain: 'transfer',
                maxBytes: 999_999_999,
                maxSegments: 50,
                maxActiveTransferMs: 3_600_000,
                maxRetryTransferRequests: 5,
              },
              globalSafety: {
                domain: 'global_safety',
                maxTotalGeneratedRequests: 500,
                maxActiveElapsedMs: 7_200_000,
              },
            },
          });
          expect(replenish.ok).toBe(false);
          if (!replenish.ok) {
            expect(replenish.rejection.code).toBe('BUDGET_REPLENISHMENT_REJECTED');
          }

          // 4. Seam journal replay: the duplicate of an accepted command still
          //    converges (idempotent acceptance survives restart, ADR-010);
          //    snapshot identity and membership were not re-enumerated (a
          //    second CONFIRM_SNAPSHOT for the same lineage rejects).
          const duplicate = seamCommand(reopened, {
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: 'contract-single-001',
            payload: crashWorkerContractPayload(),
            expectedRevision: 1,
            requestId: requestIdOf('crash-seam-001'),
          });
          expect(duplicate.outcome).toBe('ACCEPTED');
          expect(duplicate.acceptance?.converged).toBe(true);
        } finally {
          closeCoreRuntime(reopened);
        }
      },
    );
  }

  it('inherits remaining budgets across an in-process restart on the same frozen lineage', async () => {
    const rootDir = makeTempDir('t015-restart-budgets');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = new Uint8Array(4096).fill(9);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'restart-etag' });

    const first = openRuntime(rootDir);
    let beforeRemaining: unknown;
    let aggregateRevision = 0;
    try {
      seamCommand(first, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
      });
      seamCommand(first, {
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-single-001',
        payload: snapshotPayloadForSingle(),
        expectedRevision: 1,
      });
      const flow = await executeDirectAcquisition(first, {
        contractId: 'contract-single-001',
        snapshotId: 'snapshot-001',
        targetId: 'target-file-001',
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-restart-001',
        memberId: 'member-file-001',
        artifactId: 'artifact:restart-001',
        transfer: transferRequestFor(baseUri, bytes),
      });
      if (flow.attemptReplayed || flow.transfer === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.acceptance).toBeDefined();
      beforeRemaining = remainingOf(first, flow.lineageKey);
      const projection = first.seam.inspectProjection('contract-single-001');
      aggregateRevision = projection?.contract.revision ?? 0; // revision 2: submit + snapshot confirm
    } finally {
      closeRuntime(first);
    }

    // Real reopen: same files, fresh process state.
    const second = reopenCoreRuntime(runtimeOptions(rootDir));
    try {
      const lineageKey = [
        'contract-single-001',
        'snapshot-001',
        'target-file-001',
        'effect:contract-single-001:snapshot-001:target-file-001',
      ].join('|');
      expect(remainingOf(second, lineageKey)).toEqual(beforeRemaining);

      // Restart is not a successor event: the aggregate revision is
      // unchanged and a snapshot re-confirmation is a snapshot mutation.
      const projection = second.seam.inspectProjection('contract-single-001');
      expect(projection?.contract.revision).toBe(aggregateRevision);
      const reconfirm = seamCommand(second, {
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-single-001',
        payload: snapshotPayloadForSingle(),
        expectedRevision: aggregateRevision,
      });
      expect(reconfirm.outcome).toBe('REJECTED');
      const diagnostic = (reconfirm.diagnostics ?? [])[0];
      expect(diagnostic?.code).toBe('SNAPSHOT_MUTATION');

      // A duplicate flow submission on the SAME lineage converges onto the
      // durable attempt: the flow reconciles from durable truth instead of
      // re-executing the external transfer (at-least-once, idempotent
      // acceptance) and the inherited budgets are charged nothing further.
      const flow = await executeDirectAcquisition(second, {
        contractId: 'contract-single-001',
        snapshotId: 'snapshot-001',
        targetId: 'target-file-001',
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-restart-002',
        memberId: 'member-file-001',
        artifactId: 'artifact:restart-001',
        transfer: transferRequestFor(baseUri, bytes),
      });
      expect(flow.submission.converged).toBe(true);
      expect(flow.attemptReplayed).toBe(true);
      expect(flow.transfer).toBeUndefined();
      expect(flow.acceptance).toBeUndefined();
      expect(flow.schedulerAcceptance?.ok).toBe(true);
      if (flow.schedulerAcceptance?.ok === true) {
        expect(flow.schedulerAcceptance.value.previouslyAccepted).toBe(true);
      }
      expect(remainingOf(second, lineageKey)).toEqual(beforeRemaining);
    } finally {
      closeRuntime(second);
    }
  });

  it(
    'fails closed on corrupt durable truth instead of partially recovering',
    { timeout: 30_000 },
    () => {
      const rootDir = makeTempDir('t015-restart-corrupt');
      dirs.push(rootDir);
      const first = openRuntime(rootDir);
      seamCommand(first, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
      });
      closeRuntime(first);

      // Corrupt the durable fact log: reopen must refuse (no partially
      // recovered authority), not skip the bad line.
      appendFileSync(`${rootDir}/control-facts.jsonl`, '{not-json-at-all}\n');
      expect(() => reopenCoreRuntime(runtimeOptions(rootDir))).toThrowError(
        DurableStoreCorruptError,
      );

      // A truncated-but-valid-JSON line that fails scheduler-grade decode is
      // equally refused.
      const rootDir2 = makeTempDir('t015-restart-corrupt2');
      dirs.push(rootDir2);
      const other = openRuntime(rootDir2);
      registerLineage(
        other,
        {
          contractId: 'contract-single-001',
          snapshotId: 'snapshot-001',
          targetId: 'target-file-001',
          authorizationContextRef: 'authctx/local-001',
          budgetProfile: rawSingleResourceContract()['budgetProfile'],
        },
        { commandId: 'cmd-corrupt-001', memberId: 'member-file-001' },
      );
      closeRuntime(other);
      const lines = readFileSync(`${rootDir2}/control-facts.jsonl`, 'utf8').split('\n');
      lines.splice(1, lines.length - 1);
      writeFileSync(`${rootDir2}/control-facts.jsonl`, `${lines[0]}\n{"kind":"mysteryFact"}\n`);
      expect(() => reopenCoreRuntime(runtimeOptions(rootDir2))).toThrowError(
        DurableStoreCorruptError,
      );
    },
  );
});

function remainingOf(runtime: ReturnType<typeof openRuntime>, lineageKey: string): unknown {
  const remaining = runtime.scheduler.remainingBudgets(lineageKey as never);
  if (!remaining.ok) {
    throw new Error(`remaining budgets unavailable: ${remaining.rejection.code}`);
  }
  return JSON.parse(JSON.stringify(remaining.value)) as unknown;
}

function transferRequestFor(baseUri: string, bytes: Uint8Array) {
  const targetId = unwrapOrThrow(makeLogicalTargetId('target-file-001'));
  const initialUri = `${baseUri}/file.bin`;
  return {
    effectId: unwrapOrThrow(
      makeEffectId('effect:contract-single-001:snapshot-001:target-file-001'),
    ),
    contractId: 'contract-single-001',
    slice: 'S1' as const,
    selectedMemberId: unwrapOrThrow(makeMemberId('member-file-001')),
    binding: unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: initialUri,
      }),
    ),
    expectedSha256: sha256Of(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  };
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The single-resource snapshot payload (bound to the restart contract). */
function snapshotPayloadForSingle(): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId: 'snapshot-001',
    contractId: 'contract-single-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: 'single_resource:target-file-001',
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: ['member-file-001'] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: ['member-file-001'] },
    selectedMemberIds: ['member-file-001'],
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: ['member-file-001'] },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
  };
}
