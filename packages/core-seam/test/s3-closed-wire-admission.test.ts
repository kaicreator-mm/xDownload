import { describe, expect, it } from 'vitest';
import {
  COMMAND_TYPES,
  CORE_SEAM_SCHEMA_VERSION,
  createCoreSeamServer,
  decodeS3Seam12Payload,
  decodeSeamEnvelope,
  EXPECTED_PEER,
  OS_VERIFIED_PEER_COMMANDS,
  rawCommand,
  rawSingleResourceContract,
} from './helpers.ts';

const candidate = {
  snapshotId: 'snapshot-001',
  memberId: 'member-clip-001',
  variantKey: 'video-1080p',
  locatorUri: 'https://media.example.org/media/clip01.mp4',
  declaredRedirectHosts: ['media.example.org', 'cdn.example.org'],
  mediaProfileId: 'S3_SUPPORTED_MP4_V1',
  selectionAttestation: {
    kind: 'EXPLICIT_CLI_GESTURE',
    interactionId: 'interaction-001',
    displayTupleDigest: 'a'.repeat(64),
    confirmedAt: '2026-10-24T14:00:00Z',
    expectedRevision: 3,
  },
};
const execute = { snapshotId: 'snapshot-001', memberId: 'member-clip-001' };

function frame(commandType: string, payload: unknown, version = '1.2.0') {
  const old = rawCommand({
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: 'contract-single-001',
    requestId: 'req-s3-wire-001',
    expectedRevision: 3,
    correlation: { contractId: 'contract-single-001', snapshotId: 'snapshot-001' },
    payload,
  });
  return {
    ...old,
    schemaIdentity: { schema: 'xdownload.core-seam', version },
    commandType,
  };
}

