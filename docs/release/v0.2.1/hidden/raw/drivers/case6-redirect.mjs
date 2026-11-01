// Case 6 — redirect adversarial matrix on the legacy S1 lane (real fixture 302s).
import { INSTALL_ID, USER_ID, PIPE, runCli, logRun } from './lib.mjs';

const target = ['--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID];
const cases = [
  ['redirect-samehost-undeclared', ['download', '--url', 'http://127.0.0.1:49651/redirect-to-file.bin',
    '--timeout-ms', '30000', '--poll-ms', '200', ...target]],
  ['redirect-foreign-undeclared', ['download', '--url', 'http://127.0.0.1:49651/redirect-foreign.bin',
    '--timeout-ms', '30000', '--poll-ms', '200', ...target]],
  ['redirect-foreign-declared', ['download', '--url', 'http://127.0.0.1:49651/redirect-foreign.bin',
    '--redirect-host', '127.0.0.1:49652', '--timeout-ms', '30000', '--poll-ms', '200', ...target]],
  ['redirect-foreign-wrong-declared', ['download', '--url', 'http://127.0.0.1:49651/redirect-foreign.bin',
    '--redirect-host', '127.0.0.1:9', '--timeout-ms', '30000', '--poll-ms', '200', ...target]],
  ['redirect-loop', ['download', '--url', 'http://127.0.0.1:49651/redirect-loop.bin',
    '--timeout-ms', '30000', '--poll-ms', '200', ...target]],
  ['redirect-host-malformed-flag', ['download', '--url', 'http://127.0.0.1:49651/file.bin',
    '--redirect-host', 'evil/host\\x', '--timeout-ms', '5000', '--poll-ms', '200', ...target]],
  ['redirect-nine-hosts', ['download', '--url', 'http://127.0.0.1:49651/file.bin',
    '--redirect-host', 'h1.example.com', '--redirect-host', 'h2.example.com', '--redirect-host', 'h3.example.com',
    '--redirect-host', 'h4.example.com', '--redirect-host', 'h5.example.com', '--redirect-host', 'h6.example.com',
    '--redirect-host', 'h7.example.com', '--redirect-host', 'h8.example.com', '--timeout-ms', '5000', '--poll-ms', '200', ...target]],
];
for (const [label, args] of cases) {
  const r = runCli(args, { timeoutMs: 70000 });
  let stopReason = null;
  let evidence = null;
  try {
    const j = JSON.parse(r.stdout);
    stopReason = j.StopReason ?? j.outcome ?? null;
    evidence = j.target_evidence_basis ?? null;
  } catch { /* error doc */ }
  logRun({ event: 'case6', label, exit: r.exit, stopReason, evidence, stdout: r.stdout.slice(0, 500) });
  console.log(JSON.stringify({ label, exit: r.exit, stopReason, evidence, head: r.stdout.slice(0, 220) }));
}
process.exit(0);
