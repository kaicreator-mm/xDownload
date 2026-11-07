// Legacy-lane fixture: positive S1 download (artifact containment evidence +
// contract template for forgery tests), against the frozen Core + CLI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  BASE, INSTALL_ID, USER_ID, PIPE, PORT_BASE, runCli, logRun, ensureDir, sha256Hex,
} from './lib.mjs';

const FIXDIR = path.join(BASE, 'fixture');
ensureDir(FIXDIR);

// Deterministic 256 KiB payload.
const FILE_BYTES = Buffer.alloc(256 * 1024);
for (let i = 0; i < FILE_BYTES.length; i += 1) FILE_BYTES[i] = i % 251;
const FILE_DIGEST = sha256Hex(FILE_BYTES);
fs.writeFileSync(path.join(FIXDIR, 'file.bin'), FILE_BYTES);

let requests = [];
const server = http.createServer((req, res) => {
  requests.push({ t: new Date().toISOString(), url: req.url });
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(FILE_BYTES.length) });
  res.end(FILE_BYTES);
});
await new Promise((r) => server.listen(PORT_BASE, '127.0.0.1', r));
logRun({ event: 'fixture-ready', port: PORT_BASE, sha256: FILE_DIGEST, bytes: FILE_BYTES.length });

const target = ['--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID];
const dl = runCli([
  'download', '--url', `http://127.0.0.1:${PORT_BASE}/file.bin`,
  '--sha256', FILE_DIGEST, '--total-bytes', String(FILE_BYTES.length),
  '--timeout-ms', '90000', '--poll-ms', '200', ...target,
], { timeoutMs: 120000 });
console.log(JSON.stringify({ event: 'legacy-download', exit: dl.exit, stdout: dl.stdout.slice(0, 600), stderr: dl.stderr.slice(0, 200) }));

// Where did the bytes land? Scan the entire core-root for the digest.
const found = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.bin')) {
      const bytes = fs.readFileSync(full);
      if (sha256Hex(bytes) === FILE_DIGEST) found.push(full);
    }
  }
})(path.join(BASE, 'core-root'));
logRun({ event: 'legacy-artifact-locations', found, fixtureRequests: requests.length });
console.log(JSON.stringify({ event: 'legacy-artifact-locations', found, fixtureRequests: requests.length }));

// Contract template for forgery tests: newest SUBMIT_CONTRACT journal row.
const journal = path.join(BASE, 'core-root', 'seam-journal.jsonl');
let template = null;
if (fs.existsSync(journal)) {
  const rows = fs.readFileSync(journal, 'utf8').trim().split(/\r?\n/).filter((l) => l.includes('"SUBMIT_CONTRACT"'));
  if (rows.length > 0) {
    template = JSON.parse(rows[rows.length - 1]);
    fs.writeFileSync(path.join(FIXDIR, 'contract-template.json'), JSON.stringify(template, null, 2));
  }
}
console.log(JSON.stringify({ event: 'template-captured', hasTemplate: template !== null, requestId: template?.requestId ?? null }));
server.close();
process.exit(0);
