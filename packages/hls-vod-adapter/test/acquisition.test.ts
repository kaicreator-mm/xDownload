/**
 * T009 TEST_MATRIX suite `missing-segment`: a missing/failed segment yields a
 * truthful typed failure on the same effect lineage (never partial
 * acceptance), retry operates only on the frozen binding/segment plan and
 * inherits remaining budget, and a failed segment set is never normalized
 * into a completed/valid media claim.
 */

import { describe, expect, it } from 'vitest';
import { executeHlsVodAcquisition } from '../src/pipeline.ts';
import { resumeAcquisition } from '../src/acquire.ts';
import { createSyntheticSegmentBytes } from '../src/assemble.ts';
import {
  RECORDED_AT,
  bindingFixture,
  contractId,
  decodeMediaFixture,
  ledgerFixture,
  mediaPlaylistLocatorFixture,
  recordingFetcher,
} from './fixtures.ts';

function pipelineInput(overrides?: {
  readonly fetcher?: ReturnType<typeof recordingFetcher>;
  readonly mediaPlaylist?: ReturnType<typeof decodeMediaFixture>;
}) {
  return {
    contractId: contractId(),
    snapshotId: undefined,
    binding: bindingFixture(),
    master: undefined,
    mediaPlaylist: overrides?.mediaPlaylist ?? decodeMediaFixture(),
    mediaPlaylistLocator: mediaPlaylistLocatorFixture(),
    ledger: ledgerFixture(),
    fetcher: overrides?.fetcher ?? recordingFetcher(),
    assemblyPort: {
      toolId: 'must-not-run-on-failure',
      assembleAndProbe: () => {
        throw new Error('probe must not run when acquisition is incomplete');
      },
    },
    recordedAt: RECORDED_AT,
  };
}

describe('missing-segment', () => {
  it.each([
    ['MISSING', { ok: false, failure: 'MISSING', detail: '404' } as const],
    ['UNREACHABLE', { ok: false, failure: 'UNREACHABLE', detail: 'timeout' } as const],
    ['FAILED', { ok: false, failure: 'FAILED', detail: 'checksum' } as const],
  ])('a %s segment produces a truthful typed failure, not partial acceptance', (_kind, failure) => {
    const fetcher = recordingFetcher({ 1: failure });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.kind).toBe('FAILED');
    expect(outcome.value.run?.stop.kind).toBe('SEGMENT_FAILURE');
    expect(outcome.value.run?.failed).toHaveLength(1);
    expect(outcome.value.run?.failed[0]?.result).toEqual(failure);
    expect(outcome.value.terminal.stopReason).toBe('VALIDATION_FAILED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
    expect(outcome.value.terminal.requestFulfillment).toBe('PARTIAL');
    expect(outcome.value.terminal.validationSummary.status).toBe('FAILED');
    expect(outcome.value.chain?.accepted).toBe(false);
    expect(outcome.value.chain?.media.status).toBe('NOT_PERFORMED');
    expect(outcome.value.chain?.transfer.detail).toContain('SEGMENT_FAILURE');
  });

  it('truncation is detected against the declared byterange independently of fetcher honesty', () => {
    const media = decodeMediaFixture({ withByterange: true });
    const fetcher = recordingFetcher({
      // Fetcher claims success but returns fewer bytes than declared.
      1: {
        ok: true,
        bytes: createSyntheticSegmentBytes({ durationSeconds: 4, declaredLength: 16 }),
      },
    });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher, mediaPlaylist: media }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.run?.stop.kind).toBe('SEGMENT_FAILURE');
    const failedResult = outcome.value.run?.failed[0]?.result;
    expect(failedResult?.ok).toBe(false);
    if (failedResult !== undefined && !failedResult.ok) {
      expect(failedResult.failure).toBe('TRUNCATED');
    }
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
  });

  it('acquisition stops at the first failed segment and never requests later segments', () => {
    const fetcher = recordingFetcher({ 0: { ok: false, failure: 'MISSING', detail: 'gone' } });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.run?.outcomes).toHaveLength(1);
    expect(outcome.value.run?.stop).toEqual({
      kind: 'SEGMENT_FAILURE',
      position: 0,
      failure: 'MISSING',
    });
  });

  it('retry operates only on the frozen plan and preserves already-transferred lineage', () => {
    const failing = recordingFetcher({ 1: { ok: false, failure: 'MISSING', detail: 'gone' } });
    const first = executeHlsVodAcquisition(pipelineInput({ fetcher: failing }));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const run = first.value.run;
    expect(run?.stop.kind).toBe('SEGMENT_FAILURE');
    const transferredIdentities = (run?.transferred ?? []).map((outcome) => outcome.entry.identity);
    expect(transferredIdentities).toHaveLength(1);

    const recovered = recordingFetcher();
    const resumed = resumeAcquisition(run!, ledgerFixture(), recovered);
    expect(resumed.stop.kind).toBe('ALL_SEGMENTS_TRANSFERRED');
    // Same plan identities; earlier transferred outcomes preserved.
    expect(resumed.transferred.map((outcome) => outcome.entry.identity).slice(0, 1)).toEqual(
      transferredIdentities,
    );
    expect(resumed.transferred).toHaveLength(3);
    expect(resumed.plan).toBe(run?.plan);
  });

  it('no normalization: a failed segment run can never project an accepted media claim', () => {
    const outcome = executeHlsVodAcquisition(
      pipelineInput({
        fetcher: recordingFetcher({ 2: { ok: false, failure: 'FAILED', detail: 'x' } }),
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.chain?.accepted).toBe(false);
    expect(outcome.value.terminal.selectionAcquisition).not.toBe('COMPLETE');
    expect(outcome.value.terminal.requestFulfillment).not.toBe('COMPLETE');
    expect(outcome.value.terminal.validationSummary.status).not.toBe('ALL_PASSED');
    expect(outcome.value.plan?.entries).toHaveLength(3);
  });
});
