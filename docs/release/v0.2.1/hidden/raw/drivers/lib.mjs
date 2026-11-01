// T19 hidden validation shared driver library.
// Frozen candidate (read-only): payload of xdownload-v0.2.1-windows-x64.
// All artifacts under C:/xDev/kAiCreator/_tmp/v021/t19final/.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const BASE = 'C:/xDev/kAiCreator/_tmp/v021/t19final';
export const PAYLOAD = 'C:/xDev/kAiCreator/xDownload/xd-v021-finalval/out/installer/xdownload-v0.2.1-windows-x64/payload';
export const CORE = path.join(PAYLOAD, 'core/xdownload-core-host.js');
export const CLI = path.join(PAYLOAD, 'cli/xdownload-cli.js');
export const DESKTOP_EXE = path.join(PAYLOAD, 'desktop/xdownload.exe');
export const BROKER = path.join(PAYLOAD, 'native-host/xdownload-broker-host.js');
export const INSTALL_ID = 't19h';
export const USER_ID = '15549';
export const PIPE = String.raw`\\.\pipe\xdownload-core-${INSTALL_ID}`;
export const PORT_BASE = 49651;
export const RUNS = path.join(BASE, 'runs.ndjson');

export function logRun(entry) {
  fs.appendFileSync(RUNS, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function envRecord() {
  const node = spawnSync(process.execPath, ['-v'], { encoding: 'utf8' });
  return {
    node: node.stdout.trim(),
    platform: process.platform,
    arch: process.arch,
    installId: INSTALL_ID,
    userId: USER_ID,
    pipe: PIPE,
    portBase: PORT_BASE,
    payload: PAYLOAD,
    zipNote: 'xdownload-v0.2.1-windows-x64.zip 9ea81169...(controller-recorded)',
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- core host
let coreChild = null;

/** True when the t19h pipe accepts a connection (Core is up). */
export function isCoreUp(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(PIPE, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
  });
}

/**
 * Start the Core DETACHED (survives this driver's exit; cleaned up by the
 * final teardown via /pid file + taskkill).
 */
export function startCoreDetached(rootDir, logFile) {
  ensureDir(rootDir);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [CORE, '--root', rootDir, '--install-id', INSTALL_ID, '--user-id', USER_ID, '--pipe-name', PIPE], {
    windowsHide: true,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(path.join(BASE, 'core.pid'), String(child.pid));
  logRun({ event: 'core-start-detached', pid: child.pid, rootDir, logFile });
  return child.pid;
}

export async function ensureCore(rootDir, logFile, { waitReadyMs = 60000 } = {}) {
  if (await isCoreUp()) {
    logRun({ event: 'core-already-up' });
    return { pid: Number(fs.readFileSync(path.join(BASE, 'core.pid'), 'utf8').trim()) };
  }
  const pid = startCoreDetached(rootDir, logFile);
  const started = Date.now();
  while (Date.now() - started < waitReadyMs) {
    if (await isCoreUp()) {
      logRun({ event: 'core-ready-wait-ok', pid, ms: Date.now() - started });
      return { pid };
    }
    await sleep(500);
  }
  throw new Error('core not ready within ' + waitReadyMs + 'ms; see ' + logFile);
}

/** Kill the detached core by pid file (taskkill /PID /T /F — no pattern matching). */
export function killCoreByPidFile() {
  const pidFile = path.join(BASE, 'core.pid');
  if (!fs.existsSync(pidFile)) return null;
  const pid = fs.readFileSync(pidFile, 'utf8').trim();
  const r = spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { encoding: 'utf8' });
  logRun({ event: 'core-killed', pid, taskkillExit: r.status, out: (r.stdout + r.stderr).trim().slice(0, 300) });
  fs.unlinkSync(pidFile);
  return pid;
}

export function startCore(rootDir, { waitReadyMs = 20000 } = {}) {
  ensureDir(rootDir);
  coreChild = spawn(process.execPath, [CORE, '--root', rootDir, '--install-id', INSTALL_ID, '--user-id', USER_ID, '--pipe-name', PIPE], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  coreChild.stdout.on('data', (c) => out.push(String(c)));
  coreChild.stderr.on('data', (c) => out.push(String(c)));
  coreChild.on('exit', (code, signal) => logRun({ event: 'core-exit', code, signal, rootDir }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('core not ready: ' + out.join('').slice(-2000))), waitReadyMs);
    const check = () => {
      const text = out.join('');
      const line = text.split(/\r?\n/).find((l) => l.includes('xdownload.core-host.ready'));
      if (line) {
        clearTimeout(timer);
        logRun({ event: 'core-ready', rootDir, readyLine: line.slice(0, 400) });
        resolve({ child: coreChild, output: text });
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

export function killCore(label = 'killCore') {
  if (coreChild !== null) {
    const pid = coreChild.pid;
    coreChild.kill('SIGKILL');
    logRun({ event: 'core-killed', label, pid });
    coreChild = null;
    return pid;
  }
  return null;
}

export function corePid() {
  return coreChild === null ? null : coreChild.pid;
}

// ---------------------------------------------------------------- CLI
export function runCli(args, { timeoutMs = 90000 } = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const entry = {
    cmd: ['node', 'xdownload-cli.js', ...args.map((a) => (a === PIPE ? '<PIPE>' : a))].join(' '),
    exit: r.status,
    ms: Date.now() - started,
    stdout: (r.stdout ?? '').trim().slice(0, 4000),
    stderr: (r.stderr ?? '').trim().slice(0, 2000),
    timedOut: r.error?.code === 'ETIMEDOUT',
  };
  logRun({ event: 'cli', ...entry });
  return entry;
}

// ---------------------------------------------------------------- raw pipe client
// Length-prefixed seam request over the Windows named pipe via a koffi
// client opened with the impersonation QoS the Core's OS-verified admission
// requires. Runs in a worker thread so a silent refusal (server closes the
// pipe) cannot hang the driver; the thread's synchronous CreateFileW/ReadFile
// is fenced by the timeout race.
import { Worker } from 'node:worker_threads';

const RAWPIPE_WORKER = new URL('./rawpipe-worker.mjs', import.meta.url);

export function rawPipeRequest(envelope, { timeoutMs = 10000, pipeName = PIPE } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(RAWPIPE_WORKER, { workerData: { pipeName, envelopeJson: JSON.stringify(envelope) } });
    const timer = setTimeout(() => {
      worker.terminate().catch(() => undefined);
      reject(new Error('raw pipe request timeout (silent refusal or hang)'));
    }, timeoutMs);
    worker.once('message', (msg) => {
      clearTimeout(timer);
      worker.terminate().catch(() => undefined);
      if (msg.ok) {
        logRun({ event: 'raw-pipe', request: summarize(envelope), response: msg.value });
        resolve(msg.value);
      } else {
        logRun({ event: 'raw-pipe', request: summarize(envelope), error: msg.error });
        reject(new Error(msg.error));
      }
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function summarize(envelope) {
  const e = { ...envelope };
  if (e.peer) e.peer = { ...e.peer, _presented: true };
  if (e.payload && typeof e.payload === 'object') e.payload = { ...e.payload };
  return e;
}

export function seamEnvelope({ commandType, aggregateId, payload, requestId, peer, expectedRevision = 0 }) {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command',
    commandType,
    peer,
    requestId,
    aggregateId,
    expectedRevision,
    correlation: {},
    issuedAt: new Date().toISOString(),
    payload,
  };
}

export function peer(overrides = {}) {
  return { installId: INSTALL_ID, userId: USER_ID, surface: 'CLI', ...overrides };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
