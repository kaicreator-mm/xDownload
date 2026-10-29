/**
 * v0.2 T14 validation-core driver V2 — truthful UNKNOWN/reconcile and honest
 * abort (independent Validator; candidate tree @ task/v02-t14 head).
 *
 * Drives the public facade `@xdownload/download-domain-app` ONLY:
 *
 *   U1  T09 lineage ledger: UNKNOWN effect records are APPEND-ONLY — after a
 *       reopen (fresh ledger instance over the same durable file, the lane's
 *       documented restart simulation) both records are still pending,
 *       unmodified, with resolution=null. Nothing auto-clears, nothing
 *       auto-replays.
 *   U2  the ONLY pending→resolved transition is the EXPLICIT
 *       resolveUnknownEffect with a NEW authorization grant: the record is
 *       stamped (resolution + resolvedAt + grant) and KEPT forever; a second
 *       resolve is refused (UNKNOWN_ALREADY_RESOLVED), an unknown id is
 *       refused (UNKNOWN_NOT_FOUND), and a missing grant is refused
 *       (LINEAGE_AUTHORIZATION_REQUIRED).
 *   U3  the resolution survives another restart; the book never shrank;
 *       the append-only history shows 2× unknown-recorded + 1× unknown-resolved.
 *   A1  T11 journey: a mid-flight caller abort settles as a truthful
 *       NON-completion (failed/aborted, USER_CANCELLED, no artifact on disk,
 *       no success journal row, exactly one physical attempt, no retry).
 *   A2  a NEW authorized submission under a fresh identity completes — the
 *       caller's explicit decision, never an automatic redownload of the
 *       aborted occurrence.
 *
 * Run: node --experimental-transform-types --test <this file>   (repo root)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  LineageLedger,
  LineageLedgerError,
  assembleDownloadRuntime,
  submitConfirmedDownload,
  type DownloadRuntime,
  type SubmissionOutcome,
  type UnknownEffectRecord,
} from '@xdownload/download-domain-app';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function typedCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof LineageLedgerError, `expected LineageLedgerError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected a typed LineageLedgerError, none thrown');
}

// ---------------------------------------------------------------------------
// Part 1 — T09 UNKNOWN reconciliation book (temp-dir real files)
// ---------------------------------------------------------------------------

const ledgerRoot = mkdtempSync(join(tmpdir(), 'xd-v02-t14-v2-ledger-'));
const ledgerPath = join(ledgerRoot, 'lineage-ledger.json');
const LINEAGE = 'lineage-t14-unknown';
const WRITER_A = { writerId: 'k:v0.2:t14-writer-a', kind: 'new-k' } as const;
const GRANT_CLAIM = 'auth:t14-validator-claim';
const GRANT_RESOLVE = 'auth:t14-validator-resolve-new';

let firstUnknown: UnknownEffectRecord | undefined;
let secondUnknown: UnknownEffectRecord | undefined;

after(() => {
  rmSync(ledgerRoot, { recursive: true, force: true });
});

describe('T14 V2/U — UNKNOWN book is append-only with explicit resolve only', () => {
  it('U1 — records persist across reopen; nothing auto-clears or auto-replays', () => {
    const ledger = LineageLedger.open({ path: ledgerPath });
    ledger.claimLineage({ lineageId: LINEAGE, writer: WRITER_A, authorization: GRANT_CLAIM });

    firstUnknown = ledger.recordUnknownEffect({
      lineageId: LINEAGE,
      writerId: WRITER_A.writerId,
      effect: { kind: 'external-write', target: 'artifact-a', observedOutcome: 'UNKNOWN', detail: 'writer died mid-effect' },
    });
    secondUnknown = ledger.recordUnknownEffect({
      lineageId: LINEAGE,
      writerId: WRITER_A.writerId,
      effect: { kind: 'external-write', target: 'artifact-b', observedOutcome: 'UNKNOWN', detail: 'timeout without terminal evidence' },
    });
    assert.notEqual(firstUnknown.unknownId, secondUnknown.unknownId);

    // REAL process boundary: fresh instance over the same durable file.
    const reopened = LineageLedger.open({ path: ledgerPath });
    const pending = reopened.listUnknownEffects();
    assert.equal(pending.length, 2, 'both UNKNOWN records must still be pending after reopen');
    assert.deepEqual(
      pending.map(({ unknownId, resolution, resolvedAt, resolvedWithAuthorization }) => ({
        unknownId,
        resolution,
        resolvedAt,
        resolvedWithAuthorization,
      })),
      [
        { unknownId: firstUnknown.unknownId, resolution: null, resolvedAt: null, resolvedWithAuthorization: null },
        { unknownId: secondUnknown.unknownId, resolution: null, resolvedAt: null, resolvedWithAuthorization: null },
      ],
      'records must be unchanged and un-resolved (no auto-clear, no auto-replay)',
    );
    assert.equal(reopened.effectiveOwnerOf(LINEAGE), 'new-k', 'the claim also survives');
  });

  it('U2 — explicit resolution only: new authorization, stamped once, kept forever', () => {
    assert.ok(firstUnknown && secondUnknown);
    const ledger = LineageLedger.open({ path: ledgerPath });

    // Missing/empty authorization is refused before any transition.
    assert.equal(
      typedCode(() =>
        ledger.resolveUnknownEffect({ unknownId: firstUnknown.unknownId, authorization: '', resolution: { decision: 'x' } }),
      ),
      'LINEAGE_AUTHORIZATION_REQUIRED',
    );

    // The explicit resolution stamps and KEEPS the record.
    const resolved = ledger.resolveUnknownEffect({
      unknownId: firstUnknown.unknownId,
      authorization: GRANT_RESOLVE,
      resolution: { decision: 'keep-artifact', operator: 'zcode:xd-v02-t14-validator-agent', note: 'T14 explicit human-driven resolve' },
    });
    assert.ok(resolved.resolvedAt !== null && resolved.resolvedAt.length > 0);
    assert.equal(resolved.resolvedWithAuthorization, GRANT_RESOLVE);
    assert.deepEqual(resolved.resolution, {
      decision: 'keep-artifact',
      operator: 'zcode:xd-v02-t14-validator-agent',
      note: 'T14 explicit human-driven resolve',
    });
    assert.equal(ledger.listUnknownEffects().length, 1, 'only the untouched record stays pending');
    assert.equal(ledger.listUnknownEffects({ includeResolved: true }).length, 2, 'resolved records are never deleted');

    // Exactly once.
    assert.equal(
      typedCode(() =>
        ledger.resolveUnknownEffect({
          unknownId: firstUnknown.unknownId,
          authorization: 'auth:t14-another-grant',
          resolution: { decision: 'again' },
        }),
      ),
      'UNKNOWN_ALREADY_RESOLVED',
    );
    assert.equal(
      typedCode(() =>
        ledger.resolveUnknownEffect({
          unknownId: 'unknown-does-not-exist',
          authorization: GRANT_RESOLVE,
          resolution: { decision: 'x' },
        }),
      ),
      'UNKNOWN_NOT_FOUND',
    );
  });

  it('U3 — the resolution survives a restart; the book and history stay append-only', () => {
    assert.ok(secondUnknown);
    const reopened = LineageLedger.open({ path: ledgerPath });

    const all = reopened.listUnknownEffects({ includeResolved: true });
    assert.equal(all.length, 2, 'the book never shrank');
    const resolvedRecord = all.find(({ unknownId }) => unknownId === firstUnknown?.unknownId);
    assert.ok(resolvedRecord);
    assert.ok(resolvedRecord.resolvedAt !== null);
    assert.equal(resolvedRecord.resolvedWithAuthorization, GRANT_RESOLVE);
    assert.ok(resolvedRecord.resolution !== null && resolvedRecord.resolution['decision'] === 'keep-artifact');
    const stillPending = all.find(({ unknownId }) => unknownId === secondUnknown.unknownId);
    assert.ok(stillPending);
    assert.equal(stillPending.resolvedAt, null, 'the unresolved record stays honestly pending');

    const kinds = reopened.history().map(({ kind }) => kind);
    assert.equal(kinds.filter((kind) => kind === 'unknown-recorded').length, 2);
    assert.equal(kinds.filter((kind) => kind === 'unknown-resolved').length, 1);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — T11 journey abort: honest non-completion
// ---------------------------------------------------------------------------

const abortRoot = mkdtempSync(join(tmpdir(), 'xd-v02-t14-v2-abort-'));
const abortOutputRoot = join(abortRoot, 'out');
const abortStorePath = join(abortRoot, 'k-docs.json');
const HANDLE = 'ref:validator/v2-file.bin';
const ABORT_REQUEST_ID = 't14-v2-aborted';

let runtime: DownloadRuntime | undefined;

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

  /** Serve a first partial byte range and never finish (client must abort). */
  stallAfterBytes(path: string, body: Uint8Array, stallAt: number): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.write(Buffer.from(body.subarray(0, stallAt)));
      // Never end: the AbortSignal is the only way this response completes.
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

