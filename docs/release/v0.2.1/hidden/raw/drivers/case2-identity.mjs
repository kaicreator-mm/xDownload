// Case 2 — identity forgery matrix against the frozen Core seam.
// 2a/2b wrong install-id / user-id, 2c malformed ids, 2d unknown surface kind,
// 2e extra peer field, 2f surface impersonation (DESKTOP_UI / BROWSER_EXTENSION
// on CLI-gated commands), 2g second Core on the same pipe (singleton).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  BASE, PIPE, INSTALL_ID, USER_ID, CORE, rawPipeRequest, logRun, ensureDir, peer, isCoreUp,
} from './lib.mjs';

function commandEnv(p, label, payload) {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', commandType: 'SUBMIT_CONTRACT',
    peer: p, requestId: `req-id-${label}`, aggregateId: `contract-id-${label}`,
    expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
    payload: payload ?? {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId: `contract-id-${label}`, status: 'CONFIRMED', intentType: 'SINGLE_RESOURCE',
      requestedTarget: `target-id-${label}`, requestedScope: { kind: 'single_resource', targetId: `target-id-${label}` },
      continuationScope: { kind: 'NONE' }, selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
      automationMode: 'AUTO', explorationPermission: 'NONE',
      budgetProfile: { discovery: { domain: 'discovery' }, transfer: { domain: 'transfer', maxBytes: 1048576, maxSegments: 100, maxActiveTransferMs: 600000, maxRetryTransferRequests: 3 }, globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 50, maxActiveElapsedMs: 3600000 } },
      authorizationContextRef: 'authctx/t19h', validationPolicy: { requiredLayers: ['target', 'transfer'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' }, resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: new Date().toISOString(),
    },
  };
}

async function attempt(label, p, payload) {
  try {
    const r = await rawPipeRequest(commandEnv(p, label, payload), { timeoutMs: 15000 });
    const diag = r?.diagnostics?.[0];
    logRun({ event: 'case2', label, outcome: r?.outcome, code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 160) });
    console.log(JSON.stringify({ label, outcome: r?.outcome, code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 160) }));
  } catch (e) {
    logRun({ event: 'case2', label, outcome: 'ERROR', message: e.message.slice(0, 160) });
    console.log(JSON.stringify({ label, outcome: 'ERROR', message: e.message.slice(0, 160) }));
  }
}

await attempt('wrong-install-id', peer({ installId: 't19x' }));
await attempt('wrong-user-id', peer({ userId: '99999' }));
await attempt('empty-install-id', peer({ installId: '' }));
await attempt('bad-chars-install-id', peer({ installId: 't19h<script>' }));
await attempt('too-long-install-id', peer({ installId: 'a'.repeat(129) }));
await attempt('unknown-surface', peer({ surface: 'SYSTEM' }));
await attempt('lowercase-surface', peer({ surface: 'cli' }));
await attempt('extra-peer-field', { ...peer(), token: 'forged' });
// Surface impersonation on a command without a per-surface gate (SUBMIT_CONTRACT).
await attempt('impersonate-desktop-ui', peer({ surface: 'DESKTOP_UI' }));
await attempt('impersonate-browser-ext', peer({ surface: 'BROWSER_EXTENSION' }));
// Same again but on an S3 challenge command (per-surface gate: CLI only).
const s3Env = {
  schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
  kind: 'command', commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
  peer: peer({ surface: 'DESKTOP_UI' }), requestId: 'req-id-s3forge', aggregateId: 'contract-id-wrong-install-id',
  expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
  payload: {},
};
try {
  const r = await rawPipeRequest(s3Env, { timeoutMs: 15000 });
  const diag = r?.diagnostics?.[0];
  logRun({ event: 'case2', label: 's3-challenge-as-desktop', outcome: r?.outcome, code: diag?.code ?? null });
  console.log(JSON.stringify({ label: 's3-challenge-as-desktop', outcome: r?.outcome, code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 160) }));
} catch (e) {
  console.log(JSON.stringify({ label: 's3-challenge-as-desktop', outcome: 'ERROR', message: e.message.slice(0, 160) }));
}

// 2g singleton: second Core on the SAME pipe name must not take over.
const root2 = path.join(BASE, 'case2-second-core');
ensureDir(root2);
const log2 = path.join(BASE, 'case2-second-core.log');
const out = fs.openSync(log2, 'w');
const second = spawn(process.execPath, [CORE, '--root', root2, '--install-id', INSTALL_ID, '--user-id', USER_ID, '--pipe-name', PIPE], {
  windowsHide: true, stdio: ['ignore', out, out],
});
const secondResult = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ code: 'STILL_RUNNING_AFTER_15S', pid: second.pid }), 15000);
  second.on('exit', (code) => { clearTimeout(timer); resolve({ code, pid: second.pid }); });
});
logRun({ event: 'case2-second-core', secondResult, logTail: fs.existsSync(log2) ? fs.readFileSync(log2, 'utf8').slice(-500) : '' });
console.log(JSON.stringify({ label: 'second-core-same-pipe', secondResult, logTail: (fs.existsSync(log2) ? fs.readFileSync(log2, 'utf8') : '').slice(-300) }));

// The FIRST Core must still own the pipe and answer.
const healthy = await isCoreUp(4000);
logRun({ event: 'case2-first-core-healthy', healthy });
console.log(JSON.stringify({ label: 'first-core-after-second-start', healthy }));
process.exit(0);
