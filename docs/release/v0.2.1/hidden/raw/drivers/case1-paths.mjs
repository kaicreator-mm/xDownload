// Case 1 — output-root path escape adversarial matrix over the frozen Core.
// The installed v0.2 route is the S4 HLS VOD business lane
// (v02IntentDecoder = validateConfirmedS4HlsIntent): confirmed S4 HLS intent
// with exact keys; loopback http .m3u8 URIs are admissible by
// canonicalPlaylistUri. All sends ride the raw OS-admitted pipe client so the
// intent fields are fully attacker-controlled.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, rawPipeRequest, logRun, ensureDir, peer } from './lib.mjs';

const OUT = path.join(BASE, 'case1');
ensureDir(OUT);
const ROOT_REAL = path.join(BASE, 'case1-authorized');
ensureDir(ROOT_REAL);

function s4Intent(overrides) {
  const now = Date.now();
  return {
    requestId: 'req-case1',
    lineageId: 'lin-case1',
    contractId: 'contract-case1',
    targetRef: 'tok-case1',
    outputRootScope: ROOT_REAL,
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'sel-case1',
      previewId: 'prev-case1',
      snapshotId: 'snap-case1',
      memberId: 'mem-case1',
      manifestUri: 'http://127.0.0.1:49651/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
      renditionKey: 'rend-1',
      renditionUri: 'http://127.0.0.1:49651/rend.m3u8',
      displayedTupleDigest: 'a'.repeat(64),
      confirmedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(),
    },
    caller: { actor: 't19h-attacker', sessionRef: 't19h-session' },
    ...overrides,
  };
}

function v02Send(intentValue, label) {
  const env = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: peer(),
    requestId: intentValue.requestId,
    aggregateId: intentValue.lineageId,
    issuedAt: new Date().toISOString(),
    payload: { intent: intentValue },
  };
  return rawPipeRequest(env, { timeoutMs: 15000 }).then((response) => {
    const diag = response?.diagnostics?.[0];
    console.log(JSON.stringify({
      event: 'case1', label, outcome: response?.outcome,
      code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 150),
      converged: response?.acceptance?.converged ?? null,
    }));
    return response;
  }).catch((err) => {
    console.log(JSON.stringify({ event: 'case1', label, outcome: 'ERROR', message: String(err.message).slice(0, 150) }));
  });
}

// Baseline sanity: well-formed intent on the EMPTY trusted registry must be
// admitted into K and settle CONTRACT_BINDING_MISMATCH later (registry barrier).
const baseline = await v02Send(s4Intent({ requestId: 'req-1base', lineageId: 'lin-1base' }), 'baseline-valid-shape');

// 1a .. backslash traversal in the declared root
await v02Send(s4Intent({ requestId: 'req-1a', lineageId: 'lin-1a', outputRootScope: path.join(BASE, 'case1-escape', '..', 'case1-pwned') }), 'root-backslash-dotdot');
// 1b forward-slash traversal
await v02Send(s4Intent({ requestId: 'req-1b', lineageId: 'lin-1b', outputRootScope: 'C:/xDev/kAiCreator/_tmp/v021/t19final/case1-escape/../case1-pwned' }), 'root-slash-dotdot');
// 1c relative root
await v02Send(s4Intent({ requestId: 'req-1c', lineageId: 'lin-1c', outputRootScope: 'case1-relative' }), 'root-relative');
// 1d UNC-style root (\\server\share)
await v02Send(s4Intent({ requestId: 'req-1d', lineageId: 'lin-1d', outputRootScope: String.raw`\\localhost\c$\t19h-unc` }), 'root-unc');
// 1e over-long root (513 chars)
await v02Send(s4Intent({ requestId: 'req-1e', lineageId: 'lin-1e', outputRootScope: 'C:\\' + 'a'.repeat(510) }), 'root-too-long');
// 1f NTFS reserved name as a segment and as the final component
await v02Send(s4Intent({ requestId: 'req-1f', lineageId: 'lin-1f', outputRootScope: path.join(BASE, 'case1-con', 'CON') }), 'root-ntfs-reserved-segment');
await v02Send(s4Intent({ requestId: 'req-1f2', lineageId: 'lin-1f2', outputRootScope: path.join(BASE, 'case1-ok') + '\\CON' }), 'root-ntfs-reserved-final');
// 1g Unicode one-dot-leader trick (U+2025 is NOT a Windows separator)
await v02Send(s4Intent({ requestId: 'req-1g', lineageId: 'lin-1g', outputRootScope: path.join(BASE, 'case1-uni') + '\\\u2025\\pwned' }), 'root-unicode-dotleader');
// 1h Windows case-variant root (upper-cased real path)
await v02Send(s4Intent({ requestId: 'req-1h', lineageId: 'lin-1h', outputRootScope: ROOT_REAL.toUpperCase() }), 'root-case-variant');
// 1i root with '.' segment mid-path
await v02Send(s4Intent({ requestId: 'req-1i', lineageId: 'lin-1i', outputRootScope: path.join(ROOT_REAL, '.', 'sub') }), 'root-dot-segment');
// 1j unknown extra field (no-widening)
await v02Send({ ...s4Intent({ requestId: 'req-1j', lineageId: 'lin-1j' }), evilFlag: true }, 'intent-extra-field');
// 1k raw URL as targetRef (locator substitution)
await v02Send(s4Intent({ requestId: 'req-1k', lineageId: 'lin-1k', targetRef: 'http://127.0.0.1:49651/evil' }), 'targetref-raw-url');
// 1l absolute path as targetRef
await v02Send(s4Intent({ requestId: 'req-1l', lineageId: 'lin-1l', targetRef: 'C:/Windows/evil' }), 'targetref-abs-path');

// Give post-admission drives a moment, then read back the durable route log.
await new Promise((r) => setTimeout(r, 2500));
const routeLog = path.join(BASE, 'core-root', 'domain-app', 'route-log.jsonl');
if (fs.existsSync(routeLog)) {
  const lines = fs.readFileSync(routeLog, 'utf8').trim().split(/\r?\n/).slice(-8);
  logRun({ event: 'case1-route-log-tail', lines });
  console.log(JSON.stringify({ event: 'case1-route-log-tail', lines }));
}

// --- leak scan: nothing may exist outside the evidence tree.
const leaks = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase().includes('pwned')) leaks.push(full);
      if (!entry.name.startsWith('case1')) walk(full);
    }
  }
})(BASE);
logRun({ event: 'case1-leak-scan', leaks });
console.log(JSON.stringify({ event: 'case1-leak-scan', leaks }));
process.exit(0);
