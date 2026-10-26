/**
 * #153 S4 selected-HLS Core flow — the REAL restart-reconcile path over the
 * mature-client HTTP lane: a durably admitted preview intent is re-driven by
 * `reopenCoreRuntime` (bounded master read through the authorized loopback
 * fixture port), the live wire journey (BEGIN/COMMIT/EXECUTE) runs through
 * the real seam authority with an OS-verified session registry, and the
 * execution re-drives through the real T009 engine with REAL FFmpeg media
 * assembly (skipIf ffmpeg/ffprobe are not installed — same gating as the
 * upstream ffmpeg-ts real regression).
 *
 * The seeded journal entries are exactly the decoded-envelope records
 * `handleCommand` writes (the in-memory seam suite proves the live wire for
 * the https grammar); seeding them simulates the crash-after-commit window
 * honestly — replay re-validates every authority gate on the way in.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeAcquisitionContract, type TerminalResult } from '@xdownload/domain-contracts';
import {
  createVerifiedPeerSessionRegistry,
  s4SelectionTupleDigest,
  type OsVerifiedPeerSession,
  type S4ConfirmedSelectionRecord,
  type S4PreviewRecord,
  type S4RenditionFact,
} from '@xdownload/core-seam';
import { reopenCoreRuntime } from '../src/runtime.ts';
import {
  driveS4Preview,
  type CoreRuntime,
  type S4DriveRuntime,
  type S4HlsHttpOptions,
} from '../src/index.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import {
  BUDGET_PROFILE,
  closeRuntime,
  EXPECTED_PEER,
  makeTempDir,
  removeTempDir,
  seamCommand,
} from './helpers.ts';

const ffmpegOk =
  spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { timeout: 5000 }).status === 0;

const CONNECTION = 'conn-s4-flow-001';

/** The loopback-fixture HTTP lane (test-only flag; production stays https). */
const S4_FIXTURE_HTTP: S4HlsHttpOptions = { allowLoopbackHttpFixture: true };

function verifiedSession(): OsVerifiedPeerSession {
  return {
    transportKind: 'WINDOWS_NAMED_PIPE',
    connectionId: CONNECTION,
    userSid: 'S-1-5-21-7',
    userName: 'DOMAIN\\user',
    clientPid: 7007,
    logonSessionId: '0x00000000000abcde',
    sameUserAsCore: true,
    sameLogonSessionAsCore: true,
    verifiedAt: '2026-10-26T00:00:00Z',
  };
}

/** CLI-parity transfer budget: the segment fetcher advertises a 16MB
 * worst-case per-segment bound, so the lineage budget must cover it. */
const S4_TEST_BUDGET = {
  ...BUDGET_PROFILE,
  transfer: {
    domain: 'transfer',
    maxBytes: 1_073_741_824,
    maxSegments: 5000,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
} as const;

function contractPayload(contractId: string): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: `target-${contractId}`,
    requestedScope: { kind: 'single_resource', targetId: `target-${contractId}` },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
    automationMode: 'MANUAL_SELECTION',
    explorationPermission: 'NONE',
    budgetProfile: S4_TEST_BUDGET,
    authorizationContextRef: 'authctx/s4-flow-test',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format', 'media'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-26T00:00:00Z',
  };
}

function snapshotPayloadOf(contractId: string, snapshotId: string, memberId: string): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId,
    contractId,
    requestedScope: { kind: 'single_resource', targetId: `target-${contractId}` },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:target-${contractId}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    selectedMemberIds: [memberId],
    authorizationContextRef: 'authctx/s4-flow-test',
    profileContextRef: 'profile/s4-flow-test-001',
    selectionClaims: [
      { kind: 'SINGLE', confirmationType: 'CONFIRM_RESOURCE_IDENTITY', memberRefs: [memberId] },
    ],
    sourceMarker: { system: 'xdownload-test', version: 'v0.1.0' },
    createdAt: '2026-10-26T00:00:00Z',
  };
}

/** One accepted-command journal record, exactly as `handleCommand` writes it. */
function acceptedEntry(input: {
  readonly commandType: string;
  readonly aggregateId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly revision: number;
  readonly payload: unknown;
  readonly correlation: Record<string, string>;
}): string {
  const envelope = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    kind: 'command',
    commandType: input.commandType,
    peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
    requestId: input.requestId,
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision,
    correlation: input.correlation,
    issuedAt: '2026-10-26T00:00:00Z',
    payload: input.payload,
  };
  const response = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    kind: 'response',
    inReplyTo: input.requestId,
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: input.requestId,
      aggregateId: input.aggregateId,
      revision: input.revision,
      converged: false,
    },
    currentRevision: input.revision,
  };
  return `${JSON.stringify({
    kind: 'COMMAND',
    envelope,
    response,
    payloadDigest: JSON.stringify(input.payload),
  })}\n`;
}

