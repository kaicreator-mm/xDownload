/**
 * V022 A01 — neutral Host-operation contracts: direct-acquisition request.
 *
 * The narrow Host-facing DTO for the `acquisition.acquire` lane. Domain App
 * projects its validated Business Intent into exactly this shape; the
 * trusted Host independently validates it from `unknown` BEFORE any
 * physical effect (permit gate, registry resolution, network or filesystem
 * touch). Exact-key no-widening: unknown fields refuse, never drop.
 *
 * Frozen lane value: `allowedOperation` is pinned to `acquisition.acquire`
 * by the validator — the direct lane cannot be reused for another
 * operation. Pure contract layer: no I/O, no App/Host/Core imports.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';
import {
  isBoundedByteCount,
  isBoundedIntentField,
  isSha256Digest,
  MAX_DECLARED_BYTES,
} from './fields.ts';
import { validateOutputRoot } from './paths.ts';
import { exactKeys, stableRecord } from './records.ts';
import { validateOpaqueTargetRef } from './target-ref.ts';

/** Frozen direct-lane slice vocabulary (existing direct-acquisition lanes). */
export type DirectHostSlice = 'S1' | 'S3';

/** Bounded caller identity riding every direct Host request (auditable, opaque). */
export interface DirectHostCaller {
  readonly actor: string;
  readonly sessionRef: string;
}

/**
 * The direct Host acquisition request: the only payload the direct Host
 * bridge may execute against. Every field is bounded; nothing here can be
 * widened at runtime (exact-field validation below).
 */
export interface DirectHostAcquisitionRequest {
  readonly requestId: string;
  readonly lineageId: string;
  /** Opaque resolution token; only the trusted Host turns it into a locator. */
  readonly targetRef: string;
  /** Absolute authorized output root; the artifact must materialize inside. */
  readonly outputRootScope: string;
  /** Pinned to 'acquisition.acquire' by the validator. */
  readonly allowedOperation: 'acquisition.acquire';
  readonly slice: DirectHostSlice;
  /** Optional frozen digest anchor (lowercase 64-hex) for the full bytes. */
  readonly digestAnchor?: string;
  /** Optional declared total size, bounded for the v0.2 profile. */
  readonly declaredBytes?: number;
  readonly caller: DirectHostCaller;
}

const DIRECT_REQUEST_KEYS = [
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

const DIRECT_OPERATION = 'acquisition.acquire';
const DIRECT_OPTIONAL_KEYS = ['digestAnchor', 'declaredBytes'] as const;

/**
 * Exact-key fail-closed validation of a direct Host acquisition request
 * from untrusted input. This is the SINGLE direct-lane validator: App
 * projects into the DTO, Host validates it independently — no divergent
 * second validator may exist.
 */
export function validateDirectHostAcquisitionRequest(
  input: unknown,
): DomainValidationResult<DirectHostAcquisitionRequest> {
  const stable = stableRecord(input, 'request');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, DIRECT_REQUEST_KEYS, 'request', DIRECT_OPTIONAL_KEYS);
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
  if (record.allowedOperation !== DIRECT_OPERATION) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'request.allowedOperation',
        `direct Host request authorizes '${String(record.allowedOperation)}'; this lane executes only ${DIRECT_OPERATION}`,
      ),
    ]);
  }
  if (record.slice !== 'S1' && record.slice !== 'S3') {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'request.slice', "slice must be 'S1' or 'S3'"),
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
      allowedOperation: DIRECT_OPERATION,
      slice: record.slice,
      ...(record.digestAnchor === undefined ? {} : { digestAnchor: record.digestAnchor }),
      ...(record.declaredBytes === undefined ? {} : { declaredBytes: record.declaredBytes }),
      caller: caller.value,
    }),
  );
}

/** Shared bounded caller-identity grammar for both Host request DTOs. */
export function validateHostCaller(
  input: unknown,
  path: string,
): DomainValidationResult<DirectHostCaller> {
  const stable = stableRecord(input, path);
  if (!stable.ok) return stable;
  const keys = exactKeys(stable.value, ['actor', 'sessionRef'], path);
  if (!keys.ok) return keys;
  const actor = stable.value.actor;
  const sessionRef = stable.value.sessionRef;
  if (typeof actor !== 'string' || actor.length === 0 || actor.length > 128) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path + '.actor',
        'caller.actor must be a bounded string',
      ),
    ]);
  }
  if (typeof sessionRef !== 'string' || sessionRef.length === 0 || sessionRef.length > 256) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path + '.sessionRef',
        'caller.sessionRef must be bounded',
      ),
    ]);
  }
  return ok(Object.freeze({ actor, sessionRef }));
}
