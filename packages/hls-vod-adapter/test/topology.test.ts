/**
 * T009 TEST_MATRIX suite `unsupported-topology` and counterexample C15:
 * encrypted/keyed segments, DRM markers, separate A/V track topology and
 * other unsupported topologies are detected and rejected BEFORE generic
 * transfer is attempted, surface as truthful UNSUPPORTED/FAILED in the
 * canonical result vocabulary, and never fall back to an opaque byte path.
 */

import { describe, expect, it } from 'vitest';
import { classifyTopology } from '../src/topology.ts';
import { executeHlsVodAcquisition } from '../src/pipeline.ts';
import {
  RECORDED_AT,
  bindingFixture,
  contractId,
  decodeMasterFixture,
  decodeMediaFixture,
  ledgerFixture,
  masterWithMediaRenditionsText,
  mediaPlaylistLocatorFixture,
  recordingFetcher,
} from './fixtures.ts';
import { decodeMasterPlaylist, type MasterPlaylist } from '../src/playlist.ts';

function pipelineInput(overrides?: {
  readonly master?: MasterPlaylist;
  readonly mediaPlaylist?: ReturnType<typeof decodeMediaFixture>;
  readonly fetcher?: ReturnType<typeof recordingFetcher>;
}) {
  const master = overrides?.master ?? undefined;
  if (overrides?.master === undefined) {
    const decoded = decodeMasterFixture();
    if (decoded.ok) {
      return buildInput(decoded.value, overrides?.mediaPlaylist, overrides?.fetcher);
    }
    return buildInput(undefined, overrides?.mediaPlaylist, overrides?.fetcher);
  }
  return buildInput(master, overrides?.mediaPlaylist, overrides?.fetcher);
}

function buildInput(
  master: MasterPlaylist | undefined,
  mediaPlaylist?: ReturnType<typeof decodeMediaFixture>,
  fetcher?: ReturnType<typeof recordingFetcher>,
) {
  return {
    contractId: contractId(),
    snapshotId: undefined,
    binding: bindingFixture(),
    master,
    mediaPlaylist: mediaPlaylist ?? decodeMediaFixture(),
    mediaPlaylistLocator: mediaPlaylistLocatorFixture(),
    ledger: ledgerFixture(),
    fetcher: fetcher ?? recordingFetcher(),
    assemblyPort: {
      toolId: 'must-never-run-for-unsupported-topology',
      assembleAndProbe: () => {
        throw new Error('probe must never run for unsupported topology');
      },
    },
    recordedAt: RECORDED_AT,
  };
}

describe('unsupported-topology: classification', () => {
  it('supported basic VOD topology classifies as supported', () => {
    const classification = classifyTopology(undefined, decodeMediaFixture());
    expect(classification).toEqual({ supported: true });
  });

  it.each([['AES-128', 'ENCRYPTED_SEGMENTS'] as const, ['SAMPLE-AES', 'DRM_MARKER'] as const])(
    '%s key topology is rejected before transfer (fail closed)',
    (method, expectedReason) => {
      const media = decodeMediaFixture({ keyMethod: method });
      const classification = classifyTopology(undefined, media);
      expect(classification.supported).toBe(false);
      if (classification.supported) {
        return;
      }
      expect(classification.reason).toBe(expectedReason);
      expect(classification.detail).toMatch(/fail closed|never attempts decryption/);
    },
  );

  it('EXT-X-MAP initialization-section topology is unsupported', () => {
    const classification = classifyTopology(undefined, decodeMediaFixture({ withMap: true }));
    expect(classification).toMatchObject({
      supported: false,
      reason: 'INITIALIZATION_SECTION_TOPOLOGY',
    });
  });

  it('discontinuity (ad-splice) topology is unsupported', () => {
    const classification = classifyTopology(
      undefined,
      decodeMediaFixture({ withDiscontinuity: true }),
    );
    expect(classification).toMatchObject({ supported: false, reason: 'DISCONTINUITY_AD_SPLICE' });
  });

  it('separate rendition tracks (EXT-X-MEDIA) in the master are unsupported', () => {
    const master = decodeMasterPlaylist(
      masterWithMediaRenditionsText(),
      'https://cdn.example.com/vod/master.m3u8',
    );
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    const classification = classifyTopology(master.value, decodeMediaFixture());
    expect(classification).toMatchObject({ supported: false, reason: 'SEPARATE_RENDITION_TRACKS' });
  });

  it('EVENT playlist type and unclosed playlists are unsupported (no complete-VOD promise)', () => {
    expect(
      classifyTopology(undefined, decodeMediaFixture({ playlistType: 'EVENT' })),
    ).toMatchObject({
      supported: false,
      reason: 'EVENT_PLAYLIST_TYPE',
    });
    expect(classifyTopology(undefined, decodeMediaFixture({ closed: false }))).toMatchObject({
      supported: false,
      reason: 'UNCLOSED_PLAYLIST',
    });
  });
});

