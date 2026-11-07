// Case 3c — every surface's behavior while the Core is DOWN, then restart.
import path from 'node:path';
import { BASE, INSTALL_ID, USER_ID, PIPE, runCli, killCoreByPidFile, ensureCore, rawPipeRequest, logRun, peer } from './lib.mjs';

// Stop the Core (pid-file kill, no pattern matching).
const killedPid = killCoreByPidFile();
logRun({ event: 'case3c-core-stopped', killedPid });

const target = ['--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID];
const probes = [
  ['status', ['status', '--contract', 'contract-none', ...target]],
  ['download', ['download', '--url', 'http://127.0.0.1:49651/file.bin', '--timeout-ms', '8000', '--poll-ms', '200', ...target]],
  ['submit-v02-intent', null], // handled below via file
  ['cancel', ['cancel', '--contract', 'contract-none', '--expected-revision', '0', ...target]],
];
for (const [label, args] of probes) {
  if (args === null) continue;
  const r = runCli(args, { timeoutMs: 30000 });
  logRun({ event: 'case3c-cli-core-down', label, exit: r.exit, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 200), timedOut: r.timedOut });
  console.log(JSON.stringify({ label, exit: r.exit, stdout: r.stdout.slice(0, 240), stderr: r.stderr.slice(0, 160), timedOut: r.timedOut }));
}

// v0.2 raw query while down (connect must fail fast, not hang).
try {
  await rawPipeRequest({
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'query', route: 'v0.2', queryType: 'READ_JOB_PROJECTION',
    peer: peer(), requestId: 'req-c3c', aggregateId: 'lin-1base',
    issuedAt: new Date().toISOString(),
  }, { timeoutMs: 6000 });
  console.log(JSON.stringify({ label: 'v02-query-core-down', outcome: 'UNEXPECTED_RESPONSE' }));
} catch (e) {
  logRun({ event: 'case3c-v02-core-down', error: e.message.slice(0, 160) });
  console.log(JSON.stringify({ label: 'v02-query-core-down', outcome: 'ERROR', message: e.message.slice(0, 160) }));
}

// Restart the Core on the SAME durable root (journal replay path).
const { pid } = await ensureCore(path.join(BASE, 'core-root'), path.join(BASE, 'core.log'));
console.log(JSON.stringify({ label: 'core-restarted', pid }));
// Post-restart health: prior v0.2 lineage projection must still read.
await new Promise((r) => setTimeout(r, 1500));
try {
  const r = await rawPipeRequest({
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'query', route: 'v0.2', queryType: 'READ_JOB_PROJECTION',
    peer: peer(), requestId: 'req-c3c-after', aggregateId: 'lin-1base',
    issuedAt: new Date().toISOString(),
  }, { timeoutMs: 10000 });
  console.log(JSON.stringify({ label: 'v02-query-after-restart', outcome: r?.outcome, status: r?.projection?.status ?? null }));
} catch (e) {
  console.log(JSON.stringify({ label: 'v02-query-after-restart', outcome: 'ERROR', message: e.message.slice(0, 160) }));
}
process.exit(0);
