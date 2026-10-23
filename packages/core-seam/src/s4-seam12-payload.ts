/**
 * #101 S4 seam-1.2 closed payload codec. Pure, non-authoritative contract
 * decoding only; DOES NOT add S4 command types to envelope.ts, bump the
 * currently installed seam version, mint a confirmation challenge, verify an
 * OS transport/session, access a URL or mutate the Core ledger.
 *
 * The only adopted source of S4 authority is the reviewed/frozen
 * L2_S4_SEAM12_CLOSED_COMMAND_CONTRACT_v0.1.0.md. Activation is a separate,
 * independently security-reviewed Core handler and transport change.
 */
import { parseSemVer } from '@xdownload/domain-contracts';
import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

export const S4_SEAM12_COMMAND_TYPES = [
  'PREVIEW_S4_HLS_VOD',
  'CONFIRM_S4_SELECTION',
  'EXECUTE_S4_SELECTED_HLS_VOD',
] as const;

export type S4Seam12CommandType = (typeof S4_SEAM12_COMMAND_TYPES)[number];

export const S4_PUBLIC_MEDIA_PROFILE_ID = 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1' as const;

export interface S4PreviewPayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly manifestUri: string;
  readonly mediaProfileId: typeof S4_PUBLIC_MEDIA_PROFILE_ID;
}

export interface S4ConfirmBeginPayload {
  readonly phase: 'BEGIN';
  readonly snapshotId: string;
  readonly memberId: string;
  readonly previewId: string;
  readonly renditionKey: string;
  readonly displayedTupleDigest: string;
}

export interface S4ConfirmCommitPayload {
  readonly phase: 'COMMIT';
  readonly snapshotId: string;
  readonly memberId: string;
  readonly previewId: string;
  readonly renditionKey: string;
  readonly displayedTupleDigest: string;
  readonly confirmationChallenge: string;
}

export interface S4ExecutePayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly confirmedSelectionId: string;
}

export type S4Seam12Decoded =
  | { readonly commandType: 'PREVIEW_S4_HLS_VOD'; readonly payload: S4PreviewPayload }
  | {
      readonly commandType: 'CONFIRM_S4_SELECTION';
      readonly payload: S4ConfirmBeginPayload | S4ConfirmCommitPayload;
    }
  | { readonly commandType: 'EXECUTE_S4_SELECTED_HLS_VOD'; readonly payload: S4ExecutePayload };

const PREVIEW_KEYS = ['snapshotId', 'memberId', 'manifestUri', 'mediaProfileId'] as const;
const BEGIN_KEYS = [
  'phase',
  'snapshotId',
  'memberId',
  'previewId',
  'renditionKey',
  'displayedTupleDigest',
] as const;
const COMMIT_KEYS = [...BEGIN_KEYS, 'confirmationChallenge'] as const;
const EXECUTE_KEYS = ['snapshotId', 'memberId', 'confirmedSelectionId'] as const;
const ID_FIELDS = [
  'snapshotId',
  'memberId',
  'previewId',
  'renditionKey',
  'confirmedSelectionId',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function malformed(path: string, message: string): SeamResult<never> {
  return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', path, message)]);
}

function validateKeys(value: Record<string, unknown>, keys: readonly string[]): SeamResult<void> {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return malformed(`payload.${unknown[0]}`, 'unrecognized S4 authority field');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      return malformed(`payload.${key}`, 'required S4 field missing');
    }
  }
  return seamOk(undefined);
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.:-]+$/u.test(value)
  );
}

function publicManifestSyntax(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value.length < 14 ||
    !/^[\x21-\x7e]+$/u.test(value) ||
    /[?#%@\\]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.port === '' &&
      url.pathname.endsWith('.m3u8') &&
      /^[a-z0-9.-]+$/u.test(url.hostname) &&
      url.hostname.includes('.') &&
      !url.hostname.endsWith('.')
    );
  } catch {
    return false;
  }
}

