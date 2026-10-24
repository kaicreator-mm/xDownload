import { describe, expect, it } from 'vitest';
import { decodeSeamEnvelope, CORE_SEAM_SCHEMA_VERSION } from '../src/envelope.ts';
import {
  decodeS4Seam12Payload,
  S4_PUBLIC_MEDIA_PROFILE_ID,
  S4_SEAM12_COMMAND_TYPES,
} from '../src/s4-seam12-payload.ts';
import { rawCommand } from './helpers.ts';

const preview = {
  snapshotId: 'snapshot-1',
  memberId: 'member-1',
  manifestUri: 'https://cdn.example.org/video/main.m3u8',
  mediaProfileId: S4_PUBLIC_MEDIA_PROFILE_ID,
};
const begin = {
  phase: 'BEGIN',
  snapshotId: 'snapshot-1',
  memberId: 'member-1',
  previewId: 'preview-1',
  renditionKey: 'rendition-1',
  displayedTupleDigest: 'a'.repeat(64),
};
const commit = {
  ...begin,
  phase: 'COMMIT',
  confirmationChallenge: 'x'.repeat(43),
};
const execute = {
  snapshotId: 'snapshot-1',
  memberId: 'member-1',
  confirmedSelectionId: 'confirmation-1',
};
const decode = (type: unknown, payload: unknown, version: unknown = '1.2.0') =>
  decodeS4Seam12Payload(type, version, payload);

