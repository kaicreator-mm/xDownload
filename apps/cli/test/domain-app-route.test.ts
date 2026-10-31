/**
 * v0.2.1 T04 — the CF-1 closure suite: installed argv reaches
 * `domain-app-commands` → the public DomainApp facade (seam-bound) → the
 * admitted K composition inside a REAL Core process.
 *
 * The Core side of every test below is a real `createCoreRuntime`
 * composition (or the real bare seam server): the CLI never talks to a fake
 * transport. The K lane is driven against a stalled loopback origin so the
 * ONE K is genuinely invoked (route claim → attempt → Host bridge) and the
 * outcome settles truthfully FAILED — no ffmpeg, no live media bytes, and
 * every assertion reads only CLI documents, seam facts and route pin
 * counters.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  type SeamListenTarget,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import { closeCoreRuntime, createCoreRuntime, type CoreRuntime } from '@xdownload/core-runtime';
import { S4_HLS_MEDIA_PROFILE, s4HlsSelectionTupleDigest } from '@xdownload/download-domain-app';
import { runArgv, type AdapterPorts, type AdapterResult } from '../src/adapter.ts';
import { adapterPorts, startSeam, EXPECTED_PEER, type RunningSeam } from './helpers.ts';

/** Peer scope of the routed real-Core compositions. */
const INSTALL_ID = 'install-t04-cli';
const USER_ID = 'user-t04-cli';
const ROUTED_FLAGS = ['--install-id', INSTALL_ID, '--user-id', USER_ID];
/** Peer scope of the bare seam helpers (EXPECTED_PEER). */
const BARE_FLAGS = ['--install-id', EXPECTED_PEER.installId, '--user-id', EXPECTED_PEER.userId];

const roots: string[] = [];
const runtimes: CoreRuntime[] = [];
const transports: SeamServerTransport[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    closeCoreRuntime(runtime);
  }
  for (const transport of transports.splice(0)) {
    await transport.stop();
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** A loopback HTTP origin that never answers: the trusted target registry
 * admits it (fixtureLoopbackHttp) and the K Host bridge truthfully fails on
 * the stalled manifest — no ffmpeg, no media bytes needed to prove the
 * admitted-K chain. */
async function startStalledOrigin(): Promise<string> {
  const server = createServer(() => undefined);
  servers.push(server);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stalled fixture did not bind a TCP port');
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

function mediaBudget(): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes: 8_000_000,
      maxSegments: 8,
      maxRetryTransferRequests: 4,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1_000 },
  };
}

interface RoutedCore {
  readonly runtime: CoreRuntime;
  readonly target: SeamListenTarget;
}

/** One real Core process with the ONE admitted K composition (T02 route),
 * served over the real loopback transport. */
