// T14 fixture HTTP service — single-file oracle + slow/hang + flaky/fail endpoints.
// Serves deterministic bytes so the sha256 oracle is stable across requests.
import { createHash } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.T14_FIXTURE_PORT ?? 49641);
const LOG = process.env.T14_FIXTURE_LOG ?? new URL('./fixture.log', import.meta.url).pathname;

const FILE_BYTES = 1_000_000;
// Deterministic pseudo-random payload (xorshift32 seeded), not compressible-trivial.
const PAYLOAD = Buffer.alloc(FILE_BYTES);
{
  let s = 0x9e3779b9;
  for (let i = 0; i < FILE_BYTES; i += 1) {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    PAYLOAD[i] = s & 0xff;
  }
}
const FILE_SHA256 = createHash('sha256').update(PAYLOAD).digest('hex');

const flakyAttempts = new Map();

function log(line) {
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  log(`req ${req.method} ${url.pathname}${url.search}`);
  res.setHeader('connection', 'close');

  if (url.pathname === '/sha256') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sha256: FILE_SHA256, bytes: FILE_BYTES }));
    return;
  }
  if (url.pathname === '/file.bin') {
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] === '' ? FILE_BYTES - 1 : Math.min(Number(m[2]), FILE_BYTES - 1);
        res.writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-range': `bytes ${start}-${end}/${FILE_BYTES}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        });
        res.end(PAYLOAD.subarray(start, end + 1));
        return;
      }
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': FILE_BYTES,
      'accept-ranges': 'bytes',
    });
    res.end(PAYLOAD);
    return;
  }
  if (url.pathname === '/hang.bin') {
    // Claim 1MB, dribble a little, then hold the socket open indefinitely.
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': FILE_BYTES,
      'accept-ranges': 'bytes',
    });
    res.write(PAYLOAD.subarray(0, 65536));
    log('hang.bin: sent 65536 bytes, holding');
    const keep = setInterval(() => {}, 60_000);
    req.on('close', () => { clearInterval(keep); log('hang.bin: client closed (cancel observed)'); });
    return;
  }
  if (url.pathname === '/flaky.bin') {
    const id = url.searchParams.get('id') ?? 'anon';
    const attempt = (flakyAttempts.get(id) ?? 0) + 1;
    flakyAttempts.set(id, attempt);
    log(`flaky.bin id=${id} attempt=${attempt}`);
    if (attempt === 1) {
      res.writeHead(500, { 'content-type': 'text/plain', 'content-length': 9 });
      res.end('boom 500');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': FILE_BYTES,
      'accept-ranges': 'bytes',
    });
    res.end(PAYLOAD);
    return;
  }
  if (url.pathname === '/fail.bin') {
    res.writeHead(500, { 'content-type': 'text/plain', 'content-length': 9 });
    res.end('boom 500');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain', 'content-length': 3 });
  res.end('nope');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`fixture ready on 127.0.0.1:${PORT} sha256=${FILE_SHA256} bytes=${FILE_BYTES}`);
  process.stdout.write(`ready ${PORT} ${FILE_SHA256}\n`);
});
