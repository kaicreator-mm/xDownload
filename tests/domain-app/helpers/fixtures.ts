/**
 * T10 validation-harness deterministic factories (task-owned, independent
 * implementation of the established direct-acquisition helper patterns):
 * byte payloads with stable digests, canonical confirmed-intent requests and
 * id helpers. Every value is a pure function of its arguments — no clock, no
 * randomness — so baselines stay reproducible across runs.
 */

import { createHash } from 'node:crypto';
import {
  makeContractId,
  makeEvidenceId,
  makeMemberId,
  makeSnapshotId,
  makeValidationRecordId,
  unwrapOrThrow,
  validateConfirmedIntent,
  type ConfirmedDownloadIntent,
  type DomainValidationResult,
} from './contracts.ts';

/** Single fixed ISO-8601 stamp: recorded timestamps never flake a baseline. */
export const FIXED_STAMP = '2026-01-01T00:00:00.000Z';

/** Deterministic byte payload of the given size (repeating bounded pattern). */
export function payload(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index + seed) % 251;
  }
  return bytes;
}

/** Deterministic prefix of a payload: the bytes a truncated transfer leaves. */
export function payloadPrefix(size: number, written: number, seed = 0): Uint8Array {
  if (written < 0 || written > size) {
    throw new Error(
      `payloadPrefix: written ${String(written)} out of bounds for size ${String(size)}`,
    );
  }
  return payload(size, seed).subarray(0, written);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Assert-style unwrap: throws with the typed diagnostics on refusal. */
export function unwrapOk<T>(result: DomainValidationResult<T>): T {
  return unwrapOrThrow(result);
}

export const contractIdOf = (raw: string) => unwrapOk(makeContractId(raw));
export const memberIdOf = (raw: string) => unwrapOk(makeMemberId(raw));
export const snapshotIdOf = (raw: string) => unwrapOk(makeSnapshotId(raw));
export const evidenceIdOf = (raw: string) => unwrapOk(makeEvidenceId(raw));
export const validationRecordIdOf = (raw: string) => unwrapOk(makeValidationRecordId(raw));

export interface IntentOverrides {
  readonly requestId?: string;
  readonly lineageId?: string;
  readonly targetRef?: string;
  readonly outputRootScope?: string;
  readonly allowedOperation?: string;
  readonly slice?: 'S1' | 'S3';
  readonly digestAnchor?: string;
  readonly declaredBytes?: number;
  readonly actor?: string;
  readonly sessionRef?: string;
  /** Build the intent WITHOUT a digest anchor (no-anchor negative basis). */
  readonly omitDigestAnchor?: boolean;
  readonly omitDeclaredBytes?: boolean;
}

/**
 * Canonical S1 confirmed intent bound to a concrete payload digest. The
 * factory returns the *decoded* intent, so a valid construction is proven
 * every time one is built, never assumed.
 */
export function confirmedIntent(
  digestOfBody: string,
  overrides: IntentOverrides = {},
): ConfirmedDownloadIntent {
  const raw = {
    requestId: overrides.requestId ?? 'req-t10-001',
    lineageId: overrides.lineageId ?? 'lineage-t10-001',
    targetRef: overrides.targetRef ?? 'ref:t10-target-001',
    outputRootScope: overrides.outputRootScope ?? 'C:/tmp/t10-authorized-root',
    allowedOperation: overrides.allowedOperation ?? 'acquisition.acquire',
    slice: overrides.slice ?? ('S1' as const),
    ...(overrides.omitDigestAnchor === true
      ? {}
      : { digestAnchor: overrides.digestAnchor ?? digestOfBody }),
    ...(overrides.omitDeclaredBytes === true
      ? {}
      : { declaredBytes: overrides.declaredBytes ?? 1024 }),
    caller: {
      actor: overrides.actor ?? 't10-harness',
      sessionRef: overrides.sessionRef ?? 'session-t10-001',
    },
  };
  return unwrapOk(validateConfirmedIntent(raw));
}
