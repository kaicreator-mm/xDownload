/**
 * v0.2 T04 bridge tests — node:test colocated in the T04 write set (T01
 * precedent: root Node24 toolchain, real 127.0.0.1 node:http fixture on a
 * random port, every request recorded).
 *
 * Counter evidence convention: every negative asserts BOTH the bridge-side
 * counters (permitRefusals / targetRefRefusals / pathRefusals /
 * transferStarts.length) AND the fixture-side recorded request count, so a
 * zero-network guarantee is proven against the real socket, not the bridge's
 * own bookkeeping.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { validateMaterializedEvidence } from '@xdownload/download-domain-app/src/contracts/index.ts';
import { CanonicalBudgetLedger } from './budget-ledger.ts';
import {
  DirectAcquisitionBridge,
  type KernelPermitContext,
} from './direct-acquisition-bridge.ts';
import { InMemoryTargetRefRegistry, type TargetRefRecord } from './target-ref-registry.ts';

const HANDLE = 'ref:file-001';
const PERMIT: KernelPermitContext = { effectId: 'effect-req-001', durableControlTurnId: 'turn-001' };

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

type Behavior = (request: IncomingMessage, response: ServerResponse) => void;

/** Real localhost HTTP fixture: random port, per-path behavior, recorded requests. */
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

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  async start(): Promise<string> {
    await new Promise<void>((resolveStart) => {
      this.server.listen(0, '127.0.0.1', () => resolveStart());
    });
    this.port = (this.server.address() as { port: number }).port;
    return this.baseUri;
  }

  get baseUri(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  get host(): string {
    return `127.0.0.1:${String(this.port)}`;
  }

  uri(path: string): string {
    return `${this.baseUri}${path}`;
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

  redirect(path: string, location: string): void {
    this.on(path, (_request, response) => {
      response.writeHead(302, { location });
      response.end();
    });
  }

  /** Serve a first partial byte range and never finish (client must abort). */
  stallAfterBytes(path: string, body: Uint8Array, stallAfterBytes: number): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.write(Buffer.from(body.subarray(0, stallAfterBytes)));
      // Never end: the AbortSignal is the only way this response completes.
    });
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolveStop, rejectStop) => {
      this.server.close((error) => (error === undefined ? resolveStop() : rejectStop(error)));
    });
  }
}

interface Lane {
  readonly root: string;
  readonly fixture: LocalHttpFixture;
  readonly registry: InMemoryTargetRefRegistry;
  readonly ledger: CanonicalBudgetLedger;
  readonly bridge: DirectAcquisitionBridge;
}

function budgetProfile(maxTransferBytes?: number): unknown {
  return {
    discovery: { domain: 'discovery' },
    transfer: { domain: 'transfer', ...(maxTransferBytes === undefined ? {} : { maxBytes: maxTransferBytes }) },
    globalSafety: { domain: 'global_safety' },
  };
}

async function makeLane(test: TestContext, options: { maxTransferBytes?: number } = {}): Promise<Lane> {
  const fixture = new LocalHttpFixture();
  await fixture.start();
  const registry = new InMemoryTargetRefRegistry();
  const record: TargetRefRecord = { uri: fixture.uri('/file.bin'), allowedRedirectHosts: [fixture.host] };
  assert.equal(registry.register(HANDLE, record).ok, true);
  const ledger = new CanonicalBudgetLedger(budgetProfile(options.maxTransferBytes));
  const bridge = new DirectAcquisitionBridge(registry, ledger);
  // Windows-safe slug: test names carry ':' etc., which are illegal in paths.
  const slug = test.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  const root = mkdtempSync(join(tmpdir(), `xd-t04-${slug}-`));
  return {
    root,
    fixture,
    registry,
    ledger,
    bridge,
  };
}

function intentFor(lane: Lane, body: Uint8Array, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-001',
    lineageId: 'lineage-001',
    targetRef: HANDLE,
    outputRootScope: lane.root,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: sha256(body),
    declaredBytes: body.byteLength,
    caller: { actor: 't04-builder', sessionRef: 'session-001' },
    ...overrides,
  };
}

