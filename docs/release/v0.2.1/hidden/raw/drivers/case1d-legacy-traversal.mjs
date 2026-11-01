// Legacy-lane path containment: artifact scan + traversal contractId forgery.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, rawPipeRequest, runCli, logRun, ensureDir, sha256Hex, INSTALL_ID, USER_ID, PIPE, peer } from './lib.mjs';

const DIGEST = '31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be';

// 1) Artifact containment: the positive download's bytes must live ONLY under
//    core-root/artifacts with an encoded (fileSafeName) filename.
const artifactRoot = path.join(BASE, 'core-root', 'artifacts');
const hits = [];
const all = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else { all.push(f); if (sha256Hex(fs.readFileSync(f)) === DIGEST) hits.push(f); }
  }
})(artifactRoot);
logRun({ event: 'case1d-artifact-scan', hits, totalFiles: all.length });
console.log(JSON.stringify({ event: 'case1d-artifact-scan', hits, totalFiles: all.length }));

// 2) Traversal contractId forgery: mutate the captured contract template.
const templateFile = path.join(BASE, 'fixture', 'contract-template.json');
const raw = fs.readFileSync(templateFile, 'utf8');
const parsed = JSON.parse(raw);
// The journal row shape: {kind:'COMMAND', envelope:{...payload:{contract...}}}
const contract = parsed.envelope?.payload ?? parsed.payload ?? parsed;
const forged = JSON.parse(JSON.stringify(contract));
forged.contractId = 'contract-a/../../evil';
forged.requestedTarget = 'target-a/../../evil';
forged.requestedScope = { kind: 'single_resource', targetId: 'target-a/../../evil' };

const env = {
  schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
  kind: 'command', commandType: 'SUBMIT_CONTRACT',
  peer: peer(),
  requestId: 'req-forge-traversal', aggregateId: forged.contractId,
  expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
  payload: forged,
};
try {
  const r = await rawPipeRequest(env, { timeoutMs: 15000 });
  const diag = r?.diagnostics?.[0];
  logRun({ event: 'case1d-traversal-submit', outcome: r?.outcome, code: diag?.code ?? null, message: diag?.message ?? null });
  console.log(JSON.stringify({ event: 'case1d-traversal-submit', outcome: r?.outcome, code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 200) }));
} catch (e) {
  logRun({ event: 'case1d-traversal-submit', outcome: 'ERROR', message: e.message });
  console.log(JSON.stringify({ event: 'case1d-traversal-submit', outcome: 'ERROR', message: e.message.slice(0, 200) }));
}

// 3) Also via the CLI surface (operator-supplied --file payload).
const cliPayload = path.join(BASE, 'case1', 'forged-contract.json');
fs.writeFileSync(cliPayload, JSON.stringify(forged, null, 2));
const cli = runCli(['submit', '--file', cliPayload, '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
logRun({ event: 'case1d-traversal-cli', exit: cli.exit, stdout: cli.stdout.slice(0, 400) });
console.log(JSON.stringify({ event: 'case1d-traversal-cli', exit: cli.exit, stdout: cli.stdout.slice(0, 300) }));

// 4) Leak scan: nothing named *evil* anywhere under the evidence root's parent tmp.
const leaks = [];
(function walk2(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.name.toLowerCase().includes('evil')) leaks.push(f);
    if (e.isDirectory() && !e.name.startsWith('case1') ) walk2(f);
  }
})(BASE);
logRun({ event: 'case1d-leak-scan', leaks });
console.log(JSON.stringify({ event: 'case1d-leak-scan', leaks }));
process.exit(0);
