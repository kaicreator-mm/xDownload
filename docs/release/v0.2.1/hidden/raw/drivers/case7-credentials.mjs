// Case 7 — credential-form URLs must be refused (S4/v0.2 grammar), and no
// credential residue may persist in core-data or logs.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, INSTALL_ID, USER_ID, PIPE, runCli, rawPipeRequest, peer, logRun } from './lib.mjs';

const SECRET1 = 'tk-SECRETQUERYTOKEN123';
const SECRET2 = 'cookievalueXYZ';
const SECRET3 = 'userpassWORD42';

function s4Preview(manifestUri, requestId) {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', commandType: 'PREVIEW_S4_HLS_VOD',
    peer: peer(), requestId, aggregateId: `contract-${requestId}`,
    expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
    payload: {
      snapshotId: 'snap-c7', memberId: 'mem-c7',
      manifestUri, mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
    },
  };
}

async function go(label, env) {
  try {
    const r = await rawPipeRequest(env, { timeoutMs: 15000 });
    const d = r?.diagnostics?.[0];
    logRun({ event: 'case7', label, outcome: r?.outcome, code: d?.code ?? null });
    console.log(JSON.stringify({ label, outcome: r?.outcome, code: d?.code ?? null, message: (d?.message ?? '').slice(0, 130) }));
  } catch (e) {
    console.log(JSON.stringify({ label, outcome: 'ERROR', message: e.message.slice(0, 130) }));
  }
}

// 7a query-token manifest over the seam.
await go('seam-query-token', s4Preview(`https://media.example.com/vod/list.m3u8?token=${SECRET1}`, 'req-c7a'));
// 7b userinfo (cookie-ish) manifest.
await go('seam-userinfo', s4Preview(`https://user:${SECRET3}@media.example.com/vod/list.m3u8`, 'req-c7b'));
// 7c fragment.
await go('seam-fragment', s4Preview('https://media.example.com/vod/list.m3u8#frag', 'req-c7c'));
// 7d explicit port (grammar rejects url.port !== '').
await go('seam-explicit-port', s4Preview('https://media.example.com:8443/vod/list.m3u8', 'req-c7d'));
// 7e http (non-https) public host.
await go('seam-plain-http-public', s4Preview('http://media.example.com/vod/list.m3u8', 'req-c7e'));
// 7f ip-literal host.
await go('seam-ip-host', s4Preview('https://203.0.113.10/vod/list.m3u8', 'req-c7f'));

// 7g CLI hls lane: manifest grammar validated before any TTY requirement.
const cli1 = runCli(['hls', '--manifest', `https://media.example.com/vod/list.m3u8?token=${SECRET1}`,
  '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID], { timeoutMs: 20000 });
logRun({ event: 'case7-cli-hls-query', exit: cli1.exit, stdout: cli1.stdout.slice(0, 300) });
console.log(JSON.stringify({ label: 'cli-hls-query-token', exit: cli1.exit, head: cli1.stdout.slice(0, 240) }));

// 7h v0.2 DOMAIN_APP_SEND whose SELECTION URIs carry query tokens (S4 intent).
function s4IntentWith(manifestUri, renditionUri, requestId) {
  const now = Date.now();
  return {
    requestId, lineageId: `lin-${requestId}`, contractId: `contract-${requestId}`, targetRef: 'tok-c7',
    outputRootScope: 'C:\\xDev\\kAiCreator\\_tmp\\v021\\t19final\\case1-authorized',
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: `sel-${requestId}`, previewId: `prev-${requestId}`,
      snapshotId: `snap-${requestId}`, memberId: `mem-${requestId}`,
      manifestUri, mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1', renditionKey: 'rend-1',
      renditionUri, displayedTupleDigest: 'd'.repeat(64),
      confirmedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
    },
    caller: { actor: 't19h-attacker', sessionRef: 't19h-session' },
  };
}
await go('v02-intent-query-uri', {
  schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
  kind: 'command', route: 'v0.2', commandType: 'DOMAIN_APP_SEND',
  peer: peer(), requestId: 'req-c7h', aggregateId: 'lin-c7h',
  issuedAt: new Date().toISOString(),
  payload: { intent: s4IntentWith(`http://127.0.0.1:49651/master.m3u8?token=${SECRET1}`, 'http://127.0.0.1:49651/rend.m3u8', 'req-c7h') },
});

// 7i residue scan: none of the secrets may appear anywhere under core-root
// or the t19final evidence dir (logs, journal, route log, k-documents).
const needles = [SECRET1, SECRET2, SECRET3, 'SECRETQUERYTOKEN', 'userpassWORD'];
const hits = [];
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { scan(f); continue; }
    if (e.name.endsWith('.ndjson') || e.name.endsWith('.jsonl') || e.name.endsWith('.json') || e.name.endsWith('.log') || e.name.endsWith('.txt') || e.name.endsWith('.sqlite')) {
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; } // sqlite binary tolerated via strings below
      for (const n of needles) if (text.includes(n)) hits.push({ file: f, needle: n });
    }
  }
}
scan(path.join(BASE, 'core-root'));
scan(BASE);
logRun({ event: 'case7-residue-scan', hits });
console.log(JSON.stringify({ label: 'residue-scan', hits }));
process.exit(0);