/** Submit + confirm one contract/snapshot through the live seam (1.0 lane). */
function prepareLineage(runtime: CoreRuntime, contractId: string): void {
  const contract = decodeAcquisitionContract(contractPayload(contractId));
  if (!contract.ok) {
    throw new Error(`fixture contract rejected: ${contract.diagnostics[0]?.message}`);
  }
  const submitted = seamCommand(runtime, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: contractId,
    payload: contract.value,
    expectedRevision: 0,
  });
  if (submitted.outcome !== 'ACCEPTED') {
    throw new Error(`submit rejected: ${JSON.stringify(submitted.diagnostics)}`);
  }
  const confirmed = seamCommand(runtime, {
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: contractId,
    payload: snapshotPayloadOf(contractId, 's4snap-flow-001', 's4member-flow-001'),
    expectedRevision: 1,
  });
  if (confirmed.outcome !== 'ACCEPTED') {
    throw new Error(`snapshot rejected: ${JSON.stringify(confirmed.diagnostics)}`);
  }
}

async function awaitTerminal(
  runtime: CoreRuntime,
  contractId: string,
  timeoutMs = 10_000,
): Promise<TerminalResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const terminal = runtime.seam.inspectProjection(contractId)?.terminal as
      TerminalResult | undefined;
    if (terminal !== undefined) {
      return terminal;
    }
    if (Date.now() > deadline) {
      throw new Error(`no terminal projected for ${contractId} within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function awaitPreview(runtime: CoreRuntime, contractId: string): Promise<S4PreviewRecord> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const preview = runtime.seam.inspectProjection(contractId)?.s4Preview;
    if (preview !== undefined && preview.status !== 'PENDING') {
      return preview;
    }
    if (Date.now() > deadline) {
      throw new Error(`preview not observed for ${contractId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Live S4 wire frame with the OS-verified session registry attached. */
function s4Frame(
  runtime: CoreRuntime,
  commandType: string,
  payload: unknown,
  expectedRevision: number,
  requestId: string,
): ReturnType<CoreRuntime['seam']['handleFrame']> {
  return runtime.seam.handleFrame(
    JSON.stringify({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
      kind: 'command',
      commandType,
      peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
      requestId,
      aggregateId: 'contract-s4-flow-001',
      expectedRevision,
      correlation: { contractId: 'contract-s4-flow-001', snapshotId: 's4snap-flow-001' },
      issuedAt: '2026-10-26T00:00:00Z',
      payload,
    }),
    s4FlowSessions,
    CONNECTION,
  );
}

const s4FlowSessions = createVerifiedPeerSessionRegistry();
s4FlowSessions.record(verifiedSession());

/** Generate a real 3-segment h264+aac HLS VOD with ffmpeg; serve it raw. */
interface HlsFixtureMedia {
  readonly masterText: string;
  readonly mediaText: string;
  readonly segmentBytes: readonly Uint8Array[];
}

function generateRealHlsMedia(): HlsFixtureMedia {
  const dir = mkdtempSync(join(tmpdir(), 'xd-s4-flow-media-'));
  try {
    const result = spawnSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=128x72:rate=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-t',
        '6',
        '-c:v',
        'libx264',
        '-profile:v',
        'baseline',
        '-level',
        '3.0',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '20',
        '-keyint_min',
        '20',
        '-sc_threshold',
        '0',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_list_size',
        '0',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        join(dir, 'seg%01d.ts'),
        join(dir, 'index.m3u8'),
      ],
      { timeout: 60_000 },
    );
    if (result.status !== 0) {
      throw new Error(`ffmpeg fixture generation failed: ${String(result.stderr)}`);
    }
    const segmentFiles = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => new Uint8Array(readFileSync(join(dir, name))));
    if (segmentFiles.length !== 3) {
      throw new Error(`expected 3 generated TS segments, got ${String(segmentFiles.length)}`);
    }
    const mediaText = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:2.0,',
      'seg0.ts',
      '#EXTINF:2.0,',
      'seg1.ts',
      '#EXTINF:2.0,',
      'seg2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const masterText = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="avc1.42e01e,mp4a.40.2",RESOLUTION=128x72',
      'rend-360p.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",RESOLUTION=256x144',
      'rend-720p.m3u8',
    ].join('\n');
    return { masterText, mediaText, segmentBytes: segmentFiles };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mediaFixture: { current?: HlsFixtureMedia } = {};
const roots: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) {
    removeTempDir(dir);
  }
});

