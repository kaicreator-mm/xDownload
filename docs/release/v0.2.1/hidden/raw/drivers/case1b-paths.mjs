// Case 1b — literal backslash-dotdot (driver-side path.join had normalized the
// first attempt away), symlink root, and v0.2 job projection readback.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, rawPipeRequest, logRun, ensureDir, peer, PIPE } from './lib.mjs';

const ROOT_REAL = path.join(BASE, 'case1-authorized');

function s4Intent(overrides) {
  const now = Date.now();
  return {
    requestId: 'req-c1b', lineageId: 'lin-c1b', contractId: 'contract-c1b', targetRef: 'tok-c1b',
    outputRootScope: ROOT_REAL,
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'sel-c1b', previewId: 'prev-c1b', snapshotId: 'snap-c1b', memberId: 'mem-c1b',
      manifestUri: 'http://127.0.0.1:49651/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
      renditionKey: 'rend-1',
      renditionUri: 'http://127.0.0.1:49651/rend.m3u8',
      displayedTupleDigest: 'b'.repeat(64),
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
    kind: 'command', route: 'v0.2', commandType: 'DOMAIN_APP_SEND',
    peer: peer(), requestId: intentValue.requestId, aggregateId: intentValue.lineageId,
    issuedAt: new Date().toISOString(), payload: { intent: intentValue },
  };
  return rawPipeRequest(env, { timeoutMs: 15000 }).then((response) => {
    const diag = response?.diagnostics?.[0];
    console.log(JSON.stringify({ event: 'case1b', label, outcome: response?.outcome, code: diag?.code ?? null, message: (diag?.message ?? '').slice(0, 150) }));
    return response;
  }).catch((err) => console.log(JSON.stringify({ event: 'case1b', label, outcome: 'ERROR', message: String(err.message).slice(0, 150) })));
}

function v02Projection(lineageId) {
  const env = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'query', route: 'v0.2', queryType: 'READ_JOB_PROJECTION',
    peer: peer(), requestId: `req-proj-${lineageId}`, aggregateId: lineageId,
    issuedAt: new Date().toISOString(),
  };
  return rawPipeRequest(env, { timeoutMs: 15000 }).then((response) => {
    console.log(JSON.stringify({ event: 'case1b-projection', lineageId, outcome: response?.outcome, projection: response?.projection ?? null }));
    return response;
  }).catch((err) => console.log(JSON.stringify({ event: 'case1b-projection', lineageId, outcome: 'ERROR', message: String(err.message).slice(0, 150) })));
}

// TRUE backslash traversal string (no path.join normalization).
const dotdotBackslash = BASE + '\\case1-escape\\..\\case1-pwned';
await v02Send(s4Intent({ requestId: 'req-1m', lineageId: 'lin-1m', outputRootScope: dotdotBackslash }), 'root-backslash-dotdot-literal');

// Mixed separator traversal with single quotes/dots variants.
await v02Send(s4Intent({ requestId: 'req-1n', lineageId: 'lin-1n', outputRootScope: BASE + '/case1-escape\\../case1-pwned' }), 'root-mixed-sep-dotdot');
await v02Send(s4Intent({ requestId: 'req-1o', lineageId: 'lin-1o', outputRootScope: BASE + '\\case1-escape\\..;\\case1-pwned' }), 'root-dotdot-semicolon');

// Symlink root: user-declared root IS a symlink to an outside dir. The root is
// user-authorized so this is not an escape by itself; verify admission +
// truthful refusal and that the outside dir receives nothing.
const outsideDir = path.join(BASE, 'case1-outside');
ensureDir(outsideDir);
const linkRoot = path.join(BASE, 'case1-linkroot');
try { fs.symlinkSync(outsideDir, linkRoot, 'dir'); } catch { /* exists */ }
await v02Send(s4Intent({ requestId: 'req-1p', lineageId: 'lin-1p', outputRootScope: linkRoot }), 'root-symlink-to-outside');

// Projection readback for every lineage admitted in case1 + case1b.
await new Promise((r) => setTimeout(r, 2500));
for (const lineage of ['lin-1base', 'lin-1f', 'lin-1f2', 'lin-1g', 'lin-1h', 'lin-1i', 'lin-1k', 'lin-1l', 'lin-1m', 'lin-1n', 'lin-1o', 'lin-1p']) {
  await v02Projection(lineage);
}

// Filesystem assertions: no pwned dir, nothing written into the symlink target.
const pwnedExists = fs.existsSync(path.join(BASE, 'case1-pwned'));
const outsideEntries = fs.readdirSync(outsideDir);
logRun({ event: 'case1b-fs-assert', pwnedExists, outsideEntries });
console.log(JSON.stringify({ event: 'case1b-fs-assert', pwnedExists, outsideEntries }));
process.exit(0);
