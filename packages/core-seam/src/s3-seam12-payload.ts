/**
 * #150 S3 core-seam 1.2 closed command *syntax*, not Core selection authority.
 * Adopted L2 S3 (PR #119) §2.1 requires a Core-issued same-OS-session
 * one-time challenge and interactive TTY; a sender-created selectionAttestation
 * never proves either. Installed legacy seam MUST reject all S3 commands.
 */
import { isIP } from 'node:net';
import { parseSemVer } from '@xdownload/domain-contracts';
import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

export const S3_SEAM12_COMMAND_TYPES = [
  'CONFIRM_S3_CANDIDATE',
  'EXECUTE_S3_SELECTED_MEDIA',
] as const;
export type S3Seam12CommandType = (typeof S3_SEAM12_COMMAND_TYPES)[number];

export interface S3SelectionAttestation {
  readonly kind: 'EXPLICIT_CLI_GESTURE';
  readonly interactionId: string;
  readonly displayTupleDigest: string;
  readonly confirmedAt: string;
  readonly expectedRevision: number;
}
export interface S3ConfirmCandidatePayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly variantKey: string;
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  readonly mediaProfileId: string;
  readonly selectionAttestation: S3SelectionAttestation;
  readonly byteConstraintSha256?: string;
  readonly expectedTotalBytes?: number;
  readonly expectedContentTypePrefix?: string;
}
export interface S3ExecuteMediaPayload {
  readonly snapshotId: string;
  readonly memberId: string;
}
export type S3Seam12Decoded =
  | { readonly commandType: 'CONFIRM_S3_CANDIDATE'; readonly payload: S3ConfirmCandidatePayload }
  | { readonly commandType: 'EXECUTE_S3_SELECTED_MEDIA'; readonly payload: S3ExecuteMediaPayload };

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]{1,64}\.(?:mp4|m4a|mp3|webm)$/u;
const CONFIRM_REQUIRED = [
  'snapshotId',
  'memberId',
  'variantKey',
  'locatorUri',
  'declaredRedirectHosts',
  'mediaProfileId',
  'selectionAttestation',
] as const;
const CONFIRM_OPTIONAL = [
  'byteConstraintSha256',
  'expectedTotalBytes',
  'expectedContentTypePrefix',
] as const;
const EXECUTE_KEYS = ['snapshotId', 'memberId'] as const;
const ATTEST_KEYS = [
  'kind',
  'interactionId',
  'displayTupleDigest',
  'confirmedAt',
  'expectedRevision',
] as const;

function malformed(path: string, reason: string): SeamResult<never> {
  return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', path, reason)]);
}
function safeDataObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const desc = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(desc)) {
      if (typeof key !== 'string') return undefined;
      const d = desc[key];
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return undefined;
      Object.defineProperty(result, key, { value: d.value, enumerable: true });
    }
    return result;
  } catch {
    return undefined;
  }
}
/**
 * Snapshot one hostile array with descriptor-only reads. Never validate one
 * set of values and then copy a later accessor/proxy mutation into authority.
 * Reject sparse, exotic, accessor-backed, symbol and extra-property arrays.
 */
function safeHostArray(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors['length'];
    if (
      length === undefined ||
      !Object.hasOwn(length, 'value') ||
      !Number.isSafeInteger(length.value) ||
      length.value < 1 ||
      length.value > 8 ||
      Reflect.ownKeys(descriptors).length !== length.value + 1
    ) {
      return undefined;
    }
    const snapshot: string[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const item = descriptors[String(index)];
      if (
        item === undefined ||
        !item.enumerable ||
        !Object.hasOwn(item, 'value') ||
        typeof item.value !== 'string' ||
        !hostname(item.value)
      ) {
        return undefined;
      }
      snapshot.push(item.value);
    }
    return new Set(snapshot).size === snapshot.length ? Object.freeze(snapshot) : undefined;
  } catch {
    // Revoked Proxy or hostile descriptor/prototype trap: fail typed and
    // always before a Core journal, replay or external effect.
    return undefined;
  }
}

function ownFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((k) => Object.hasOwn(value, k)) &&
    keys.every((k) => required.includes(k) || optional.includes(k))
  );
}
function id(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}
function hostname(value: string): boolean {
  return (
    HOST.test(value) &&
    value.includes('.') &&
    !value.endsWith('.') &&
    isIP(value) === 0 &&
    !['.localhost', '.local', '.internal', '.onion', '.test', '.invalid'].some((suffix) =>
      value.endsWith(suffix),
    )
  );
}
function publicMediaSyntax(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 25 ||
    value.length > 2048 ||
    !/^[\x21-\x7e]+$/u.test(value) ||
    /[%?#@\\]/u.test(value)
  )
    return false;
  const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/.*)$/u.exec(value);
  if (!match || !hostname(match[1]!) || !MEDIA_PATH.test(match[3]!)) return false;
  const rawPort = match[2];
  if (
    rawPort !== undefined &&
    (String(Number(rawPort)) !== rawPort || Number(rawPort) < 1 || Number(rawPort) > 65535)
  )
    return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.hostname === match[1] &&
      parsed.pathname === match[3] &&
      parsed.href === value &&
      (rawPort === undefined || Number(parsed.port || '443') === Number(rawPort))
    );
  } catch {
    return false;
  }
}
function version12(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value))
    return false;
  const version = parseSemVer(value);
  return version !== undefined && version.major === 1 && version.minor >= 2;
}

