/**
 * T009 TEST_MATRIX suite `segment-media-validation` (assembly/probe
 * acceptance rules) and counterexample oracles C09 (advertised-vs-actual
 * rendition), C18 (count equality is not identity), C22 (insufficient
 * evidence), C26 (selection proves selection only) and C27 (confirmation
 * cannot waive validation; truncated assembly forbids acceptance).
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidatesRequiredLayer,
  decodeEvidenceRecord,
  evidenceRecord,
  makeEvidenceId,
  unwrapOrThrow,
  whatConfirmationProves,
} from '@xdownload/domain-contracts';
import {
  createSyntheticMediaAssemblyPort,
  createSyntheticSegmentBytes,
  createEvidencelessMediaAssemblyPort,
  type MediaAssemblyPort,
} from '../src/assemble.ts';
import { executeHlsVodAcquisition } from '../src/pipeline.ts';
import { runHlsValidationChain } from '../src/validate.ts';
import {
  RECORDED_AT,
  bindingFixture,
  contractId,
  decodeMediaFixture,
  ledgerFixture,
  mediaPlaylistLocatorFixture,
  planFixture,
  recordingFetcher,
} from './fixtures.ts';

function pipelineInput(overrides?: {
  readonly fetcher?: ReturnType<typeof recordingFetcher>;
  readonly assemblyPort?: MediaAssemblyPort;
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
    assemblyPort: overrides?.assemblyPort ?? createSyntheticMediaAssemblyPort(),
    recordedAt: RECORDED_AT,
  };
}

describe('segment-media-validation: accepted artifacts require validation', () => {
  it('assembled final media passes format/media validation through the assembly port before acceptance', () => {
    const outcome = executeHlsVodAcquisition(pipelineInput());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.kind).toBe('COMPLETED');
    expect(outcome.value.chain?.accepted).toBe(true);
    expect(outcome.value.chain?.format.status).toBe('PASSED');
    expect(outcome.value.chain?.media.status).toBe('PASSED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('COMPLETE');
    expect(outcome.value.terminal.requestFulfillment).toBe('COMPLETE');
    expect(outcome.value.terminal.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 4,
      failedCount: 0,
    });
  });

  it('segment-count equality alone never establishes validity: equal-count identity substitution is rejected', () => {
    const port = createSyntheticMediaAssemblyPort();
    const plan = planFixture();
    const validBytes = createSyntheticSegmentBytes({ durationSeconds: 4 });
    // Same COUNT as the plan, but position 1 carries a different segment identity.
    const substituted = [
      { entry: plan.entries[0]!, bytes: validBytes },
      {
        entry: { ...plan.entries[1]!, identity: `${plan.entries[1]!.identity}-substituted` },
        bytes: validBytes,
      },
      { entry: plan.entries[2]!, bytes: createSyntheticSegmentBytes({ durationSeconds: 3.5 }) },
    ];
    const probe = port.assembleAndProbe({
      binding: bindingFixture(),
      plan,
      transferred: substituted,
    });
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.value.kind !== 'EVIDENCE') {
      return;
    }
    expect(probe.value.report.observedIdentitySetMatchesPlan).toBe(false);
    expect(probe.value.report.checks).toContain('IDENTITY_MISMATCH');
    const chain = runHlsValidationChain({
      binding: bindingFixture(),
      plan,
      run: {
        kind: 'hls-segment-acquisition-run',
        plan,
        outcomes: [],
        transferred: [],
        failed: [],
        stop: { kind: 'ALL_SEGMENTS_TRANSFERRED' },
      },
      probe: probe.value,
      probeToolId: port.toolId,
    });
    expect(chain.accepted).toBe(false);
    expect(chain.media.status).toBe('FAILED');
  });

  it('wrong-content-same-length segments fail media validation despite equal counts', () => {
    // Position 1 returns bytes whose embedded duration belongs to another chapter.
    const fetcher = recordingFetcher({
      1: { ok: true, bytes: createSyntheticSegmentBytes({ durationSeconds: 2 }) },
    });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.run?.transferred).toHaveLength(3);
    expect(outcome.value.kind).toBe('FAILED');
    expect(outcome.value.chain?.media.status).toBe('FAILED');
    expect(outcome.value.chain?.media.detail).toContain('SEGMENT_CORRUPT_OR_TRUNCATED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
  });

  it('truncated assembled bytes forbid acceptance (C27 transfer side)', () => {
    const fetcher = recordingFetcher({
      2: {
        ok: true,
        bytes: createSyntheticSegmentBytes({ durationSeconds: 3.5, declaredLength: 4 }),
      },
    });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Duration header cannot even be read from 4 bytes; probe marks it invalid.
    expect(outcome.value.chain?.media.status).toBe('FAILED');
    expect(outcome.value.chain?.accepted).toBe(false);
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
  });
});

describe('C22: insufficient evidence stays insufficient', () => {
  it('a probe without evidence can never be converted into PASS', () => {
    const port = createEvidencelessMediaAssemblyPort(
      'broken-tool/1',
      'tool could not analyze input',
    );
    const outcome = executeHlsVodAcquisition(pipelineInput({ assemblyPort: port }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.kind).toBe('FAILED');
    expect(outcome.value.chain?.outcomeClass).toBe('INSUFFICIENT_EVIDENCE');
    expect(outcome.value.chain?.format.status).toBe('NOT_PERFORMED');
    expect(outcome.value.chain?.media.status).toBe('NOT_PERFORMED');
    expect(outcome.value.terminal.validationSummary.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
  });
});

describe('C26/C27: confirmation proves selection only and cannot waive validation', () => {
  it('user confirmation evidence cannot satisfy the media validation layer', () => {
    const confirmation = evidenceRecord({
      evidenceId: unwrapOrThrow(makeEvidenceId('ev:user-confirmation-1')),
      claimType: 'SELECTION',
      claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-hls-vod-1' },
      sourceType: 'USER_CONFIRMATION',
      provenance: { sourceIdentity: 'user-click' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
      certaintyClass: 'DECISIVE',
    });
    const mediaLayer = assertValidatesRequiredLayer(confirmation, 'media');
    expect(mediaLayer.ok).toBe(false);
    if (!mediaLayer.ok) {
      expect(mediaLayer.diagnostics[0]?.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
    }
    const proves = whatConfirmationProves('CONFIRM_QUALITY_CHOICE');
    expect(proves.proves).toBe('SELECTION');
    expect(proves.doesNotProve).toContain('QUALITY');
  });

  it('confirmed candidate with a truncated transfer is still not accepted (C27)', () => {
    const fetcher = recordingFetcher({
      1: {
        ok: true,
        bytes: createSyntheticSegmentBytes({ durationSeconds: 4, declaredLength: 3 }),
      },
    });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Even with a user confirmation in hand, the adapter requires the full
    // validation chain; a truncated acquisition forbids COMPLETE.
    expect(outcome.value.terminal.selectionAcquisition).not.toBe('COMPLETE');
    expect(outcome.value.terminal.validationSummary.status).not.toBe('ALL_PASSED');
  });

  it('accepted media evidence is independent validator evidence, not user confirmation', () => {
    const outcome = executeHlsVodAcquisition(pipelineInput());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const mediaEvidence = outcome.value.chain?.media.evidence;
    expect(mediaEvidence).toBeDefined();
    if (mediaEvidence === undefined) {
      return;
    }
    expect(mediaEvidence.sourceType).toBe('INDEPENDENT_VALIDATOR');
    expect(mediaEvidence.independenceFromDiscovery).toBe('INDEPENDENT');
    expect(mediaEvidence.claimType).toBe('MEDIA');
    expect(decodeEvidenceRecord(mediaEvidence).ok).toBe(true);
  });
});

describe('C09: advertised-vs-actual rendition identity', () => {
  it('actual media identity differing from the declared rendition fails format validation', () => {
    // Master declares CODECS="xdv1-video"; segments actually carry xdv1-audio.
    const audioBytes = (durationSeconds: number) =>
      createSyntheticSegmentBytes({ durationSeconds, codecClass: 'xdv1-audio' });
    const fetcher = recordingFetcher({
      0: { ok: true, bytes: audioBytes(4) },
      1: { ok: true, bytes: audioBytes(4) },
      2: { ok: true, bytes: audioBytes(3.5) },
    });
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.chain?.format.status).toBe('FAILED');
    expect(outcome.value.chain?.format.detail).toContain('DIFFERS_FROM_DECLARED_RENDITION');
    expect(outcome.value.chain?.accepted).toBe(false);
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
    expect(outcome.value.terminal.requestFulfillment).not.toBe('COMPLETE');
  });
});
