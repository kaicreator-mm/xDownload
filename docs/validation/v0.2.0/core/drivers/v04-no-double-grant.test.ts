/**
 * v0.2 T14 validation-core driver V4 — no double grant (independent
 * Validator; candidate tree @ task/v02-t14 head).
 *
 * Drives the public facade `@xdownload/download-domain-app` ONLY:
 *
 *   G1  T11 exactly-one permit / no double journal: one occurrence mints
 *       exactly ONE durable effect-permit and ONE effect-journal row; an
 *       idempotent replay of the same messageId adds NONE (zero bridge
 *       dispatch, zero real socket requests); a SECOND, separately
 *       authorized occurrence mints its OWN permit/journal (grants are
 *       per-occurrence, never shared, never reused).
 *   G2  T09 one writer per lineage: a second writer identity is refused
 *       typed (WRITER_IDENTITY_CONFLICT, the U02/N06 PoC code), a foreign
 *       release is refused, the ownership survives a reopen, and the
 *       generation partition holds in both directions
 *       (LINEAGE_PARTITION_VIOLATION for new-K-on-legacy and for
 *       legacy-re-register-of-new-K).
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

// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'xd-v02-t14-v4-'));
const outputRoot = join(root, 'out');
const storePath = join(root, 'k-docs.json');
const ledgerPath = join(root, 'lineage-ledger.json');
const HANDLE = 'ref:validator/v4-file.bin';

const fixture = new LocalHttpFixture();
let runtime: DownloadRuntime | undefined;

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
    outputRootScope: outputRoot,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: sha256(bytes),
    declaredBytes: bytes.byteLength,
    caller: { actor: 'zcode:xd-v02-t14-validator-agent', sessionRef: 'session:t14-validation-core' },
  };
}

after(async () => {
  runtime?.stop();
  await fixture.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('T14 V4/G1 — exactly one K permit per occurrence; no double journal', () => {
  it('G1a — first occurrence mints exactly 1 permit + 1 journal row; replay adds none', async () => {
    await fixture.start();
    fixture.serveBytes('/file.bin', payload(2048, 4401));
    runtime = await assembleDownloadRuntime({
      storePath,
      targetRefs: [
        { handle: HANDLE, record: { uri: fixture.uri('/file.bin'), allowedRedirectHosts: [fixture.host()] } },
      ],
    });

    assert.equal(runtime.store.journalRows().length, 0, 'fresh runtime: zero journal rows');
    assert.equal(runtime.store.permitDocs().length, 0, 'fresh runtime: zero permits');

    const first = await submitConfirmedDownload(runtime, intentFor('t14-v4-first', payload(2048, 4401)));
    assert.equal(first.status, 'completed');
    if (first.status !== 'completed') return;

    assert.equal(runtime.store.permitDocs().length, 1, 'exactly one K permit');
    assert.equal(runtime.store.journalRows().length, 1, 'exactly one journal row');
    assert.ok(runtime.store.permitDocs()[0]?.key.includes(`effect-permit:${first.permitEffectId}`));
    assert.equal(runtime.bridge.counters.acquireCalls, 1);
    assert.equal(fixture.requestCount('/file.bin'), 1);

    const firstPermitKey = runtime.store.permitDocs()[0]?.key ?? '';
    const firstJournalKey = runtime.store.journalRows()[0]?.key ?? '';

    // Idempotent replay of the SAME messageId: zero second effects anywhere.
    const replay = await submitConfirmedDownload(runtime, intentFor('t14-v4-first', payload(2048, 4401)));
    assert.equal(replay.status, 'replayed');
    assert.equal(runtime.store.permitDocs().length, 1, 'no double permit');
    assert.equal(runtime.store.journalRows().length, 1, 'no double journal');
    assert.equal(runtime.bridge.counters.acquireCalls, 1);
    assert.equal(fixture.requestCount('/file.bin'), 1);
    assert.equal(runtime.store.permitDocs()[0]?.key, firstPermitKey);
    assert.equal(runtime.store.journalRows()[0]?.key, firstJournalKey);
  });

  it('G1b — a SECOND authorized occurrence gets its OWN grant; grants are never shared', async () => {
    assert.ok(runtime);
    const secondBody = payload(1024, 4402);
    fixture.serveBytes('/file.bin', secondBody);

    const second = await submitConfirmedDownload(runtime, intentFor('t14-v4-second', secondBody));
    assert.equal(second.status, 'completed');
    if (second.status !== 'completed') return;

    // Two occurrences → exactly two distinct permits, two journal rows,
    // two physical dispatches. No permit reuse, no journal collapse.
    assert.equal(runtime.store.permitDocs().length, 2);
    assert.equal(runtime.store.journalRows().length, 2);
    assert.equal(runtime.bridge.counters.acquireCalls, 2);
    assert.equal(fixture.requestCount('/file.bin'), 2);
    const permitKeys = runtime.store.permitDocs().map(({ key }) => key);
    assert.equal(new Set(permitKeys).size, 2, 'permit identities must be distinct');
    assert.ok(permitKeys.some((key) => key.includes(`effect-permit:${second.permitEffectId}`)));
    // The first grant was consumed once and never re-minted.
    assert.equal(permitKeys.filter((key) => key.includes('effect-permit:')).length, 2);
    assert.equal(existsSync(join(outputRoot, 't14-v4-second.bin')), true);
    assert.equal(sha256(readFileSync(join(outputRoot, 't14-v4-second.bin'))), sha256(secondBody));
  });
});

describe('T14 V4/G2 — T09 one writer per lineage (dual-writer refusal)', () => {
  it('G2 — second writer refused typed; ownership survives reopen; partition holds both ways', () => {
    const WRITER_A = { writerId: 'k:v0.2:t14-writer-a', kind: 'new-k' } as const;
    const WRITER_B = { writerId: 'k:v0.2:t14-writer-b', kind: 'new-k' } as const;
    const LEGACY = { writerId: 'legacy-core:v0.1', kind: 'old-core' } as const;
    const lineageId = 'lineage-t14-v4-exclusive';

    const ledger = LineageLedger.open({ path: ledgerPath });
    const claim = ledger.claimLineage({ lineageId, writer: WRITER_A, authorization: 'auth:t14-v4-claim-a' });
    assert.equal(claim.ownerWriterId, WRITER_A.writerId);
    assert.equal(claim.state, 'owned');

    // A second business writer on the same lineage: refused typed (U02/N06).
    assert.equal(
      typedCode(() => ledger.claimLineage({ lineageId, writer: WRITER_B, authorization: 'auth:t14-v4-claim-b' })),
      'WRITER_IDENTITY_CONFLICT',
    );
    // A foreign release is refused the same way.
    assert.equal(
      typedCode(() => ledger.releaseLineage({ lineageId, writer: WRITER_B })),
      'WRITER_IDENTITY_CONFLICT',
    );
    // A legacy writer claiming a fresh lineage is refused (default partition).
    assert.equal(
      typedCode(() => ledger.claimLineage({ lineageId: 'lineage-t14-v4-fresh', writer: LEGACY, authorization: 'auth:x' })),
      'LINEAGE_PARTITION_VIOLATION',
    );
    // Partition inversion on the SAME ledger: a new-K-owned lineage can never
    // be re-registered as a legacy lineage.
    assert.equal(
      typedCode(() => ledger.registerLegacyLineage(lineageId)),
      'LINEAGE_PARTITION_VIOLATION',
    );

    // Ownership survives a real reopen of the same durable file.
    const reopened = LineageLedger.open({ path: ledgerPath });
    const stillOwned = reopened.claimFor(lineageId);
    assert.ok(stillOwned);
    assert.equal(stillOwned.ownerKind, 'new-k');
    assert.equal(stillOwned.ownerWriterId, WRITER_A.writerId);
    assert.equal(stillOwned.state, 'owned');
    assert.equal(reopened.effectiveOwnerOf(lineageId), 'new-k');

    // Generation partition, on a fresh legacy lineages file.
    const legacyLedger = LineageLedger.open({ path: join(root, 'lineage-ledger-legacy.json') });
    legacyLedger.registerLegacyLineage('lineage-t14-v4-old');
    assert.equal(
      typedCode(() =>
        legacyLedger.claimLineage({ lineageId: 'lineage-t14-v4-old', writer: WRITER_A, authorization: 'auth:t14-v4-claim-a' }),
      ),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });
});
