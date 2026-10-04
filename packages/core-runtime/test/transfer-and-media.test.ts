/**
 * TEST_MATRIX suite `transfer-and-media` (+ C15, C27, C29, C12 shape).
 *
 * Must prove:
 * - DirectHttpAdapter executes a full direct acquisition under runtime
 *   dispatch, with resume/retry honoring identity/locator separation (C29);
 * - the HLS VOD pipeline executes playlist→bind→plan→acquire→assemble→
 *   validate under runtime dispatch; unsupported topology fails closed (C15);
 * - the applicable validation chain (transfer/format/media/target) gates
 *   artifact acceptance; AcceptanceValidation flows from adapter validation
 *   results (C27);
 * - missing or corrupt artifact bytes are never accepted as success.
 */

import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import type { DirectTransferRequest } from '@xdownload/direct-acquisition';
import {
  bindRenditionToTarget,
  createSyntheticMediaAssemblyPort,
  createSyntheticSegmentBytes,
  decodeMasterPlaylist,
  decodeMediaPlaylist,
  type HlsRenditionBinding,
  type MasterPlaylist,
  type MediaPlaylist,
} from '@xdownload/hls-vod-adapter';
import { fileSafeName, type PersistenceError } from '@xdownload/persistence-ledger';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  rawSingleResourceContract,
  removeTempDir,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { executeDirectAcquisition, executeHlsAcquisition, registerLineage } from '../src/index.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = 'contract-single-001';
const SNAPSHOT = 'snapshot-001';
const TARGET = 'target-file-001';
const MEMBER = 'member-file-001';
const HLS_TARGET = 'target-hls-vod-1';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bindingFor(baseUri: string, targetRaw = TARGET): LocatorBinding<LogicalTargetId> {
  const targetId = unwrapOrThrow(makeLogicalTargetId(targetRaw));
  const initialUri = `${baseUri}/file.bin`;
  return unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
}

