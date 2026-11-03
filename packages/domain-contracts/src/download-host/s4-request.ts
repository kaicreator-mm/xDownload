/**
 * V022 A01 — neutral Host-operation contracts: S4/media-acquisition request.
 *
 * The narrow Host-facing DTO for the S4 selected-HLS `media.acquire` lane.
 * The closed S4 selection rides INSIDE the request: rendition, expiry and
 * digest facts the trusted Host must independently re-check against the
 * freshly fetched master manifest before any segment request. Domain App
 * projects its validated S4 Business Intent into exactly this shape; the
 * Host validates it from `unknown` BEFORE any physical effect. Exact-key
 * no-widening; stale/expired selections fail closed.
 *
 * The S4 tuple-digest RECOMPUTATION stays Host-side: it needs the freshly
 * fetched master facts (bandwidth/resolution) and a hash implementation —
 * neither belongs in the pure neutral package. The DTO carries the
 * displayed tuple digest fact and enforces its grammar only.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';
import { isSha256Digest } from './fields.ts';
import { validateHostCaller, type DirectHostCaller } from './direct-request.ts';
import { validateOutputRoot } from './paths.ts';
import { exactKeys, stableRecord } from './records.ts';
import { REFERENCE_TOKEN_PATTERN, validateOpaqueTargetRef } from './target-ref.ts';

/** The frozen S4 media profile the selection is pinned to. */
const S4_MEDIA_PROFILE = 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1';
const S4_OPERATION = 'media.acquire';

