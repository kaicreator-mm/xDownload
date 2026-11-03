/**
 * V022 A01B — neutral Host-operation contracts: S3 media-acquisition request.
 *
 * The narrow Host-facing DTO for the S3 `media.acquire` lane. Post-A01 source
 * audit found that the Host media operation `acquireMediaViaHls` still
 * imports the Domain App intent validator for this lane; neither the direct
 * DTO (pinned to `acquisition.acquire`) nor the S4 DTO (pinned to
 * `media.acquire` with an explicit selected-HLS tuple) represents it. This
 * DTO fills that gap: Domain App projects its validated S3 Business Intent
 * into exactly this shape; the trusted Host independently validates it from
 * `unknown` BEFORE any physical effect. Exact-key no-widening: unknown
 * fields refuse, never drop.
 *
 * Frozen lane value: `allowedOperation` is pinned to `media.acquire` and
 * `slice` to `S3` by the validator — the S3 media lane cannot be reused for
 * another operation or slice. Pure contract layer: no I/O, no App/Host/Core
 * imports.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';
import {
  isBoundedByteCount,
  isBoundedIntentField,
  isSha256Digest,
  MAX_DECLARED_BYTES,
} from './fields.ts';
import { validateHostCaller, type DirectHostCaller } from './direct-request.ts';
import { validateOutputRoot } from './paths.ts';
import { exactKeys, stableRecord } from './records.ts';
import { validateOpaqueTargetRef } from './target-ref.ts';

/** Frozen S3 media-lane operation vocabulary. */
const S3_MEDIA_OPERATION = 'media.acquire';
/** Frozen S3 media-lane slice: this DTO is the S3 lane only. */
const S3_MEDIA_SLICE = 'S3';

/**
 * The S3 media Host acquisition request: the only payload the S3 media Host
 * bridge may execute against. Every field is bounded; nothing here can be
 * widened at runtime (exact-field validation below).
 */
export interface S3MediaHostAcquisitionRequest {
  readonly requestId: string;
  readonly lineageId: string;
  /** Opaque resolution token; only the trusted Host turns it into a locator. */
  readonly targetRef: string;
  /** Absolute authorized output root; the artifact must materialize inside. */
  readonly outputRootScope: string;
  /** Pinned to 'media.acquire' by the validator. */
  readonly allowedOperation: typeof S3_MEDIA_OPERATION;
  /** Pinned to 'S3' by the validator. */
  readonly slice: typeof S3_MEDIA_SLICE;
  /** Optional frozen digest anchor (lowercase 64-hex) for the artifact. */
  readonly digestAnchor?: string;
  /** Optional declared total size, bounded for the v0.2 profile. */
  readonly declaredBytes?: number;
  readonly caller: DirectHostCaller;
}

const S3_MEDIA_REQUEST_KEYS = [
  'requestId',
  'lineageId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'slice',
  'digestAnchor',
  'declaredBytes',
  'caller',
] as const;

const S3_MEDIA_OPTIONAL_KEYS = ['digestAnchor', 'declaredBytes'] as const;

/**
 * Exact-key fail-closed validation of an S3 media Host acquisition request
 * from untrusted input. This is the SINGLE S3 media-lane validator: App
 * projects into the DTO, Host validates it independently — no divergent
 * second validator may exist.
 */
export function validateS3MediaHostAcquisitionRequest(
  input: unknown,
): DomainValidationResult<S3MediaHostAcquisitionRequest> {
  const stable = stableRecord(input, 'request');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, S3_MEDIA_REQUEST_KEYS, 'request', S3_MEDIA_OPTIONAL_KEYS);
  if (!keys.ok) return keys;

  if (!isBoundedIntentField(record.requestId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.requestId',
        `requestId must match ^[a-z0-9][a-z0-9-]{0,63}$`,
      ),
    ]);
  }
  if (!isBoundedIntentField(record.lineageId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.lineageId',
        'lineageId must match ^[a-z0-9][a-z0-9-]{0,63}$',
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
  if (record.allowedOperation !== S3_MEDIA_OPERATION) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'request.allowedOperation',
        `S3 media Host request authorizes '${String(record.allowedOperation)}'; this lane executes only ${S3_MEDIA_OPERATION}`,
      ),
    ]);
  }
  if (record.slice !== S3_MEDIA_SLICE) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'request.slice', `slice must be '${S3_MEDIA_SLICE}'`),
    ]);
  }
  if (record.digestAnchor !== undefined && !isSha256Digest(record.digestAnchor)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.digestAnchor',
        'digestAnchor must be lowercase 64-hex',
      ),
    ]);
  }
  if (record.declaredBytes !== undefined && !isBoundedByteCount(record.declaredBytes)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'request.declaredBytes',
        `declaredBytes must be a safe integer in (0, ${MAX_DECLARED_BYTES}]`,
      ),
    ]);
  }
  const caller = validateHostCaller(record.caller, 'request.caller');
  if (!caller.ok) return caller;

  return ok(
    Object.freeze({
      requestId: record.requestId,
      lineageId: record.lineageId,
      targetRef: targetRef.value,
      outputRootScope: root.value,
      allowedOperation: S3_MEDIA_OPERATION,
      slice: S3_MEDIA_SLICE,
      ...(record.digestAnchor === undefined ? {} : { digestAnchor: record.digestAnchor }),
      ...(record.declaredBytes === undefined ? {} : { declaredBytes: record.declaredBytes }),
      caller: caller.value,
    }),
  );
}