const abortFixture = new LocalHttpFixture();

function payload(size: number, seed = 7): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function intentFor(requestId: string, bytes: Buffer): Record<string, unknown> {
  return {
    requestId,
    lineageId: `lineage-${requestId}`,
    targetRef: HANDLE,
    outputRootScope: abortOutputRoot,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: sha256(bytes),
    declaredBytes: bytes.byteLength,
    caller: { actor: 'zcode:xd-v02-t14-validator-agent', sessionRef: 'session:t14-validation-core' },
  };
}

function journalHasSuccess(current: DownloadRuntime): boolean {
  return current.store.journalRows().some(({ record }) => JSON.stringify(record).includes('"ok":true'));
}

after(async () => {
  runtime?.stop();
  await abortFixture.stop();
  rmSync(abortRoot, { recursive: true, force: true });
});

describe('T14 V2/A — mid-flight abort settles as an honest non-completion', () => {
  it('A1 — caller abort: failed/aborted, no file, no success journal, exactly one attempt', async () => {
    await abortFixture.start();
    const stalledBody = payload(8192, 2402);
    abortFixture.stallAfterBytes('/file.bin', stalledBody, 64);
    runtime = await assembleDownloadRuntime({
      storePath: abortStorePath,
      targetRefs: [
        { handle: HANDLE, record: { uri: abortFixture.uri('/file.bin'), allowedRedirectHosts: [abortFixture.host()] } },
      ],
    });

    const controller = new AbortController();
    const pending: Promise<SubmissionOutcome> = submitConfirmedDownload(runtime, intentFor(ABORT_REQUEST_ID, stalledBody), {
      signal: controller.signal,
    });

    // Abort as soon as the physical request really hit the socket.
    for (let i = 0; i < 400 && abortFixture.requestCount('/file.bin') === 0; i += 1) {
      await new Promise((wait) => setTimeout(wait, 25));
    }
    assert.ok(abortFixture.requestCount('/file.bin') === 1, 'the transfer must have started');
    controller.abort(new Error('caller cancelled'));

    const outcome = await pending;
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.aborted, true, 'the failure must be marked as the caller cancellation');
    assert.equal(outcome.error.code, 'USER_CANCELLED');
    assert.equal(outcome.terminal?.phase, 'terminal');
    assert.equal(outcome.terminal?.outcome.ok, false);

    // Honest durable state: no artifact, no success row, exactly one attempt.
    assert.equal(existsSync(join(abortOutputRoot, `${ABORT_REQUEST_ID}.bin`)), false);
    assert.equal(runtime.bridge.counters.filesWritten, 0);
    assert.equal(runtime.bridge.counters.acquireCalls, 1, 'exactly one attempt, no automatic retry');
    assert.equal(abortFixture.requestCount('/file.bin'), 1, 'no automatic redownload');
    assert.equal(journalHasSuccess(runtime), false, 'no journal row may claim success after an abort');
  });

  it('A2 — a NEW authorized submission under a fresh identity completes (explicit, not auto)', async () => {
    assert.ok(runtime);
    const retryBody = payload(4096, 2403);
    abortFixture.serveBytes('/file.bin', retryBody);

    const retry = await submitConfirmedDownload(runtime, intentFor('t14-v2-retry', retryBody));
    assert.equal(retry.status, 'completed', `the new authorized submission must complete (got ${JSON.stringify('status' in retry ? retry.status : retry)})`);
    if (retry.status !== 'completed') return;

    // The retried identity wrote its own artifact; the aborted one never
    // appeared (zero auto-redownload of the aborted occurrence).
    assert.equal(existsSync(join(abortOutputRoot, 't14-v2-retry.bin')), true);
    assert.equal(existsSync(join(abortOutputRoot, `${ABORT_REQUEST_ID}.bin`)), false);
    assert.equal(sha256(readFileSync(join(abortOutputRoot, 't14-v2-retry.bin'))), sha256(retryBody));
    assert.equal(abortFixture.requestCount('/file.bin'), 2, 'exactly the two authorized requests, nothing more');
  });
});