function directRequest(
  baseUri: string,
  bytes: Uint8Array,
  overrides: Partial<DirectTransferRequest> = {},
): DirectTransferRequest {
  return {
    effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice: 'S1',
    selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
    binding: bindingFor(baseUri),
    expectedSha256: sha256(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
    ...overrides,
  };
}

describe('T015 transfer-and-media', () => {
  it('executes a full S3 media acquisition under runtime dispatch and gates acceptance on the validate chain', async () => {
    const rootDir = makeTempDir('t015-media-ok');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    // Media bytes with an MP4 ftyp box: media policy requires it at offset 4.
    const bytes = new Uint8Array(2048);
    bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
    for (let index = 8; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    fixture.serveFile('/file.bin', { body: bytes, etag: 'media-etag', contentType: 'video/mp4' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await executeDirectAcquisition(runtime, {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-media-001',
        memberId: MEMBER,
        artifactId: 'artifact:media-001',
        transfer: directRequest(baseUri, bytes, {
          slice: 'S3',
          mediaPolicy: {
            signatures: [{ hex: '66747970', offset: 4, label: 'mp4 ftyp container box' }],
          },
        }),
      });
      if (flow.attemptReplayed || flow.transfer === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.transfer.reason).toBe('COMPLETED');
      expect(
        flow.transfer.validations.map((check) => `${check.layer}:${check.passed}`).sort(),
      ).toEqual(['format:true', 'media:true', 'target:true', 'transfer:true']);
      expect(flow.acceptance).toBeDefined();
      expect(flow.schedulerAcceptance?.ok).toBe(true);
      // The bytes physically persisted under the digest binding.
      const finalBytes = runtime.store.readFinalBytes('artifact:media-001');
      expect(finalBytes && sha256(finalBytes)).toBe(sha256(bytes));
    } finally {
      closeRuntime(runtime);
    }
  });

  it('blocks acceptance when the validate chain fails (C27) and never projects COMPLETE', async () => {
    const rootDir = makeTempDir('t015-media-fail');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    // Bytes WITHOUT the required media structure; the digest matches the
    // frozen anchor, so only media validation fails (C27 shape).
    const bytes = payload(1024, 9);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'media-missing-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await executeDirectAcquisition(runtime, {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-media-002',
        memberId: MEMBER,
        artifactId: 'artifact:media-002',
        transfer: directRequest(baseUri, bytes, {
          slice: 'S3',
          mediaPolicy: {
            signatures: [{ hex: '66747970', offset: 4, label: 'mp4 ftyp container box' }],
          },
        }),
      });
      if (flow.attemptReplayed || flow.transfer === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.transfer.reason).toBe('MEDIA_INVALID');
      expect(flow.transfer.allApplicableValidationPassed).toBe(false);
      // The writer's AcceptanceValidation gate rejected the acceptance.
      expect(flow.acceptance).toBeUndefined();
      expect(flow.acceptanceError?.code).toBe('ACCEPTANCE_INVALID');
      expect(flow.schedulerAcceptance).toBeUndefined();
      // The terminal-failure fact is durable and truthful.
      const facts = runtime.writer.reader.facts(flow.workItemId);
      expect(facts.some((fact) => fact.kind === 'TERMINAL_FAILURE')).toBe(true);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('preserves logical target identity across a declared CDN redirect (C29)', async () => {
    const rootDir = makeTempDir('t015-redirect');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(1024, 5);
    fixture.redirect('/file.bin', `${baseUri}/cdn/file.bin`);
    fixture.serveFile('/cdn/file.bin', { body: bytes, etag: 'cdn-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await executeDirectAcquisition(runtime, {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-redirect-001',
        memberId: MEMBER,
        artifactId: 'artifact:redirect-001',
        transfer: directRequest(baseUri, bytes),
      });
      if (flow.attemptReplayed || flow.transfer === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.transfer.reason).toBe('COMPLETED');
      // The locator chain records the provenance-bound hop; the logical
      // target identity of every hop is the frozen target.
      expect(flow.transfer.locatorChain.length).toBe(2);
      for (const hop of flow.transfer.locatorChain) {
        expect(hop.identity).toBe(unwrapOrThrow(makeLogicalTargetId(TARGET)));
      }
      expect(flow.acceptance).toBeDefined();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('executes the HLS VOD pipeline under runtime dispatch and accepts the assembled artifact', () => {
    const rootDir = makeTempDir('t015-hls-ok');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const hls = hlsFixtures();
      const flow = executeHlsAcquisition(runtime, {
        contractId: 'contract-hls-001',
        snapshotId: 'snapshot-hls-001',
        targetId: HLS_TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-hls-001',
        memberId: 'member-hls-001',
        artifactId: 'artifact:hls-001',
        binding: hls.binding,
        master: hls.master,
        mediaPlaylist: hls.mediaPlaylist,
        mediaPlaylistLocator: hls.mediaPlaylistLocator,
        fetcher: hls.fetcher,
        assemblyPort: hls.assemblyPort,
        recordedAt: '2026-10-04T05:00:00.000Z',
      });
      if (flow.attemptReplayed || flow.pipeline === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.pipeline.kind).toBe('COMPLETED');
      expect(flow.pipeline.chain?.accepted).toBe(true);
      expect(flow.acceptance).toBeDefined();
      expect(flow.schedulerAcceptance?.ok).toBe(true);
      // Canonical transfer charges went through the scheduler ledger.
      const kinds = runtime.scheduler
        .log()
        .readAll()
        .map((fact) => fact.kind);
      expect(kinds.filter((kind) => kind === 'budgetConsumed').length).toBeGreaterThan(0);
      // The assembled artifact persists under its digest binding.
      const finalBytes = runtime.store.readFinalBytes('artifact:hls-001');
      expect(finalBytes?.length ?? 0).toBeGreaterThan(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails closed on an unsupported HLS topology (C15) without false complete projection', () => {
    const rootDir = makeTempDir('t015-hls-unsupported');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const hls = hlsFixtures({
        mediaPlaylistText: [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-TARGETDURATION:4',
          '#EXT-X-MAP:URI="init.mp4"',
          '#EXTINF:4,',
          'seg-0.ts',
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
      });
      const flow = executeHlsAcquisition(runtime, {
        contractId: 'contract-hls-002',
        snapshotId: 'snapshot-hls-002',
        targetId: HLS_TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        commandId: 'cmd-hls-002',
        memberId: 'member-hls-001',
        artifactId: 'artifact:hls-002',
        binding: hls.binding,
        master: hls.master,
        mediaPlaylist: hls.mediaPlaylist,
        mediaPlaylistLocator: hls.mediaPlaylistLocator,
        fetcher: hls.fetcher,
        assemblyPort: hls.assemblyPort,
        recordedAt: '2026-10-04T05:00:00.000Z',
      });
      if (flow.attemptReplayed || flow.pipeline === undefined) {
        throw new Error('unexpected replay in fixture flow');
      }

      expect(flow.pipeline.kind).toBe('UNSUPPORTED');
      expect(flow.pipeline.unsupportedReason).toBeDefined();
      expect(flow.acceptance).toBeUndefined();
      // Terminal truth is FAILED, never a false COMPLETE.
      expect(flow.pipeline.terminal.selectionAcquisition).not.toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('never accepts missing artifact bytes as success (DB-only acceptance refused)', async () => {
    const rootDir = makeTempDir('t015-media-missing');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const { lineageKey, workItemId } = registerSucceededLineage(runtime);
      const bytes = payload(1024, 11);
      runtime.writer.stageArtifact({
        workItemId,
        artifactId: 'artifact:missing-001',
        bytes,
        provenance: { source: 'missing-bytes-suite' },
      });
      runtime.writer.materializeArtifact(workItemId, 'artifact:missing-001');
      runtime.writer.finalizeArtifact(workItemId, 'artifact:missing-001');

      // Delete the finalized bytes: a DB row alone can never be accepted.
      rmSync(
        join(runtime.layout.artifactRoot, 'final', `${fileSafeName('artifact:missing-001')}.bin`),
      );
      let rejected: PersistenceError | undefined;
      try {
        runtime.writer.acceptArtifact({
          workItemId,
          artifactId: 'artifact:missing-001',
          validation: { passed: true, passedCount: 3, failedCount: 0 },
        });
      } catch (error) {
        rejected = error as PersistenceError;
      }
      expect(rejected?.code).toBe('ACCEPTANCE_INVALID');

      const classification = runtime.recovery.classify(workItemId);
      expect(classification.fsState).toBe('ABSENT');
      expect(classification.bytesVerified).toBe(false);
      expect(classification.successClaimable).toBe(false);
      void lineageKey;
    } finally {
      closeRuntime(runtime);
    }
  });

  it('never accepts corrupt bytes: digest mismatch fails closed and classifies truthfully', async () => {
    const rootDir = makeTempDir('t015-media-digest');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const { lineageKey, workItemId } = registerSucceededLineage(runtime);
      const bytes = payload(1024, 13);
      runtime.writer.stageArtifact({
        workItemId,
        artifactId: 'artifact:digest-001',
        bytes,
        provenance: { source: 'digest-suite' },
      });
      runtime.writer.materializeArtifact(workItemId, 'artifact:digest-001');
      runtime.writer.finalizeArtifact(workItemId, 'artifact:digest-001');

      // Corrupt the finalized bytes on disk; acceptance must refuse with the
      // typed provenance mismatch, never normalize into success.
      const finalPath = join(
        runtime.layout.artifactRoot,
        'final',
        `${fileSafeName('artifact:digest-001')}.bin`,
      );
      writeFileSync(finalPath, Buffer.from(payload(1024, 99)));
      let rejected: PersistenceError | undefined;
      try {
        runtime.writer.acceptArtifact({
          workItemId,
          artifactId: 'artifact:digest-001',
          validation: { passed: true, passedCount: 3, failedCount: 0 },
        });
      } catch (error) {
        rejected = error as PersistenceError;
      }
      expect(rejected?.code).toBe('PROVENANCE_DIGEST_MISMATCH');

      const classification = runtime.recovery.classify(workItemId);
      expect(classification.fsState).toBe('DIGEST_MISMATCH');
      expect(classification.lifecycleClass).toBe('TERMINAL_FAILED');
      expect(classification.successClaimable).toBe(false);
      void lineageKey;
    } finally {
      closeRuntime(runtime);
    }
  });
});

/** Register a lineage with a durably recorded SUCCEEDED effect (upstream truth). */
function registerSucceededLineage(runtime: ReturnType<typeof openRuntime>): {
  readonly lineageKey: string;
  readonly workItemId: string;
} {
  const { submission, workItemId } = registerLineage(
    runtime,
    {
      contractId: CONTRACT,
      snapshotId: SNAPSHOT,
      targetId: TARGET,
      authorizationContextRef: 'authctx/local-001',
      budgetProfile: rawSingleResourceContract()['budgetProfile'],
    },
    { commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`, memberId: MEMBER },
  );
  runtime.writer.dispatch({ workItemId, attemptId: `${workItemId}#attempt-1` });
  const attempt = runtime.scheduler.startEffectAttempt(
    submission.lineageKey,
    `${workItemId}#attempt-1`,
  );
  expect(attempt.ok).toBe(true);
  const recorded = runtime.scheduler.recordEffectOutcome(submission.lineageKey, {
    attemptId: `${workItemId}#attempt-1`,
    outcome: 'SUCCEEDED',
  });
  expect(recorded.ok).toBe(true);
  return { lineageKey: submission.lineageKey, workItemId };
}

// ------------------------------------------------------------- HLS fixtures

interface HlsFixtures {
  readonly binding: HlsRenditionBinding;
  readonly master: MasterPlaylist;
  readonly mediaPlaylist: MediaPlaylist;
  readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
  readonly fetcher: { readonly fetcherId: string; readonly fetch: (entry: never) => never };
  readonly assemblyPort: ReturnType<typeof createSyntheticMediaAssemblyPort>;
}

const MASTER_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:4',
  '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video",RESOLUTION=1280x720',
  'media-720p.m3u8',
  '',
].join('\n');

function hlsFixtures(options: { readonly mediaPlaylistText?: string } = {}): HlsFixtures {
  const masterUri = 'https://fixture.invalid/vod/master.m3u8';
  const decodedMaster = decodeMasterPlaylist(MASTER_MANIFEST, masterUri);
  if (!decodedMaster.ok) {
    throw new Error('fixture master playlist rejected');
  }
  const master = decodedMaster.value;
  const mediaText =
    options.mediaPlaylistText ??
    [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4,seg-0',
      'seg-0.ts',
      '#EXTINF:3.5,seg-1',
      'seg-1.ts',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
  const decodedMedia = decodeMediaPlaylist(
    mediaText,
    'https://fixture.invalid/vod/media-720p.m3u8',
  );
  if (!decodedMedia.ok) {
    throw new Error(
      `fixture media playlist rejected: ${decodedMedia.diagnostics.map((d) => d.code).join(',')}`,
    );
  }
  const mediaPlaylist = decodedMedia.value;
  const targetId = unwrapOrThrow(makeLogicalTargetId(HLS_TARGET));
  const manifestLocator = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: masterUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: masterUri,
    }),
  );
  const binding = unwrapOrThrow(
    bindRenditionToTarget({
      logicalTargetId: targetId,
      manifestLocator,
      master,
      selectedVariant: master.variants[0]!,
    }),
  );
  const mediaPlaylistLocator = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: 'https://fixture.invalid/vod/media-720p.m3u8' }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: masterUri,
    }),
  );
  return {
    binding,
    master,
    mediaPlaylist,
    mediaPlaylistLocator,
    fetcher: {
      fetcherId: 't015-fixture-fetcher/1',
      fetch: ((entry: { position: number; durationSeconds: number }) => ({
        ok: true,
        bytes: createSyntheticSegmentBytes({ durationSeconds: entry.durationSeconds }),
        entry,
      })) as never,
    },
    assemblyPort: createSyntheticMediaAssemblyPort(),
  };
}