async function startRoutedCore(root: string, origin: string): Promise<RoutedCore> {
  const runtime = createCoreRuntime({
    rootDir: root,
    expectedPeer: { installId: INSTALL_ID, userId: USER_ID, allowedSurfaces: ['CLI'] },
    domainApp: {
      mediaTargetRefs: [
        {
          handle: 'ref:t04-stalled-target-001',
          record: {
            protocol: 'HLS',
            manifestUri: `${origin}/master.m3u8`,
            artifactFileName: 't04-stalled.ts',
            allowedManifestOrigins: [origin],
            allowedSegmentOrigins: [origin],
            budget: mediaBudget(),
            fixtureLoopbackHttp: true,
            manifestMaxBytes: 65_536,
            segmentMaxBytes: 2_000_000,
            timeoutMs: 2_000,
          },
        },
      ],
    },
  });
  runtimes.push(runtime);
  await runtime.domainApp?.ready;
  const transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
  transports.push(transport);
  const target = await transport.start({
    onFrame: (connection, frame) => {
      const response = runtime.seam.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
  return { runtime, target };
}

function routedPorts(target: SeamListenTarget, files: ReadonlyMap<string, string>): AdapterPorts {
  return adapterPorts(target, { files, transport: createLoopbackClientTransport() });
}

async function runV02(
  argv: readonly string[],
  ports: AdapterPorts,
): Promise<AdapterResult & { json: unknown }> {
  const result = await runArgv([...argv], ports);
  return { ...result, json: JSON.parse(result.document) as unknown };
}

/** One valid confirmed S4 HLS intent targeting the stalled origin. */
function confirmedS4Intent(outputRootScope: string, origin: string): Record<string, unknown> {
  const now = Date.now();
  const tuple = {
    contractId: 'contract-t04-001',
    snapshotId: 'snapshot-t04-001',
    memberId: 'member-t04-001',
    previewId: 'preview-t04-001',
    renditionKey: 'rend-0',
    renditionUri: `${origin}/media.m3u8`,
    manifestUri: `${origin}/master.m3u8`,
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: 500_000,
    width: 160,
    height: 90,
  };
  return {
    requestId: 'req-t04-001',
    lineageId: 'lineage-t04-001',
    contractId: tuple.contractId,
    targetRef: 'ref:t04-stalled-target-001',
    outputRootScope,
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'confirmed-t04-001',
      previewId: tuple.previewId,
      snapshotId: tuple.snapshotId,
      memberId: tuple.memberId,
      manifestUri: tuple.manifestUri,
      mediaProfileId: tuple.mediaProfileId,
      renditionKey: tuple.renditionKey,
      renditionUri: tuple.renditionUri,
      displayedTupleDigest: s4HlsSelectionTupleDigest(tuple),
      confirmedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
    },
    caller: { actor: 't04-cli-test', sessionRef: 'session-t04-001' },
  };
}

describe('v0.2 Domain App route (CF-1 chain)', () => {
  it('argv reaches domain-app-commands → the public facade → the admitted K composition', async () => {
    const root = await tempRoot('t04-routed-');
    const origin = await startStalledOrigin();
    const { runtime, target } = await startRoutedCore(root, origin);
    const files = new Map([
      ['intent.json', JSON.stringify(confirmedS4Intent(resolve(join(root, 'output')), origin))],
    ]);
    const ports = routedPorts(target, files);

    const submit = await runV02(
      [
        'submit',
        ...ROUTED_FLAGS,
        '--port',
        String(target.port),
        '--route',
        'v0.2',
        '--file',
        'intent.json',
      ],
      ports,
    );
    // The send was admitted by the v0.2 route (acceptance, never success).
    expect(submit.exitCode).toBe(0);
    expect((submit.json as Record<string, unknown>)['document']).toBe(
      'xdownload.cli.domain-app.sent',
    );
    expect((submit.json as Record<string, unknown>)['status']).toBe('RUNNING');
    expect(String(submit.stderr).startsWith('mode: v0.2 domain-app submit via core seam')).toBe(
      true,
    );

    // The route durably claimed the lineage BEFORE any effect (claim +
    // attempt facts are synchronous with the admission).
    const factKinds = (runtime.domainApp?.routeFacts() ?? []).map((fact) => fact.kind);
    expect(factKinds).toContain('CLAIM');
    expect(factKinds).toContain('ATTEMPT');

    // wait polls the truthful projection until the stalled transfer fails.
    const wait = await runV02(
      [
        'wait',
        ...ROUTED_FLAGS,
        '--port',
        String(target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-t04-001',
        '--timeout-ms',
        '20000',
        '--poll-ms',
        '100',
      ],
      ports,
    );
    expect(wait.exitCode).toBe(4); // TERMINAL_NON_SUCCESS — never a fake success
    const waitJson = wait.json as Record<string, unknown>;
    expect(waitJson['document']).toBe('xdownload.cli.domain-app.status');
    expect(waitJson['status']).toBe('FAILED');
    expect(waitJson['terminal']).toBe(true);
    expect(waitJson['error']).not.toBeNull();
    expect(String(wait.stderr)).toContain('wait: lineage lineage-t04-001');

    // The admitted K composition was invoked exactly once (one Host bridge
    // dispatch) and its outcome landed in the durable route log.
    expect(runtime.domainApp?.pin.acquireCalls).toBe(1);
    expect((runtime.domainApp?.routeFacts() ?? []).some((fact) => fact.kind === 'OUTCOME')).toBe(
      true,
    );

    // status reads the same Core-owned truth through the v0.2 read route.
    const status = await runV02(
      [
        'status',
        ...ROUTED_FLAGS,
        '--port',
        String(target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-t04-001',
      ],
      ports,
    );
    expect(status.exitCode).toBe(4);
    expect((status.json as Record<string, unknown>)['status']).toBe('FAILED');
    expect(runtime.domainApp?.pin.acquireCalls).toBe(1);
  }, 30_000);

  it('bounded wait stops at the deadline while the attempt is honestly RUNNING (no invented status)', async () => {
    const root = await tempRoot('t04-wait-timeout-');
    const origin = await startStalledOrigin();
    const { target } = await startRoutedCore(root, origin);
    const files = new Map([
      ['intent.json', JSON.stringify(confirmedS4Intent(resolve(join(root, 'output')), origin))],
    ]);
    const ports = routedPorts(target, files);
    const submit = await runV02(
      [
        'submit',
        ...ROUTED_FLAGS,
        '--port',
        String(target.port),
        '--route',
        'v0.2',
        '--file',
        'intent.json',
      ],
      ports,
    );
    expect(submit.exitCode).toBe(0);
    const wait = await runV02(
      [
        'wait',
        ...ROUTED_FLAGS,
        '--port',
        String(target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-t04-001',
        '--timeout-ms',
        '300',
        '--poll-ms',
        '50',
      ],
      ports,
    );
    expect(wait.exitCode).toBe(6); // WAIT_TIMEOUT
    const json = wait.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.domain-app.wait-timeout');
    expect(json['lineage_id']).toBe('lineage-t04-001');
    expect(String(wait.stderr)).toContain('bounded wait elapsed');
  }, 30_000);
});

describe('v0.2 Domain App route negatives', () => {
  it('an unreachable Core is a transport failure with actionable context, never a coded refusal', async () => {
    // Nothing listens on loopback port 1.
    const ports = adapterPorts(
      { host: '127.0.0.1', port: 1 },
      { transport: createLoopbackClientTransport() },
    );
    const run = await runV02(
      ['status', ...BARE_FLAGS, '--port', '1', '--route', 'v0.2', '--lineage', 'lineage-none'],
      ports,
    );
    expect(run.exitCode).toBe(5); // TRANSPORT
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.domain-app.error');
    expect(json['coded']).toBe(false); // a system error is never a typed refusal
    expect(String(run.stderr)).toContain('mode: v0.2 domain-app status via core seam');
    expect(String(run.stderr)).toContain('check that the installed Core is running');
  });

  it('missing Host endpoint fails closed as USAGE before any frame', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runV02(
      ['submit', ...BARE_FLAGS, '--route', 'v0.2', '--file', 'intent.json'],
      adapterPorts(seam.target, { transport: createLoopbackClientTransport() }),
    );
    expect(run.exitCode).toBe(1);
    expect(String(run.stderr)).toContain('input error');
    expect(JSON.stringify(run.json)).toContain('missing required option --port');
  });

  it('commands outside the closed v0.2 vocabulary refuse with USAGE', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runV02(
      [
        'download',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--url',
        'https://example.invalid/file',
      ],
      adapterPorts(seam.target, { transport: createLoopbackClientTransport() }),
    );
    expect(run.exitCode).toBe(1);
    expect(JSON.stringify(run.json)).toContain('not admitted on --route v0.2');
  });

  it('malformed payload JSON fails closed as USAGE', async () => {
    const seam: RunningSeam = await startSeam();
    const ports = adapterPorts(seam.target, {
      files: new Map([['intent.json', 'NOT JSON {']]),
      transport: createLoopbackClientTransport(),
    });
    const run = await runV02(
      [
        'submit',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--file',
        'intent.json',
      ],
      ports,
    );
    expect(run.exitCode).toBe(1);
    expect(JSON.stringify(run.json)).toContain('not valid JSON');
  });

  it('a bare seam without the K route refuses the send with its typed validator code', async () => {
    const seam: RunningSeam = await startSeam();
    const intent = JSON.stringify({
      requestId: 'req-x',
      lineageId: 'lineage-x',
      allowedOperation: 'media.acquire',
    });
    const ports = adapterPorts(seam.target, {
      files: new Map([['intent.json', intent]]),
      transport: createLoopbackClientTransport(),
    });
    const run = await runV02(
      [
        'submit',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--file',
        'intent.json',
      ],
      ports,
    );
    expect(run.exitCode).toBe(2); // REJECTED
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.domain-app.error');
    expect(json['code']).toBe('V02_INTENT_VALIDATOR_UNAVAILABLE');
    expect(json['coded']).toBe(true);
  });

  it('status on a bare seam refuses with the typed projection code; wait surfaces it without polling', async () => {
    const seam: RunningSeam = await startSeam();
    const ports = adapterPorts(seam.target, { transport: createLoopbackClientTransport() });
    const status = await runV02(
      [
        'status',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-none',
      ],
      ports,
    );
    expect(status.exitCode).toBe(2);
    expect((status.json as Record<string, unknown>)['code']).toBe('JOB_PROJECTION_UNAVAILABLE');
    const wait = await runV02(
      [
        'wait',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-none',
        '--timeout-ms',
        '1000',
        '--poll-ms',
        '50',
      ],
      ports,
    );
    expect(wait.exitCode).toBe(2);
    expect((wait.json as Record<string, unknown>)['code']).toBe('JOB_PROJECTION_UNAVAILABLE');
  });

  it('cancel rides the v0.2 send route and surfaces the Core-owned admission verdict', async () => {
    const seam: RunningSeam = await startSeam();
    const ports = adapterPorts(seam.target, { transport: createLoopbackClientTransport() });
    const run = await runV02(
      [
        'cancel',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-none',
        '--reason',
        'operator stop',
      ],
      ports,
    );
    expect(run.exitCode).toBe(2);
    expect((run.json as Record<string, unknown>)['document']).toBe(
      'xdownload.cli.domain-app.error',
    );
  });

  it('permission denial is projected verbatim (never masked)', async () => {
    const desktopOnly = {
      installId: EXPECTED_PEER.installId,
      userId: EXPECTED_PEER.userId,
      allowedSurfaces: ['DESKTOP_UI' as const],
    };
    const seam: RunningSeam = await startSeam(desktopOnly);
    const ports = adapterPorts(seam.target, { transport: createLoopbackClientTransport() });
    const run = await runV02(
      [
        'status',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--lineage',
        'lineage-none',
      ],
      ports,
    );
    expect(run.exitCode).toBe(2);
    const json = run.json as Record<string, unknown>;
    expect(json['code']).toBe('PEER_UNAUTHORIZED');
    expect(String(json['message'])).toContain("'CLI'");
  });

  it('batch projects per-line results and never merges truth', async () => {
    const seam: RunningSeam = await startSeam();
    const good = JSON.stringify({
      requestId: 'req-b1',
      lineageId: 'lineage-b1',
      allowedOperation: 'media.acquire',
    });
    const ports = adapterPorts(seam.target, {
      files: new Map([['batch.jsonl', `${good}\n{NOT JSON}\n`]]),
      transport: createLoopbackClientTransport(),
    });
    const run = await runV02(
      [
        'batch',
        ...BARE_FLAGS,
        '--port',
        String(seam.target.port),
        '--route',
        'v0.2',
        '--file',
        'batch.jsonl',
      ],
      ports,
    );
    expect(run.exitCode).toBe(1); // worst severity: one input error
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.domain-app.batch');
    expect(json['item_count']).toBe(2);
    const items = json['items'] as Record<string, unknown>[];
    expect(items.length).toBe(2);
    expect(items[0]?.['outcome']).toBe('PROJECTED');
    expect(items[1]?.['outcome']).toBe('INPUT_ERROR');
  });

  it('stdin payloads behave exactly like file payloads (redirected output stays parseable)', async () => {
    const seam: RunningSeam = await startSeam();
    const ports = adapterPorts(seam.target, {
      stdinText: JSON.stringify({
        requestId: 'req-s1',
        lineageId: 'lineage-s1',
        allowedOperation: 'media.acquire',
      }),
      transport: createLoopbackClientTransport(),
    });
    const run = await runV02(
      ['submit', ...BARE_FLAGS, '--port', String(seam.target.port), '--route', 'v0.2', '--stdin'],
      ports,
    );
    expect(run.exitCode).toBe(2);
    expect((run.json as Record<string, unknown>)['document']).toBe(
      'xdownload.cli.domain-app.error',
    );
  });
});