afterAll(async () => {
  for (const server of fixtures.splice(0)) {
    await server.stop();
  }
});

async function hlsFixture(): Promise<ControlledHttpFixture> {
  const server = new ControlledHttpFixture();
  await server.start();
  fixtures.push(server);
  const media = (mediaFixture.current ??= generateRealHlsMedia());
  server.serveFile('/hls/master.m3u8', {
    body: new TextEncoder().encode(media.masterText),
    contentType: 'application/vnd.apple.mpegurl',
  });
  server.serveFile('/hls/rend-360p.m3u8', {
    body: new TextEncoder().encode(media.mediaText),
    contentType: 'application/vnd.apple.mpegurl',
  });
  media.segmentBytes.forEach((bytes, index) => {
    server.serveFile(`/hls/seg${String(index)}.ts`, {
      body: bytes,
      contentType: 'video/mp2t',
    });
  });
  return server;
}

/** Drive the live BEGIN→COMMIT→EXECUTE wire journey over the observed preview. */
function confirmAndExecute(
  runtime: CoreRuntime,
  preview: S4PreviewRecord,
  variant: S4RenditionFact,
  fromRevision: number,
): number {
  const digest = s4SelectionTupleDigest({
    contractId: 'contract-s4-flow-001',
    snapshotId: preview.snapshotId,
    memberId: preview.memberId,
    previewId: preview.previewId,
    renditionKey: variant.key,
    renditionUri: variant.uri,
    manifestUri: preview.manifestUri,
    mediaProfileId: preview.mediaProfileId,
    bandwidth: variant.bandwidth,
    ...(variant.width === undefined ? {} : { width: variant.width }),
    ...(variant.height === undefined ? {} : { height: variant.height }),
  });
  const begin = s4Frame(
    runtime,
    'CONFIRM_S4_SELECTION',
    {
      phase: 'BEGIN',
      snapshotId: preview.snapshotId,
      memberId: preview.memberId,
      previewId: preview.previewId,
      renditionKey: variant.key,
      displayedTupleDigest: digest,
    },
    fromRevision,
    'req-s4-flow-begin',
  );
  if (begin.outcome !== 'ACCEPTED' || begin.s4PrivateChallenge === undefined) {
    throw new Error(`BEGIN rejected: ${JSON.stringify(begin.diagnostics)}`);
  }
  const committed = s4Frame(
    runtime,
    'CONFIRM_S4_SELECTION',
    {
      phase: 'COMMIT',
      snapshotId: preview.snapshotId,
      memberId: preview.memberId,
      previewId: preview.previewId,
      renditionKey: variant.key,
      displayedTupleDigest: digest,
      confirmationChallenge: begin.s4PrivateChallenge.value,
    },
    fromRevision,
    'req-s4-flow-commit',
  );
  if (committed.outcome !== 'ACCEPTED') {
    throw new Error(`COMMIT rejected: ${JSON.stringify(committed.diagnostics)}`);
  }
  const selection = runtime.seam.inspectProjection('contract-s4-flow-001')
    ?.s4ConfirmedSelection as S4ConfirmedSelectionRecord;
  const executed = s4Frame(
    runtime,
    'EXECUTE_S4_SELECTED_HLS_VOD',
    {
      snapshotId: preview.snapshotId,
      memberId: preview.memberId,
      confirmedSelectionId: selection.confirmedSelectionId,
    },
    committed.currentRevision ?? fromRevision + 1,
    'req-s4-flow-execute',
  );
  if (executed.outcome !== 'ACCEPTED') {
    throw new Error(`EXECUTE rejected: ${JSON.stringify(executed.diagnostics)}`);
  }
  return executed.currentRevision ?? fromRevision + 2;
}

