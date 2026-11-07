/**
 * #284/#285 T09-R1 packaged desktop smoke — real launcher, real Core (WIN32).
 *
 * Proves, against the COMPOSED installer payload bytes only (never the repo
 * dist/): the packaged desktop artifact is a double-clickable product:
 *
 *   1. positive: payload/desktop/xdownload.exe (renamed Electron 45.1.0)
 *      boots the frozen T07/T08 shell from payload bytes, connects to the
 *      REAL packaged Core host (payload/core/xdownload-core-host.js) over the
 *      loopback seam as a DESKTOP_UI peer, and the app-intrinsic smoke
 *      verdict (`--xdownload-smoke=<out.json>`, the shell's own readiness
 *      channel written by main.ts) reports renderer load, the closed IPC
 *      bridge and a reached Core (CONNECTED / REJECTED_PROJECTION);
 *   2. negative (Core absent): the exe still starts and stays truthful — the
 *      verdict reports the fail-closed DISCONNECTED state, the shell does not
 *      crash and does not fabricate a connection;
 *   3. negative (identity mismatch): the exe presents a different install id
 *      than the running Core's same-install/same-user scope — the seam
 *      refuses the peer (PEER_IDENTITY_REJECTED) and the shell again
 *      degrades to a truthful DISCONNECTED verdict.
 *
 * The evidence document (stdout + --out, default
 * build/evidence/windows-desktop-packaged-smoke.json) follows the durable
 * evidence shape of the other windows-*.json suites. Smoke tooling only —
 * never packaged, never shipped.
 *
 * Usage: node build/desktop-packaged-smoke.ts [--installer <installerRoot>]
 *          [--out <evidence.json>]
 * Exit codes: 0 all checks PASS; 1 a check FAILED; 2 typed refusal.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { CONTENT_VERSION, REPO_ROOT, VENDORED_ELECTRON_RUNTIME } from './build-config.ts';
import { installerDirName, INSTALLER_CONTENT_VERSION } from '../installers/compose-installer.ts';

interface EvidenceCheck {
  readonly id: string;
  readonly status: 'PASS' | 'FAIL';
  readonly detail: string;
}

interface EvidenceDocument {
  suite: string;
  overall: 'PASS' | 'FAIL';
  executedAt: string;
  environment: Record<string, string>;
  installer: {
    readonly root: string;
    readonly desktopExecutable: string;
    readonly desktopExecutableSha256: string;
    readonly electronVersion: string;
  };
  checks: EvidenceCheck[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${String(ms)}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function freeLoopbackPort(): Promise<number> {
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

function sha256File(full: string): string {
  return createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}

/** Wait for the first complete stdout line that parses as JSON. */
function awaitFirstJsonLine(
  child: ChildProcess,
  log: { text: string },
  timeoutMs: number,
  label: string,
): Promise<Record<string, unknown>> {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: unknown): void => {
        buffer += String(chunk);
        const line = buffer.split('\n').find((candidate) => candidate.trimStart().startsWith('{'));
        if (line === undefined) {
          return;
        }
        child.stdout?.off('data', onData);
        try {
          resolve(JSON.parse(line) as Record<string, unknown>);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('unparseable JSON line'));
        }
      };
      child.stdout?.on('data', onData);
      child.once('exit', (code) => {
        reject(
          new Error(`${label} exited early (code ${String(code)}): ${log.text.slice(0, 400)}`),
        );
      });
    }),
    timeoutMs,
    label,
  );
}

interface ShellRun {
  readonly code: number;
  readonly verdict: Record<string, unknown> | undefined;
  readonly stderr: string;
}

/**
 * Launch the packaged exe once with the given seam environment and wait for
 * its deterministic exit (the shell's smoke mode always writes the verdict
 * document, then exits 0 on PASS and 1 on a failed check).
 */
