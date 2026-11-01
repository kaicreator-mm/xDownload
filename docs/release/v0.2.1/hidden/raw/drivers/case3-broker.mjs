// Case 3 — permissions: native-host broker origin authorization + Core-down
// surface behavior.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, BROKER, PAYLOAD, INSTALL_ID, USER_ID, PIPE, runCli, logRun, ensureDir } from './lib.mjs';

const CONFIG_REAL = path.join(PAYLOAD, 'native-host', 'broker-config.json');

function runBroker(args, frames, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BROKER, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = Buffer.alloc(0);
    let err = '';
    child.stdout.on('data', (c) => { out = Buffer.concat([out, c]); });
    child.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    for (const f of frames) {
      const body = Buffer.from(JSON.stringify(f), 'utf8');
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.byteLength, 0);
      child.stdin.write(Buffer.concat([head, body]));
    }
    // Half-close stdin to signal EOF.
    child.stdin.end();
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.toString('utf8').slice(0, 800), err: err.slice(0, 400) });
    });
  });
}

const GOOD_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const EVIL_ORIGIN = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/';
const queryFrame = { kind: 'query', queryType: 'READ_PROJECTION', aggregateId: 'contract-none' };

// 3a unauthorized origin (present but not allow-listed)
const r1 = await runBroker(['--config', CONFIG_REAL, EVIL_ORIGIN], [queryFrame]);
logRun({ event: 'case3-broker-evil-origin', ...r1 });
console.log(JSON.stringify({ label: 'broker-evil-origin', code: r1.code, out: r1.out.slice(0, 300), err: r1.err.slice(0, 200) }));

// 3a2 no origin at all
const r2 = await runBroker(['--config', CONFIG_REAL], [queryFrame]);
logRun({ event: 'case3-broker-no-origin', ...r2 });
console.log(JSON.stringify({ label: 'broker-no-origin', code: r2.code, out: r2.out.slice(0, 300), err: r2.err.slice(0, 200) }));

// 3b tampered config (attacker-writable copy adds the evil origin)
const tampered = path.join(BASE, 'case3-tampered-broker-config.json');
fs.writeFileSync(tampered, JSON.stringify({ hostName: 'com.xdownload.broker', allowedOrigins: [GOOD_ORIGIN, EVIL_ORIGIN] }));
const r3 = await runBroker(['--config', tampered, EVIL_ORIGIN], [queryFrame]);
logRun({ event: 'case3-broker-tampered-config', ...r3 });
console.log(JSON.stringify({ label: 'broker-tampered-config', code: r3.code, out: r3.out.slice(0, 300), err: r3.err.slice(0, 200) }));

// 3b2 malformed origin string (not the chrome-extension shape)
const r4 = await runBroker(['--config', CONFIG_REAL, 'chrome-extension://NOT_HEX/'], [queryFrame]);
logRun({ event: 'case3-broker-malformed-origin', ...r4 });
console.log(JSON.stringify({ label: 'broker-malformed-origin', code: r4.code, out: r4.out.slice(0, 200), err: r4.err.slice(0, 200) }));

process.exit(0);
