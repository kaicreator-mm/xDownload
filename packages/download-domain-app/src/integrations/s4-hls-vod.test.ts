import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  acquireS4HlsBridgePin,
  assembleS4HlsRuntime,
  S4_HLS_BRIDGE_PIN,
  submitConfirmedS4HlsVod,
  type S4HlsPinCounters,
  type S4HlsRuntime,
} from './s4-hls-vod.ts';
import {
  S4_HLS_MEDIA_OPERATION,
  S4_HLS_MEDIA_PROFILE,
  s4HlsSelectionTupleDigest,
  validateConfirmedS4HlsIntent,
} from './s4-hls-vod-contract.ts';

interface IntentOptions {
  readonly manifestUri?: string;
  readonly renditionUri?: string;
  readonly targetRef?: string;
  readonly digestAnchor?: string;
}

function confirmedIntent(
  outputRootScope: string,
  options: IntentOptions = {},
): Record<string, unknown> {
  const now = Date.now();
  const tuple = {
    contractId: 'contract-s4-001',
    snapshotId: 'snapshot-s4-001',
    memberId: 'member-s4-001',
    previewId: 'preview-s4-001',
    renditionKey: 'rend-0',
    renditionUri: options.renditionUri ?? 'https://cdn.example.test/vod/720p.m3u8',
    manifestUri: options.manifestUri ?? 'https://cdn.example.test/vod/master.m3u8',
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: 1_500_000,
    width: 1280,
    height: 720,
  };
  return {
    requestId: 'req-s4-001',
    lineageId: 'lineage-s4-001',
    contractId: tuple.contractId,
    targetRef: options.targetRef ?? 'ref:s4-target-missing',
    outputRootScope,
    allowedOperation: S4_HLS_MEDIA_OPERATION,
    selection: {
      confirmedSelectionId: 'confirmed-s4-001',
      previewId: tuple.previewId,
      snapshotId: tuple.snapshotId,
      memberId: tuple.memberId,
      manifestUri: tuple.manifestUri,
      mediaProfileId: tuple.mediaProfileId,
      renditionKey: tuple.renditionKey,
      renditionUri: tuple.renditionUri,
      displayedTupleDigest: s4HlsSelectionTupleDigest(tuple),
      confirmedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 59_000).toISOString(),
    },
    caller: { actor: 't06-test', sessionRef: 'session-s4-001' },
    ...(options.digestAnchor === undefined ? {} : { digestAnchor: options.digestAnchor }),
  };
}

function budgetFixture(): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      // The engine's conservative pre-HTTP gate admits a segment only when the
      // fetcher's worst-case bound still fits the remaining budget, so the
      // transfer budget must exceed segmentMaxBytes (2 MiB) plus the playlist
      // fetches — 8 MiB leaves room for every fixture segment.
      maxBytes: 8_000_000,
      maxSegments: 8,
      maxRetryTransferRequests: 4,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1_000 },
  };
}

function masterPlaylist(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
    'media.m3u8',
    '',
  ].join('\n');
}

async function createRealHlsFixture(root: string): Promise<{
  readonly fixtureDir: string;
  readonly mediaPlaylist: string;
  readonly segmentNames: readonly string[];
  readonly segments: readonly Buffer[];
}> {
  const fixtureDir = join(root, 'fixture');
  await mkdir(fixtureDir, { recursive: true });
  const mediaPath = join(fixtureDir, 'media.m3u8');
  const segmentPattern = join(fixtureDir, 'segment%03d.ts');
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
      segmentPattern,
      mediaPath,
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  assert.equal(
    generated.error,
    undefined,
    `ffmpeg must be available for the real S4 fixture: ${generated.error?.message ?? ''}`,
  );
  assert.equal(generated.status, 0, `ffmpeg fixture generation failed: ${generated.stderr}`);
  const mediaPlaylist = await readFile(mediaPath, 'utf8');
  const segmentNames = mediaPlaylist
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  assert.ok(
    segmentNames.length >= 2,
    'real S4 fixture must contain at least two independently probed TS segments',
  );
  assert.ok(
    segmentNames.every((name) => basename(name) === name),
    'fixture playlist segment names must be basenames',
  );
  const segments = await Promise.all(segmentNames.map((name) => readFile(join(fixtureDir, name))));
  return { fixtureDir, mediaPlaylist, segmentNames, segments };
}

