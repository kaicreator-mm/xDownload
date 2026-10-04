/**
 * T005 real process-death crash worker.
 *
 * Spawned as a real child process (`node crash-worker.ts ...`) on the local
 * host. It performs the scripted acquisition lifecycle against a REAL SQLite
 * file and REAL filesystem directories, up to the injected kill window, then
 * writes a marker file and stays alive until the parent hard-kills it
 * (SIGKILL-class). No graceful shutdown runs: the process dies holding open
 * handles, which is exactly the process-death/reopen tuple under test.
 *
 * Runs under Node's built-in TypeScript type stripping (erasable-only TS
 * with explicit `.ts` import extensions — the repository convention).
 */

import { closeSync, fsyncSync, openSync, writeFileSync, writeSync } from 'node:fs';
import {
  AuthoritativeLedgerWriter,
  FilesystemArtifactStore,
  LedgerConnection,
} from '../src/index.ts';
import { SCENARIO_BYTES, SCENARIO_PROFILE } from './fixture-bytes.ts';

interface WorkerArgs {
  readonly dbPath: string;
  readonly storeRoot: string;
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
  const dbPath = args['db'];
  const storeRoot = args['store'];
  const window = args['window'];
  const markerPath = args['marker'];
  const stepsPath = args['steps'];
  if (
    dbPath === undefined ||
    storeRoot === undefined ||
    window === undefined ||
    markerPath === undefined ||
    stepsPath === undefined
  ) {
    throw new Error('crash-worker requires --db, --store, --window, --marker, --steps');
  }
  return { dbPath, storeRoot, window, markerPath, stepsPath };
}

const PROFILE = SCENARIO_PROFILE;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const steps: string[] = [];

  const recordStep = (step: string): void => {
    steps.push(step);
    const fd = openSync(args.stepsPath, 'w');
    try {
      writeSync(fd, JSON.stringify({ steps, profile: PROFILE }, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  const store = new FilesystemArtifactStore(args.storeRoot);
  const connection = LedgerConnection.openWriter(args.dbPath);
  const writer = new AuthoritativeLedgerWriter(connection, store);
  const workItemId = 'work:crash-scenario';
  const artifactId = 'artifact:crash-scenario';

  const reached = (window: string): boolean => {
    if (args.window !== window) {
      return false;
    }
    // Signal the injected boundary, then stay alive until hard-killed.
    const markerFd = openSync(args.markerPath, 'w');
    try {
      writeSync(markerFd, window);
      fsyncSync(markerFd);
    } finally {
      closeSync(markerFd);
    }
    setInterval(() => {
      // keep the event loop alive; the parent SIGKILLs us here
    }, 60_000);
    return true;
  };

  recordStep('open');

  writer.submitAcquisition({
    commandId: 'cmd:crash-1',
    commandKind: 'ACQUIRE',
    workItemId,
    contractId: 'contract:crash-1',
    snapshotId: 'snapshot:crash-1',
    memberId: 'member:crash-1',
    effectId: 'effect:crash-1',
    authorizationContextRef: 'authref:crash-test',
    budgetProfile: PROFILE,
    artifactProvenance: { sourceRef: 'https://scenario.invalid/crash-1' },
  });
  recordStep('submitted');
  if (reached('after-submit')) {
    return;
  }

  writer.dispatch({
    workItemId,
    attemptId: 'attempt:crash-1',
    reservations: [
      { domain: 'transfer', limitKey: 'bytes', amount: 40_000, convergenceKey: 'plan:crash-1' },
    ],
  });
  recordStep('dispatched');
  if (reached('after-dispatch-mid-external-effect')) {
    return;
  }

  writer.recordExternalEffectObserved(workItemId);
  recordStep('effect-observed');
  if (reached('after-effect-observed')) {
    return;
  }

  const staged = writer.stageArtifact({
    workItemId,
    artifactId,
    bytes: SCENARIO_BYTES,
    provenance: { sourceRef: 'https://scenario.invalid/crash-1' },
    consumption: {
      domain: 'transfer',
      limitKey: 'bytes',
      amount: SCENARIO_BYTES.length,
      convergenceKey: `consumed:${artifactId}`,
    },
  });
  if (!staged.reused) {
    recordStep('staged');
  }
  if (reached('after-stage-bytes')) {
    return;
  }

  writer.materializeArtifact(workItemId, artifactId);
  recordStep('materialized');
  if (reached('after-materialize')) {
    return;
  }

  writer.finalizeArtifact(workItemId, artifactId);
  recordStep('finalized');
  if (reached('after-finalize')) {
    return;
  }

  writer.acceptArtifact({
    workItemId,
    artifactId,
    validation: { passed: true, passedCount: 1, failedCount: 0 },
  });
  recordStep('accepted');
  if (reached('after-accept-commit')) {
    return;
  }

  // Window name never matched: fail loudly instead of exiting cleanly, so a
  // harness bug can never masquerade as a passed kill-window test.
  writeFileSync(args.markerPath, 'UNREACHED');
  throw new Error(`unknown kill window '${args.window}'`);
}

main();
