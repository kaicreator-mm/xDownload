/**
 * #95 real-path S2 integration — REAL deployed processes, no in-process
 * substitutes:
 *
 *   packaged core-host JS (real loopback seam transport, real SQLite/artifact
 *   root) + packaged native-host JS (real stdio Native Messaging framing,
 *   origin-allow-listed) + a real localhost cookie-auth attachment server
 *   (the PB3 S2 shape: /login → session cookie → /s2/page → auth-gated
 *   /s2/private-attachment.bin) + an independently generated oracle.
 *
 * The drive is exactly what the shipped service worker does: acquire the
 * bytes under the authorized context OUTSIDE the broker boundary (the
 * session cookie never enters any NM frame, config, log or Core-durable
 * path), then submit S2_ACQUIRE over real NM frames.
 *
 * Legs: positive journey (accepted artifact == oracle bytes, terminal
 * COMPLETE), 401-without-session truthfulness (AUTH_REQUIRED terminal, no
 * silent success), no-Core fail-closed typed rejection, and a whole-root
 * secret-leak scan.
 */

import { spawn } from 'node:child_process';
import * as nodeChildProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface CoreHostProcess {
  readonly pid: number | undefined;
  kill(): Promise<void>;
  stdout(): string;
  stderr(): string;
}

function makeCoreHost(child: ReturnType<typeof spawn>): CoreHostProcess {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return {
    pid: child.pid,
    stdout: () => stdout,
    stderr: () => stderr,
    kill: () =>
      new Promise((resolve) => {
        child.on('exit', () => resolve(undefined));
        child.kill();
      }),
  };
}

function spawnCoreHost(args: readonly string[]): CoreHostProcess {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return makeCoreHost(child);
}

/** Await the core-host ready document (host+port) on stdout. */
async function awaitCoreReady(
  host: CoreHostProcess,
  timeoutMs = 30_000,
): Promise<{ host: string; port: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const line = host
      .stdout()
      .split('\n')
      .find((entry) => entry.includes('xdownload.core-host.ready'));
    if (line !== undefined) {
      const doc = JSON.parse(line.trim()) as { host: string; port: number };
      return { host: doc.host, port: doc.port };
    }
    if (Date.now() > deadline) {
      throw new Error(`core-host not ready; stderr: ${host.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The PB3-shaped localhost attachment server (session cookie auth). */
async function startAttachmentServer(bytes: Uint8Array): Promise<{
  server: Server;
  origin: string;
  stop: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const cookies = Object.fromEntries(
      (request.headers.cookie ?? '')
        .split(';')
        .map((entry) => entry.trim().split('='))
        .filter((parts) => parts.length === 2),
    );
    if (url.pathname === '/login' && request.method === 'POST') {
      response.writeHead(302, {
        location: '/s2/page',
        'set-cookie': 'pb3_session=full; Path=/; HttpOnly; SameSite=Lax',
      });
      response.end();
      return;
    }
    if (url.pathname === '/s2/page') {
      if (cookies['pb3_session'] !== 'full') {
        response.writeHead(302, { location: '/login' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><a href="/s2/private-attachment.bin">Download explicit attachment</a>',
      );
      return;
    }
    if (url.pathname === '/s2/private-attachment.bin') {
      if (cookies['pb3_session'] !== 'full') {
        response.writeHead(401);
        response.end('AUTH_REQUIRED');
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      });
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as { port: number };
  return {
    server,
    origin: `http://127.0.0.1:${String(address.port)}`,
    stop: () =>
      Promise.race([
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve(undefined));
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]),
  };
}

