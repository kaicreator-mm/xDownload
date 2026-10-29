/**
 * v0.2 T14 validation-core driver V1 — crash/restart durable replay
 * (independent Validator; candidate tree @ task/v02-t14 head).
 *
 * Drives the REAL composition through the public facade
 * `@xdownload/download-domain-app` ONLY (no lane-internal imports, no mock):
 *
 *   P   one real K journey (intent → T01 gate → K permit → sealed direct C
 *       → pinned T04 bridge → real 127.0.0.1 socket → digest-backed file),
 *       with the terminal evidence re-verified against the bytes on disk;
 *   R1  REAL process boundary: the runtime is stopped, then a SECOND node
 *       process re-opens the durable store file (raw bytes + FileCasDocStore
 *       reopen path) and reports journal/permit survival; parent asserts
 *       byte-level equality and the child's real exit code;
 *   R2  reopen over the SAME store file (fresh assembleDownloadRuntime):
 *       journal/permit rows survive verbatim, an idempotent replay of the
 *       settled occurrence adds ZERO effects (fresh bridge untouched, real
 *       socket untouched, artifact untouched, still exactly 1 permit/1 row).
 *
 * Run: node --experimental-transform-types --test <this file>   (repo root)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  FileCasDocStore,
  assembleDownloadRuntime,
  submitConfirmedDownload,
  type DownloadRuntime,
} from '@xdownload/download-domain-app';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'child-readback.mjs');

// --- real localhost fixture (T11 test precedent: random port, real socket) --
type Behavior = (request: IncomingMessage, response: ServerResponse) => void;

class LocalHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<string, Behavior>();
  readonly requests: string[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((request: IncomingMessage, response: ServerResponse) => {
      this.requests.push(request.url ?? '/');
      const behavior = this.behaviors.get((request.url ?? '/').split('?')[0] ?? '/');
      if (behavior === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('fixture: no behavior');
        return;
      }
      behavior(request, response);
    });
  }

  serveBytes(path: string, body: Uint8Array): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.end(Buffer.from(body));
    });
  }

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolveStart) => {
      this.server.listen(0, '127.0.0.1', () => resolveStart());
    });
    this.port = (this.server.address() as { port: number }).port;
  }

  uri(path: string): string {
    return `http://127.0.0.1:${String(this.port)}${path}`;
  }

  host(): string {
    return `127.0.0.1:${String(this.port)}`;
  }

  requestCount(path: string): number {
    return this.requests.filter((recorded) => recorded === path).length;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolveStop, rejectStop) => {
      this.server.close((error) => (error === undefined ? resolveStop() : rejectStop(error)));
    });
  }
}

function payload(size: number, seed = 7): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// --- one shared workspace, torn down in the after() hook --------------------

const root = mkdtempSync(join(tmpdir(), 'xd-v02-t14-v1-'));
const outputRoot = join(root, 'out');
const storePath = join(root, 'k-docs.json');
const HANDLE = 'ref:validator/v1-file.bin';
const REQUEST_ID = 't14-v1-restart';
const body = payload(8192, 1401);
const fixture = new LocalHttpFixture();

let runtime: DownloadRuntime | undefined;
let completedPermitEffectId = '';
let journalBefore: readonly { key: string; record: unknown }[] = [];
let permitKeysBefore: readonly string[] = [];
let artifactPath = '';

after(async () => {
  runtime?.stop();
  await fixture.stop();
  rmSync(root, { recursive: true, force: true });
});

function intentFor(): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    lineageId: `lineage-${REQUEST_ID}`,
    targetRef: HANDLE,
    outputRootScope: outputRoot,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: sha256(body),
    declaredBytes: body.byteLength,
    caller: { actor: 'zcode:xd-v02-t14-validator-agent', sessionRef: 'session:t14-validation-core' },
  };
}

async function assemble(): Promise<DownloadRuntime> {
  return assembleDownloadRuntime({
    storePath,
    targetRefs: [
      {
        handle: HANDLE,
        record: { uri: fixture.uri('/file.bin'), allowedRedirectHosts: [fixture.host()] },
      },
    ],
  });
}

// ---------------------------------------------------------------------------

describe('T14 V1 — crash/restart durable replay over the real composition', () => {
  it('P — one real K journey completes with real bytes and a verifiable digest', async () => {
    await fixture.start();
    fixture.serveBytes('/file.bin', body);
    runtime = await assemble();

    const outcome = await submitConfirmedDownload(runtime, intentFor());
    assert.equal(outcome.status, 'completed', `journey must complete (got ${JSON.stringify('status' in outcome ? outcome.status : outcome)})`);
    if (outcome.status !== 'completed') return;

    // Accepted file digest: terminal evidence must reproduce the served body,
    // and the artifact must really exist with those bytes.
    assert.equal(outcome.evidence.fileSha256, sha256(body));
    assert.equal(outcome.evidence.bytesWritten, body.byteLength);
    assert.equal(outcome.evidence.stopReason, 'COMPLETED');
    artifactPath = join(outputRoot, `${REQUEST_ID}.bin`);
    assert.ok(existsSync(artifactPath), 'artifact must be materialized on disk');
    const onDisk = readFileSync(artifactPath);
    assert.equal(sha256(onDisk), sha256(body));
    assert.equal(onDisk.byteLength, body.byteLength);

    // The dispatch ran under a LIVE kernel-minted permit identity.
    assert.ok(outcome.permitEffectId.length > 0);
    completedPermitEffectId = outcome.permitEffectId;

    // Durable state after the first journey: exactly one permit, one journal row.
    assert.equal(runtime.store.permitDocs().length, 1);
    assert.equal(runtime.store.journalRows().length, 1);
    assert.ok(runtime.store.permitDocs()[0]?.key.includes(`effect-permit:${completedPermitEffectId}`));
  });

  it('R1 — a SECOND PROCESS re-opens the durable store and observes the same journal/permit', async () => {
    assert.ok(runtime);
    journalBefore = runtime.store.journalRows();
    permitKeysBefore = runtime.store.permitDocs().map(({ key }) => key);
    assert.equal(journalBefore.length, 1);
    assert.equal(permitKeysBefore.length, 1);

    // Real boundary: stop the runtime (app stop + pin release + store close),
    // then inspect the file from an independent process.
    runtime.stop();
    runtime = undefined;

    const child = spawnSync(
      process.execPath,
      ['--experimental-transform-types', CHILD, storePath],
      { cwd: join(HERE, '..', '..', '..', '..', '..'), encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(child.status, 0, `child readback must exit 0 (status=${String(child.status)}, stderr=${child.stderr.slice(0, 800)})`);
    const report = JSON.parse(child.stdout.trim()) as {
      raw: { keyCount: number; keys: string[] };
      store: {
        keyCount: number;
        journalCount: number;
        journalJson: string[];
        permitCount: number;
        permitKeys: string[];
      };
    };
    // Raw durable bytes agree with the reopen path on the full key set, and
    // contain exactly the pre-stop journal/permit families (the kernel also
    // keeps its other occurrence documents — fence, baseline, claims — the
    // evidence families asserted here are the permit/journal ones).
    assert.equal(report.raw.keyCount, report.store.keyCount, 'raw bytes and reopen view must agree on the key set');
    assert.equal(report.raw.keys.filter((key) => key.includes('effect-journal:')).length, journalBefore.length);
    assert.equal(report.raw.keys.filter((key) => key.includes('effect-permit:')).length, permitKeysBefore.length);
    // Reopen-path view: exactly the pre-stop journal rows and permits.
    assert.equal(report.store.journalCount, journalBefore.length);
    assert.equal(report.store.permitCount, permitKeysBefore.length);
    assert.deepEqual(
      report.store.journalJson,
      journalBefore.map(({ key, record }) => JSON.stringify({ key, record })).sort(),
      'journal rows must survive the process boundary byte-for-byte',
    );
    assert.deepEqual(report.store.permitKeys, [...permitKeysBefore].sort());
  });

  it('R2 — reopen over the SAME store file: journal survives, replay is idempotent with zero new effects', async () => {
    const reopened = await assemble();

    // Durable state survived: same rows, same permits.
    assert.deepEqual(
      reopened.store.journalRows().map(({ key, record }) => JSON.stringify({ key, record })).sort(),
      journalBefore.map(({ key, record }) => JSON.stringify({ key, record })).sort(),
    );
    assert.deepEqual(
      reopened.store.permitDocs().map(({ key }) => key).sort(),
      [...permitKeysBefore].sort(),
    );

    // Idempotent replay of the settled occurrence on the reopened runtime.
    const acquireBudgetBefore = reopened.bridge.counters.acquireCalls;
    const requestsBefore = fixture.requestCount('/file.bin');
    assert.equal(acquireBudgetBefore, 0, 'the reopened bridge starts fresh');
    assert.ok(requestsBefore >= 1, 'the first journey really hit the socket');

    const replay = await submitConfirmedDownload(reopened, intentFor());
    assert.equal(replay.status, 'replayed', `replay must be idempotent (got ${JSON.stringify('status' in replay ? replay.status : replay)})`);

    // Zero new effects, three ways: fresh bridge untouched, real socket
    // untouched, durable journal/permit families unchanged.
    assert.equal(reopened.bridge.counters.acquireCalls, 0);
    assert.equal(reopened.bridge.counters.filesWritten, 0);
    assert.equal(fixture.requestCount('/file.bin'), requestsBefore);
    assert.equal(reopened.store.permitDocs().length, 1);
    assert.equal(reopened.store.journalRows().length, 1);

    // No second artifact; the original bytes are intact.
    assert.ok(existsSync(artifactPath));
    assert.equal(sha256(readFileSync(artifactPath)), sha256(body));

    reopened.stop();
  });

  it('R3 — FileCasDocStore reopen is the exact public path (direct store-level check)', () => {
    // Belt-and-braces on the public class itself, no runtime: a fresh
    // instance over the same file must observe the same durable state.
    const direct = new FileCasDocStore(storePath);
    assert.equal(direct.journalRows().length, 1);
    assert.equal(direct.permitDocs().length, 1);
    direct.close();
  });
});
