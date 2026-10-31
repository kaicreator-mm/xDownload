import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  assembleS4HlsRuntime,
  submitConfirmedS4HlsVod,
} from './s4-hls-vod.ts';
import {
  S4_HLS_MEDIA_OPERATION,
  S4_HLS_MEDIA_PROFILE,
  s4HlsSelectionTupleDigest,
  validateConfirmedS4HlsIntent,
} from './s4-hls-vod-contract.ts';

function confirmedIntent(outputRootScope: string): Record<string, unknown> {
  const tuple = {
    contractId: 'contract-s4-001',
    snapshotId: 'snapshot-s4-001',
    memberId: 'member-s4-001',
    previewId: 'preview-s4-001',
    renditionKey: 'rend-0',
    renditionUri: 'https://cdn.example.test/vod/720p.m3u8',
    manifestUri: 'https://cdn.example.test/vod/master.m3u8',
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: 1_500_000,
    width: 1280,
    height: 720,
  };
  return {
    requestId: 'req-s4-001',
    lineageId: 'lineage-s4-001',
    contractId: tuple.contractId,
    targetRef: 'ref:s4-target-missing',
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
      confirmedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    caller: { actor: 't06-test', sessionRef: 'session-s4-001' },
  };
}

describe('T06 S4 HLS VOD confirmation and K/Host admission', () => {
  let root = '';
  let outputRoot = '';

  after(async () => {
    if (root.length > 0) await rm(root, { recursive: true, force: true });
  });

  it('accepts only the closed explicit rendition-selection contract', async () => {
    root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-contract-'));
    outputRoot = resolve(join(root, 'output'));
    await mkdir(outputRoot, { recursive: true });

    const valid = validateConfirmedS4HlsIntent(confirmedIntent(outputRoot));
    assert.equal(valid.ok, true);

    const widened = validateConfirmedS4HlsIntent({
      ...confirmedIntent(outputRoot),
      rawUrl: 'https://cdn.example.test/vod/master.m3u8',
    });
    assert.equal(widened.ok, false);
    if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
  });

  it('routes one valid S4 intent through K to the trusted Host pin and refuses an unknown target before media effects', async () => {
    root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t06-s4-runtime-'));
    outputRoot = resolve(join(root, 'output'));
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
  });
});
