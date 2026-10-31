import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  auditValueContainsSentinel,
  clearSinkScrubSentinels,
  redactForSink,
  registerSinkScrubSentinel,
} from '@xdownload/browser-observation';
import {
  decodeDownloadProgressProjection,
  resolveLineageOwner,
} from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from
  '../../packages/direct-acquisition/test/helpers/fixture-server.ts';
import { payload } from '../../packages/direct-acquisition/test/helpers/fixtures.ts';
import { startControlledHlsFixture, type ControlledHlsFixture } from './controlled-hls-fixture.ts';
import { V021_SCENARIO_CORPUS } from './scenario-corpus.ts';
import { materializeFixtureAtomically, withTemporaryArtifactRoot } from './temporary-artifact.ts';

describe('v0.2.1 validation fixture corpus', () => {
  it('contains each required scenario exactly once and references existing evidence tests', () => {
    const ids = V021_SCENARIO_CORPUS.map((scenario) => scenario.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 11);
    for (const scenario of V021_SCENARIO_CORPUS) {
      assert.equal(scenario.required, true);
      assert.ok(scenario.evidencePaths.length > 0);
      for (const path of scenario.evidencePaths) {
        assert.equal(existsSync(join(process.cwd(), path)), true, 'missing evidence path: ' + path);
      }
    }
    const permission = V021_SCENARIO_CORPUS.find(
      (scenario) => scenario.id === 'permission-and-disk-full-failure',
    );
    assert.ok(permission?.classifications.includes('INJECTED_FAILURE_FAKE'));
    assert.equal(permission?.installedGate, 'NOT_PROVEN');
    assert.deepEqual(permission?.evidencePaths, ['tests/v0.2.1/controlled-fixtures.test.ts']);
  });
});

describe('real controlled direct HTTP fixture', () => {
  let fixture: ControlledHttpFixture;
  let baseUri: string;

  before(async () => {
    fixture = new ControlledHttpFixture();
    baseUri = await fixture.start();
    fixture.serveFile('/direct.bin', { body: payload(128), etag: '"t11-direct-v1"' });
  });

  after(async () => {
    await fixture.stop();
  });

  it('uses a real loopback socket and records the direct request', async () => {
    const response = await fetch(baseUri + '/direct.bin');
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload(128));
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.path, '/direct.bin');
  });
});

describe('real controlled HLS VOD fixture', () => {
  let fixture: ControlledHlsFixture;

  before(async () => {
    fixture = await startControlledHlsFixture();
  });

  after(async () => {
    await fixture.stop();
  });

  it('serves one finite selected rendition and its real loopback segments', async () => {
    const masterResponse = await fetch(fixture.origin + '/master.m3u8');
    assert.equal(masterResponse.status, 200);
    const master = await masterResponse.text();
    assert.ok(master.includes('variant-720p.m3u8'));

    const mediaResponse = await fetch(fixture.origin + '/variant-720p.m3u8');
    assert.equal(mediaResponse.status, 200);
    const media = await mediaResponse.text();
    assert.ok(media.includes('#EXT-X-ENDLIST'));

    for (let index = 0; index < fixture.segmentBytes.length; index += 1) {
      const path = '/segment-' + String(index) + '.ts';
      const response = await fetch(fixture.origin + path);
      assert.equal(response.status, 200);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.segmentBytes[index]);
    }
    assert.deepEqual(fixture.requests, [
      '/master.m3u8',
      '/variant-720p.m3u8',
      '/segment-0.ts',
      '/segment-1.ts',
      '/segment-2.ts',
    ]);
  });
});

describe('real temporary filesystem fixture', () => {
  it('writes and verifies an atomically published artifact from disk', async () => {
    const bytes = payload(4096);
    await withTemporaryArtifactRoot(async (root) => {
      const artifact = await materializeFixtureAtomically(root, 'fixture.bin', bytes);
      assert.equal(existsSync(artifact.path), true);
      assert.deepEqual(artifact.bytes, bytes);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.equal(existsSync(artifact.path + '.partial'), false);
    });
  });

  it('rejects traversal-like fixture names before writing', async () => {
    await withTemporaryArtifactRoot(async (root) => {
      await assert.rejects(
        materializeFixtureAtomically(root, '../escape.bin', payload(8)),
        /fixture filename must be one basename/,
      );
    });
  });

  it('does not overwrite an existing final artifact', async () => {
    await withTemporaryArtifactRoot(async (root) => {
      const existing = payload(16, 7);
      const finalPath = join(root, 'existing.bin');
      await writeFile(finalPath, existing, { flag: 'wx' });

      await assert.rejects(
        materializeFixtureAtomically(root, 'existing.bin', payload(32, 9)),
        /fixture artifact collision/,
      );

      assert.deepEqual(await readFile(finalPath), existing);
      assert.equal(existsSync(finalPath + '.partial'), false);
    });
  });

  it('labels injected permission and disk-full failures as FAKE', async () => {
    await withTemporaryArtifactRoot(async (root) => {
      for (const failure of ['PERMISSION_DENIED', 'DISK_FULL'] as const) {
        const filename = failure.toLowerCase() + '.bin';
        await assert.rejects(
          materializeFixtureAtomically(root, filename, payload(128), { injectedFailure: failure }),
          /INJECTED_FAILURE_FAKE/,
        );
        assert.equal(existsSync(join(root, filename)), false);
        assert.equal(existsSync(join(root, filename + '.partial')), false);
      }
    });
  });
});

describe('pure contract and exit-sink fixture oracles', () => {
  it('preserves UNKNOWN totals and refuses ambiguous/conflicting lineage owners', () => {
    const progress = decodeDownloadProgressProjection({
      transferredBytes: 120,
      totalBytes: { kind: 'UNKNOWN' },
    });
    assert.equal(progress.ok, true);
    if (progress.ok) {
      assert.deepEqual(progress.value.totalBytes, { kind: 'UNKNOWN' });
    }
    const conflict = resolveLineageOwner({ oldCore: 'REGISTERED', newK: 'OWNED' });
    const ambiguous = resolveLineageOwner({ oldCore: 'UNKNOWN', newK: 'ABSENT' });
    assert.deepEqual(conflict.ok && conflict.value, {
      status: 'REFUSED',
      reason: 'LINEAGE_OWNER_CONFLICT',
    });
    assert.deepEqual(ambiguous.ok && ambiguous.value, {
      status: 'REFUSED',
      reason: 'LINEAGE_OWNER_AMBIGUOUS',
    });
  });

  it('redacts raw secret keys and sentinel-bearing non-secret fields before exit sinks', () => {
    const sentinel = 'T11-SENTINEL-DO-NOT-PERSIST-20261031';
    registerSinkScrubSentinel(sentinel);
    try {
      const input = {
        cookie: 'raw-cookie',
        nested: { authorization: 'Bearer raw-token' },
        note: 'page note contains ' + sentinel,
      };
      const safe = redactForSink(input);
      const serialized = JSON.stringify(safe);
      assert.ok(!serialized.includes('raw-cookie'));
      assert.ok(!serialized.includes('raw-token'));
      assert.ok(!serialized.includes(sentinel));
      assert.equal(auditValueContainsSentinel(safe), false);
    } finally {
      clearSinkScrubSentinels();
    }
  });
});
