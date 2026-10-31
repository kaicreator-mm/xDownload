import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { ControlledHttpFixture } from '../../packages/direct-acquisition/test/helpers/fixture-server.ts';
import { payload } from '../../packages/direct-acquisition/test/helpers/fixtures.ts';
import { startControlledHlsFixture, type ControlledHlsFixture } from './controlled-hls-fixture.ts';
import { V021_SCENARIO_CORPUS } from './scenario-corpus.ts';
import { materializeFixtureAtomically, withTemporaryArtifactRoot } from './temporary-artifact.ts';

describe('v0.2.1 validation fixture corpus', () => {
  it('contains each required scenario exactly once and references existing evidence tests', () => {
    const ids = V021_SCENARIO_CORPUS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(11);
    for (const scenario of V021_SCENARIO_CORPUS) {
      expect(scenario.required).toBe(true);
      expect(scenario.evidencePaths.length).toBeGreaterThan(0);
      for (const path of scenario.evidencePaths) {
        expect(existsSync(join(process.cwd(), path))).toBe(true);
      }
    }
    const permission = V021_SCENARIO_CORPUS.find(
      (scenario) => scenario.id === 'permission-and-disk-full-failure',
    );
    expect(permission?.classifications).toContain('INJECTED_FAILURE_FAKE');
    expect(permission?.installedGate).toBe('NOT_PROVEN');
  });
});

describe('real controlled direct HTTP fixture', () => {
  let fixture: ControlledHttpFixture;
  let baseUri: string;

  beforeAll(async () => {
    fixture = new ControlledHttpFixture();
    baseUri = await fixture.start();
    fixture.serveFile('/direct.bin', { body: payload(128), etag: '"t11-direct-v1"' });
  });

  afterAll(async () => {
    await fixture.stop();
  });

  it('uses a real loopback socket and records the direct request', async () => {
    const response = await fetch(baseUri + '/direct.bin');
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload(128));
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.path).toBe('/direct.bin');
  });
});

describe('real controlled HLS VOD fixture', () => {
  let fixture: ControlledHlsFixture;

  beforeAll(async () => {
    fixture = await startControlledHlsFixture();
  });

  afterAll(async () => {
    await fixture.stop();
  });

  it('serves one finite selected rendition and its real loopback segments', async () => {
    const masterResponse = await fetch(fixture.origin + '/master.m3u8');
    expect(masterResponse.status).toBe(200);
    const master = await masterResponse.text();
    expect(master).toContain('variant-720p.m3u8');

    const mediaResponse = await fetch(fixture.origin + '/variant-720p.m3u8');
    expect(mediaResponse.status).toBe(200);
    const media = await mediaResponse.text();
    expect(media).toContain('#EXT-X-ENDLIST');

    for (let index = 0; index < fixture.segmentBytes.length; index += 1) {
      const path = '/segment-' + String(index) + '.ts';
      const response = await fetch(fixture.origin + path);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture.segmentBytes[index]);
    }
    expect(fixture.requests).toEqual([
      '/master.m3u8',
      '/variant-720p.m3u8',
      '/segment-0.ts',
      '/segment-1.ts',
      '/segment-2.ts',
    ]);
  });
});

describe('real temporary filesystem fixture', () => {
  it('writes a partial file, atomically renames it and verifies bytes/digest from disk', async () => {
    const bytes = payload(4096);
    await withTemporaryArtifactRoot(async (root) => {
      const artifact = await materializeFixtureAtomically(root, 'fixture.bin', bytes);
      expect(existsSync(artifact.path)).toBe(true);
      expect(artifact.bytes).toEqual(bytes);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(artifact.path + '.partial')).toBe(false);
    });
  });

  it('rejects traversal-like fixture names before writing', async () => {
    await withTemporaryArtifactRoot(async (root) => {
      await expect(materializeFixtureAtomically(root, '../escape.bin', payload(8))).rejects.toThrow(
        'fixture filename must be one basename',
      );
    });
  });
});

describe('pure contract and exit-sink fixture oracles', () => {
  it('preserves UNKNOWN totals and refuses ambiguous/conflicting lineage owners', () => {
    const progress = decodeDownloadProgressProjection({
      transferredBytes: 120,
      totalBytes: { kind: 'UNKNOWN' },
    });
    expect(progress.ok).toBe(true);
    if (progress.ok) {
      expect(progress.value.totalBytes).toEqual({ kind: 'UNKNOWN' });
    }
    const conflict = resolveLineageOwner({ oldCore: 'REGISTERED', newK: 'OWNED' });
    const ambiguous = resolveLineageOwner({ oldCore: 'UNKNOWN', newK: 'ABSENT' });
    expect(conflict.ok && conflict.value).toEqual({
      status: 'REFUSED',
      reason: 'LINEAGE_OWNER_CONFLICT',
    });
    expect(ambiguous.ok && ambiguous.value).toEqual({
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
      expect(serialized).not.toContain('raw-cookie');
      expect(serialized).not.toContain('raw-token');
      expect(serialized).not.toContain(sentinel);
      expect(auditValueContainsSentinel(safe)).toBe(false);
    } finally {
      clearSinkScrubSentinels();
    }
  });
});
