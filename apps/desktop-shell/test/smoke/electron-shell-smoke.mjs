/*
 * T07 minimal non-installed shell smoke driver.
 *
 * Proves, against the REAL pinned Electron binary and a REAL seam authority
 * in another process:
 *   1. the shell launches a hidden, sandboxed window from local assets;
 *   2. the preload bridge exposes exactly the allowlisted method set and is frozen;
 *   3. the page serves a restrictive CSP on a file: origin;
 *   4. renderer isolation holds (no require/process) and navigation and
 *      window.open are refused;
 *   5. the shell's desktop adapter connects over the seam as a DESKTOP_UI
 *      peer and the Core's typed answer is observed (no DISCONNECTED claim).
 *
 * The verdict is JSON (stdout + --out path); exit code 0 only when every
 * check passes. Smoke tooling only — never packaged, never shipped.
 *
 * v0.2.2 U06 deterministic terminal fixtures (test-only):
 *   --fixture=ACTIVE|COMPLETE|FAILED|CANCELLED  run one fixture
 *   --fixtures                                  run all four, sequentially
 *   --evidence-dir=<dir>                        evidence output directory
 *                                               (default: a fresh temp dir)
 *
 * Fixture mode drives the REAL renderer through the REAL add/preview/confirm
 * flow over CDP, exercises the actual Cancel control for CANCELLED, and
 * records BOTH the raw Core projection (all six terminal dimensions when
 * present) AND the actual renderer DOM/status/filter counts as separate
 * evidence. COMPLETE/FAILED terminal results are injected by the harness
 * through the same seam only after real submit admission. A valid
 * single-resource COMPLETE has coverage=NOT_APPLICABLE; the renderer's
 * current "ended · not completed" label for that honest state is recorded,
 * never upgraded to a completed claim. Each run uses a fresh Electron
 * user-data directory, unique evidence files and deterministic cleanup;
 * realDownloads/nativeHostCalls are recorded as labeled
 * SOURCE_SCOPE_ASSERTION zero counts (the fixture journey drives only the
 * existing Core Seam — no downloader or Native Host bridge is reachable on
 * that path by construction), not runtime-measured counters.
 */
/* global process, console, setTimeout, clearTimeout, fetch, WebSocket, Buffer */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..', '..');
const dist = join(packageRoot, 'dist');
const require = createRequire(import.meta.url);

