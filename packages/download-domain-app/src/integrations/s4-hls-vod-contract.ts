/**
 * T06 closed S4 confirmation contract. No generic S1/S3 slice is carried:
 * the selected HLS rendition is an explicit confirmed fact and is re-read
 * against the trusted manifest by the Host before any segment request.
 */
import { createHash } from 'node:crypto';
import {
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import {
  REFERENCE_TOKEN_PATTERN,
  SHA256_PATTERN,
  validateOutputRoot,
} from '../contracts/index.ts';

export const S4_HLS_MEDIA_OPERATION = 'media.acquire' as const;
export const S4_HLS_MEDIA_PROFILE = 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1' as const;

export interface S4ConfirmedSelection {
  readonly confirmedSelectionId: string;
  readonly previewId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly manifestUri: string;
  readonly mediaProfileId: typeof S4_HLS_MEDIA_PROFILE;
  readonly renditionKey: string;
  readonly renditionUri: string;
  readonly displayedTupleDigest: string;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

export interface ConfirmedS4HlsIntent {
  readonly requestId: string;
  readonly lineageId: string;
  readonly contractId: string;
  readonly targetRef: string;
  readonly outputRootScope: string;
  readonly allowedOperation: typeof S4_HLS_MEDIA_OPERATION;
  readonly selection: S4ConfirmedSelection;
  readonly caller: { readonly actor: string; readonly sessionRef: string };
  readonly digestAnchor?: string;
}

const INTENT_KEYS = [
  'requestId',
  'lineageId',
  'contractId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'selection',
  'caller',
  'digestAnchor',
] as const;
const SELECTION_KEYS = [
  'confirmedSelectionId',
  'previewId',
  'snapshotId',
  'memberId',
  'manifestUri',
  'mediaProfileId',
  'renditionKey',
  'renditionUri',
  'displayedTupleDigest',
  'confirmedAt',
  'expiresAt',
] as const;

function stableRecord(
  value: unknown,
  path: string,
): DomainValidationResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, path + ' must be a plain data object'),
    ]);
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', path, path + ' must be a plain data object'),
      ]);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        return fail([diagnostic('SCOPE_WIDENING_REFUSED', path, 'symbol fields are not permitted')]);
      }
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            path + '.' + key,
            'accessor/non-enumerable fields are refused',
          ),
        ]);
      }
      snapshot[key] = descriptor.value;
    }
    return ok(snapshot);
  } catch {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'hostile or revoked object is refused'),
    ]);
  }
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): DomainValidationResult<void> {
  const allowed = new Set<string>(keys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    return fail([
      diagnostic('SCOPE_WIDENING_REFUSED', path + '.' + unknown, 'unknown field is refused'),
    ]);
  }
  const missing = keys.find((key) => key !== 'digestAnchor' && !Object.hasOwn(record, key));
  if (missing !== undefined) {
    return fail([
      diagnostic('MISSING_REQUIRED_FIELD', path + '.' + missing, 'required field is missing'),
    ]);
  }
  return ok(undefined);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_TOKEN_PATTERN.test(value);
}

function canonicalPlaylistUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 14 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.endsWith('.m3u8')
    );
  } catch {
    return false;
  }
}

/**
 * Exact same fixed-order tuple digest used by Core's S4 selection protocol.
 * Host recomputes it from the freshly fetched master facts before transfer.
 */