describe('#150 adopted S3 1.2 two-command syntax, no installed S3 authority', () => {
  it('accepts only syntax of two exact 1.2 commands and keeps advertised Core seam 1.1', () => {
    expect(CORE_SEAM_SCHEMA_VERSION).toBe('1.1.0');
    expect(COMMAND_TYPES).not.toContain('CONFIRM_S3_CANDIDATE');
    expect(COMMAND_TYPES).not.toContain('EXECUTE_S3_SELECTED_MEDIA');
    for (const [commandType, payload] of [
      ['CONFIRM_S3_CANDIDATE', candidate],
      ['EXECUTE_S3_SELECTED_MEDIA', execute],
    ] as const) {
      expect(OS_VERIFIED_PEER_COMMANDS).toContain(commandType);
      const decoded = decodeSeamEnvelope(frame(commandType, payload));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok || decoded.value.kind !== 'command') continue;
      expect(decoded.value.commandType).toBe(commandType);
      expect(Object.isFrozen(decoded.value.payload)).toBe(true);
      for (const version of ['1.0.0', '1.1.0', '1.2.0-beta.1', '2.0.0']) {
        const old = decodeSeamEnvelope(frame(commandType, payload, version));
        expect(old.ok).toBe(false);
        if (!old.ok)
          expect(
            old.diagnostics.some((d) =>
              ['UNSUPPORTED_ENVELOPE_VERSION', 'ENVELOPE_MALFORMED'].includes(d.code),
            ),
          ).toBe(true);
      }
    }
  });

  it('rejects unknown, extra effect and privileged fields, unsupported URL, spoofed fields', () => {
    const wrong = [
      { ...candidate, status: 'COMPLETE' },
      { ...candidate, execute: true },
      { ...candidate, locatorUri: 'http://127.0.0.1/media/clip01.mp4' },
      { ...candidate, locatorUri: 'https://media.example.org/clip01.mp4' },
      { ...candidate, locatorUri: 'https://media.example.org/media/clip01.mp4?token=secret' },
      { ...candidate, locatorUri: '***media.example.org/media/clip01.mp4' },
      { ...candidate, locatorUri: 'https://media.example.org/media/%63lip.mp4' },
      { ...candidate, locatorUri: 'https://media.example.org/media/clip01.mp4#frag' },
      { ...candidate, declaredRedirectHosts: ['media.example.org', 'media.example.org'] },
      { ...candidate, declaredRedirectHosts: ['*.example.org'] },
      { ...candidate, mediaProfileId: '' },
      { ...candidate, byteConstraintSha256: 'bad' },
      { ...candidate, expectedContentTypePrefix: 'text/html' },
      {
        ...candidate,
        selectionAttestation: { ...candidate.selectionAttestation, coreApproved: true },
      },
      {
        ...candidate,
        selectionAttestation: { ...candidate.selectionAttestation, interactionId: '' },
      },
    ];
    for (const payload of wrong) {
      const decoded = decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', payload);
      expect(decoded.ok).toBe(false);
      if (!decoded.ok) expect(decoded.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    }
    for (const extra of [
      { ...execute, locatorUri: candidate.locatorUri },
      { ...execute, artifactId: 'artifact:forged' },
      { ...execute, expectedSha256: 'a'.repeat(64) },
      { ...execute, mediaPolicy: { signatures: [] } },
    ]) {
      expect(decodeSeamEnvelope(frame('EXECUTE_S3_SELECTED_MEDIA', extra)).ok).toBe(false);
    }
    expect(decodeSeamEnvelope(frame('EXECUTE_UNKNOWN_S3', execute)).ok).toBe(false);
  });

  it('takes immutable defensive copies, rejects accessors and never trusts self-attestation', () => {
    const input = { ...candidate, declaredRedirectHosts: [...candidate.declaredRedirectHosts] };
    const decoded = decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', input);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.value.commandType !== 'CONFIRM_S3_CANDIDATE') return;
    input.declaredRedirectHosts.push('other.example.org');
    expect(decoded.value.payload.declaredRedirectHosts).toHaveLength(2);
    expect(Object.isFrozen(decoded.value.payload.declaredRedirectHosts)).toBe(true);
    expect(Object.isFrozen(decoded.value.payload.selectionAttestation)).toBe(true);
    const hostile = {
      ...candidate,
      get selectionAttestation(): never {
        throw Error('getter');
      },
    };
    expect(decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', hostile).ok).toBe(false);
    expect(decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', new Date()).ok).toBe(false);
  });

  it('blocks the reviewed changing-getter redirect host counterexample, never copying unchecked IP', () => {
    const changing: string[] = ['media.example.org'];
    let reads = 0;
    Object.defineProperty(changing, '0', {
      enumerable: true,
      configurable: true,
      get: () => (++reads < 3 ? 'media.example.org' : '127.0.0.1'),
    });
    const result = decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', {
      ...candidate,
      declaredRedirectHosts: changing,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    // The descriptor is rejected before invoking an accessor or before
    // interpreting the public hostname as proof of what was copied.
    expect(reads).toBe(0);
  });

  it('rejects hostile, revoked, sparse and extra-property host arrays with typed refusal', () => {
    const revoked = Proxy.revocable(['media.example.org'], {});
    revoked.revoke();
    const holey = new Array<string>(2);
    holey[0] = 'media.example.org';
    const extra = ['media.example.org'] as string[] & { authority?: string };
    extra.authority = 'private-host';
    const hostile: unknown[] = [
      revoked.proxy,
      holey,
      extra,
      new Proxy(['media.example.org'], {
        getOwnPropertyDescriptor() {
          throw new Error('descriptor trap');
        },
      }),
      new Proxy(['media.example.org'], {
        getPrototypeOf() {
          throw new Error('prototype trap');
        },
      }),
    ];
    for (const hosts of hostile) {
      expect(() =>
        decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', {
          ...candidate,
          declaredRedirectHosts: hosts,
        }),
      ).not.toThrow();
      const result = decodeS3Seam12Payload('CONFIRM_S3_CANDIDATE', '1.2.0', {
        ...candidate,
        declaredRedirectHosts: hosts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('fails before accepted-request replay or any Core persistent effect even when peer claims CLI', () => {
    const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const server = result.value;
    const old = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      requestId: 'req-s3-wire-001',
      payload: rawSingleResourceContract(),
    });
    expect(server.handleFrame(JSON.stringify(old)).outcome).toBe('ACCEPTED');
    for (const [commandType, payload] of [
      ['CONFIRM_S3_CANDIDATE', candidate],
      ['EXECUTE_S3_SELECTED_MEDIA', execute],
    ] as const) {
      const response = server.handleFrame(JSON.stringify(frame(commandType, payload)));
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
      expect(server.acceptedCommandCount).toBe(1);
    }
  });

  it('never accepts S3 on a fresh unverified CLI transport', () => {
    const created = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = created.value.handleFrame(
      JSON.stringify(frame('CONFIRM_S3_CANDIDATE', candidate)),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    expect(created.value.acceptedCommandCount).toBe(0);
  });
});
