/**
 * T015 real process-death crash worker for the composed Core Runtime.
 *
 * Spawned as a real child process (`node runtime-crash-worker.ts ...`) on the
 * local host. It composes a FRESH authoritative Core Runtime over the given
 * root directory, drives a scripted direct acquisition against a worker-local
 * loopback HTTP fixture up to the injected durable window, then writes a
 * marker file and stays alive until the parent hard-kills it (SIGKILL-class).
 * No graceful shutdown runs: the process dies holding open handles — exactly
 * the process-death/reopen tuple under test (T005 crash-harness pattern).
 *
 * Runs under Node's built-in TypeScript type stripping (erasable-only TS with
 * explicit `.ts` import extensions — the repository convention).
 */

import { closeSync, fsyncSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';

interface WorkerArgs {
  readonly root: string;
  readonly window: string;
  readonly markerPath: string;
  readonly stepsPath: string;
}

function parseArgs(argv: readonly string[]): WorkerArgs {
  const args: Record<string, string> = {};
  for (const argument of argv) {
    const equals = argument.indexOf('=');
    if (argument.startsWith('--') && equals > 0) {
      args[argument.slice(2, equals)] = argument.slice(equals + 1);
    }
  }
  const root = args['root'];
  const window = args['window'];
  const markerPath = args['marker'];
  const stepsPath = args['steps'];
  if (
    root === undefined ||
    window === undefined ||
    markerPath === undefined ||
    stepsPath === undefined
  ) {
    throw new Error('runtime-crash-worker requires --root, --window, --marker, --steps');
  }
  return { root, window, markerPath, stepsPath };
}

const BUDGET_PROFILE = {
  discovery: { domain: 'discovery', maxGeneratedRequests: 50 },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_000_000,
    maxSegments: 50,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
};

const CONTRACT = 'contract-single-001';
const SNAPSHOT = 'snapshot-001';
const TARGET = 'target-file-001';
const MEMBER = 'member-file-001';
const ARTIFACT = 'artifact:crash-001';

/** Write the window marker, then stay alive until the parent hard-kills us. */
async function holdAtMarker(markerPath: string, window: string): Promise<never> {
  writeFileSync(markerPath, window);
  await new Promise<never>(() => undefined);
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const steps: string[] = [];
  const recordStep = (step: string): void => {
    steps.push(step);
    const fd = openSync(args.stepsPath, 'w');
    try {
      writeSync(fd, JSON.stringify({ steps, window: args.window }, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  const runtimeModule = await import('../src/index.ts');
  const dc = await import('@xdownload/domain-contracts');
  const { DirectHttpAdapter } = await import('@xdownload/direct-acquisition');

  // Worker-local loopback fixture (dies with the process).
  const bytes = new Uint8Array(2048).map((_, index) => (index + 11) % 251);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      etag: 'crash-etag',
      'accept-ranges': 'bytes',
    });
    response.end(Buffer.from(bytes));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const baseUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const runtime = runtimeModule.createCoreRuntime({
    rootDir: args.root,
    expectedPeer: { installId: 'install-001', userId: 'user-001', allowedSurfaces: ['CLI'] },
  });
  recordStep('runtime-composed');

  // One accepted seam command: the durable seam journal entry that must
  // replay (and stay idempotent) after restart.
  const contractPayload = (await import('./helpers.ts')).crashWorkerContractPayload();
  const submitted = runtime.seam.handleFrame(
    JSON.stringify({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
      kind: 'command',
      commandType: 'SUBMIT_CONTRACT',
      peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
      requestId: 'crash-seam-001',
      aggregateId: CONTRACT,
      expectedRevision: 0,
      correlation: {},
      issuedAt: '2026-10-04T01:00:00Z',
      payload: contractPayload,
    }),
  );
  if (submitted.outcome !== 'ACCEPTED') {
    throw new Error(`seam submit rejected: ${JSON.stringify(submitted.diagnostics ?? [])}`);
  }

  const { submission, workItemId } = runtimeModule.registerLineage(
    runtime,
    {
      contractId: CONTRACT,
      snapshotId: SNAPSHOT,
      targetId: TARGET,
      authorizationContextRef: 'authctx/local-001',
      budgetProfile: BUDGET_PROFILE,
    },
    { commandId: 'cmd-crash-001', memberId: MEMBER },
  );
  runtime.writer.dispatch({ workItemId, attemptId: `${workItemId}#attempt-1` });
  const attempt = runtime.scheduler.startEffectAttempt(
    submission.lineageKey,
    `${workItemId}#attempt-1`,
  );
  if (!attempt.ok) {
    throw new Error(`attempt rejected: ${attempt.rejection.code}`);
  }
  recordStep('after-lineage');
  if (args.window === 'after-lineage') {
    await holdAtMarker(args.markerPath, args.window);
  }

  const targetId = dc.unwrapOrThrow(dc.makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  const binding = dc.unwrapOrThrow(
    dc.bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
  const adapter = new DirectHttpAdapter(
    runtimeModule.schedulerTransferBudgetPort(runtime, submission.lineageKey),
  );
  const acquired = await adapter.acquire({
    effectId: dc.unwrapOrThrow(dc.makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice: 'S1',
    selectedMemberId: dc.unwrapOrThrow(dc.makeMemberId(MEMBER)),
    binding,
    expectedSha256: createHash('sha256').update(bytes).digest('hex'),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  });
  if (!acquired.ok) {
    throw new Error('crash worker transfer request rejected');
  }
  const transfer = acquired.value;
  if (transfer.reason !== 'COMPLETED') {
    throw new Error(`crash worker transfer did not complete: ${transfer.reason}`);
  }
  runtime.writer.recordExternalEffectObserved(workItemId);
  const recorded = runtime.scheduler.recordEffectOutcome(submission.lineageKey, {
    attemptId: attempt.value.attemptId,
    outcome: 'SUCCEEDED',
  });
  if (!recorded.ok) {
    throw new Error(`outcome rejected: ${recorded.rejection.code}`);
  }
  recordStep('after-transfer');

  const staged = runtime.writer.stageArtifact({
    workItemId,
    artifactId: ARTIFACT,
    bytes: transfer.bytes as Uint8Array,
    provenance: {
      source: 'crash-worker',
      digest: createHash('sha256').update(bytes).digest('hex'),
    },
    consumption: {
      domain: 'transfer',
      limitKey: 'bytes',
      amount: bytes.byteLength,
      convergenceKey: `${attempt.value.attemptId}:bytes`,
    },
  });
  void staged;
  recordStep('after-stage');
  if (args.window === 'after-stage') {
    await holdAtMarker(args.markerPath, args.window);
  }

  runtime.writer.materializeArtifact(workItemId, ARTIFACT);
  recordStep('after-materialize');
  if (args.window === 'after-materialize') {
    await holdAtMarker(args.markerPath, args.window);
  }

  runtime.writer.finalizeArtifact(workItemId, ARTIFACT);
  recordStep('after-finalize');
  if (args.window === 'after-finalize') {
    await holdAtMarker(args.markerPath, args.window);
  }

  runtime.writer.acceptArtifact({
    workItemId,
    artifactId: ARTIFACT,
    validation: { passed: true, passedCount: 3, failedCount: 0 },
  });
  const accepted = runtime.scheduler.tryAccept(submission.lineageKey);
  if (!accepted.ok) {
    throw new Error(`acceptance rejected: ${accepted.rejection.code}`);
  }
  recordStep('after-accept-commit');
  if (args.window === 'after-accept-commit') {
    await holdAtMarker(args.markerPath, args.window);
  }

  writeFileSync(args.markerPath, 'completed');
  await holdAtMarker(args.markerPath, 'hold');
}

void main();