/** Explicitly refuse prereleases, major != 1, and minors < 2. */
function compatibleS4Minor(version: unknown): boolean {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) return false;
  const parsed = parseSemVer(version);
  return parsed !== undefined && parsed.major === 1 && parsed.minor >= 2;
}

/**
 * Decode ONLY the future S4 v1.2 payload data structure.
 *
 * Returned objects are frozen *syntactic candidates*, NOT accepted Core
 * commands or session/manifest/confirmation authorization. In particular
 * challenge length is not evidence a Core CSPRNG issued a challenge.
 */
export function decodeS4Seam12Payload(
  commandType: unknown,
  schemaVersion: unknown,
  raw: unknown,
): SeamResult<S4Seam12Decoded> {
  if (!compatibleS4Minor(schemaVersion)) {
    return seamFail([
      seamDiagnostic(
        'UNSUPPORTED_ENVELOPE_VERSION',
        'schemaIdentity.version',
        'S4 commands require a final core-seam 1.2.0-or-newer minor of major 1',
      ),
    ]);
  }
  if (
    typeof commandType !== 'string' ||
    !S4_SEAM12_COMMAND_TYPES.includes(commandType as S4Seam12CommandType)
  ) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        'S4 command is not in the closed 1.2 vocabulary',
      ),
    ]);
  }
  if (!record(raw)) return malformed('payload', 'S4 payload must be a closed object');

  let allowed: readonly string[];
  if (commandType === 'PREVIEW_S4_HLS_VOD') {
    allowed = PREVIEW_KEYS;
  } else if (commandType === 'EXECUTE_S4_SELECTED_HLS_VOD') {
    allowed = EXECUTE_KEYS;
  } else {
    if (raw['phase'] !== 'BEGIN' && raw['phase'] !== 'COMMIT') {
      return malformed('payload.phase', 'expected closed BEGIN or COMMIT phase');
    }
    allowed = raw['phase'] === 'BEGIN' ? BEGIN_KEYS : COMMIT_KEYS;
  }
  const keys = validateKeys(raw, allowed);
  if (!keys.ok) return keys;

  for (const field of ID_FIELDS) {
    if (allowed.includes(field) && !boundedId(raw[field])) {
      return malformed(`payload.${field}`, 'expected a bounded 1..128 character identifier');
    }
  }
  if (commandType === 'PREVIEW_S4_HLS_VOD') {
    if (!publicManifestSyntax(raw['manifestUri'])) {
      return malformed(
        'payload.manifestUri',
        'expected a canonical credential-free HTTPS .m3u8 URI candidate',
      );
    }
    if (raw['mediaProfileId'] !== S4_PUBLIC_MEDIA_PROFILE_ID) {
      return malformed('payload.mediaProfileId', 'unsupported public-only fixed HLS profile');
    }
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze(raw as unknown as S4PreviewPayload),
      }),
    );
  }
  if (commandType === 'EXECUTE_S4_SELECTED_HLS_VOD') {
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze(raw as unknown as S4ExecutePayload),
      }),
    );
  }
  if (
    typeof raw['displayedTupleDigest'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(raw['displayedTupleDigest'])
  ) {
    return malformed('payload.displayedTupleDigest', 'expected a lowercase 64-hex tuple digest');
  }
  if (
    raw['phase'] === 'COMMIT' &&
    (typeof raw['confirmationChallenge'] !== 'string' ||
      !/^[A-Za-z0-9_-]{22,128}$/u.test(raw['confirmationChallenge']))
  ) {
    return malformed(
      'payload.confirmationChallenge',
      'expected a bounded opaque base64url challenge',
    );
  }
  if (raw['phase'] === 'BEGIN') {
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze(raw as unknown as S4ConfirmBeginPayload),
      }),
    );
  }
  return seamOk(
    Object.freeze({
      commandType,
      payload: Object.freeze(raw as unknown as S4ConfirmCommitPayload),
    }),
  );
}
