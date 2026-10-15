import { describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeLogicalTargetId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import { acquireSelectedHlsManifests } from '../src/manifest-admission.ts';
import { createTransferLedger } from '../src/budget.ts';
import type { AuthorizedHlsManifestPort } from '../src/manifest-http.ts';

const masterUri = 'https://cdn.example.test/master.m3u8';
const renditionUri = 'https://cdn.example.test/v360/index.m3u8';
const target = unwrapOrThrow(makeLogicalTargetId('s4-manifest-budget-001'));
const manifestLocator = unwrapOrThrow(
  bindLocator({ kind: 'direct', uri: masterUri }, target, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: masterUri,
  }),
);
const masterText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2"',
  'v360/index.m3u8',
].join('\n');
const mediaText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:5',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4.0,',
  'one.ts',
  '#EXT-X-ENDLIST',
].join('\n');

function budget(maxBytes: number) {
  return createTransferLedger({
    discovery: { domain: 'discovery', maxGeneratedRequests: 0 },
    transfer: { domain: 'transfer', maxBytes, maxSegments: 6 },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 6 },
  });
}

function fixture(
  urls: string[],
  options: { readonly failMedia?: boolean } = {},
): AuthorizedHlsManifestPort {
  return {
    maxResponseBytes: 128,
    async fetchManifest(uri) {
      urls.push(uri);
      if (uri === masterUri) {
        return { ok: true, text: masterText, byteLength: Buffer.byteLength(masterText) };
      }
      if (uri === renditionUri && !options.failMedia) {
        return { ok: true, text: mediaText, byteLength: Buffer.byteLength(mediaText) };
      }
      return { ok: false, reason: 'UNREACHABLE' };
    },
  };
}

describe('S4 frozen selected manifests use one inherited Core transfer budget', () => {
  it('fetches exact declared rendition and produces a finite segment plan', async () => {
    const urls: string[] = [];
    const ledger = budget(1000);
    const result = await acquireSelectedHlsManifests({
      logicalTargetId: target,
      manifestLocator,
      selectedRenditionUri: renditionUri,
      ledger,
      port: fixture(urls),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.segmentPlan.entries).toHaveLength(1);
    expect(urls).toEqual([masterUri, renditionUri]);
    expect(ledger.consumed().transfer.bytes).toBe(
      Buffer.byteLength(masterText) + Buffer.byteLength(mediaText),
    );
  });

  it('does not request arbitrary rendition absent from decoded master', async () => {
    const urls: string[] = [];
    const result = await acquireSelectedHlsManifests({
      logicalTargetId: target,
      manifestLocator,
      selectedRenditionUri: 'https://attacker.example.test/other.m3u8',
      ledger: budget(1000),
      port: fixture(urls),
    });
    expect(result.ok).toBe(false);
    expect(urls).toEqual([masterUri]);
  });

  it('refuses second HTTP when first manifest depleted safe pre-request budget', async () => {
    const urls: string[] = [];
    const ledger = budget(200);
    const result = await acquireSelectedHlsManifests({
      logicalTargetId: target,
      manifestLocator,
      selectedRenditionUri: renditionUri,
      ledger,
      port: fixture(urls),
    });
    expect(result.ok).toBe(false);
    expect(urls).toEqual([masterUri]);
    expect(ledger.consumed().transfer.bytes).toBe(Buffer.byteLength(masterText));
  });

  it('does not fetch anything on invalid target or missing initial budget', async () => {
    const urls: string[] = [];
    const common = {
      manifestLocator,
      selectedRenditionUri: renditionUri,
      port: fixture(urls),
    };
    const wrongTarget = await acquireSelectedHlsManifests({
      ...common,
      logicalTargetId: unwrapOrThrow(makeLogicalTargetId('other-target-001')),
      ledger: budget(1000),
    });
    const noBudget = await acquireSelectedHlsManifests({
      ...common,
      logicalTargetId: target,
      ledger: budget(8),
    });
    expect(wrongTarget.ok).toBe(false);
    expect(noBudget.ok).toBe(false);
    expect(urls).toEqual([]);
  });

  it('reports the second HTTP failure, never produces a complete plan', async () => {
    const urls: string[] = [];
    const result = await acquireSelectedHlsManifests({
      logicalTargetId: target,
      manifestLocator,
      selectedRenditionUri: renditionUri,
      ledger: budget(1000),
      port: fixture(urls, { failMedia: true }),
    });
    expect(result.ok).toBe(false);
    expect(urls).toEqual([masterUri, renditionUri]);
  });
});