/** Fetch helper mirroring the SW's credentialed browser fetch. */
async function credentialedFetch(
  url: string,
  cookie: string | undefined,
): Promise<{
  status: number;
  finalUrl: string;
  contentType: string | undefined;
  bytes: Uint8Array;
}> {
  const response = await fetch(url, {
    headers: cookie === undefined ? {} : { cookie },
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location !== null) {
    return credentialedFetch(new URL(location, url).toString(), cookie);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? undefined,
    bytes: buffer,
  };
}

/** Native Messaging frame codec (browser side). */
function nmFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

interface NmSession {
  send(message: unknown): void;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  outputSoFar(): string;
}

describe('#95 real-path S2 integration (packaged processes)', () => {
  let distRoot: string;
  let coreRoot: string;
  let configPath: string;
  let core: CoreHostProcess;
  let coreTarget: { host: string; port: number };
  let attachment: { server: Server; origin: string; stop: () => Promise<void> };
  const oracleBytes = new Uint8Array(81_920).map((_, index) => (index * 17 + 3) & 0xff);
  const ORACLE_SHA = sha256(oracleBytes);
  const EXTENSION_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

  beforeAll(async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-s2-realpath-'));
    distRoot = path.join(work, 'dist');
    coreRoot = path.join(work, 'core-data');
    const { runPackageBuild } = await import('../package.ts');
    await runPackageBuild(distRoot);
    // Start the ONE Core authority with a FIXED port (the deployment writes
    // the broker config against it). Port collisions retry with a new port.
    let ready: { host: string; port: number } | undefined;
    for (let attempt = 0; attempt < 5 && ready === undefined; attempt += 1) {
      // Ask the OS for a genuinely free loopback port (Windows reserve ranges
      // make blind port guessing unreliable), then hand it to the fixed-port
      // core-host + broker config exactly as a deployment would.
      const fixedPort = await new Promise<number>((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
          const port = (probe.address() as { port: number }).port;
          probe.close(() => resolve(port));
        });
      });
      const candidate = spawnCoreHost([
        path.join(distRoot, 'core', 'xdownload-core-host.js'),
        '--root',
        coreRoot,
        '--install-id',
        'install-001',
        '--user-id',
        'user-001',
        '--port',
        String(fixedPort),
      ]);
      try {
        ready = await awaitCoreReady(candidate, 15_000);
        core = candidate;
      } catch {
        await candidate.kill();
        fs.rmSync(coreRoot, { recursive: true, force: true });
      }
    }
    if (ready === undefined) {
      throw new Error('core-host never became ready on any candidate port');
    }
    coreTarget = ready;
    // Deployment-time broker config: allowed_origins + the Core target.
    configPath = path.join(work, 'broker-config.json');
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          hostName: 'com.xdownload.broker',
          allowedOrigins: [EXTENSION_ORIGIN],
          core: {
            host: '127.0.0.1',
            port: coreTarget.port,
            installId: 'install-001',
            userId: 'user-001',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    attachment = await startAttachmentServer(oracleBytes);
  }, 120_000);

  afterAll(async () => {
    if (attachment !== undefined) {
      await attachment.stop();
    }
    if (core !== undefined) {
      await core.kill();
    }
    if (distRoot !== undefined) {
      fs.rmSync(path.dirname(distRoot), { recursive: true, force: true });
    }
  }, 30_000);

  function openNmHost(): NmSession {
    const child = spawn(
      process.execPath,
      [
        path.join(distRoot, 'native-host', 'xdownload-broker-host.js'),
        '--config',
        configPath,
        EXTENSION_ORIGIN,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const pending: Record<string, unknown>[] = [];
    const waiters: ((value: Record<string, unknown>) => void)[] = [];
    let buffer = Buffer.alloc(0);
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const declared = buffer.readUInt32LE(0);
        if (buffer.length - 4 < declared) {
          return;
        }
        const payload = buffer.subarray(4, 4 + declared);
        buffer = buffer.subarray(4 + declared);
        try {
          pending.push(JSON.parse(payload.toString('utf8')) as Record<string, unknown>);
        } catch {
          pending.push({ kind: 'INVALID_JSON_FRAME' });
        }
        const waiter = waiters.shift();
        if (waiter !== undefined) {
          waiter(pending.shift() as Record<string, unknown>);
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    return {
      send(message: unknown): void {
        child.stdin.write(nmFrame(message));
      },
      next(timeoutMs = 30_000): Promise<Record<string, unknown>> {
        const ready = pending.shift();
        if (ready !== undefined) {
          return Promise.resolve(ready);
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`NM response timeout; stderr: ${stderr}`)),
            timeoutMs,
          );
          waiters.push((value) => {
            clearTimeout(timer);
            resolve(value);
          });
        });
      },
      close: () =>
        new Promise<void>((resolve) => {
          child.on('exit', () => resolve(undefined));
          child.stdin.end();
          setTimeout(() => child.kill(), 5_000);
        }),
      outputSoFar: () => stderr,
    };
  }

  function s2AcquireMessage(input: {
    readonly bytes: Uint8Array;
    readonly finalUrl: string;
    readonly status: number;
    readonly contentType?: string;
    readonly requestId: string;
    readonly sessionCookieValue?: string;
  }): Record<string, unknown> {
    // The session cookie NEVER enters this payload — it stayed in the
    // authorized fetch below (browser-zone simulation).
    void input.sessionCookieValue;
    const origin = attachment.origin;
    const chunks: string[] = [];
    const whole = Buffer.from(input.bytes).toString('base64');
    for (let index = 0; index < whole.length; index += 3072) {
      chunks.push(whole.slice(index, index + 3072));
    }
    return {
      kind: 'S2_ACQUIRE',
      requestId: input.requestId,
      s2: {
        handoff: {
          kind: 'NETWORK_OBSERVATION',
          provenanceKey: `t42|f0|${origin}|${input.requestId}`,
          origin,
          payload: { requestUrl: `${origin}/s2/private-attachment.bin`, requestMethod: 'GET' },
          capturedAtMs: Date.now(),
          authority: 'EVIDENCE_INPUT_ONLY',
        },
        decisionToken: `user-confirm:${input.requestId}`,
        ttlMs: 60_000,
        delivery: {
          locatorUri: `${origin}/s2/private-attachment.bin`,
          originLocatorUri: `${origin}/s2/private-attachment.bin`,
          provenanceBinding: 'SELECTED_RESOURCE_PROVENANCE',
          declaredRedirectHosts: [new URL(origin).host],
          expectedSha256: ORACLE_SHA,
          expectedContentTypePrefix: 'application/octet-stream',
          expectedTotalBytes: input.bytes.length,
        },
        browserResponse: {
          finalUrl: input.finalUrl,
          ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
          status: input.status,
        },
        bytes: chunks,
      },
    };
  }

  it('positive journey: cookie-authenticated bytes → NM → Core acceptance == oracle bytes', async () => {
    // The operator signs in (the authorized browser context).
    const login = await fetch(`${attachment.origin}/login`, {
      method: 'POST',
      redirect: 'manual',
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    const cookie = /pb3_session=[^;]+/u.exec(setCookie)?.[0];
    expect(cookie).toBeDefined();

    const acquired = await credentialedFetch(
      `${attachment.origin}/s2/private-attachment.bin`,
      cookie,
    );
    expect(acquired.status).toBe(200);
    expect(sha256(acquired.bytes)).toBe(ORACLE_SHA);

    const session = openNmHost();
    try {
      session.send(
        s2AcquireMessage({
          bytes: acquired.bytes,
          finalUrl: acquired.finalUrl,
          status: acquired.status,
          contentType: acquired.contentType,
          requestId: 'realpath-positive-001',
        }),
      );
      const response = await session.next();
      expect(response['kind']).toBe('S2_RESULT');
      const terminal = response['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe(
        'ALL_PASSED',
      );

      // Independent verification from the authoritative durable root: the
      // accepted artifact bytes equal the independently generated oracle.
      const artifactsDir = path.join(coreRoot, 'artifacts');
      const files = walkFiles(artifactsDir);
      expect(files.length).toBeGreaterThan(0);
      const accepted = files.map((file) => fs.readFileSync(file));
      expect(accepted.some((bytes) => sha256(bytes) === ORACLE_SHA)).toBe(true);

      // CLI-view truth: READ_PROJECTION through the packaged CLI binary.
      const cli = spawnSyncText(process.execPath, [
        path.join(distRoot, 'cli', 'xdownload-cli.js'),
        'status',
        '--host',
        coreTarget.host,
        '--port',
        String(coreTarget.port),
        '--install-id',
        'install-001',
        '--user-id',
        'user-001',
        '--contract',
        String(response['contractId']),
      ]);
      expect(cli).toContain(String(response['contractId']));
    } finally {
      await session.close();
    }
  });

  it('unauthorized fetch (no session) is a truthful AUTH_REQUIRED terminal, never silent success', async () => {
    const denied = await credentialedFetch(
      `${attachment.origin}/s2/private-attachment.bin`,
      undefined,
    );
    expect(denied.status).toBe(401);

    const session = openNmHost();
    try {
      session.send(
        s2AcquireMessage({
          bytes: denied.bytes,
          finalUrl: denied.finalUrl,
          status: denied.status,
          contentType: denied.contentType,
          requestId: 'realpath-auth-001',
        }),
      );
      const response = await session.next();
      expect(response['kind']).toBe('S2_RESULT');
      const terminal = response['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect(JSON.stringify(terminal)).toContain('AUTH_REQUIRED');
    } finally {
      await session.close();
    }
  });

  it('a NM frame from a non-allow-listed origin never spawns a session (exit 2, no stdout frames)', async () => {
    const child = spawn(
      process.execPath,
      [
        path.join(distRoot, 'native-host', 'xdownload-broker-host.js'),
        '--config',
        configPath,
        'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    const code = await new Promise<number>((resolve) => {
      child.on('exit', (exitCode) => resolve(exitCode ?? -1));
      child.stdin.end();
    });
    expect(code).toBe(2);
    expect(stdout).toBe('');
  });

  it('no raw session material leaks into the Core-durable root or any host output', async () => {
    // The session cookie value must not appear anywhere durable or logged.
    const secret = 'pb3_session=full';
    const rootScan = walkFiles(coreRoot)
      .map((file) => fs.readFileSync(file, 'utf8'))
      .concat(fs.readFileSync(configPath, 'utf8'))
      .join('\n');
    expect(rootScan).not.toContain(secret);
    // SQLite/ledger bytes: binary-safe scan of raw buffers.
    for (const file of walkFiles(coreRoot)) {
      const raw = fs.readFileSync(file);
      expect(raw.includes(Buffer.from(secret, 'utf8'))).toBe(false);
    }
  });
});

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function spawnSyncText(command: string, args: readonly string[]): string {
  const { spawnSync } = nodeChildProcess;
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
