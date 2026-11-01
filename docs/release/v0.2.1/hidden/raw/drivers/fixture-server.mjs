// Persistent fixture server (ports 49651+). Records every request to
// fixture-requests.jsonl. Routes:
//   /file.bin        deterministic 256 KiB
//   /slow.bin        throttled 1 MiB (~100 KB/s)
//   /glacial.bin     4 MiB at ~16 KB/s (mid-transfer kill window)
//   /redirect-to-file.bin  302 -> /file.bin (same host)
//   /redirect-foreign.bin  302 -> http://127.0.0.1:49652/foreign.bin
//   /redirect-loop.bin     302 -> itself (hop bound probe)
//   /master.m3u8, /rend.m3u8, /seg0.ts  minimal HLS fixture
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PORT_BASE, logRun } from './lib.mjs';

const FILE_BYTES = Buffer.alloc(256 * 1024);
for (let i = 0; i < FILE_BYTES.length; i += 1) FILE_BYTES[i] = i % 251;
const SLOW_BYTES = Buffer.alloc(1024 * 1024);
for (let i = 0; i < SLOW_BYTES.length; i += 1) SLOW_BYTES[i] = (i * 7) % 251;
const CHUNK = Buffer.alloc(4096, 3);
const REQLOG = path.join(BASE, 'fixture-requests.jsonl');

function logReq(entry) {
  fs.appendFileSync(REQLOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nrend.m3u8\n';
const REND = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-VERSION:3\n#EXTINF:2.000,\nseg0.ts\n#EXT-X-ENDLIST\n';
const SEG = Buffer.alloc(64 * 1024, 7);

function throttled(res, req, total, intervalMs) {
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(total) });
  let off = 0;
  const timer = setInterval(() => {
    try {
      if (off >= total) { clearInterval(timer); res.end(); return; }
      const n = Math.min(CHUNK.length, total - off);
      off += n;
      res.write(CHUNK.subarray(0, n));
    } catch { clearInterval(timer); }
  }, intervalMs);
  req.on('close', () => clearInterval(timer));
}

const handler = (req, res) => {
  try { logReq({ port: req.socket.localPort, url: req.url, method: req.method }); } catch {}
  const u = req.url.split('?')[0];
  if (u === '/file.bin' || u === '/foreign.bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(FILE_BYTES.length) });
    res.end(FILE_BYTES);
    return;
  }
  if (u === '/slow.bin') { throttled(res, req, SLOW_BYTES.length, 32); return; }
  if (u === '/glacial.bin') { throttled(res, req, 4 * 1024 * 1024, 250); return; }
  if (u === '/redirect-to-file.bin') {
    res.writeHead(302, { location: `http://127.0.0.1:${PORT_BASE}/file.bin` });
    res.end();
    return;
  }
  if (u === '/redirect-foreign.bin') {
    res.writeHead(302, { location: `http://127.0.0.1:${PORT_BASE + 1}/foreign.bin` });
    res.end();
    return;
  }
  if (u === '/redirect-loop.bin') {
    res.writeHead(302, { location: `http://127.0.0.1:${PORT_BASE}/redirect-loop.bin?n=${Date.now()}` });
    res.end();
    return;
  }
  if (u === '/master.m3u8') { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); res.end(MASTER); return; }
  if (u === '/rend.m3u8') { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); res.end(REND); return; }
  if (u === '/seg0.ts') { res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(SEG.length) }); res.end(SEG); return; }
  res.writeHead(404); res.end();
};

const s1 = http.createServer(handler);
const s2 = http.createServer(handler);
await new Promise((r) => s1.listen(PORT_BASE, '127.0.0.1', r));
await new Promise((r) => s2.listen(PORT_BASE + 1, '127.0.0.1', r));
logRun({ event: 'fixture-persistent-ready', ports: [PORT_BASE, PORT_BASE + 1] });
console.log(JSON.stringify({ event: 'fixture-persistent-ready', ports: [PORT_BASE, PORT_BASE + 1] }));
setInterval(() => {}, 60000); // keep-alive