export function s4HlsSelectionTupleDigest(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly previewId: string;
  readonly renditionKey: string;
  readonly renditionUri: string;
  readonly manifestUri: string;
  readonly mediaProfileId: string;
  readonly bandwidth: number;
  readonly width?: number;
  readonly height?: number;
}): string {
  const canonical = `{"contractId":${JSON.stringify(input.contractId)},"snapshotId":${JSON.stringify(
    input.snapshotId,
  )},"memberId":${JSON.stringify(input.memberId)},"previewId":${JSON.stringify(
    input.previewId,
  )},"renditionKey":${JSON.stringify(input.renditionKey)},"renditionUri":${JSON.stringify(
    input.renditionUri,
  )},"manifestUri":${JSON.stringify(input.manifestUri)},"mediaProfileId":${JSON.stringify(
    input.mediaProfileId,
  )},"bandwidth":${String(input.bandwidth)},"width":${input.width === undefined ? 'null' : String(
    input.width,
  )},"height":${input.height === undefined ? 'null' : String(input.height)}}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateConfirmedS4HlsIntent(
  input: unknown,
): DomainValidationResult<ConfirmedS4HlsIntent> {
  const stable = stableRecord(input, 'intent');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, INTENT_KEYS, 'intent');
  if (!keys.ok) return keys;

  for (const field of ['requestId', 'lineageId', 'contractId', 'targetRef'] as const) {
    if (!boundedId(record[field])) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'intent.' + field,
          'expected a bounded opaque identifier',
        ),
      ]);
    }
  }
  if (record.allowedOperation !== S4_HLS_MEDIA_OPERATION) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'intent.allowedOperation',
        'S4 HLS requires media.acquire',
      ),
    ]);
  }
  const root = validateOutputRoot(record.outputRootScope);
  if (!root.ok) return root;

  const selectionStable = stableRecord(record.selection, 'intent.selection');
  if (!selectionStable.ok) return selectionStable;
  const selection = selectionStable.value;
  const selectionKeys = exactKeys(selection, SELECTION_KEYS, 'intent.selection');
  if (!selectionKeys.ok) return selectionKeys;
  for (const field of ['confirmedSelectionId', 'previewId', 'snapshotId', 'memberId'] as const) {
    if (!boundedId(selection[field])) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'intent.selection.' + field,
          'expected a bounded selection identifier',
        ),
      ]);
    }
  }
  if (
    selection.mediaProfileId !== S4_HLS_MEDIA_PROFILE ||
    typeof selection.renditionKey !== 'string' ||
    !/^rend-(0|[1-9]\d*)$/u.test(selection.renditionKey) ||
    !canonicalPlaylistUri(selection.manifestUri) ||
    !canonicalPlaylistUri(selection.renditionUri) ||
    typeof selection.displayedTupleDigest !== 'string' ||
    !SHA256_PATTERN.test(selection.displayedTupleDigest)
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'intent.selection',
        'S4 selection/profile/URI/digest is malformed',
      ),
    ]);
  }
  if (typeof selection.confirmedAt !== 'string' || typeof selection.expiresAt !== 'string') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'intent.selection.confirmedAt',
        'confirmation timestamps must be ISO strings',
      ),
    ]);
  }
  const confirmedAt = Date.parse(selection.confirmedAt);
  const expiresAt = Date.parse(selection.expiresAt);
  if (!Number.isFinite(confirmedAt) || !Number.isFinite(expiresAt) || expiresAt <= confirmedAt) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'intent.selection.expiresAt',
        'selection confirmation window is invalid',
      ),
    ]);
  }

  const callerStable = stableRecord(record.caller, 'intent.caller');
  if (!callerStable.ok) return callerStable;
  const caller = callerStable.value;
  const callerKeys = exactKeys(caller, ['actor', 'sessionRef'], 'intent.caller');
  if (!callerKeys.ok) return callerKeys;
  if (
    typeof caller.actor !== 'string' ||
    caller.actor.length < 1 ||
    caller.actor.length > 128 ||
    typeof caller.sessionRef !== 'string' ||
    caller.sessionRef.length < 1 ||
    caller.sessionRef.length > 256
  ) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'intent.caller', 'caller identity is malformed'),
    ]);
  }
  if (
    record.digestAnchor !== undefined &&
    (typeof record.digestAnchor !== 'string' || !SHA256_PATTERN.test(record.digestAnchor))
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'intent.digestAnchor',
        'digestAnchor must be lowercase SHA-256',
      ),
    ]);
  }

  return ok(Object.freeze({
    requestId: record.requestId as string,
    lineageId: record.lineageId as string,
    contractId: record.contractId as string,
    targetRef: record.targetRef as string,
    outputRootScope: root.value,
    allowedOperation: S4_HLS_MEDIA_OPERATION,
    selection: Object.freeze({
      confirmedSelectionId: selection.confirmedSelectionId as string,
      previewId: selection.previewId as string,
      snapshotId: selection.snapshotId as string,
      memberId: selection.memberId as string,
      manifestUri: selection.manifestUri as string,
      mediaProfileId: S4_HLS_MEDIA_PROFILE,
      renditionKey: selection.renditionKey as string,
      renditionUri: selection.renditionUri as string,
      displayedTupleDigest: selection.displayedTupleDigest as string,
      confirmedAt: selection.confirmedAt as string,
      expiresAt: selection.expiresAt as string,
    }),
    caller: Object.freeze({
      actor: caller.actor as string,
      sessionRef: caller.sessionRef as string,
    }),
    ...(record.digestAnchor === undefined ? {} : { digestAnchor: record.digestAnchor as string }),
  }));
}