const FIXTURES = ['ACTIVE', 'COMPLETE', 'FAILED', 'CANCELLED'];

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
const fixtureFlag = (() => {
  const flag = process.argv.find((value) => value.startsWith('--fixture='));
  return flag === undefined ? null : flag.slice('--fixture='.length);
})();
const runAllFixtures = process.argv.includes('--fixtures');
const evidenceDirFlag = (() => {
  const flag = process.argv.find((value) => value.startsWith('--evidence-dir='));
  return flag === undefined ? null : flag.slice('--evidence-dir='.length);
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

// ---------------------------------------------------------------------------
// Legacy default path (no --fixture/--fixtures): single ACTIVE smoke via the
// shell's own verdict document. Unchanged from the original driver.
// ---------------------------------------------------------------------------
async function runDefaultSmoke() {
  const port = await freeLoopbackPort();

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
}

// ---------------------------------------------------------------------------
// U06 fixture path: real renderer drive over CDP against the real harness.
// ---------------------------------------------------------------------------
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ''}`);
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

async function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id !== 'number') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) waiter.reject(new Error('CDP socket closed'));
    pending.clear();
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result?.value;
  };
  return { socket, send, evaluate };
}

function expectedLineageFor(fixture) {
  if (fixture === 'ACTIVE') return 'ACTIVE';
  if (fixture === 'CANCELLED') return 'CANCELLED';
  return 'TERMINAL';
}

function terminalMatches(fixture, terminal) {
  if (terminal === null || typeof terminal !== 'object') return false;
  if (fixture === 'COMPLETE') {
    return (
      terminal.requestFulfillment === 'COMPLETE' &&
      terminal.targetResolution === 'RESOLVED' &&
      terminal.selectionAcquisition === 'COMPLETE' &&
      terminal.coverage === 'NOT_APPLICABLE' &&
      terminal.stopReason === 'NONE' &&
      terminal.validationSummary?.status === 'ALL_PASSED'
    );
  }
  if (fixture === 'FAILED') {
    return (
      terminal.requestFulfillment === 'UNSATISFIED' &&
      terminal.targetResolution === 'BLOCKED' &&
      terminal.selectionAcquisition === 'NOT_STARTED' &&
      terminal.coverage === 'NOT_APPLICABLE' &&
      terminal.stopReason === 'AUTH_FAILED' &&
      terminal.validationSummary?.status === 'NOT_PERFORMED'
    );
  }
  return false;
}

async function runFixtureScenario(fixture, evidenceDir, electronVersion) {
  const seamPort = await freeLoopbackPort();
  const debugPort = await freeLoopbackPort();
  const userDataDir = join(evidenceDir, 'user-data', fixture.toLowerCase());
  mkdirSync(userDataDir, { recursive: true });

  const harnessEvents = [];
  let harnessText = '';
  const harness = spawn(
    process.execPath,
    [
      join(dist, 'smoke', 'harness-core.cjs'),
      '--host',
      '127.0.0.1',
      '--port',
      String(seamPort),
      '--install-id',
      INSTALL_ID,
      '--user-id',
      USER_ID,
      '--fixture',
      fixture,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  harness.stdout.on('data', (chunk) => {
    harnessText += String(chunk);
    for (const line of String(chunk).split(/\r?\n/u)) {
      if (!line.startsWith('{')) continue;
      try {
        harnessEvents.push(JSON.parse(line));
      } catch {
        // partial line retained in the raw log
      }
    }
  });
  harness.stderr.on('data', (chunk) => {
    harnessText += String(chunk);
  });

  let shell;
  let shellText = '';
  let result;
  let client;
  try {
    const ready = await waitFor(() => {
      const event = harnessEvents.find((item) => item.ready === true);
      return event ?? (harness.exitCode !== null ? Promise.reject(new Error(harnessText)) : null);
    }, `harness ${fixture} readiness`);
    shell = spawn(
      electronBinary,
      [
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${String(debugPort)}`,
        '--remote-allow-origins=*',
        join(dist, 'main', 'main.cjs'),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${String(ready.port)}`,
          XDOWNLOAD_SHELL_INSTALL_ID: INSTALL_ID,
          XDOWNLOAD_SHELL_USER_ID: USER_ID,
        },
      },
    );
    shell.stdout.on('data', (chunk) => {
      shellText += String(chunk);
    });
    shell.stderr.on('data', (chunk) => {
      shellText += String(chunk);
    });

    const pageTarget = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${String(debugPort)}/json/list`);
      const pages = await response.json();
      const page = pages.find(
        (item) => item.type === 'page' && String(item.url).startsWith('file:'),
      );
      return page ?? null;
    }, 'electron remote-debug target');
    const versionResponse = await fetch(`http://127.0.0.1:${String(debugPort)}/json/version`);
    const browserVersion = await versionResponse.json();
    client = await cdpClient(pageTarget.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await waitFor(
      () =>
        client.evaluate(
          `document.readyState === 'complete' && !!window.xdownloadShell && !document.getElementById('app').hidden`,
        ),
      'renderer ready',
    );

    // Real Desktop add flow: open the add form, fill the URL, submit, and
    // confirm the Core preview (the same surface path a user drives).
    await client.evaluate(`(() => {
      document.getElementById('new-download').click();
      const input = document.getElementById('url');
      input.value = 'https://fixture.invalid/${fixture.toLowerCase()}.mp4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('add-form').requestSubmit();
      return true;
    })()`);
    await waitFor(
      () => client.evaluate(`!document.getElementById('preview').hidden`),
      'Core preview',
    );
    await client.evaluate(`document.getElementById('preview-confirm').click(); true`);
    await waitFor(
      () => client.evaluate(`document.querySelectorAll('#jobs-body tr').length === 1`),
      'admitted job row',
    );

    if (fixture === 'CANCELLED') {
      // The actual renderer Cancel control — never a fabricated terminal.
      await client.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('#jobs-body button')).find(
          (item) => item.textContent === '取消' && !item.disabled,
        );
        if (!button) throw new Error('enabled cancel button not found');
        button.click();
        return true;
      })()`);
    }

    const expectedLineage = expectedLineageFor(fixture);
    const list = await waitFor(async () => {
      const current = await client.evaluate(`window.xdownloadShell.managerRefresh()`);
      return current.jobs?.[0]?.lineageStatus === expectedLineage ? current : null;
    }, `${fixture} Core projection`);
    const row = list.jobs[0];

    // Raw protocol truth and UI presentation are SEPARATE evidence.
    const dom = await client.evaluate(`(() => ({
      status: document.querySelector('#jobs-body .status-tag')?.textContent ?? null,
      statusTitle: document.querySelector('#jobs-body .status-tag')?.title ?? null,
      rowText: document.querySelector('#jobs-body tr')?.textContent ?? null,
      counts: {
        all: document.getElementById('count-all').textContent,
        active: document.getElementById('count-active').textContent,
        complete: document.getElementById('count-complete').textContent,
        failed: document.getElementById('count-failed').textContent,
      },
    }))()`);

    const projectionPass =
      row.present === true &&
      row.lineageStatus === expectedLineage &&
      (fixture === 'ACTIVE' || fixture === 'CANCELLED'
        ? row.terminal === null
        : terminalMatches(fixture, row.terminal));

    let screenshotPath = null;
    try {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
      screenshotPath = join(evidenceDir, `desktop-${fixture.toLowerCase()}.png`);
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    } catch (error) {
      console.log(`${fixture}: screenshot unavailable: ${String(error)}`);
    }

    result = {
      fixture,
      projectionPass,
      expectedLineage,
      coreProjection: row,
      dom,
      // Honest display boundary: a valid single-resource COMPLETE
      // (coverage=NOT_APPLICABLE) currently renders "ended · not completed";
      // record the actual label, never assert a completed UI claim.
      rendererShowsCompletedLabel: dom.status === '已完成',
      browserVersion,
      electronVersion,
      nodeVersion: process.version,
      harnessEvents,
      harnessLogTail: harnessText.slice(-2000),
      shellLogTail: shellText.slice(-2000),
      screenshotPath,
      // P2 repair (web source-review): labeled source-scope zero-side-effect
      // assertions, not runtime-measured counters.
      zeroSideEffects: {
        realDownloads: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
        nativeHostCalls: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
      },
    };
  } catch (error) {
    result = {
      fixture,
      projectionPass: false,
      error: String(error),
      electronVersion,
      nodeVersion: process.version,
      harnessEvents,
      harnessLogTail: harnessText.slice(-2000),
      shellLogTail: shellText.slice(-2000),
      zeroSideEffects: {
        realDownloads: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
        nativeHostCalls: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
      },
    };
  } finally {
    if (client) {
      void client.send('Browser.close').catch(() => undefined);
      client.socket.close();
    }
    if (shell && shell.exitCode === null && shell.signalCode === null) shell.kill('SIGTERM');
    if (harness.exitCode === null && harness.signalCode === null) harness.kill('SIGTERM');
    if (shell) await Promise.race([childExit(shell), delay(5_000)]);
    await Promise.race([childExit(harness), delay(5_000)]);
    // Deterministic cleanup gate: no Electron/harness process may remain.
    if (shell && shell.exitCode === null && shell.signalCode === null) {
      shell.kill('SIGKILL');
      await Promise.race([childExit(shell), delay(3_000)]);
    }
    if (harness.exitCode === null && harness.signalCode === null) {
      harness.kill('SIGKILL');
      await Promise.race([childExit(harness), delay(3_000)]);
    }
  }
  result.shellExitCode = shell?.exitCode ?? null;
  result.shellSignalCode = shell?.signalCode ?? null;
  result.harnessExitCode = harness.exitCode ?? null;
  result.harnessSignalCode = harness.signalCode ?? null;
  result.processesCleanedUp =
    (shell === undefined || shell.exitCode !== null || shell.signalCode !== null) &&
    (harness.exitCode !== null || harness.signalCode !== null);
  writeFileSync(
    join(evidenceDir, `desktop-${fixture.toLowerCase()}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  // The isolated user-data directory is per-run residue; remove it once the
  // run settled. Evidence JSON/PNG above are the durable artifacts.
  rmSync(userDataDir, { recursive: true, force: true });
  console.log(
    `${result.projectionPass ? 'PASS' : 'FAIL'}  ${fixture} — lineage=${result.expectedLineage ?? '?'} ` +
      `domStatus=${result.dom?.status ?? '-'} counts=${JSON.stringify(result.dom?.counts ?? null)} ` +
      `error=${result.error ?? 'none'}`,
  );
  return result;
}