describe('T04 DirectAcquisitionBridge', () => {
  it('positive: permitted acquire materializes digest-verified bytes and charges the single ledger', async (test) => {
    const body = payload(2048);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      const envelope = await lane.bridge.acquire(intentFor(lane, body), PERMIT);

      assert.equal(envelope.phase, 'terminal');
      assert.equal(envelope.externalRef, PERMIT.effectId);
      assert.ok(envelope.phase === 'terminal' && envelope.outcome.ok === true);
      const output = envelope.phase === 'terminal' && envelope.outcome.ok === true ? envelope.outcome.output : {};
      const artifactPath = join(lane.root, 'req-001.bin');
      assert.equal(output['artifactPath'], artifactPath);
      assert.equal(output['fileSha256'], sha256(body));
      assert.equal(output['bytesWritten'], body.byteLength);
      assert.equal(output['receivedBytes'], body.byteLength);
      assert.equal(output['stopReason'], 'COMPLETED');
      assert.equal(output['permitEffectId'], PERMIT.effectId);
      assert.equal(output['durableControlTurnId'], PERMIT.durableControlTurnId);
      assert.equal(output['targetBasis'], 'PUBLISHED_SHA256');

      // The file is really there with exactly the confirmed bytes.
      assert.equal(existsSync(artifactPath), true);
      assert.ok(readFileSync(artifactPath).equals(body));
      // The returned evidence passes the T01 evidence grammar against the root.
      assert.equal(
        validateMaterializedEvidence(
          {
            fileSha256: String(output['fileSha256']),
            bytesWritten: Number(output['bytesWritten']),
            artifactPath: String(output['artifactPath']),
            stopReason: String(output['stopReason']),
          },
          lane.root,
        ).ok,
        true,
      );

      // Counter evidence: exactly one network request, one file, one writer.
      assert.equal(lane.fixture.requests.length, 1);
      assert.equal(lane.bridge.counters.filesWritten, 1);
      assert.equal(lane.bridge.counters.bytesDownloaded, body.byteLength);
      assert.equal(lane.bridge.counters.permitRefusals, 0);
      assert.equal(lane.bridge.transferStarts.length, 1);
      // Single budget truth: consumption is visible only through the port.
      assert.equal(lane.ledger.consumedSnapshot.transfer.bytes, body.byteLength);
      assert.equal(lane.ledger.transferRequestsReported, 1);
      assert.equal(lane.ledger.remaining().transfer.exhausted, false);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: no permit → typed refusal with zero network and zero file (counter proof)', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      for (const missing of [undefined, 'not-a-permit', { effectId: 'effect-req-001' }]) {
        const envelope = await lane.bridge.acquire(intentFor(lane, body), missing);
        assert.ok(envelope.phase === 'terminal');
        assert.ok(envelope.phase === 'terminal' && envelope.outcome.ok === false);
        if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
          assert.equal(envelope.outcome.error.code.startsWith('PERMIT_'), true);
        }
      }
      // Zero network: the fixture recorded no requests at all.
      assert.equal(lane.fixture.requests.length, 0);
      // Zero file: the default artifact path was never created.
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      // Zero side effects anywhere else.
      assert.equal(lane.bridge.counters.permitRefusals, 3);
      assert.equal(lane.bridge.counters.filesWritten, 0);
      assert.equal(lane.bridge.transferStarts.length, 0);
      assert.equal(lane.ledger.consumedSnapshot.transfer.bytes, 0);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: redirect outside the declared hosts refuses before touching the foreign host', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    const foreign = new LocalHttpFixture();
    try {
      const foreignBase = await foreign.start();
      lane.fixture.redirect('/file.bin', `${foreignBase}/elsewhere`);
      foreign.serveBytes('/elsewhere', body);

      const envelope = await lane.bridge.acquire(intentFor(lane, body), PERMIT);
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'LOCATOR_SUBSTITUTION');
      }
      // The declared delivery graph was not widened: the foreign host got no
      // request, and nothing materialized.
      assert.equal(foreign.requests.length, 0);
      assert.equal(lane.fixture.requests.length, 1);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.filesWritten, 0);
    } finally {
      await lane.fixture.stop();
      await foreign.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('positive: redirect inside the declared hosts completes (declared graph, not widened)', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    try {
      lane.fixture.redirect('/hop.bin', lane.fixture.uri('/file.bin'));
      lane.fixture.serveBytes('/file.bin', body);
      const record: TargetRefRecord = { uri: lane.fixture.uri('/hop.bin'), allowedRedirectHosts: [lane.fixture.host] };
      assert.equal(lane.registry.register('ref:hop-001', record).ok, true);

      const envelope = await lane.bridge.acquire(intentFor(lane, body, { targetRef: 'ref:hop-001' }), PERMIT);
      assert.ok(envelope.phase === 'terminal' && envelope.outcome.ok === true);
      const artifactPath = join(lane.root, 'req-001.bin');
      assert.equal(existsSync(artifactPath), true);
      assert.equal(lane.fixture.requests.length, 2);
      assert.equal(lane.bridge.counters.filesWritten, 1);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: digest mismatch → no file materializes', async (test) => {
    const body = payload(1024);
    const other = payload(1024, 99);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      // Confirmed anchor belongs to DIFFERENT bytes: the transfer must never
      // be accepted and nothing may be written.
      const envelope = await lane.bridge.acquire(intentFor(lane, body, { digestAnchor: sha256(other) }), PERMIT);
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'WRONG_TARGET');
      }
      assert.equal(lane.fixture.requests.length, 1);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.filesWritten, 0);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: artifact path escaping the output root refuses before any network', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      const escapes = [
        `${lane.root}${sep}sub${sep}..${sep}escaped.bin`,
        `${lane.root}${sep}..${sep}outside.bin`,
        `${lane.root}-sibling${sep}x.bin`,
        lane.root,
      ];
      for (const artifactPath of escapes) {
        const envelope = await lane.bridge.acquire(intentFor(lane, body), PERMIT, { artifactPath });
        assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
        if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
          assert.equal(envelope.outcome.error.code, 'OUTPUT_ROOT_ESCAPED');
        }
      }
      assert.equal(lane.bridge.counters.pathRefusals, escapes.length);
      // Zero network for every refused path.
      assert.equal(lane.fixture.requests.length, 0);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(existsSync(join(lane.root, '..', 'outside.bin')), false);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: targetRef given as a raw URL is refused with zero network (never parsed as a locator)', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      const rawUrl = lane.fixture.uri('/file.bin');
      const envelope = await lane.bridge.acquire(intentFor(lane, body, { targetRef: rawUrl }), PERMIT);
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'LOCATOR_SUBSTITUTION_REJECTED');
      }
      // The URL targetRef was never dereferenced.
      assert.equal(lane.fixture.requests.length, 0);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.scopeRefusals, 1);

      // Registry-level assertion: a locator-shaped handle can never be
      // seeded, and a locator-shaped targetRef can never resolve.
      assert.equal(lane.registry.register(rawUrl, { uri: rawUrl, allowedRedirectHosts: [] }).ok, false);
      const resolved = lane.registry.resolve(rawUrl);
      assert.equal(resolved.ok, false);
      if (!resolved.ok) {
        assert.equal(resolved.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
      }
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('negative: unknown registry handle → typed refusal with zero network', async (test) => {
    const body = payload(1024);
    const lane = await makeLane(test);
    try {
      lane.fixture.serveBytes('/file.bin', body);
      const envelope = await lane.bridge.acquire(intentFor(lane, body, { targetRef: 'ref:missing' }), PERMIT);
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'CONTRACT_BINDING_MISMATCH');
      }
      assert.equal(lane.fixture.requests.length, 0);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.targetRefRefusals, 1);
      assert.equal(lane.bridge.transferStarts.length, 0);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('cancellation: a fired AbortSignal stops the transfer; partial bytes never materialize', async (test) => {
    const body = payload(8192);
    const lane = await makeLane(test);
    try {
      lane.fixture.stallAfterBytes('/file.bin', body, 64);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 150);
      const envelope = await lane.bridge.acquire(intentFor(lane, body), PERMIT, { signal: controller.signal });
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'USER_CANCELLED');
      }
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.filesWritten, 0);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });

  it('budget: exhausted transfer budget on the single port stops the transfer with zero network', async (test) => {
    const body = payload(4096);
    const lane = await makeLane(test, { maxTransferBytes: 1024 });
    try {
      lane.fixture.serveBytes('/file.bin', body);
      // The durable budget owner exhausted the transfer domain before this
      // dispatch; the adapter must see that through OUR injected port (single
      // budget truth) and refuse before any request.
      lane.ledger.consume({ transferRequests: 0, retryTransferRequests: 0, bytes: 1024 });
      assert.equal(lane.ledger.remaining().transfer.exhausted, true);

      const envelope = await lane.bridge.acquire(intentFor(lane, body), PERMIT);
      assert.ok(envelope.phase === 'terminal' && !envelope.outcome.ok);
      if (envelope.phase === 'terminal' && !envelope.outcome.ok) {
        assert.equal(envelope.outcome.error.code, 'TRANSFER_BUDGET_EXHAUSTED');
      }
      assert.equal(lane.fixture.requests.length, 0);
      assert.equal(existsSync(join(lane.root, 'req-001.bin')), false);
      assert.equal(lane.bridge.counters.filesWritten, 0);
      // Consumption never grew past the exhaustion point.
      assert.equal(lane.ledger.consumedSnapshot.transfer.bytes, 1024);
    } finally {
      await lane.fixture.stop();
      rmSync(lane.root, { recursive: true, force: true });
    }
  });
});
