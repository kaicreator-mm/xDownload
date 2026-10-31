/*
 * T07 minimal non-installed shell smoke driver.
 *
 * Proves, against the REAL pinned Electron binary and a REAL seam authority
 * in another process:
 *   1. the shell launches a hidden, sandboxed window from local assets;
 *   2. the preload bridge exposes exactly {status} and is frozen;
 *   3. the page serves a restrictive CSP on a file: origin;
 *   4. renderer isolation holds (no require/process) and navigation and
 *      window.open are refused;
 *   5. the shell's desktop adapter connects over the seam as a DESKTOP_UI
 *      peer and the Core's typed answer is observed (no DISCONNECTED claim).
 *
 * The verdict is JSON (stdout + --out path); exit code 0 only when every
 * check passes. Smoke tooling only — never packaged, never shipped.
 */
/* global process, console, setTimeout, clearTimeout */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..', '..');
const dist = join(packageRoot, 'dist');
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`shell smoke FAILED: ${message}`);
  process.exit(1);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : -1;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

const INSTALL_ID = 'shellsmoke';
const USER_ID = 'shellsmokeuser';
const outPath = (() => {
  const flag = process.argv.find((value) => value.startsWith('--out='));
  return flag === undefined
    ? join(tmpdir(), `xd-shell-smoke-${String(process.pid)}.json`)
    : flag.slice('--out='.length);
})();

// 1. Build the shell bundles.
const buildRun = spawnSync(process.execPath, [join(here, 'build-shell.mjs')], {
  stdio: 'inherit',
  cwd: packageRoot,
});
if (buildRun.status !== 0) {
  fail(`bundle step exited with ${String(buildRun.status)}`);
}

// 2. Resolve the pinned electron binary from the app's own dependencies.
//    pnpm records the build approval (allowBuilds) but has been observed to
//    skip electron's postinstall; the driver self-heals by running the
//    package's own install.js against the mirror when the binary is absent.
function electronBinaryPath() {
  try {
    const resolved = require('electron');
    return typeof resolved === 'string' && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

let electronBinary = electronBinaryPath();
if (electronBinary === null) {
  const electronPackageDir = dirname(require.resolve('electron/package.json'));
  console.log('electron binary missing; running its own install.js (ELECTRON_MIRROR)...');
  const heal = spawnSync(process.execPath, [join(electronPackageDir, 'install.js')], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' },
  });
  electronBinary = electronBinaryPath();
  if (electronBinary === null) {
    fail(`electron binary download failed (exit ${String(heal.status)}); smoke is NOT_PROVEN`);
  }
}

const port = await freeLoopbackPort();

// 3. Start the harness Core (the "existing Core" of this smoke).
const harness = spawn(
  process.execPath,
  [
    join(dist, 'smoke', 'harness-core.cjs'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--install-id',
    INSTALL_ID,
    '--user-id',
    USER_ID,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let harnessLog = '';
harness.stdout.on('data', (chunk) => {
  harnessLog += String(chunk);
});
harness.stderr.on('data', (chunk) => {
  harnessLog += String(chunk);
});

try {
  const readiness = await withTimeout(
    new Promise((resolve, reject) => {
      harness.stdout.once('data', (chunk) => {
        const line = String(chunk)
          .split('\n')
          .find((candidate) => candidate.startsWith('{'));
        if (line === undefined) {
          reject(new Error(`harness readiness not a JSON line: ${String(chunk).slice(0, 120)}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      });
      harness.once('exit', (code) =>
        reject(
          new Error(`harness exited early (code ${String(code)}): ${harnessLog.slice(0, 400)}`),
        ),
      );
    }),
    30_000,
    'harness core start',
  );
  if (readiness.ready !== true || typeof readiness.port !== 'number') {
    fail(`harness readiness malformed: ${JSON.stringify(readiness)}`);
  }

  // 4. Launch the real Electron shell, hidden, pointed at the harness seam.
  const shell = spawn(
    electronBinary,
    [join(dist, 'main', 'main.cjs'), `--xdownload-smoke=${outPath}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${String(readiness.port)}`,
        XDOWNLOAD_SHELL_INSTALL_ID: INSTALL_ID,
        XDOWNLOAD_SHELL_USER_ID: USER_ID,
      },
    },
  );
  let shellStderr = '';
  shell.stderr.on('data', (chunk) => {
    shellStderr += String(chunk);
  });
  const shellCode = await withTimeout(
    new Promise((resolve, reject) => {
      shell.once('exit', (code) => resolve(code));
      shell.once('error', reject);
    }),
    120_000,
    'electron shell smoke run',
  );

  if (!existsSync(outPath)) {
    fail(
      `no verdict document at ${outPath}; shell exit ${String(shellCode)}; stderr: ${shellStderr.slice(0, 800)}`,
    );
  }
  const verdict = JSON.parse(readFileSync(outPath, 'utf8'));
  for (const check of verdict.checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`);
  }
  console.log(`electron=${verdict.electron} verdict ok=${String(verdict.ok)}`);
  process.exit(verdict.ok && shellCode === 0 ? 0 : 1);
} finally {
  if (harness.exitCode === null && !harness.killed) {
    harness.kill('SIGTERM');
  }
}