describe.skipIf(!ffmpegOk)('#153 S4 selected-HLS Core flow (real FFmpeg)', () => {
  it('drives the durable preview + confirmed selection to an accepted COMPLETE terminal', async () => {
    const server = await hlsFixture();
    const root = makeTempDir('s4-hls-flow');
    roots.push(root);
    const contractId = 'contract-s4-flow-001';
    // Live process admitted the lineage + preview intent, then died.
    const live = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    prepareLineage(live, contractId);
    appendFileSync(
      join(root, 'seam-journal.jsonl'),
      acceptedEntry({
        commandType: 'PREVIEW_S4_HLS_VOD',
        aggregateId: contractId,
        requestId: 'seed-s4-preview',
        expectedRevision: 2,
        revision: 3,
        payload: {
          snapshotId: 's4snap-flow-001',
          memberId: 's4member-flow-001',
          manifestUri: server.uri('/hls/master.m3u8'),
          mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
        },
        correlation: { contractId, snapshotId: 's4snap-flow-001' },
      }),
    );
    closeRuntime(live);
    // Restart reconcile observes the master through the fixture lane.
    const runtime = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    try {
      const preview = await awaitPreview(runtime, contractId);
      expect(preview.status).toBe('AVAILABLE');
      expect(preview.variants?.length).toBe(2);
      expect(preview.variants?.[0]?.uri).toBe(server.uri('/hls/rend-360p.m3u8'));

      const variant = preview.variants![0]!;
      const revision = confirmAndExecute(runtime, preview, variant, 3);
      void revision;
      const terminal = await awaitTerminal(runtime, contractId);
      expect(terminal.requestFulfillment).toBe('COMPLETE');
      expect(terminal.validationSummary.status).toBe('ALL_PASSED');
      const artifactId = `s4artifact:${contractId}:s4snap-flow-001:s4member-flow-001`;
      const digest = runtime.store.observe(artifactId).observedDigest;
      const expected = createHash('sha256');
      for (const bytes of mediaFixture.current!.segmentBytes) {
        expected.update(bytes);
      }
      expect(digest).toBe(expected.digest('hex'));
      const witness = runtime.seam.targetWitnessFor(contractId);
      expect(witness?.status).toBe('RESOLVED');
      expect(witness?.certaintyClass).toBe('PROBATIVE');
      // Master was read once by the preview and once by the execution lane.
      const masterReads = server.requests.filter((r) => r.path === '/hls/master.m3u8').length;
      expect(masterReads).toBe(2);
      expect(server.requests.filter((r) => r.path.endsWith('.ts'))).toHaveLength(3);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('never re-executes an already-terminal execution (durable truth only)', async () => {
    const server = await hlsFixture();
    const root = makeTempDir('s4-hls-flow');
    roots.push(root);
    const contractId = 'contract-s4-flow-001';
    const live = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    prepareLineage(live, contractId);
    appendFileSync(
      join(root, 'seam-journal.jsonl'),
      acceptedEntry({
        commandType: 'PREVIEW_S4_HLS_VOD',
        aggregateId: contractId,
        requestId: 'seed-s4-preview',
        expectedRevision: 2,
        revision: 3,
        payload: {
          snapshotId: 's4snap-flow-001',
          memberId: 's4member-flow-001',
          manifestUri: server.uri('/hls/master.m3u8'),
          mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
        },
        correlation: { contractId, snapshotId: 's4snap-flow-001' },
      }),
    );
    closeRuntime(live);
    const runtime = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    try {
      const preview = await awaitPreview(runtime, contractId);
      confirmAndExecute(runtime, preview, preview.variants![0]!, 3);
      await awaitTerminal(runtime, contractId);
      const requestsAfterFirst = server.requests.length;
      // A restart replays the journaled intent; reconcile re-derives the
      // identical terminal WITHOUT a second HTTP request.
      closeRuntime(runtime);
      const reopened = reopenCoreRuntime({
        rootDir: root,
        expectedPeer: EXPECTED_PEER,
        s4Hls: S4_FIXTURE_HTTP,
      });
      try {
        const terminal = reopened.seam.inspectProjection(contractId)?.terminal as
          TerminalResult | undefined;
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(terminal?.requestFulfillment).toBe('COMPLETE');
        expect(server.requests.length).toBe(requestsAfterFirst);
      } finally {
        closeRuntime(reopened);
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('records a truthful preview refusal when the manifest origin is unreachable', async () => {
    const server = new ControlledHttpFixture();
    await server.start();
    fixtures.push(server);
    const root = makeTempDir('s4-hls-flow');
    roots.push(root);
    const contractId = 'contract-s4-flow-001';
    const live = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    prepareLineage(live, contractId);
    appendFileSync(
      join(root, 'seam-journal.jsonl'),
      acceptedEntry({
        commandType: 'PREVIEW_S4_HLS_VOD',
        aggregateId: contractId,
        requestId: 'seed-s4-preview',
        expectedRevision: 2,
        revision: 3,
        payload: {
          snapshotId: 's4snap-flow-001',
          memberId: 's4member-flow-001',
          manifestUri: server.uri('/hls/master.m3u8'),
          mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
        },
        correlation: { contractId, snapshotId: 's4snap-flow-001' },
      }),
    );
    closeRuntime(live);
    const runtime = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    try {
      const preview = await awaitPreview(runtime, contractId);
      expect(preview.status).toBe('FAILED');
      expect(preview.failureReason).toBe('MANIFEST_UNREACHABLE');
      expect(runtime.seam.inspectProjection(contractId)?.terminal).toBeUndefined();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('closes truthfully when the user cancelled before dispatch (no transfer, no socket)', async () => {
    const server = await hlsFixture();
    const root = makeTempDir('s4-hls-flow');
    roots.push(root);
    const contractId = 'contract-s4-flow-001';
    const live = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    prepareLineage(live, contractId);
    appendFileSync(
      join(root, 'seam-journal.jsonl'),
      acceptedEntry({
        commandType: 'PREVIEW_S4_HLS_VOD',
        aggregateId: contractId,
        requestId: 'seed-s4-preview',
        expectedRevision: 2,
        revision: 3,
        payload: {
          snapshotId: 's4snap-flow-001',
          memberId: 's4member-flow-001',
          manifestUri: server.uri('/hls/master.m3u8'),
          mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
        },
        correlation: { contractId, snapshotId: 's4snap-flow-001' },
      }),
    );
    closeRuntime(live);
    // Observe the preview, confirm + execute, then durably cancel before any drive.
    const runtime = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    const preview = await awaitPreview(runtime, contractId);
    const revision = confirmAndExecute(runtime, preview, preview.variants![0]!, 3);
    const cancelled = runtime.seam.handleFrame(
      JSON.stringify({
        schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
        kind: 'command',
        commandType: 'CANCEL_LINEAGE',
        peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
        requestId: 'seed-s4-cancel',
        aggregateId: contractId,
        expectedRevision: revision,
        correlation: {},
        issuedAt: '2026-10-26T00:00:00Z',
        payload: {},
      }),
    );
    expect(cancelled.outcome).toBe('ACCEPTED');
    closeRuntime(runtime);
    const after = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    try {
      const terminal = await awaitTerminal(after, contractId);
      expect(terminal.requestFulfillment).not.toBe('COMPLETE');
      expect(terminal.stopReason).toBe('USER_CANCELLED');
      const segmentReads = server.requests.filter((r) => r.path.endsWith('.ts')).length;
      expect(segmentReads).toBe(0);
    } finally {
      closeRuntime(after);
    }
  });
});

describe('#153 S4 preview expiry (no FFmpeg required)', () => {
  it('closes an expired PENDING preview truthfully FAILED without a fetch', async () => {
    const root = makeTempDir('s4-hls-expiry');
    roots.push(root);
    const contractId = 'contract-s4-flow-001';
    const runtime = reopenCoreRuntime({
      rootDir: root,
      expectedPeer: EXPECTED_PEER,
      s4Hls: S4_FIXTURE_HTTP,
    });
    try {
      prepareLineage(runtime, contractId);
      // Admit the preview intent live, then simulate the reconcile finding a
      // preview whose Core-enforced TTL window has fully elapsed.
      const admitted = s4Frame(
        runtime,
        'PREVIEW_S4_HLS_VOD',
        {
          snapshotId: 's4snap-flow-001',
          memberId: 's4member-flow-001',
          manifestUri: 'https://cdn.example.org/vod/master.m3u8',
          mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
        },
        2,
        'req-s4-expiry-preview',
      );
      expect(admitted.outcome).toBe('ACCEPTED');
      const pending = runtime.seam.inspectProjection(contractId)?.s4Preview;
      expect(pending?.status).toBe('PENDING');
      const expiredRecord: S4PreviewRecord = {
        ...pending!,
        createdAt: new Date(Date.now() - 300_000).toISOString(),
        expiresAt: new Date(Date.now() - 180_000).toISOString(),
      };
      const decoded = decodeAcquisitionContract(contractPayload(contractId));
      if (!decoded.ok) throw new Error('fixture contract rejected');
      const drive = await driveS4Preview(
        { ...runtime } satisfies S4DriveRuntime,
        {
          aggregateId: contractId,
          contract: decoded.value,
          preview: expiredRecord,
        },
        S4_FIXTURE_HTTP,
      );
      expect(drive.ok).toBe(true);
      const observed = runtime.seam.inspectProjection(contractId)?.s4Preview;
      expect(observed?.status).toBe('FAILED');
      expect(observed?.failureReason).toBe('PREVIEW_EXPIRED');
    } finally {
      closeRuntime(runtime);
    }
  });
});