describe('unsupported-topology: pipeline fail-closed behavior', () => {
  it('encrypted topology is rejected BEFORE any segment transfer is attempted', () => {
    const fetcher = recordingFetcher();
    const outcome = executeHlsVodAcquisition(
      pipelineInput({ mediaPlaylist: decodeMediaFixture({ keyMethod: 'AES-128' }), fetcher }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Gate ran before transfer: zero fetcher calls, no plan, no run.
    expect(fetcher.calls).toHaveLength(0);
    expect(outcome.value.plan).toBeUndefined();
    expect(outcome.value.run).toBeUndefined();
    expect(outcome.value.kind).toBe('UNSUPPORTED');
    expect(outcome.value.unsupportedReason).toBe('ENCRYPTED_SEGMENTS');
    expect(outcome.value.chain).toBeUndefined();
  });

  it('rejection surfaces as truthful UNSUPPORTED/FAILED in the canonical result vocabulary', () => {
    const outcome = executeHlsVodAcquisition(
      pipelineInput({ mediaPlaylist: decodeMediaFixture({ keyMethod: 'SAMPLE-AES' }) }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.terminal.stopReason).toBe('UNSUPPORTED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
    expect(outcome.value.terminal.requestFulfillment).toBe('UNSATISFIED');
    expect(outcome.value.terminal.validationSummary.status).toBe('NOT_PERFORMED');
    expect(outcome.value.terminal.requestFulfillment).not.toBe('COMPLETE');
  });

  it('C15: separate A/V requiring mux never produces a silent video-only success', () => {
    const master = decodeMasterPlaylist(
      masterWithMediaRenditionsText(),
      'https://cdn.example.com/vod/master.m3u8',
    );
    expect(master.ok).toBe(true);
    if (!master.ok) {
      return;
    }
    const fetcher = recordingFetcher();
    const outcome = executeHlsVodAcquisition(pipelineInput({ master: master.value, fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(fetcher.calls).toHaveLength(0);
    expect(outcome.value.kind).toBe('UNSUPPORTED');
    expect(outcome.value.unsupportedReason).toBe('SEPARATE_RENDITION_TRACKS');
    expect(outcome.value.terminal.stopReason).toBe('UNSUPPORTED');
    expect(outcome.value.evidence).toHaveLength(0);
  });

  it('unsupported topology never falls back to an opaque byte path (no transfer, no bytes claimed)', () => {
    const fetcher = recordingFetcher();
    const outcome = executeHlsVodAcquisition(
      pipelineInput({ mediaPlaylist: decodeMediaFixture({ withDiscontinuity: true }), fetcher }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(fetcher.calls).toHaveLength(0);
    expect(outcome.value.run).toBeUndefined();
    expect(outcome.value.terminal.stopReason).toBe('UNSUPPORTED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
    expect(outcome.value.terminal.coverage).toBe('NOT_APPLICABLE');
  });
});