async function runFixtureMode() {
  const fixtures = runAllFixtures ? FIXTURES : [fixtureFlag ?? 'ACTIVE'];
  for (const fixture of fixtures) {
    if (!FIXTURES.includes(fixture)) {
      fail(`unknown --fixture '${fixture}' (expected ${FIXTURES.join('|')})`);
    }
  }
  const evidenceDir = evidenceDirFlag ?? mkdtempSync(join(tmpdir(), 'xd-shell-smoke-evidence-'));
  mkdirSync(evidenceDir, { recursive: true });
  const electronVersion = require('electron/package.json').version;
  const results = [];
  for (const fixture of fixtures) {
    results.push(await runFixtureScenario(fixture, evidenceDir, electronVersion));
  }
  const ok = results.every((item) => item.projectionPass === true);
  writeFileSync(
    join(evidenceDir, 'desktop-summary.json'),
    `${JSON.stringify({ ok, results }, null, 2)}\n`,
  );
  console.log(`evidence dir: ${evidenceDir}`);
  console.log(`DESKTOP_FIXTURES_EXIT=${ok ? 0 : 1}`);
  process.exit(ok ? 0 : 1);
}

if (fixtureFlag !== null || runAllFixtures) {
  await runFixtureMode();
} else {
  await runDefaultSmoke();
}
