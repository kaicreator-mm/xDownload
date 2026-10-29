/**
 * T005 crash-harness helper — spawn/kill/reopen, reused by every kill-window
 * case so the kill mechanics are proven once (REFERENCE_PACK §1.1).
 *
 * The child is a REAL process on the local host, performing the scripted
 * lifecycle against a REAL SQLite file and REAL temp artifact directories,
 * hard-killed (SIGKILL-class) at the injected durable-fact boundary. Claims
 * stay bounded to the process-death/reopen tuple actually exercised.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRASH_WINDOWS = [
  'after-submit',
  'after-dispatch-mid-external-effect',
  'after-effect-observed',
  'after-stage-bytes',
  'after-materialize',
  'after-finalize',
  'after-accept-commit',
] as const;

export type CrashWindow = (typeof CRASH_WINDOWS)[number];

export interface CrashRunPaths {
  readonly dir: string;
  readonly dbPath: string;
  readonly storeRoot: string;
  readonly markerPath: string;
  readonly stepsPath: string;
}

export interface CrashRunSteps {
  readonly steps: readonly string[];
  readonly profile: unknown;
}

export function createCrashRun(dir: string): CrashRunPaths {
  return {
    dir,
    dbPath: join(dir, 'crash-ledger.sqlite'),
    storeRoot: join(dir, 'artifacts'),
    markerPath: join(dir, 'window-reached.marker'),
    stepsPath: join(dir, 'steps.json'),
  };
}

export function readSteps(paths: CrashRunPaths): CrashRunSteps {
  const raw = JSON.parse(readFileSync(paths.stepsPath, 'utf8')) as CrashRunSteps;
  return raw;
}

/**
 * Spawn the worker, wait for the injected window marker, hard-kill the
 * process, and wait for the OS to reap it. The returned run has a real
 * process-death boundary at the requested durable-fact window.
 */
export function runKillWindow(dir: string, window: CrashWindow): Promise<CrashRunPaths> {
  const paths = createCrashRun(dir);
  const workerPath = fileURLToPath(new URL('./crash-worker.ts', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      workerPath,
      `--db=${paths.dbPath}`,
      `--store=${paths.storeRoot}`,
      `--window=${window}`,
      `--marker=${paths.markerPath}`,
      `--steps=${paths.stepsPath}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const killed = new Promise<CrashRunPaths>((resolve, reject) => {
    const started = Date.now();
    const pollMarker = (): void => {
      if (existsSync(paths.markerPath)) {
        const marker = readFileSync(paths.markerPath, 'utf8');
        if (marker !== window) {
          child.kill('SIGKILL');
          reject(new Error(`worker reported unreached window '${marker}' for '${window}'`));
          return;
        }
        // Hard kill at the injected boundary: SIGKILL-class process death,
        // no graceful shutdown, handles left open by the dying process.
        child.kill('SIGKILL');
        child.on('exit', () => resolve(paths));
        return;
      }
      if (Date.now() - started > 30_000) {
        child.kill('SIGKILL');
        reject(new Error(`worker never reached window '${window}'; stderr: ${stderr}`));
        return;
      }
      setTimeout(pollMarker, 20);
    };
    child.on('exit', (code) => {
      if (!existsSync(paths.markerPath)) {
        reject(new Error(`worker exited (code ${String(code)}) before marker; stderr: ${stderr}`));
      }
    });
    pollMarker();
  });

  return killed;
}

export function removeCrashRun(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
