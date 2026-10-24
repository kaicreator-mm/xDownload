import { describe, expect, it } from 'vitest';
import {
  COMMAND_TYPES,
  CORE_SEAM_SCHEMA_VERSION,
  createCoreSeamServer,
  decodeSeamEnvelope,
  EXPECTED_PEER,
  OS_VERIFIED_PEER_COMMANDS,
  rawCommand,
  rawSingleResourceContract,
} from './helpers.ts';

const previewPayload = {
  snapshotId: 'snapshot-s4-001',
  memberId: 'member-s4-001',
  manifestUri: 'https://media.example.org/media/playlist.m3u8',
  mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
};

function frame(commandType: string, payload: unknown = previewPayload, version = '1.2.0') {
  const request = rawCommand({
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: 'contract-single-001',
    requestId: 'req-s4-block-001',
    expectedRevision: 0,
    correlation: { contractId: 'contract-single-001', snapshotId: 'snapshot-s4-001' },
    payload,
  });
  return {
    ...request,
    schemaIdentity: { schema: 'xdownload.core-seam', version },
    commandType,
  };
}

describe('#148 closed S4 1.2 wire admission — NO installed S4 authority', () => {
  it('recognizes only the 3 reviewed S4 commands under final 1.2, not v1.0/v1.1 or S3', () => {
    expect(CORE_SEAM_SCHEMA_VERSION).toBe('1.1.0');
    expect(COMMAND_TYPES).not.toContain('EXECUTE_S3_SELECTED_MEDIA');
    for (const name of [
      'PREVIEW_S4_HLS_VOD',
      'CONFIRM_S4_SELECTION',
      'EXECUTE_S4_SELECTED_HLS_VOD',
    ]) {
      expect(OS_VERIFIED_PEER_COMMANDS).toContain(name);
      const payload =
        name === 'PREVIEW_S4_HLS_VOD'
          ? previewPayload
          : name === 'CONFIRM_S4_SELECTION'
            ? {
                phase: 'BEGIN',
                snapshotId: 'snapshot-s4-001',
                memberId: 'member-s4-001',
                previewId: 'preview-s4-001',
                renditionKey: 'video-001',
                displayedTupleDigest: 'a'.repeat(64),
              }
            : {
                snapshotId: 'snapshot-s4-001',
                memberId: 'member-s4-001',
                confirmedSelectionId: 'confirmed-s4-001',
              };
      const decoded = decodeSeamEnvelope(frame(name, payload));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok || decoded.value.kind !== 'command') continue;
      expect(decoded.value.commandType).toBe(name);
      expect(Object.isFrozen(decoded.value.payload)).toBe(true);
      for (const version of ['1.0.0', '1.1.0', '1.2.0-beta.1']) {
        const old = decodeSeamEnvelope(frame(name, payload, version));
        expect(old.ok).toBe(false);
        if (!old.ok)
          expect(old.diagnostics.some((d) => ['UNSUPPORTED_ENVELOPE_VERSION', 'ENVELOPE_MALFORMED'].includes(d.code))).toBe(true);
      }
    }
    const unapproved = decodeSeamEnvelope(frame('EXECUTE_S3_SELECTED_MEDIA', {}));
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.diagnostics[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
  });

  it('refuses extra/forged S4 authority fields and wrong manifest URI at decode', () => {
    for (const candidate of [
      { ...previewPayload, autoConfirm: true },
      { ...previewPayload, manifestUri: 'http://127.0.0.1/private.m3u8' },
      { ...previewPayload, manifestUri: 'https://media.example.org/playlist.m3u8?sig=secret' },
    ]) {
      const decoded = decodeSeamEnvelope(frame('PREVIEW_S4_HLS_VOD', candidate));
      expect(decoded.ok).toBe(false);
      if (!decoded.ok)
        expect(decoded.diagnostics.some((d) => d.code === 'ENVELOPE_MALFORMED')).toBe(true);
    }
  });

  it('refuses BEFORE any legacy idempotent replay or journal/authority state effect', () => {
    const created = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const server = created.value;
    const old = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      requestId: 'req-s4-block-001',
      payload: rawSingleResourceContract(),
    });
    const accepted = server.handleFrame(JSON.stringify(old));
    expect(accepted.outcome).toBe('ACCEPTED');
    expect(server.acceptedCommandCount).toBe(1);
    for (const name of [
      'PREVIEW_S4_HLS_VOD',
      'CONFIRM_S4_SELECTION',
      'EXECUTE_S4_SELECTED_HLS_VOD',
    ]) {
      const payload =
        name === 'PREVIEW_S4_HLS_VOD'
          ? previewPayload
          : name === 'CONFIRM_S4_SELECTION'
            ? {
                phase: 'BEGIN',
                snapshotId: 'snapshot-s4-001',
                memberId: 'member-s4-001',
                previewId: 'preview-s4-001',
                renditionKey: 'video-001',
                displayedTupleDigest: 'a'.repeat(64),
              }
            : {
                snapshotId: 'snapshot-s4-001',
                memberId: 'member-s4-001',
                confirmedSelectionId: 'confirmed-s4-001',
              };
      const result = server.handleFrame(JSON.stringify(frame(name, payload)));
      expect(result.outcome).toBe('REJECTED');
      expect(result.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
      expect(server.acceptedCommandCount).toBe(1);
    }
  });

  it('does not accept syntactically valid S4 on a fresh server with a claimed CLI peer', () => {
    const created = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const s = created.value;
    const result = s.handleFrame(JSON.stringify(frame('PREVIEW_S4_HLS_VOD')));
    expect(result.outcome).toBe('REJECTED');
    expect(result.diagnostics?.some((d) => d.code === 'TRANSPORT_UNAUTHORIZED')).toBe(true);
    expect(s.acceptedCommandCount).toBe(0);
  });
});