async function runS4RefusalScenario(input: {
  readonly master: string;
  readonly media: string;
  readonly expectedCode: string;
  readonly expectedPlaylistRequests: number;
}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-refusal-'));
  let runtime: Awaited<ReturnType<typeof assembleS4HlsRuntime>> | undefined;
  let server: Server | undefined;
  try {
    const outputRoot = resolve(join(root, 'output'));
    await mkdir(outputRoot, { recursive: true });
    const hits = new Map<string, number>();
    const serverInstance = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
      const body =
        pathname === '/master.m3u8'
          ? input.master
          : pathname === '/media.m3u8'
            ? input.media
            : undefined;
      if (body !== undefined) {
        response.writeHead(200, {
          'content-type': 'application/vnd.apple.mpegurl',
          'content-length': String(Buffer.byteLength(body)),
        });
        response.end(body);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server = serverInstance;
    await new Promise<void>((resolveListen, rejectListen) => {
      serverInstance.once('error', rejectListen);
      serverInstance.listen(0, '127.0.0.1', resolveListen);
    });
    const address = serverInstance.address();
    if (address === null || typeof address === 'string') {
      throw new Error('S4 refusal fixture server did not bind a TCP port');
    }
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const manifestUri = origin + '/master.m3u8';
    const renditionUri = origin + '/media.m3u8';
    const targetRef = 'ref:s4-target-negative';
    runtime = await assembleS4HlsRuntime({
      storePath: join(root, 'k-documents.json'),
      mediaTargetRefs: [
        {
          handle: targetRef,
          record: {
            protocol: 'HLS',
            manifestUri,
            selectedRenditionUri: renditionUri,
            artifactFileName: 's4-refusal.ts',
            allowedManifestOrigins: [origin],
            allowedSegmentOrigins: [origin],
            budget: budgetFixture(),
            fixtureLoopbackHttp: true,
          },
        },
      ],
    });
    const intent = confirmedIntent(outputRoot, { manifestUri, renditionUri, targetRef });
    const selection = intent.selection as Record<string, unknown>;
    selection.displayedTupleDigest = s4HlsSelectionTupleDigest({
      contractId: 'contract-s4-001',
      snapshotId: 'snapshot-s4-001',
      memberId: 'member-s4-001',
      previewId: 'preview-s4-001',
      renditionKey: 'rend-0',
      renditionUri,
      manifestUri,
      mediaProfileId: S4_HLS_MEDIA_PROFILE,
      bandwidth: 500_000,
      width: 160,
      height: 90,
    });

    const result = await submitConfirmedS4HlsVod(runtime, intent);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') throw new Error('expected a typed S4 topology refusal');
    assert.equal(result.code, input.expectedCode);
    assert.equal(runtime.pin.acquireCalls, 1);
    assert.equal(runtime.pin.completedExecutions, 0);
    assert.equal(runtime.pin.failedExecutions, 1);
    assert.equal(hits.get('/master.m3u8'), 1);
    assert.equal(hits.get('/media.m3u8') ?? 0, input.expectedPlaylistRequests);
    assert.equal(hits.get('/segment000.ts') ?? 0, 0);
    assert.equal(hits.get('/key.bin') ?? 0, 0);
    assert.deepEqual(await readdir(outputRoot), []);
  } finally {
    runtime?.stop();
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => {
        server!.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
    await rm(root, { recursive: true, force: true });
  }
}

describe('T06 S4 HLS VOD confirmation and K/Host admission', () => {
  it('accepts only the closed explicit rendition-selection contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-contract-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });

      const valid = validateConfirmedS4HlsIntent(confirmedIntent(outputRoot));
      assert.equal(valid.ok, true);

      const widened = validateConfirmedS4HlsIntent({
        ...confirmedIntent(outputRoot),
        rawUrl: 'https://cdn.example.test/vod/master.m3u8',
      });
      assert.equal(widened.ok, false);
      if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects future-dated and expired confirmation windows before K send', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-expiry-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      const future = confirmedIntent(outputRoot);
      const futureSelection = future.selection as Record<string, unknown>;
      futureSelection.confirmedAt = new Date(Date.now() + 1_000).toISOString();
      futureSelection.expiresAt = new Date(Date.now() + 30_000).toISOString();
      assert.equal(validateConfirmedS4HlsIntent(future).ok, false);

      const expired = confirmedIntent(outputRoot);
      const expiredSelection = expired.selection as Record<string, unknown>;
      expiredSelection.confirmedAt = new Date(Date.now() - 61_000).toISOString();
      expiredSelection.expiresAt = new Date(Date.now() - 1_000).toISOString();
      assert.equal(validateConfirmedS4HlsIntent(expired).ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses unknown S4 targets before media effects through K/Host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-runtime-'));
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });

      const runtime = await assembleS4HlsRuntime({
        storePath: join(root, 'k-documents.json'),
        mediaTargetRefs: [],
      });
      try {
        const result = await submitConfirmedS4HlsVod(runtime, confirmedIntent(outputRoot));
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed') throw new Error('expected unknown target refusal');
        assert.equal(result.code, 'CONTRACT_BINDING_MISMATCH');
        assert.equal(runtime.pin.acquireCalls, 1);
        assert.equal(runtime.pin.registryRefusals, 1);
        assert.equal(runtime.pin.completedExecutions, 0);
        assert.deepEqual(await readdir(outputRoot), []);
      } finally {
        runtime.stop();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an unclosed live playlist before requesting any segment', async () => {
    await runS4RefusalScenario({
      master: masterPlaylist(),
      media: [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:2.000000,',
        'segment000.ts',
        '',
      ].join('\n'),
      expectedCode: 'MEDIA_TOPOLOGY_UNSUPPORTED',
      expectedPlaylistRequests: 1,
    });
  });

  it('refuses AES-128 protected media without requesting keys or segments', async () => {
    await runS4RefusalScenario({
      master: masterPlaylist(),
      media: [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        '#EXTINF:2.000000,',
        'segment000.ts',
        '#EXTINF:2.000000,',
        'segment001.ts',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
      expectedCode: 'MEDIA_TOPOLOGY_UNSUPPORTED',
      expectedPlaylistRequests: 1,
    });
  });

  it('refuses duplicate variants before fetching a media playlist', async () => {
    const ambiguousMaster = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
      'media.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=600000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=160x90',
      'media.m3u8',
      '',
    ].join('\n');
    await runS4RefusalScenario({
      master: ambiguousMaster,
      media: '',
      expectedCode: 'MEDIA_MANIFEST_MALFORMED',
      expectedPlaylistRequests: 0,
    });
  });

  it('materializes real HLS VOD through K/Host with FFmpeg integrity checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-positive-'));
    let runtime: Awaited<ReturnType<typeof assembleS4HlsRuntime>> | undefined;
    let server: Server | undefined;
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      const fixture = await createRealHlsFixture(root);
      const expectedBytes = Buffer.concat([...fixture.segments]);
      const digestAnchor = createHash('sha256').update(expectedBytes).digest('hex');

      const hits = new Map<string, number>();
      const serverInstance = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
        if (pathname === '/master.m3u8') {
          const body = masterPlaylist();
          response.writeHead(200, {
            'content-type': 'application/vnd.apple.mpegurl',
            'content-length': String(Buffer.byteLength(body)),
          });
          response.end(body);
          return;
        }
        if (pathname === '/media.m3u8') {
          response.writeHead(200, {
            'content-type': 'application/vnd.apple.mpegurl',
            'content-length': String(Buffer.byteLength(fixture.mediaPlaylist)),
          });
          response.end(fixture.mediaPlaylist);
          return;
        }
        const name = pathname.slice(1);
        if (fixture.segmentNames.includes(name)) {
          void readFile(join(fixture.fixtureDir, name))
            .then((bytes) => {
              response.writeHead(200, {
                'content-type': 'video/mp2t',
                'content-length': String(bytes.length),
              });
              response.end(bytes);
            })
            .catch(() => {
              response.writeHead(404);
              response.end();
            });
          return;
        }
        response.writeHead(404);
        response.end();
      });
      server = serverInstance;
      await new Promise<void>((resolveListen, rejectListen) => {
        serverInstance.once('error', rejectListen);
        serverInstance.listen(0, '127.0.0.1', resolveListen);
      });
      const address = serverInstance.address();
      if (address === null || typeof address === 'string') {
        throw new Error('S4 fixture server did not bind a TCP port');
      }
      const origin = `http://127.0.0.1:${String(address.port)}`;
      const manifestUri = origin + '/master.m3u8';
      const renditionUri = origin + '/media.m3u8';
      const targetRef = 'ref:s4-target-001';

      runtime = await assembleS4HlsRuntime({
        storePath: join(root, 'k-documents.json'),
        mediaTargetRefs: [
          {
            handle: targetRef,
            record: {
              protocol: 'HLS',
              manifestUri,
              selectedRenditionUri: renditionUri,
              artifactFileName: 's4-positive.ts',
              allowedManifestOrigins: [origin],
              allowedSegmentOrigins: [origin],
              budget: budgetFixture(),
              fixtureLoopbackHttp: true,
              manifestMaxBytes: 65_536,
              segmentMaxBytes: 2_000_000,
              timeoutMs: 10_000,
            },
          },
        ],
      });

      const intent = confirmedIntent(outputRoot, {
        manifestUri,
        renditionUri,
        targetRef,
        digestAnchor,
      });
      const tuple = {
        contractId: 'contract-s4-001',
        snapshotId: 'snapshot-s4-001',
        memberId: 'member-s4-001',
        previewId: 'preview-s4-001',
        renditionKey: 'rend-0',
        renditionUri,
        manifestUri,
        mediaProfileId: S4_HLS_MEDIA_PROFILE,
        bandwidth: 500_000,
        width: 160,
        height: 90,
      };
      const selection = intent.selection as Record<string, unknown>;
      selection.displayedTupleDigest = s4HlsSelectionTupleDigest(tuple);

      const result = await submitConfirmedS4HlsVod(runtime, intent);
      assert.equal(
        result.status,
        'completed',
        result.message ?? result.code ?? 'S4 journey did not complete',
      );
      if (result.status !== 'completed') throw new Error('expected completed S4 journey');
      assert.ok(result.evidence);
      assert.equal(result.evidence.fileSha256, digestAnchor);
      assert.equal(result.evidence.bytesWritten, expectedBytes.length);
      assert.ok(result.evidence.artifactPath.startsWith(outputRoot));
      assert.deepEqual(await readFile(result.evidence.artifactPath), expectedBytes);
      assert.equal(result.summary?.segmentsTransferred, fixture.segmentNames.length);
      assert.equal(runtime.pin.acquireCalls, 1);
      assert.equal(runtime.pin.completedExecutions, 1);
      assert.equal(runtime.pin.registryRefusals, 0);
      assert.equal(hits.get('/master.m3u8'), 1);
      assert.equal(hits.get('/media.m3u8'), 1);
      for (const name of fixture.segmentNames) assert.equal(hits.get('/' + name), 1);
      assert.equal(hits.size, fixture.segmentNames.length + 2);
    } finally {
      runtime?.stop();
      if (server !== undefined) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose, rejectClose) => {
          server!.close((error) => (error ? rejectClose(error) : resolveClose()));
        });
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a duplicate bridge registration without displacing the live holder', () => {
    const first = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error('expected first registration to succeed');

    const second = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => {
        throw new Error('never routed');
      },
    });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error('expected duplicate registration refusal');
    assert.equal(second.code, 'S4_BRIDGE_PIN_CONFLICT');

    // The live holder keeps its authority: the conflicting registration routed nothing.
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], first.lease.bridge);
    first.lease.release();
    first.lease.release();
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], undefined);

    const reacquired = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(reacquired.ok, true);
    if (reacquired.ok) reacquired.lease.release();
  });

  it('refuses a second standalone assembly beside a live runtime instead of displacing its bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-conflict-'));
    let first: Awaited<ReturnType<typeof assembleS4HlsRuntime>> | undefined;
    try {
      const outputRoot = resolve(join(root, 'output'));
      await mkdir(outputRoot, { recursive: true });
      first = await assembleS4HlsRuntime({
        storePath: join(root, 'k-first.json'),
        mediaTargetRefs: [],
      });

      await assert.rejects(
        assembleS4HlsRuntime({ storePath: join(root, 'k-second.json'), mediaTargetRefs: [] }),
        /S4_BRIDGE_PIN_CONFLICT/,
      );

      // Zero wrong-registry effects from the refused assembly: the live runtime
      // still owns the pin and answers with its own registry refusal.
      const result = await submitConfirmedS4HlsVod(first, confirmedIntent(outputRoot));
      assert.equal(result.status, 'failed');
      if (result.status !== 'failed') throw new Error('expected unknown target refusal');
      assert.equal(result.code, 'CONTRACT_BINDING_MISMATCH');
      assert.equal(first.pin.acquireCalls, 1);
      assert.equal(first.pin.registryRefusals, 1);
      assert.deepEqual(await readdir(outputRoot), []);
    } finally {
      first?.stop();
      await rm(root, { recursive: true, force: true });
    }

    // After the live runtime is stopped, a new assembly may hold the pin again.
    const secondRoot = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-reacquire-'));
    try {
      const second = await assembleS4HlsRuntime({
        storePath: join(secondRoot, 'k-second.json'),
        mediaTargetRefs: [],
      });
      second.stop();
    } finally {
      await rm(secondRoot, { recursive: true, force: true });
    }
  });

  it('composes the S4 contribution into one externally-built single-K app', async () => {
    const { buildV10App } = await import('@kaicreator/domain-harness-build');
    const { load } = await import('@kaicreator/domain-harness-microkernel');
    const {
      s4HlsCompositionContribution,
      S4_HLS_BRIDGE_PIN,
      submitConfirmedS4HlsVod: submit,
    } = await import('./s4-hls-vod.ts');
    const { buildDownloadDomainApp, verifySealedModules } =
      await import('../business/composition.ts');
    const { FileCasDocStore } = await import('../composition/runtime.ts');
    const { s4HlsSealedPassthrough } = await import('./s4-hls-vod.ts');

    const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-single-k-'));
    const contribution = s4HlsCompositionContribution();
    const core = buildDownloadDomainApp().built;
    const modules = core.modules.map((module) => {
      if (module.role === 'business') return contribution.business;
      if (module.role === 'capability') return contribution.capability;
      return s4HlsSealedPassthrough(module);
    });
    const built = buildV10App({
      appId: 'app:xdownload-v021-single-k-t06-contribution',
      audience: core.audience,
      targetProfile: core.targetProfile,
      modules,
      routes: [contribution.route],
      hardBudget: core.hardBudget,
      buildId: 'xdownload-v021-single-k-t06-contribution-v1',
    });
    verifySealedModules(built);

    const store = new FileCasDocStore(join(root, 'single-k-documents.json'));
    const pinCounters = { acquireCalls: 0, registryRefusals: 0 };
    const registration = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => {
        pinCounters.acquireCalls += 1;
        pinCounters.registryRefusals += 1;
        return {
          phase: 'terminal',
          externalRef: 'media.acquire:unpermitted',
          outcome: {
            ok: false,
            error: { code: 'MEDIA_TARGET_UNKNOWN', message: 'opaque targetRef did not resolve' },
          },
        };
      },
    });
    assert.equal(registration.ok, true);
    if (!registration.ok) throw new Error('expected contribution bridge registration');
    try {
      const app = await load(built, {
        store,
        tenantId: 'tenant:xdownload-v021-s4',
        deploymentIdentity: {
          deployedAppId: 'deploy:xdownload-v021-single-k',
          tenantId: 'tenant:xdownload-v021-s4',
          appId: built.appId,
        },
        queryAuthority: {
          principal: { actor: 'xdownload-v021-s4-host' },
          authorize: (candidate, target) =>
            Boolean(
              candidate !== null &&
              typeof candidate === 'object' &&
              (candidate as { actor?: string }).actor === 'xdownload-v021-s4-host' &&
              target.tenantId === 'tenant:xdownload-v021-s4',
            ),
        },
      });
      try {
        assert.equal(typeof (globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], 'object');
        const runtime = {
          app,
          pin: pinCounters as unknown as S4HlsPinCounters,
        } as unknown as S4HlsRuntime;
        const result = await submit(runtime, confirmedIntent(join(root, 'output')));
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed')
          throw new Error('expected typed registry refusal through one K');
        assert.equal(result.code, 'MEDIA_TARGET_UNKNOWN');
        assert.equal(pinCounters.acquireCalls, 1);
      } finally {
        app.stop();
      }
    } finally {
      if (registration.ok) registration.lease.release();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
