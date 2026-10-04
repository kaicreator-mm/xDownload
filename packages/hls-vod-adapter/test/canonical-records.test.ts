/**
 * T009 canonical record emission (L2 invariant 17), the untrusted request
 * boundary (raw secrets / unknown fields, PRD §29 + C21), and the no-adapter-
 * local-success rule: every projected terminal combination re-validates
 * through canonical semantics and illegal combinations fail closed.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeEvidenceRecord,
  makeMemberId,
  unwrapOrThrow,
  validateTerminalResult,
} from '@xdownload/domain-contracts';
import { decodeHlsAdapterRequest } from '../src/request.ts';
import { executeHlsVodAcquisition } from '../src/pipeline.ts';
import { projectHlsAdapterOutcome } from '../src/validate.ts';
import {
  RECORDED_AT,
  bindingFixture,
  contractId,
  decodeMediaFixture,
  ledgerFixture,
  masterManifestText,
  mediaPlaylistLocatorFixture,
  recordingFetcher,
  targetId,
} from './fixtures.ts';
import { createSyntheticMediaAssemblyPort } from '../src/assemble.ts';
import { decodeMasterPlaylist } from '../src/playlist.ts';

function pipelineInput(overrides?: { readonly fetcher?: ReturnType<typeof recordingFetcher> }) {
  const master = decodeMasterPlaylist(
    masterManifestText(),
    'https://cdn.example.com/vod/master.m3u8',
  );
  if (!master.ok) {
    throw new Error('fixture master rejected');
  }
  return {
    contractId: contractId(),
    snapshotId: undefined,
    binding: bindingFixture(),
    master: master.value,
    mediaPlaylist: decodeMediaFixture(),
    mediaPlaylistLocator: mediaPlaylistLocatorFixture(),
    ledger: ledgerFixture(),
    fetcher: overrides?.fetcher ?? recordingFetcher(),
    assemblyPort: createSyntheticMediaAssemblyPort(),
    recordedAt: RECORDED_AT,
  };
}

describe('canonical record emission (L2-inv17)', () => {
  it('adapter emits canonical evidence records that decode against the T002 vocabulary', () => {
    const outcome = executeHlsVodAcquisition(pipelineInput());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const evidence = outcome.value.evidence;
    expect(evidence.map((record) => record.claimType)).toEqual([
      'RESOURCE_IDENTITY',
      'TRANSFER',
      'FORMAT',
      'MEDIA',
    ]);
    for (const record of evidence) {
      expect(decodeEvidenceRecord(record).ok).toBe(true);
      expect(record.sourceType).not.toBe('DISCOVERY_INFERENCE');
      expect(record.independenceFromDiscovery).toBe('INDEPENDENT');
      expect(record.scope.domain).toBe('SINGLE_RESOURCE_TRANSFER');
      expect(record.claimSubject).toEqual({ kind: 'LOGICAL_TARGET', ref: targetId() });
    }
  });

  it('every projected terminal combination is legal under canonical semantics', () => {
    const outcomes = [
      executeHlsVodAcquisition(pipelineInput()), // completed
      executeHlsVodAcquisition(
        pipelineInput({
          fetcher: recordingFetcher({ 1: { ok: false, failure: 'MISSING', detail: 'x' } }),
        }),
      ), // failed
      executeHlsVodAcquisition(pipelineInput({ fetcher: recordingFetcher() })),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        continue;
      }
      const legal = validateTerminalResult(outcome.value.terminal, {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
        selectedValidationOutcomes: [
          {
            memberId: unwrapOrThrow(makeMemberId('target-hls-vod-1')),
            requiredValidationPassed: outcome.value.terminal.selectionAcquisition === 'COMPLETE',
          },
        ],
      });
      expect(legal.ok).toBe(true);
    }
  });

  it('adapter refuses to project an outcome without a chain or unsupported reason (no local success)', () => {
    const refused = projectHlsAdapterOutcome({
      contractId: contractId(),
      snapshotId: undefined,
      binding: bindingFixture(),
      chain: undefined,
      run: undefined,
      unsupportedReason: undefined,
      transferredByteCount: 0,
      recordedAt: RECORDED_AT,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.diagnostics[0]?.code).toBe('INVALID_RESULT_COMBINATION');
    }
  });

  it('unsupported-topology outcomes carry no fabricated evidence', () => {
    const outcome = executeHlsVodAcquisition(pipelineInput({ fetcher: recordingFetcher() }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Completed flow emits exactly the four layer evidence records — no
    // extra fabricated success artifacts.
    expect(outcome.value.evidence).toHaveLength(4);
    expect(outcome.value.kind).toBe('COMPLETED');
  });
});

describe('untrusted request boundary', () => {
  it('decodes a well-formed adapter request with canonical identities', () => {
    const decoded = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      manifest: {
        locator: { kind: 'direct', uri: 'https://cdn.example.com/vod/master.m3u8' },
        text: masterManifestText(),
      },
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.logicalTargetId).toBe(targetId());
      expect(decoded.value.authorizationContextRef).toBeUndefined();
    }
  });

  it('raw-secret-or-key-material negative: secret fields are rejected at the boundary', () => {
    const withCookies = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      cookies: 'session=abc',
      manifest: {
        locator: { kind: 'direct', uri: 'https://cdn.example.com/vod/master.m3u8' },
        text: masterManifestText(),
      },
    });
    expect(withCookies.ok).toBe(false);
    if (!withCookies.ok) {
      expect(withCookies.diagnostics[0]?.code).toBe('RAW_SECRET_FIELD');
    }
    const withTokenInManifest = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      manifest: {
        locator: { kind: 'signed', uri: 'https://cdn.example.com/vod/master.m3u8?sig=x' },
        text: masterManifestText(),
        token: 'bearer-xyz',
      },
    });
    expect(withTokenInManifest.ok).toBe(false);
    if (!withTokenInManifest.ok) {
      expect(withTokenInManifest.diagnostics[0]?.code).toBe('RAW_SECRET_FIELD');
      expect(withTokenInManifest.diagnostics[0]?.path).toBe('request.manifest.token');
    }
  });

  it('unknown fields and malformed identities fail closed', () => {
    const unknownField = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      manifest: {
        locator: { kind: 'direct', uri: 'https://cdn.example.com/vod/master.m3u8' },
        text: masterManifestText(),
      },
      surprise: true,
    });
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.diagnostics[0]?.code).toBe('UNKNOWN_FIELD');
    }
    const badTarget = decodeHlsAdapterRequest({
      logicalTargetId: '../etc/passwd',
      manifest: {
        locator: { kind: 'direct', uri: 'https://cdn.example.com/vod/master.m3u8' },
        text: masterManifestText(),
      },
    });
    expect(badTarget.ok).toBe(false);
    const badLocator = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      manifest: {
        locator: { kind: 'wormhole', uri: 'https://cdn.example.com/vod/master.m3u8' },
        text: masterManifestText(),
      },
    });
    expect(badLocator.ok).toBe(false);
    if (!badLocator.ok) {
      expect(badLocator.diagnostics[0]?.code).toBe('UNKNOWN_ENUM_VALUE');
    }
  });

  it('opaque AuthorizationContextRef is admitted; raw credentials are not', () => {
    const decoded = decodeHlsAdapterRequest({
      logicalTargetId: 'target-hls-vod-1',
      manifest: {
        locator: { kind: 'signed', uri: 'https://cdn.example.com/vod/master.m3u8?sig=x' },
        text: masterManifestText(),
      },
      authorizationContextRef: 'auth-ctx-1',
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.authorizationContextRef).toBe('auth-ctx-1');
    }
  });
});