async function runShellSmoke(
  executable: string,
  verdictPath: string,
  env: NodeJS.ProcessEnv,
): Promise<ShellRun> {
  const child = spawn(executable, [`--xdownload-smoke=${verdictPath}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const code = await withTimeout(
    new Promise<number>((resolve, reject) => {
      child.once('exit', (exitCode) => resolve(exitCode ?? -1));
      child.once('error', reject);
    }),
    120_000,
    'packaged desktop shell smoke run',
  );
  const verdict = fs.existsSync(verdictPath)
    ? (JSON.parse(fs.readFileSync(verdictPath, 'utf8')) as Record<string, unknown>)
    : undefined;
  return { code, verdict, stderr };
}

interface VerdictCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

function verdictChecks(verdict: Record<string, unknown>): readonly VerdictCheck[] {
  return Array.isArray(verdict['checks']) ? (verdict['checks'] as readonly VerdictCheck[]) : [];
}

function findCheck(verdict: Record<string, unknown>, namePart: string): VerdictCheck | undefined {
  return verdictChecks(verdict).find((check) => check.name.includes(namePart));
}

/** Extract the `core.connection=<WORD>` fact from a verdict check detail. */
function extractCoreConnection(detail: string): string | null {
  const match = /core\.connection=([A-Z_]+)/u.exec(detail);
  return match === null ? null : (match[1] ?? null);
}

/**
 * Submit one length-prefixed seam frame (the loopback transport's wire
 * format, packages/core-seam transport-loopback.ts) to a running Core and
 * return its typed response. The frame carries a DESKTOP_UI peer identity so
 * the Core's per-frame authorizePeer is exercised exactly as the packaged
 * shell's frames are; the v0.2 intent shape is never processed because
 * authorization runs before routing, so a foreign peer cannot mutate Core
 * state.
 */
function seamProbe(
  port: number,
  installId: string,
  userId: string,
): Promise<{ outcome: string; diagnostics: readonly unknown[] }> {
  const frame = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: { installId, userId, surface: 'DESKTOP_UI' },
    requestId: `smoke-probe-${installId}`,
    aggregateId: 'ln-smoke-probe',
    issuedAt: new Date().toISOString(),
    payload: { intent: { requestId: `smoke-probe-${installId}`, lineageId: 'ln-smoke-probe' } },
  };
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    socket.on('connect', () => {
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }
      const declared = buffer.readUInt32BE(0);
      if (buffer.length - 4 < declared) {
        return;
      }
      const response = JSON.parse(buffer.subarray(4, 4 + declared).toString('utf8')) as {
        outcome?: string;
        diagnostics?: readonly unknown[];
      };
      socket.destroy();
      resolve({
        outcome: response.outcome ?? 'UNPARSEABLE',
        diagnostics: response.diagnostics ?? [],
      });
    });
    socket.on('error', reject);
    socket.on('end', () => reject(new Error('seam closed without an answer')));
  });
}

/** Start the REAL packaged Core host on a loopback port; returns its handle. */
async function startPackagedCore(
  payloadDir: string,
  rootDir: string,
  installId: string,
  userId: string,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      path.join(payloadDir, 'core', 'xdownload-core-host.js'),
      '--root',
      rootDir,
      '--install-id',
      installId,
      '--user-id',
      userId,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const log = { text: '' };
  child.stdout.on('data', (chunk) => {
    log.text += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log.text += String(chunk);
  });
  const ready = await awaitFirstJsonLine(child, log, 30_000, 'packaged core host start');
  if (ready['document'] !== 'xdownload.core-host.ready' || typeof ready['port'] !== 'number') {
    throw new Error(`packaged core host readiness malformed: ${JSON.stringify(ready)}`);
  }
  return {
    port: ready['port'],
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const installerRoot = path.resolve(
    flag('--installer') ??
      path.join(REPO_ROOT, 'out', 'installer', installerDirName(CONTENT_VERSION)),
  );
  const evidencePath = path.resolve(
    flag('--out') ??
      path.join(REPO_ROOT, 'build', 'evidence', 'windows-desktop-packaged-smoke.json'),
  );
  const payloadDir = path.join(installerRoot, 'payload');
  const executable = path.join(payloadDir, 'desktop', VENDORED_ELECTRON_RUNTIME.executable);

  const checks: EvidenceCheck[] = [];

  if (
    process.platform !== VENDORED_ELECTRON_RUNTIME.platform ||
    process.arch !== VENDORED_ELECTRON_RUNTIME.arch
  ) {
    process.stderr.write(
      `desktop-packaged-smoke: refusing to run on ${process.platform}-${process.arch}; the packaged desktop artifact only exists on the selected ${VENDORED_ELECTRON_RUNTIME.platform}-${VENDORED_ELECTRON_RUNTIME.arch} tuple\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(executable)) {
    process.stderr.write(
      `desktop-packaged-smoke: ${executable} not found; compose the installer (node installers/compose-installer.ts --version ${INSTALLER_CONTENT_VERSION}) first\n`,
    );
    process.exitCode = 2;
    return;
  }

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09r1-desktop-'));
  const evidence: EvidenceDocument = {
    suite: 'windows-desktop-packaged-smoke',
    overall: 'FAIL',
    executedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      node: process.version,
      executable: process.execPath,
    },
    installer: {
      root: installerRoot,
      desktopExecutable: executable,
      desktopExecutableSha256: sha256File(executable),
      electronVersion: VENDORED_ELECTRON_RUNTIME.version,
    },
    checks,
  };

  const INSTALL_ID = 'deskpkgsmoke';
  const USER_ID = 'deskpkgsmokeuser';
  const coreRoot = path.join(runRoot, 'core-root');
  fs.mkdirSync(coreRoot, { recursive: true });

  try {
    // ---------------------------------------------------------- 1. positive
    const core = await startPackagedCore(payloadDir, coreRoot, INSTALL_ID, USER_ID);
    try {
      const verdictPath = path.join(runRoot, 'positive-verdict.json');
      const run = await runShellSmoke(executable, verdictPath, {
        ...process.env,
        XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${String(core.port)}`,
        XDOWNLOAD_SHELL_INSTALL_ID: INSTALL_ID,
        XDOWNLOAD_SHELL_USER_ID: USER_ID,
      });
      const verdict = run.verdict;
      const coreCheck =
        verdict === undefined ? undefined : findCheck(verdict, 'core seam reachable');
      if (verdict === undefined) {
        passOrFail(
          checks,
          'packaged-desktop-exe-boots-and-renders',
          false,
          `no verdict document; exe exit ${String(run.code)}; stderr: ${run.stderr.slice(0, 400)}`,
        );
      } else {
        const bridgeCheck = findCheck(verdict, 'preload bridge exposes');
        const isolationCheck = findCheck(verdict, 'renderer isolated');
        const cspCheck = findCheck(verdict, 'restrictive CSP');
        const ok =
          run.code === 0 &&
          verdict['ok'] === true &&
          bridgeCheck?.pass === true &&
          isolationCheck?.pass === true &&
          cspCheck?.pass === true;
        passOrFail(
          checks,
          'packaged-desktop-exe-boots-and-renders',
          ok,
          `exe exit=${String(run.code)} verdict.ok=${String(verdict['ok'])} electron=${String(verdict['electron'])} ` +
            `bridge=${String(bridgeCheck?.pass)} isolated=${String(isolationCheck?.pass)} csp=${String(cspCheck?.pass)}`,
        );
        passOrFail(
          checks,
          'packaged-desktop-exe-reaches-packaged-core',
          coreCheck?.pass === true,
          `core reachability check: ${coreCheck === undefined ? 'absent' : `${coreCheck.pass ? 'PASS' : 'FAIL'} (${coreCheck.detail})`}`,
        );
      }
    } finally {
      await core.stop();
    }

    // --------------------------------------------- 2. negative: Core absent
    const deadPort = await freeLoopbackPort();
    const negativeVerdictPath = path.join(runRoot, 'negative-absent-verdict.json');
    const negativeRun = await runShellSmoke(executable, negativeVerdictPath, {
      ...process.env,
      XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${String(deadPort)}`,
      XDOWNLOAD_SHELL_INSTALL_ID: INSTALL_ID,
      XDOWNLOAD_SHELL_USER_ID: USER_ID,
    });
    const negativeVerdict = negativeRun.verdict;
    const absentCoreCheck =
      negativeVerdict === undefined ? undefined : findCheck(negativeVerdict, 'core seam reachable');
    const absentOk =
      negativeVerdict !== undefined &&
      negativeVerdict['ok'] === false &&
      negativeRun.code === 1 &&
      absentCoreCheck?.pass === false &&
      absentCoreCheck.detail.includes('DISCONNECTED');
    passOrFail(
      checks,
      'packaged-desktop-exe-fail-closed-without-core',
      absentOk,
      negativeVerdict === undefined
        ? `no verdict document; exe exit ${String(negativeRun.code)}; stderr: ${negativeRun.stderr.slice(0, 400)}`
        : `exe exit=${String(negativeRun.code)} verdict.ok=${String(negativeVerdict['ok'])} core detail=${absentCoreCheck?.detail ?? 'absent'} (truthful DISCONNECTED, no crash, no fabricated success)`,
    );

    // ----------------------------------- 3. negative: peer identity mismatch
    // The packaged shell's adapter maps ANY typed seam rejection to
    // REJECTED_PROJECTION (its designed "Core answered, refused" state), so a
    // foreign peer is not observable as DISCONNECTED exe-side. The honest
    // proof is two-sided: (a) seam-level — the REAL packaged Core must refuse
    // a foreign install-id frame with the typed PEER_IDENTITY_REJECTED while
    // accepting the matching identity (refusal is identity-specific, not
    // generic); (b) exe-level — the exe still boots, does not crash and never
    // claims CONNECTED against the refusing Core.
    const mismatchCoreRoot = path.join(runRoot, 'core-root-mismatch');
    fs.mkdirSync(mismatchCoreRoot, { recursive: true });
    const mismatchCore = await startPackagedCore(payloadDir, mismatchCoreRoot, 'coreside', USER_ID);
    try {
      const foreignProbe = await seamProbe(mismatchCore.port, 'shellside', USER_ID);
      const matchingProbe = await seamProbe(mismatchCore.port, 'coreside', USER_ID);
      const refusedForeign =
        foreignProbe.outcome === 'REJECTED' &&
        JSON.stringify(foreignProbe.diagnostics).includes('PEER_IDENTITY_REJECTED');
      const servedMatching =
        matchingProbe.outcome === 'REJECTED' &&
        !JSON.stringify(matchingProbe.diagnostics).includes('PEER_IDENTITY_REJECTED');
      passOrFail(
        checks,
        'packaged-core-refuses-foreign-peer-identity',
        refusedForeign && servedMatching,
        `foreign peer → ${foreignProbe.outcome} ${JSON.stringify(foreignProbe.diagnostics)}; matching peer → ${matchingProbe.outcome} ${JSON.stringify(matchingProbe.diagnostics)}`,
      );

      const mismatchVerdictPath = path.join(runRoot, 'negative-mismatch-verdict.json');
      const mismatchRun = await runShellSmoke(executable, mismatchVerdictPath, {
        ...process.env,
        XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${String(mismatchCore.port)}`,
        XDOWNLOAD_SHELL_INSTALL_ID: 'shellside',
        XDOWNLOAD_SHELL_USER_ID: USER_ID,
      });
      const mismatchVerdict = mismatchRun.verdict;
      const status = (mismatchVerdict?.['checks'] as readonly VerdictCheck[] | undefined)?.find(
        (check) => check.name.includes('core seam reachable'),
      );
      const coreState = extractCoreConnection(status?.detail ?? '');
      const exeHonest =
        mismatchVerdict !== undefined &&
        mismatchRun.code <= 1 &&
        coreState !== 'CONNECTED' &&
        coreState !== null;
      passOrFail(
        checks,
        'packaged-desktop-exe-truthful-against-refusing-core',
        exeHonest,
        mismatchVerdict === undefined
          ? `no verdict document; exe exit ${String(mismatchRun.code)}; stderr: ${mismatchRun.stderr.slice(0, 400)}`
          : `exe exit=${String(mismatchRun.code)} core.connection=${coreState ?? 'unparseable'} (answered-and-refused, never CONNECTED; no crash, no fabricated success)`,
      );
    } finally {
      await mismatchCore.stop();
    }
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }

  evidence.overall = checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL';
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(evidenceText);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, evidenceText, 'utf8');
  process.stdout.write(`desktop-packaged-smoke: ${evidence.overall} (${evidencePath})\n`);
  process.exitCode = evidence.overall === 'PASS' ? 0 : 1;
}

function passOrFail(checks: EvidenceCheck[], id: string, ok: boolean, detail: string): void {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