/** Deterministic, frozen untrusted syntax. Nothing here mints a challenge. */
export function decodeS3Seam12Payload(
  commandType: unknown,
  schemaVersion: unknown,
  raw: unknown,
): SeamResult<S3Seam12Decoded> {
  if (!version12(schemaVersion)) {
    return seamFail([
      seamDiagnostic(
        'UNSUPPORTED_ENVELOPE_VERSION',
        'schemaIdentity.version',
        'S3 commands require final core-seam 1.2.0 or newer minor of major 1',
      ),
    ]);
  }
  if (
    typeof commandType !== 'string' ||
    !S3_SEAM12_COMMAND_TYPES.includes(commandType as S3Seam12CommandType)
  ) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        'S3 opcode is not in closed 1.2 vocabulary',
      ),
    ]);
  }
  const input = safeDataObject(raw);
  if (input === undefined)
    return malformed('payload', 'S3 payload must be a stable plain data object');
  if (commandType === 'EXECUTE_S3_SELECTED_MEDIA') {
    if (!ownFields(input, EXECUTE_KEYS) || !id(input['snapshotId']) || !id(input['memberId'])) {
      return malformed(
        'payload',
        'EXECUTE_S3_SELECTED_MEDIA may carry only frozen snapshotId and memberId',
      );
    }
    return seamOk(
      Object.freeze({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        payload: Object.freeze({ snapshotId: input['snapshotId'], memberId: input['memberId'] }),
      }),
    );
  }
  if (
    !ownFields(input, CONFIRM_REQUIRED, CONFIRM_OPTIONAL) ||
    !id(input['snapshotId']) ||
    !id(input['memberId']) ||
    !id(input['variantKey']) ||
    !id(input['mediaProfileId']) ||
    !publicMediaSyntax(input['locatorUri'])
  ) {
    return malformed('payload', 'S3 confirmation requires one closed public media candidate');
  }
  const hosts = safeHostArray(input['declaredRedirectHosts']);
  if (hosts === undefined) {
    return malformed(
      'payload.declaredRedirectHosts',
      'expected an immutable snapshot of 1..8 unique public DNS hosts',
    );
  }
  const attestation = safeDataObject(input['selectionAttestation']);
  if (
    attestation === undefined ||
    !ownFields(attestation, ATTEST_KEYS) ||
    attestation['kind'] !== 'EXPLICIT_CLI_GESTURE' ||
    !id(attestation['interactionId']) ||
    typeof attestation['displayTupleDigest'] !== 'string' ||
    !SHA.test(attestation['displayTupleDigest']) ||
    typeof attestation['confirmedAt'] !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(attestation['confirmedAt']) ||
    !Number.isSafeInteger(attestation['expectedRevision']) ||
    (attestation['expectedRevision'] as number) < 0
  ) {
    return malformed(
      'payload.selectionAttestation',
      'syntax cannot authenticate a self-asserted CLI gesture',
    );
  }
  if (
    input['byteConstraintSha256'] !== undefined &&
    (typeof input['byteConstraintSha256'] !== 'string' || !SHA.test(input['byteConstraintSha256']))
  ) {
    return malformed(
      'payload.byteConstraintSha256',
      'untrusted SHA constraint requires 64 lowercase hex chars',
    );
  }
  if (
    input['expectedTotalBytes'] !== undefined &&
    (!Number.isSafeInteger(input['expectedTotalBytes']) ||
      (input['expectedTotalBytes'] as number) <= 0)
  ) {
    return malformed('payload.expectedTotalBytes', 'expected positive safe byte count');
  }
  if (
    input['expectedContentTypePrefix'] !== undefined &&
    (typeof input['expectedContentTypePrefix'] !== 'string' ||
      !/^(?:video|audio)\/[a-z0-9.+-]{1,64}$/u.test(input['expectedContentTypePrefix']))
  ) {
    return malformed('payload.expectedContentTypePrefix', 'expected bounded video/audio MIME');
  }
  return seamOk(
    Object.freeze({
      commandType: 'CONFIRM_S3_CANDIDATE',
      payload: Object.freeze({
        snapshotId: input['snapshotId'] as string,
        memberId: input['memberId'] as string,
        variantKey: input['variantKey'] as string,
        locatorUri: input['locatorUri'] as string,
        declaredRedirectHosts: hosts,
        mediaProfileId: input['mediaProfileId'] as string,
        selectionAttestation: Object.freeze({
          kind: 'EXPLICIT_CLI_GESTURE' as const,
          interactionId: attestation['interactionId'] as string,
          displayTupleDigest: attestation['displayTupleDigest'] as string,
          confirmedAt: attestation['confirmedAt'] as string,
          expectedRevision: attestation['expectedRevision'] as number,
        }),
        ...(input['byteConstraintSha256'] === undefined
          ? {}
          : { byteConstraintSha256: input['byteConstraintSha256'] as string }),
        ...(input['expectedTotalBytes'] === undefined
          ? {}
          : { expectedTotalBytes: input['expectedTotalBytes'] as number }),
        ...(input['expectedContentTypePrefix'] === undefined
          ? {}
          : { expectedContentTypePrefix: input['expectedContentTypePrefix'] as string }),
      }),
    }),
  );
}
