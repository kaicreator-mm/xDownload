/**
 * T02 Single-Core Domain App integration — the acceptance suite over the ONE
 * Core-owned K route:
 *
 * 1. exact old-lineage regression (legacy compositions byte-identical with
 *    and without the domainApp option);
 * 2. new v0.2 K lineage positive path (seam v0.2 route → durable claim →
 *    one K send → truthful job projection; full acquisition gated on
 *    ffmpeg exactly like the upstream real regression);
 * 3. owner-conflict refusal BEFORE any network/file effect (both directions,
 *    plus duplicate-send convergence);
 * 4. restart/reopen preserves the owner (durable route facts; a crash
 *    mid-send reads back UNKNOWN, never fabricated);
 * 5. no per-surface K instantiation (one K per process: a second composition
 *    is refused by the bridge-pin conflict gate; every surface reaches the
 *    same instance);
 * 6. SDK source/tarball identities stay byte-bound to the qualified baseline
 *    (vendored tarballs re-hashed against SHA256SUMS.txt; sealed K/S module
 *    SHAs equal the #183 PoC manifest).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { currentSeamSchemaIdentity } from '@xdownload/core-seam';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  peer,
  rawSingleResourceContract,
  removeTempDir,
  requestIdOf,
  runtimeOptions,
  seamCommand,
  seamQuery,
} from './helpers.ts';
import {
  CoreDomainAppRouteError,
  createCoreRuntime,
  DurableStoreCorruptError,
  FileBackedDomainAppRouteLog,
  reopenCoreRuntime,
  type CoreRuntime,
} from '../src/index.ts';
import { sealS4HlsComposition } from '../../download-domain-app/src/integrations/s4-hls-vod.ts';
import {
  S4_HLS_MEDIA_PROFILE,
  s4HlsSelectionTupleDigest,
} from '../../download-domain-app/src/integrations/s4-hls-vod-contract.ts';
import {
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
} from '../../download-domain-app/src/business/composition.ts';

const dirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

function tempRoot(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

// ------------------------------------------------------------- v0.2 frames

function v02CommandFrame(input: {
  readonly requestId: string;
  readonly lineageId: string;
  readonly intent: unknown;
}): string {
  return JSON.stringify({
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: peer(),
    requestId: input.requestId,
    aggregateId: input.lineageId,
    issuedAt: '2026-10-04T01:00:00Z',
    payload: { intent: input.intent },
  });
}

function v02JobQueryFrame(input: {
  readonly requestId: string;
  readonly lineageId: string;
}): string {
  return JSON.stringify({
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    route: 'v0.2',
    queryType: 'READ_JOB_PROJECTION',
    peer: peer(),
    requestId: input.requestId,
    aggregateId: input.lineageId,
    issuedAt: '2026-10-04T01:00:00Z',
  });
}

interface JobProjectionView {
  readonly lineageId: string;
  readonly owner: 'old-core' | 'new-k';
  readonly status: string;
  readonly attempts?: readonly { readonly attemptId: string; readonly status: string }[];
  readonly progress?: { readonly transferredBytes: number };
  readonly error?: { readonly code: string };
}

type JobQueryResponse = ReturnType<CoreRuntime['seam']['handleFrame']> & {
  readonly projection?: JobProjectionView;
};

function readJobProjection(runtime: CoreRuntime, lineageId: string): JobQueryResponse {
  return runtime.seam.handleFrame(
    v02JobQueryFrame({ requestId: `req-job-${lineageId}`, lineageId }),
  ) as JobQueryResponse;
}

/** Poll the v0.2 job projection until the status leaves the running set. */
async function waitForJobStatus(
  runtime: CoreRuntime,
  lineageId: string,
  wanted: readonly string[],
  timeoutMs = 20_000,
): Promise<JobProjectionView> {
  const deadline = Date.now() + timeoutMs;
  let last: JobProjectionView | undefined;
  while (Date.now() < deadline) {
    const response = readJobProjection(runtime, lineageId);
    if (response.outcome === 'PROJECTION' && response.projection !== undefined) {
      last = response.projection;
      if (wanted.includes(response.projection.status)) {
        return response.projection;
      }
    }
    await new Promise((resolvePause) => setTimeout(resolvePause, 25));
  }
  throw new Error(
    `job projection for '${lineageId}' did not reach ${wanted.join('/')} in time; last=${JSON.stringify(last)}`,
  );
}

