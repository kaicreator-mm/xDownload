/**
 * V022 A01 focused-test fixtures. Builders return RAW plain objects so every
 * test exercises the untrusted-input decode path (unknown -> canonical
 * value), never already-typed construction.
 */

export const DIGEST_A = 'a'.repeat(64);
export const DIGEST_B = 'b'.repeat(64);

/** A minimal valid direct Host request (raw plain object). */
export function rawDirectRequest(): Record<string, unknown> {
  return {
    requestId: 'req-001',
    lineageId: 'lin-001',
    targetRef: 'target-001',
    outputRootScope: '/var/out/root',
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    caller: { actor: 'local-agent', sessionRef: 'session-001' },
  };
}

/** Deterministic clock anchor for S4 freshness tests (2026-11-03T00:00:00Z). */
export const S4_NOW = Date.parse('2026-11-03T00:00:00.000Z');

/** A minimal valid S4/media Host request (raw plain object). */
export function rawS4Request(): Record<string, unknown> {
  return {
    requestId: 'req-001',
    lineageId: 'lin-001',
    contractId: 'contract-001',
    targetRef: 'target-001',
    outputRootScope: '/var/out/root',
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'sel-001',
      previewId: 'prev-001',
      snapshotId: 'snap-001',
      memberId: 'member-001',
      manifestUri: 'https://media.example/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
      renditionKey: 'rend-0',
      renditionUri: 'https://media.example/rend-0.m3u8',
      displayedTupleDigest: DIGEST_A,
      confirmedAt: '2026-11-02T00:00:00.000Z',
      expiresAt: '2026-11-04T00:00:00.000Z',
    },
    caller: { actor: 'local-agent', sessionRef: 'session-001' },
  };
}