/** Canonical playlist locator grammar: credential-free http(s) .m3u8 URL. */
function isCanonicalPlaylistUri(value: unknown): value is string {
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

/** A bounded opaque selection-identifier token. */
function isBoundedSelectionId(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_TOKEN_PATTERN.test(value);
}

/**
 * The closed S4 confirmed selection. Every fact here is re-checked by the
 * Host against fresh master-manifest state before transfer; nothing may be
 * defaulted (no implicit first-variant fallback).
 */
export interface S4HostConfirmedSelection {
  readonly confirmedSelectionId: string;
  readonly previewId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly manifestUri: string;
  /** Pinned to the frozen S4 media profile by the validator. */
  readonly mediaProfileId: typeof S4_MEDIA_PROFILE;
  readonly renditionKey: string;
  readonly renditionUri: string;
  readonly displayedTupleDigest: string;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

/**
 * The S4/media Host acquisition request: the only payload the S4 Host
 * bridge may execute against. The selection is an explicit confirmed fact,
 * not a slice field.
 */
export interface S4HostAcquisitionRequest {
  readonly requestId: string;
  readonly lineageId: string;
  readonly contractId: string;
  readonly targetRef: string;
  readonly outputRootScope: string;
  /** Pinned to 'media.acquire' by the validator. */
  readonly allowedOperation: typeof S4_OPERATION;
  readonly selection: S4HostConfirmedSelection;
  readonly caller: DirectHostCaller;
  /** Optional frozen digest anchor (lowercase 64-hex) for the artifact. */
  readonly digestAnchor?: string;
}

const S4_REQUEST_KEYS = [
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
const S4_SELECTION_KEYS = [
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

/**
 * Exact-key fail-closed validation of an S4/media Host acquisition request
 * from untrusted input, including selection freshness at `now` (default:
 * current wall clock; injectable for deterministic tests). This is the
 * SINGLE S4-lane request validator — App projects into the DTO, Host
 * validates it independently before any physical effect.
 */
export function validateS4HostAcquisitionRequest(
  input: unknown,
  now: number = Date.now(),
): DomainValidationResult<S4HostAcquisitionRequest> {
  const stable = stableRecord(input, 'request');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, S4_REQUEST_KEYS, 'request', ['digestAnchor']);
  if (!keys.ok) return keys;

  const requestId = record.requestId;
  const lineageId = record.lineageId;
  const contractId = record.contractId;
  if (
    !isBoundedSelectionId(requestId) ||
    !isBoundedSelectionId(lineageId) ||
    !isBoundedSelectionId(contractId)
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request',
        'requestId/lineageId/contractId must be bounded opaque identifiers',
      ),
    ]);
  }
  const targetRef = validateOpaqueTargetRef(record.targetRef);
  if (!targetRef.ok) {
    return fail([
      diagnostic(
        targetRef.diagnostics[0]!.code,
        'request.targetRef',
        targetRef.diagnostics[0]!.message,
      ),
    ]);
  }
  const root = validateOutputRoot(record.outputRootScope);
  if (!root.ok) {
    return fail([
      diagnostic(
        root.diagnostics[0]!.code,
        'request.outputRootScope',
        root.diagnostics[0]!.message,
      ),
    ]);
  }
  if (record.allowedOperation !== S4_OPERATION) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'request.allowedOperation',
        `S4/media Host request authorizes '${String(record.allowedOperation)}'; this lane executes only ${S4_OPERATION}`,
      ),
    ]);
  }
  if (record.digestAnchor !== undefined && !isSha256Digest(record.digestAnchor)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.digestAnchor',
        'digestAnchor must be lowercase SHA-256',
      ),
    ]);
  }

  const selectionStable = stableRecord(record.selection, 'request.selection');
  if (!selectionStable.ok) return selectionStable;
  const selection = selectionStable.value;
  const selectionKeys = exactKeys(selection, S4_SELECTION_KEYS, 'request.selection');
  if (!selectionKeys.ok) return selectionKeys;
  const confirmedSelectionId = selection.confirmedSelectionId;
  const previewId = selection.previewId;
  const snapshotId = selection.snapshotId;
  const memberId = selection.memberId;
  if (
    !isBoundedSelectionId(confirmedSelectionId) ||
    !isBoundedSelectionId(previewId) ||
    !isBoundedSelectionId(snapshotId) ||
    !isBoundedSelectionId(memberId)
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.selection',
        'selection identifiers must be bounded opaque tokens',
      ),
    ]);
  }
  if (
    selection.mediaProfileId !== S4_MEDIA_PROFILE ||
    typeof selection.renditionKey !== 'string' ||
    !/^rend-(0|[1-9]\d*)$/u.test(selection.renditionKey) ||
    !isCanonicalPlaylistUri(selection.manifestUri) ||
    !isCanonicalPlaylistUri(selection.renditionUri) ||
    !isSha256Digest(selection.displayedTupleDigest)
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.selection',
        'S4 selection/profile/rendition/URI/digest is malformed',
      ),
    ]);
  }
  if (typeof selection.confirmedAt !== 'string' || typeof selection.expiresAt !== 'string') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.selection.confirmedAt',
        'confirmation timestamps must be ISO strings',
      ),
    ]);
  }
  const confirmedAt = Date.parse(selection.confirmedAt);
  const expiresAt = Date.parse(selection.expiresAt);
  if (
    !Number.isFinite(confirmedAt) ||
    !Number.isFinite(expiresAt) ||
    confirmedAt > now ||
    expiresAt <= now ||
    expiresAt <= confirmedAt
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.selection.expiresAt',
        'selection must be currently valid and must not be future-dated',
      ),
    ]);
  }

  const caller = validateHostCaller(record.caller, 'request.caller');
  if (!caller.ok) return caller;

  return ok(
    Object.freeze({
      requestId,
      lineageId,
      contractId,
      targetRef: targetRef.value,
      outputRootScope: root.value,
      allowedOperation: S4_OPERATION,
      selection: Object.freeze({
        confirmedSelectionId,
        previewId,
        snapshotId,
        memberId,
        manifestUri: selection.manifestUri,
        mediaProfileId: S4_MEDIA_PROFILE,
        renditionKey: selection.renditionKey,
        renditionUri: selection.renditionUri,
        displayedTupleDigest: selection.displayedTupleDigest,
        confirmedAt: selection.confirmedAt,
        expiresAt: selection.expiresAt,
      }),
      caller: caller.value,
      ...(record.digestAnchor === undefined ? {} : { digestAnchor: record.digestAnchor }),
    }),
  );
}
