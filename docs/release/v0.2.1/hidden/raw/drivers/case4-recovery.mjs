// Case 4 — kill the Core MID-TRANSFER (real断流), restart, demand truthful
// status: no fake COMPLETE, partial bytes classified, resubmit semantics.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  BASE, INSTALL_ID, USER_ID, PIPE, CLI, runCli, killCoreByPidFile, ensureCore,
  logRun, isCoreUp, sleep,
} from './lib.mjs';

// 1) Start a glacial download (4 MiB @ ~16 KB/s ≈ 4+ min) without waiting.
let stdout = '';
const child = spawn(process.execPath, [CLI, 'download', '--url', 'http://127.0.0.1:49651/glacial.bin',
  '--timeout-ms', '300000', '--poll-ms', '500', '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID], { windowsHide: true });
child.stdout.on('data', (c) => { stdout += c; });
child.stderr.on('data', () => {});
let cliExit = null;
child.on('exit', (code) => { cliExit = code; });

// Wait for the transfer to be in flight (fixture sees /glacial.bin), then kill.
const reqLog = path.join(BASE, 'fixture-requests.jsonl');
async function glacialTransferSeen() {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (fs.existsSync(reqLog) && fs.readFileSync(reqLog, 'utf8').includes('/glacial.bin')) return true;
    await sleep(300);
  }
  return false;
}
const seen = await glacialTransferSeen();
// The CLI only prints the contract id in its FINAL document; grab the durable
// aggregate id from the seam journal instead (readable even while the Core is
// down — it is a plain JSONL file).
function lastSubmittedContract() {
  const journal = path.join(BASE, 'core-root', 'seam-journal.jsonl');
  if (!fs.existsSync(journal)) return null;
  const rows = fs.readFileSync(journal, 'utf8').trim().split(/\r?\n/).filter((l) => l.includes('"SUBMIT_CONTRACT"'));
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[rows.length - 1]).envelope?.aggregateId ?? null;
  } catch { return null; }
}
let contractId = lastSubmittedContract();
// Fallback: stdout regex (in case the CLI already finished).
if (contractId === null) {
  const m = stdout.match(/contract-s1-[a-z0-9-]+/);
  contractId = m ? m[0] : null;
}
await sleep(3000); // stay clearly mid-transfer (4+ min total, killed at ~10 s in)
logRun({ event: 'case4-inflight', slowSeen: seen, contractId, stdoutHead: stdout.slice(0, 300) });
console.log(JSON.stringify({ label: 'inflight', slowSeen: seen, contractId }));

const killedPid = killCoreByPidFile();
logRun({ event: 'case4-core-killed-mid-transfer', killedPid, contractId });
console.log(JSON.stringify({ label: 'core-killed-mid-transfer', killedPid, contractId }));

// CLI must terminate truthfully (transport error), never a fake success.
const cliDone = await new Promise((resolve) => {
  const t = setInterval(() => { if (cliExit !== null) { clearInterval(t); resolve(cliExit); } }, 300);
  setTimeout(() => { clearInterval(t); resolve('STILL_RUNNING'); }, 30000);
});
logRun({ event: 'case4-cli-after-kill', cliExit: cliDone, stdoutTail: stdout.slice(-400) });
console.log(JSON.stringify({ label: 'cli-after-kill', cliExit: cliDone, stdoutTail: stdout.slice(-300) }));

// Partial bytes snapshot BEFORE restart (staging area).
const artRoot = path.join(BASE, 'core-root', 'artifacts');
function snapshotArtifacts() {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push({ path: path.relative(artRoot, f), bytes: fs.statSync(f).size });
    }
  })(artRoot);
  return out;
}
const partialBefore = snapshotArtifacts();
logRun({ event: 'case4-partial-before-restart', partialBefore });
console.log(JSON.stringify({ label: 'partial-before-restart', partialBefore }));

// 2) Restart the Core on the SAME root; recovery classification runs.
const { pid } = await ensureCore(path.join(BASE, 'core-root'), path.join(BASE, 'core.log'));
console.log(JSON.stringify({ label: 'core-restarted', pid }));
await sleep(3000);

// 3) Status must be truthful (never COMPLETE for a killed transfer).
if (contractId !== null) {
  const st = runCli(['status', '--contract', contractId, '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
  logRun({ event: 'case4-status-after-restart', exit: st.exit, stdout: st.stdout.slice(0, 900) });
  console.log(JSON.stringify({ label: 'status-after-restart', exit: st.exit, stdout: st.stdout.slice(0, 700) }));
  const wait = runCli(['wait', '--contract', contractId, '--timeout-ms', '15000', '--poll-ms', '500', '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
  logRun({ event: 'case4-wait-after-restart', exit: wait.exit, stdout: wait.stdout.slice(0, 900) });
  console.log(JSON.stringify({ label: 'wait-after-restart-15s', exit: wait.exit, stdout: wait.stdout.slice(0, 700) }));
  // The restart reconcile may re-drive the transfer truthfully; observe the
  // eventual terminal (bounded, up to 6 min).
  const wait2 = runCli(['wait', '--contract', contractId, '--timeout-ms', '360000', '--poll-ms', '1000', '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID], { timeoutMs: 400000 });
  logRun({ event: 'case4-wait-eventual', exit: wait2.exit, stdout: wait2.stdout.slice(0, 900) });
  console.log(JSON.stringify({ label: 'wait-eventual', exit: wait2.exit, stdout: wait2.stdout.slice(0, 700) }));
}

// 4) Filesystem truth after recovery: partial bytes classified, none finalized.
const after = snapshotArtifacts();
logRun({ event: 'case4-artifacts-after-recovery', after });
console.log(JSON.stringify({ label: 'artifacts-after-recovery', after }));
process.exit(0);