// --------------------------------------------------------- S4 loopback fixture

function budgetFixture(): Record<string, unknown> {
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

function ffmpegAvailable(): boolean {
  const probe = spawnSync('ffmpeg', ['-version'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  return probe.status === 0;
}

const HAS_FFMPEG = ffmpegAvailable();

interface HlsFixture {
  readonly origin: string;
  readonly manifestUri: string;
  readonly renditionUri: string;
  readonly segmentNames: readonly string[];
  readonly expectedBytes: Buffer;
  readonly mediaPlaylist: string;
}

async function startHlsFixture(): Promise<HlsFixture> {
  const root = tempRoot('t02-s4-fixture-ffmpeg');
  const fixtureDir = join(root, 'fixture');
  mkdirSync(fixtureDir, { recursive: true });
  const mediaPath = join(fixtureDir, 'media.m3u8');
  const generated = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x90:rate=25:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:sample_rate=48000:duration=4',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'baseline',
      '-level',
      '3.0',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '50',
      '-keyint_min',
      '50',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-force_key_frames',
      'expr:gte(t,n_forced*2)',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(fixtureDir, 'segment%03d.ts'),
      mediaPath,
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  if (generated.status !== 0) {
    throw new Error(`ffmpeg fixture generation failed: ${generated.stderr}`);
  }
  const mediaPlaylist = readFileSync(mediaPath, 'utf8');
  const segmentNames = mediaPlaylist
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => basename(line.trim()));
  const segments = segmentNames.map((name) => readFileSync(join(fixtureDir, name)));
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
    'media.m3u8',
    '',
  ].join('\n');
  const serverInstance = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const body =
      pathname === '/master.m3u8' ? master : pathname === '/media.m3u8' ? mediaPlaylist : undefined;
    if (body !== undefined) {
      response.writeHead(200, {
        'content-type': 'application/vnd.apple.mpegurl',
        'content-length': String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    const name = pathname.slice(1);
    const segment = segmentNames.indexOf(name);
    if (segment >= 0) {
      response.writeHead(200, {
        'content-type': 'video/mp2t',
        'content-length': String(segments[segment]?.length ?? 0),
      });
      response.end(segments[segment]);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(serverInstance);
  await new Promise<void>((resolveListen, rejectListen) => {
    serverInstance.once('error', rejectListen);
    serverInstance.listen(0, '127.0.0.1', resolveListen);
  });
  const address = serverInstance.address();
  if (address === null || typeof address === 'string') {
    throw new Error('S4 fixture server did not bind a TCP port');
  }
  const origin = `http://127.0.0.1:${String(address.port)}`;
  return {
    origin,
    manifestUri: `${origin}/master.m3u8`,
    renditionUri: `${origin}/media.m3u8`,
    segmentNames,
    expectedBytes: Buffer.concat(segments),
    mediaPlaylist,
  };
}

interface ConfirmedIntentOverrides {
  readonly manifestUri?: string;
  readonly renditionUri?: string;
  readonly targetRef?: string;
  readonly digestAnchor?: string;
  readonly requestId?: string;
  readonly lineageId?: string;
}

function confirmedS4Intent(
  outputRootScope: string,
  fixture: Pick<HlsFixture, 'manifestUri' | 'renditionUri'>,
  tupleFacts: { readonly bandwidth: number; readonly width: number; readonly height: number } = {
    bandwidth: 500_000,
    width: 160,
    height: 90,
  },
  overrides: ConfirmedIntentOverrides = {},
): Record<string, unknown> {
  const now = Date.now();
  const requestId = overrides.requestId ?? 'req-s4-route-001';
  const lineageId = overrides.lineageId ?? 'lineage-s4-route-001';
  const tuple = {
    contractId: 'contract-s4-route-001',
    snapshotId: 'snapshot-s4-route-001',
    memberId: 'member-s4-route-001',
    previewId: 'preview-s4-route-001',
    renditionKey: 'rend-0',
    renditionUri: overrides.renditionUri ?? fixture.renditionUri,
    manifestUri: overrides.manifestUri ?? fixture.manifestUri,
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: tupleFacts.bandwidth,
    width: tupleFacts.width,
    height: tupleFacts.height,
  };
  return {
    requestId,
    lineageId,
    contractId: tuple.contractId,
    targetRef: overrides.targetRef ?? 'ref:s4-route-target-001',
    outputRootScope,
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'confirmed-s4-route-001',
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
    caller: { actor: 't02-test', sessionRef: 'session-s4-route-001' },
    ...(overrides.digestAnchor === undefined ? {} : { digestAnchor: overrides.digestAnchor }),
  };
}

function composeWithDomainApp(rootDir: string, mediaTargetRefs: readonly unknown[]): CoreRuntime {
  return createCoreRuntime({
    ...runtimeOptions(rootDir),
    domainApp: {
      mediaTargetRefs: mediaTargetRefs as never,
    },
  });
}

// ------------------------------------------------------------------- suites

describe('T02 single-K Domain App route', () => {
  it('keeps legacy compositions byte-identical with and without the domainApp option', () => {
    const legacyRoot = tempRoot('t02-legacy-baseline-');
    const routedRoot = tempRoot('t02-legacy-routed-');

    const legacy = openRuntime(legacyRoot);
    try {
      expect(legacy.domainApp).toBeUndefined();
      const contractAccepted = seamCommand(legacy, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
        requestId: requestIdOf('t02-legacy-001'),
      });
      expect(contractAccepted.outcome).toBe('ACCEPTED');
      const legacyProjection = seamQuery(legacy, 'contract-single-001', 't02-legacy-query-001');

      const routed = composeWithDomainApp(routedRoot, []);
      try {
        expect(routed.domainApp).toBeDefined();
        const routedAccepted = seamCommand(routed, {
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          expectedRevision: 0,
          requestId: requestIdOf('t02-legacy-001'),
        });
        expect(routedAccepted.outcome).toBe('ACCEPTED');
        const routedProjection = seamQuery(routed, 'contract-single-001', 't02-legacy-query-001');

        // Same legacy command/query through both compositions: identical
        // acceptance and identical projection bytes.
        expect(routedAccepted.acceptance).toEqual(contractAccepted.acceptance);
        expect(JSON.stringify(routedProjection)).toBe(JSON.stringify(legacyProjection));
      } finally {
        closeRuntime(routed);
      }
    } finally {
      closeRuntime(legacy);
    }
  });

  it('routes a fresh v0.2 lineage into the one K and records the typed bridge refusal truthfully', async () => {
    const root = tempRoot('t02-route-refusal-');
    const runtime = composeWithDomainApp(root, []);
    try {
      await runtime.domainApp?.ready;
      expect(runtime.domainApp?.isLoaded()).toBe(true);

      // The intent is seam-valid but its targetRef is not seeded: the Host
      // bridge refuses typed BEFORE any network/file effect of the effect.
      const intent = confirmedS4Intent(resolve(join(root, 'output')), {
        manifestUri: 'http://127.0.0.1/master.m3u8',
        renditionUri: 'http://127.0.0.1/media.m3u8',
      });
      const response = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-route-001',
          lineageId: 'lineage-s4-route-001',
          intent,
        }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      expect(response.route).toBe('v0.2');
      expect(response.acceptance?.aggregateId).toBe('lineage-s4-route-001');

      const projection = await waitForJobStatus(runtime, 'lineage-s4-route-001', [
        'SUCCEEDED',
        'FAILED',
      ]);
      expect(projection.owner).toBe('new-k');
      expect(projection.status).toBe('FAILED');
      expect(projection.error?.code).toBe('CONTRACT_BINDING_MISMATCH');

      // The durable route truth: claim → attempt → outcome.
      const facts = runtime.domainApp?.routeFacts() ?? [];
      expect(facts.map((fact) => fact.kind)).toEqual(['CLAIM', 'ATTEMPT', 'OUTCOME']);
      expect(runtime.domainApp?.pin.acquireCalls).toBe(1);
      expect(runtime.domainApp?.pin.registryRefusals).toBe(1);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('completes the new-K positive path end-to-end (ffmpeg-gated real acquisition)', async () => {
    if (!HAS_FFMPEG) {
      return; // same gating as the upstream ffmpeg-ts real regression
    }
    const root = tempRoot('t02-route-positive-');
    const fixture = await startHlsFixture();
    const outputRoot = resolve(join(root, 'output'));
    const runtime = composeWithDomainApp(root, [
      {
        handle: 'ref:s4-route-target-001',
        record: {
          protocol: 'HLS',
          manifestUri: fixture.manifestUri,
          selectedRenditionUri: fixture.renditionUri,
          artifactFileName: 's4-route-positive.ts',
          allowedManifestOrigins: [fixture.origin],
          allowedSegmentOrigins: [fixture.origin],
          budget: budgetFixture(),
          fixtureLoopbackHttp: true,
          manifestMaxBytes: 65_536,
          segmentMaxBytes: 2_000_000,
          timeoutMs: 10_000,
        },
      },
    ]);
    try {
      await runtime.domainApp?.ready;
      const digestAnchor = createHash('sha256').update(fixture.expectedBytes).digest('hex');
      const intent = confirmedS4Intent(
        outputRoot,
        { manifestUri: fixture.manifestUri, renditionUri: fixture.renditionUri },
        { bandwidth: 500_000, width: 160, height: 90 },
        {
          digestAnchor,
          requestId: 'req-s4-route-pos',
          lineageId: 'lineage-s4-route-pos',
        },
      );
      const response = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-route-pos',
          lineageId: 'lineage-s4-route-pos',
          intent,
        }),
      );
      expect(response.outcome).toBe('ACCEPTED');

      const projection = await waitForJobStatus(runtime, 'lineage-s4-route-pos', [
        'SUCCEEDED',
        'FAILED',
      ]);
      expect(projection.owner).toBe('new-k');
      expect(projection.status).toBe('SUCCEEDED');
      expect(projection.progress?.transferredBytes).toBe(fixture.expectedBytes.length);
      expect(runtime.domainApp?.pin.completedExecutions).toBe(1);
      // The artifact materialized inside the authorized root.
      expect(existsSync(join(outputRoot, 's4-route-positive.ts'))).toBe(true);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('refuses a v0.2 send addressed to a legacy-owned lineage before ANY effect', async () => {
    const root = tempRoot('t02-conflict-legacy-owner-');
    const runtime = composeWithDomainApp(root, []);
    try {
      await runtime.domainApp?.ready;
      // The legacy Core partition owns contract-single-001 (durable aggregate).
      const accepted = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
        requestId: requestIdOf('t02-conflict-legacy-001'),
      });
      expect(accepted.outcome).toBe('ACCEPTED');
      const pinCallsBefore = runtime.domainApp?.pin.acquireCalls ?? 0;

      // The intent is seam-valid but its targetRef is not seeded, so the
      // admitted fresh lineage settles truthfully FAILED fast.
      const intent = confirmedS4Intent(
        resolve(join(root, 'output')),
        {
          manifestUri: 'http://127.0.0.1/master.m3u8',
          renditionUri: 'http://127.0.0.1/media.m3u8',
        },
        {
          bandwidth: 500_000,
          width: 160,
          height: 90,
        },
        {
          requestId: 'req-s4-conflict-001',
          lineageId: 'lineage-s4-conflict-001',
        },
      );
      // Fresh lineage: this one is ADMITTED (the claim point), proving the
      // conflict below is not a blanket refusal.
      const response = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-conflict-001',
          lineageId: 'lineage-s4-conflict-001',
          intent,
        }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      await waitForJobStatus(runtime, 'lineage-s4-conflict-001', ['FAILED', 'SUCCEEDED']);

      // The SAME intent shape but bound to the legacy-owned lineageId: the
      // route refuses it as an owner conflict before any effect.
      const conflicting = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-conflict-002',
          lineageId: 'contract-single-001',
          intent: {
            ...intent,
            requestId: 'req-s4-conflict-002',
            lineageId: 'contract-single-001',
          },
        }),
      );
      expect(conflicting.outcome).toBe('REJECTED');
      expect(conflicting.route).toBe('v0.2');
      expect(conflicting.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_CONFLICT');
      // BEFORE any effect: no durable route fact references the legacy-owned
      // lineage (no claim append), and no K send happened for it.
      const factsAfter = runtime.domainApp?.routeFacts() ?? [];
      expect(
        factsAfter.some((fact) => 'lineageId' in fact && fact.lineageId === 'contract-single-001'),
      ).toBe(false);
      expect((runtime.domainApp?.pin.acquireCalls ?? 0) - pinCallsBefore).toBe(1);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('refuses a legacy command addressed to a K-owned lineage before the old seam applies it', async () => {
    const root = tempRoot('t02-conflict-k-owner-');
    const runtime = composeWithDomainApp(root, []);
    try {
      await runtime.domainApp?.ready;
      const intent = confirmedS4Intent(
        resolve(join(root, 'output')),
        {
          manifestUri: 'http://127.0.0.1/master.m3u8',
          renditionUri: 'http://127.0.0.1/media.m3u8',
        },
        {
          bandwidth: 500_000,
          width: 160,
          height: 90,
        },
        {
          requestId: 'req-s4-kowner-001',
          lineageId: 'lineage-s4-kowner-001',
        },
      );
      const admitted = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-kowner-001',
          lineageId: 'lineage-s4-kowner-001',
          intent,
        }),
      );
      expect(admitted.outcome).toBe('ACCEPTED');
      await waitForJobStatus(runtime, 'lineage-s4-kowner-001', ['FAILED', 'SUCCEEDED']);

      // A legacy v1 command may never create authority over the K-owned id.
      const legacyCommand = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'lineage-s4-kowner-001',
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
        requestId: requestIdOf('t02-kowner-legacy-001'),
      });
      expect(legacyCommand.outcome).toBe('REJECTED');
      expect(legacyCommand.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_CONFLICT');
      // The old seam never saw the frame: no aggregate, no journal entry.
      expect(runtime.seam.inspectProjection('lineage-s4-kowner-001')).toBeUndefined();
      expect(runtime.seam.acceptedCommandCount).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('converges a duplicate v0.2 send of the same idempotent identity', async () => {
    const root = tempRoot('t02-duplicate-send-');
    const runtime = composeWithDomainApp(root, []);
    try {
      await runtime.domainApp?.ready;
      const intent = confirmedS4Intent(
        resolve(join(root, 'output')),
        {
          manifestUri: 'http://127.0.0.1/master.m3u8',
          renditionUri: 'http://127.0.0.1/media.m3u8',
        },
        {
          bandwidth: 500_000,
          width: 160,
          height: 90,
        },
        {
          requestId: 'req-s4-dup-001',
          lineageId: 'lineage-s4-dup-001',
        },
      );
      const first = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-dup-001',
          lineageId: 'lineage-s4-dup-001',
          intent,
        }),
      );
      expect(first.outcome).toBe('ACCEPTED');
      await waitForJobStatus(runtime, 'lineage-s4-dup-001', ['FAILED', 'SUCCEEDED']);
      const duplicate = runtime.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-dup-001',
          lineageId: 'lineage-s4-dup-001',
          intent,
        }),
      );
      expect(duplicate.outcome).toBe('ACCEPTED');
      expect(duplicate.acceptance?.converged).toBe(true);
      // Exactly one K occurrence for the duplicate identity.
      const attempts = (runtime.domainApp?.routeFacts() ?? []).filter(
        (fact) => fact.kind === 'ATTEMPT',
      );
      expect(attempts).toHaveLength(1);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('preserves the lineage owner across restart and reads a crash mid-send back as UNKNOWN', async () => {
    const root = tempRoot('t02-reopen-owner-');
    const firstRuntime = composeWithDomainApp(root, []);
    let lineageId: string;
    try {
      await firstRuntime.domainApp?.ready;
      lineageId = 'lineage-s4-reopen-001';
      const intent = confirmedS4Intent(
        resolve(join(root, 'output')),
        {
          manifestUri: 'http://127.0.0.1/master.m3u8',
          renditionUri: 'http://127.0.0.1/media.m3u8',
        },
        {
          bandwidth: 500_000,
          width: 160,
          height: 90,
        },
        {
          requestId: 'req-s4-reopen-001',
          lineageId,
        },
      );
      const admitted = firstRuntime.seam.handleFrame(
        v02CommandFrame({ requestId: 'req-s4-reopen-001', lineageId, intent }),
      );
      expect(admitted.outcome).toBe('ACCEPTED');
      await waitForJobStatus(firstRuntime, lineageId, ['FAILED', 'SUCCEEDED']);
    } finally {
      closeRuntime(firstRuntime);
    }

    // Reopen composes over the SAME durable root: the owner survives.
    const reopened = reopenCoreRuntime({
      ...runtimeOptions(root),
      domainApp: {},
    });
    try {
      await reopened.domainApp?.ready;
      const response = readJobProjection(reopened, lineageId) as {
        outcome: string;
        projection?: JobProjectionView;
      };
      expect(response.outcome).toBe('PROJECTION');
      expect(response.projection?.owner).toBe('new-k');
      expect(['SUCCEEDED', 'FAILED']).toContain(response.projection?.status);
      // The same ownership still fences the legacy side after reopen.
      const legacyCommand = seamCommand(reopened, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: lineageId,
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
        requestId: requestIdOf('t02-reopen-legacy-001'),
      });
      expect(legacyCommand.outcome).toBe('REJECTED');
      expect(legacyCommand.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_CONFLICT');

      // The v0.2 route keeps accepting fresh lineages after reopen (the K
      // document store reopened at the same path).
      const fresh = confirmedS4Intent(
        resolve(join(root, 'output')),
        {
          manifestUri: 'http://127.0.0.1/master.m3u8',
          renditionUri: 'http://127.0.0.1/media.m3u8',
        },
        { bandwidth: 500_000, width: 160, height: 90 },
        {
          lineageId: 'lineage-s4-reopen-002',
          requestId: 'req-s4-reopen-002',
        },
      );
      const admitted = reopened.seam.handleFrame(
        v02CommandFrame({
          requestId: 'req-s4-reopen-002',
          lineageId: 'lineage-s4-reopen-002',
          intent: fresh,
        }),
      );
      expect(admitted.outcome).toBe('ACCEPTED');
    } finally {
      closeRuntime(reopened);
    }
  });

  it('reads an attempt that was in flight at crash back as UNKNOWN, never fabricated', async () => {
    const root = tempRoot('t02-crash-inflight-');
    const logPath = join(root, 'domain-app-route.jsonl');
    // Simulate the crash-after-admission window honestly: CLAIM + ATTEMPT
    // were fsync'd, the OUTCOME never was.
    const log = FileBackedDomainAppRouteLog.createFresh(logPath);
    log.append({ kind: 'CLAIM', lineageId: 'lineage-s4-crash-001' });
    log.append({
      kind: 'ATTEMPT',
      lineageId: 'lineage-s4-crash-001',
      requestId: 'req-s4-crash-001',
      attemptId: 's4hls-req-s4-crash-001#1',
      sequence: 1,
    });
    const runtime = reopenCoreRuntime({
      ...runtimeOptions(root),
      domainApp: {},
    });
    try {
      await runtime.domainApp?.ready;
      const response = readJobProjection(runtime, 'lineage-s4-crash-001') as {
        projection?: JobProjectionView;
      };
      expect(response.projection?.owner).toBe('new-k');
      expect(response.projection?.status).toBe('UNKNOWN');
      expect(response.projection?.attempts?.[0]?.status).toBe('UNKNOWN');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('holds exactly ONE K per process: a second composition is refused, not displaced', async () => {
    const root = tempRoot('t02-single-k-');
    const first = composeWithDomainApp(root, []);
    try {
      await first.domainApp?.ready;
      expect(() => composeWithDomainApp(join(root, 'second'), [])).toThrow(CoreDomainAppRouteError);
      // The first K keeps its authority (the conflicting composition routed
      // nothing and released nothing).
      expect(first.domainApp?.isLoaded()).toBe(true);
    } finally {
      closeRuntime(first);
    }
    // After the first runtime closes, the pin is free again.
    const second = composeWithDomainApp(join(root, 'second'), []);
    try {
      await second.domainApp?.ready;
      expect(second.domainApp?.isLoaded()).toBe(true);
    } finally {
      closeRuntime(second);
    }
  });

  it('keeps the SDK source/tarball identities byte-bound to the qualified baseline', () => {
    // The vendored SDK tarballs must reproduce the qualified SHA256SUMS.
    const sdkDir = resolve(
      join(import.meta.dirname ?? '.', '..', '..', 'download-domain-app', 'vendor', 'sdk'),
    );
    const sums = readFileSync(join(sdkDir, 'SHA256SUMS.txt'), 'utf8');
    for (const line of sums.split('\n')) {
      const match = /^([0-9a-f]{64}) \*(.+)$/u.exec(line);
      if (match === null) continue;
      const expected = match[1];
      const rawPath = match[2];
      if (expected === undefined || rawPath === undefined) continue;
      const tarballPath = resolve(join(sdkDir, basename(rawPath)));
      const actual = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
      expect(actual).toBe(expected);
    }
    // The sealed K/S modules the single K loads reproduce the #183 PoC
    // manifest identity (sealS4HlsComposition self-checks the same pins).
    const built = sealS4HlsComposition();
    const kernel = built.modules.find((module) => module.role === 'kernel-primary');
    const standard = built.modules.find((module) => module.role === 'standard-primary');
    expect(kernel?.moduleSha256).toBe(POC183_KERNEL_MODULE_SHA256);
    expect(standard?.moduleSha256).toBe(POC183_STANDARD_MODULE_SHA256);
  });

  it('fails closed when the durable route fact log is corrupt on reopen', async () => {
    const root = tempRoot('t02-corrupt-route-log-');
    const logPath = join(root, 'domain-app-route.jsonl');
    writeFileSync(logPath, '{"kind":"CLAIM","lineageId":"x"}\nnot-json-at-all\n', 'utf8');
    expect(() => reopenCoreRuntime({ ...runtimeOptions(root), domainApp: {} })).toThrow(
      DurableStoreCorruptError,
    );
  });

  it('keeps the durable route fact log fail-closed and createFresh honest', () => {
    const root = tempRoot('t02-route-log-discipline-');
    const logPath = join(root, 'domain-app-route.jsonl');
    const log = FileBackedDomainAppRouteLog.createFresh(logPath);
    log.append({ kind: 'CLAIM', lineageId: 'lineage-a' });
    log.append({
      kind: 'ATTEMPT',
      lineageId: 'lineage-a',
      requestId: 'req-a',
      attemptId: 's4hls-req-a#1',
      sequence: 1,
    });
    log.append({
      kind: 'OUTCOME',
      lineageId: 'lineage-a',
      attemptId: 's4hls-req-a#1',
      status: 'FAILED',
      errorCode: 'MEDIA_TARGET_UNKNOWN',
      errorMessage: 'opaque targetRef did not resolve',
    });
    expect(log.isClaimed('lineage-a')).toBe(true);
    expect(log.isClaimed('lineage-b')).toBe(false);
    expect(log.claimedLineageIds()).toEqual(['lineage-a']);

    // Reopen reproduces the identical durable view.
    const reopened = FileBackedDomainAppRouteLog.openExisting(logPath);
    expect(reopened.all()).toEqual(log.all());
    expect(reopened.isClaimed('lineage-a')).toBe(true);

    // A fresh composition refuses to clobber committed route facts.
    expect(() => FileBackedDomainAppRouteLog.createFresh(logPath)).toThrow(
      DurableStoreCorruptError,
    );

    // Unknown kinds and unknown fields fail closed on reopen.
    writeFileSync(logPath, '{"kind":"SOMETHING_ELSE","lineageId":"x"}\n', 'utf8');
    expect(() => FileBackedDomainAppRouteLog.openExisting(logPath)).toThrow(
      DurableStoreCorruptError,
    );
    writeFileSync(logPath, '{"kind":"CLAIM","lineageId":"x","extra":1}\n', 'utf8');
    expect(() => FileBackedDomainAppRouteLog.openExisting(logPath)).toThrow(
      DurableStoreCorruptError,
    );
  });
});