describe('S4 seam 1.2 closed payload candidates; Core effect authority NOT enabled', () => {
  it('parses a bounded manifest candidate without acquiring any network authority', () => {
    const result = decode('PREVIEW_S4_HLS_VOD', preview);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commandType).toBe('PREVIEW_S4_HLS_VOD');
    expect(result.value.payload).toEqual(preview);
    expect(Object.isFrozen(result.value.payload)).toBe(true);
    expect(Object.isFrozen(preview)).toBe(false); // decoder must not mutate caller input
    expect(result.value).not.toHaveProperty('accepted');
    expect(result.value).not.toHaveProperty('transportAuthorized');
  });

  it.each([
    ['CONFIRM_S4_SELECTION', begin],
    ['CONFIRM_S4_SELECTION', commit],
    ['EXECUTE_S4_SELECTED_HLS_VOD', execute],
  ])('decodes one closed %s payload', (command, payload) => {
    const a = decode(command, payload);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.payload).toEqual(payload);
  });

  it.each([
    '1.0.0',
    '1.1.0',
    '2.0.0',
    '0.99.99',
    '1.2.0-beta.1',
    '1.2.0+unsafe',
    '1.02.0',
    'one',
    '',
    null,
  ])('refuses unsupported/non-final seam version %s', (version) => {
    const r = decode('PREVIEW_S4_HLS_VOD', preview, version);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');
  });

  it.each(['1.2.0', '1.3.0'])('accepts a valid final major-1, minor>=2 schema version %s', (v) => {
    expect(decode('PREVIEW_S4_HLS_VOD', preview, v).ok).toBe(true);
  });

  it.each([
    'CONFIRM_S3_CANDIDATE',
    'EXECUTE_S3_SELECTED_MEDIA',
    'EXECUTE_S1_DIRECT_ACQUISITION',
    'READ_PROJECTION',
    'DELETE_ALL',
    '',
  ])('rejects unapproved command names: %s', (kind) => {
    const r = decode(kind, preview);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
  });

  it.each([
    ['unknown authority key', { ...preview, allowHost: 'evil.example.net' }],
    [
      'credential-bearing manifest',
      { ...preview, manifestUri: 'https://user:secret@cdn.example.org/video/main.m3u8' },
    ],
    ['HTTP manifest', { ...preview, manifestUri: 'http://cdn.example.org/video/main.m3u8' }],
    ['loopback literal', { ...preview, manifestUri: 'https://127.0.0.1/video/main.m3u8' }],
    ['private network literal', { ...preview, manifestUri: 'https://10.0.0.5/video/main.m3u8' }],
    ['internal zone', { ...preview, manifestUri: 'https://x.internal/video/main.m3u8' }],
    [
      'query credential',
      { ...preview, manifestUri: 'https://cdn.example.org/video/main.m3u8?token=x' },
    ],
    ['relative manifest', { ...preview, manifestUri: '/video/main.m3u8' }],
    ['nested mutation', { ...preview, policy: { budget: 99999999 } }],
    [
      'missing target',
      {
        snapshotId: 'snapshot-1',
        manifestUri: preview.manifestUri,
        mediaProfileId: S4_PUBLIC_MEDIA_PROFILE_ID,
      },
    ],
    ['different profile', { ...preview, mediaProfileId: 'ARBITRARY_MEDIA_ALL' }],
    ['non-object', []],
  ])('rejects malformed preview candidate: %s', (_label, raw) => {
    expect(decode('PREVIEW_S4_HLS_VOD', raw).ok).toBe(false);
  });

  it('rejects BEGIN carrying secret, COMMIT lacking it, or an arbitrary consent flag', () => {
    for (const x of [
      { ...begin, confirmationChallenge: 'steal' },
      { ...commit, confirmationChallenge: undefined },
      { ...commit, confirmed: true },
      { ...commit, phase: 'CONFIRM' },
      { ...commit, displayedTupleDigest: '1' },
      { ...begin, issuedAt: 'forged' },
    ]) {
      expect(decode('CONFIRM_S4_SELECTION', x).ok).toBe(false);
    }
  });

  it('rejects execution authority beyond an immutable confirmed-selection reference', () => {
    for (const raw of [
      { ...execute, manifestUri: preview.manifestUri },
      { ...execute, tool: 'ffmpeg -i ...' },
      { ...execute, forceSuccess: true },
      { ...execute, cookie: 'secret' },
      { ...execute, confirmedSelectionId: '' },
    ]) {
      expect(decode('EXECUTE_S4_SELECTED_HLS_VOD', raw).ok).toBe(false);
    }
  });

  it('does not silently activate three S4 command names in installed v1.1 Core envelope', () => {
    expect(CORE_SEAM_SCHEMA_VERSION).toBe('1.1.0');
    expect(S4_SEAM12_COMMAND_TYPES).toHaveLength(3);
    for (const commandType of S4_SEAM12_COMMAND_TYPES) {
      const envelope = rawCommand({
        // The currently shipped command type is deliberately closed at 1.1.
        // Inject the future discriminant only AFTER constructing a legacy
        // helper frame so this exercises raw untrusted JSON decoding.
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-1',
        payload:
          commandType === 'PREVIEW_S4_HLS_VOD'
            ? preview
            : commandType === 'CONFIRM_S4_SELECTION'
              ? begin
              : execute,
      });
      envelope.commandType = commandType;
      envelope.schemaIdentity = { schema: 'xdownload.core-seam', version: '1.2.0' };
      const result = decodeSeamEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
    }
  });

  it('rejects accessor-backed values before any second read can bypass lexical validation', () => {
    let getterCalls = 0;
    const source = { ...preview };
    Object.defineProperty(source, 'manifestUri', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return getterCalls === 1 ? 'https://cdn.example.org/main.m3u8' : 'file:///etc/passwd';
      },
    });
    const result = decode('PREVIEW_S4_HLS_VOD', source);
    expect(result.ok).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it('rejects accessor phase, nonenumerable authority keys and symbol keys', () => {
    const accessor = { ...begin };
    Object.defineProperty(accessor, 'phase', {
      enumerable: true,
      get() {
        throw new Error('getter must never run');
      },
    });
    const hidden = { ...preview };
    Object.defineProperty(hidden, 'allowedOrigins', { value: ['localhost'] });
    const symbol = { ...preview, [Symbol('override')]: true };
    for (const payload of [accessor, hidden, symbol]) {
      const result = decode(
        payload === accessor ? 'CONFIRM_S4_SELECTION' : 'PREVIEW_S4_HLS_VOD',
        payload,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('returns typed rejection for hostile and revoked proxies', () => {
    const hostile = new Proxy(
      { ...preview },
      {
        ownKeys() {
          throw new Error('ownKeys trap');
        },
      },
    );
    const revocable = Proxy.revocable({ ...preview }, {});
    revocable.revoke();
    for (const payload of [hostile, revocable.proxy]) {
      expect(() => decode('PREVIEW_S4_HLS_VOD', payload)).not.toThrow();
      const result = decode('PREVIEW_S4_HLS_VOD', payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    }
  });
});
