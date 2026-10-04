/**
 * T008 shared test fixtures: deterministic payloads, digest anchors, canonical
 * request factory and budget profiles. Tests construct canonical requests and
 * assert canonical outcomes only — never incidental internal structures.
 */

import { createHash } from 'node:crypto';
import {
  bindLocator,
  decodeBudgetProfile,
  makeEffectId,
  makeEvidenceId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type BudgetProfile,
  type EffectId,
  type EvidenceId,
  type LocatorBinding,
  type LogicalTargetId,
  type MemberId,
} from '@xdownload/domain-contracts';
import type { DirectTransferRequest } from '../../src/index.ts';

/** Decoded branded-id helpers for fixtures. */
export const effectIdOf = (raw: string): EffectId => unwrapOrThrow(makeEffectId(raw));
export const targetIdOf = (raw: string): LogicalTargetId => unwrapOrThrow(makeLogicalTargetId(raw));
export const evidenceIdOf = (raw: string): EvidenceId => unwrapOrThrow(makeEvidenceId(raw));
export const memberIdOf = (raw: string): MemberId => unwrapOrThrow(makeMemberId(raw));

/** Deterministic byte payload of a given size (repeating pattern). */
export function payload(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index + seed) % 251;
  }
  return bytes;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface TransferProfileOverrides {
  readonly maxBytes?: number;
  readonly maxRetryTransferRequests?: number;
  readonly discoveryMaxGeneratedRequests?: number;
  readonly globalMaxTotalGeneratedRequests?: number;
}

/** Complete canonical budget profile with only transfer-relevant limits set. */
export function transferProfile(overrides: TransferProfileOverrides = {}): BudgetProfile {
  return unwrapOrThrow(
    decodeBudgetProfile({
      discovery: {
        domain: 'discovery',
        ...(overrides.discoveryMaxGeneratedRequests === undefined
          ? {}
          : { maxGeneratedRequests: overrides.discoveryMaxGeneratedRequests }),
      },
      transfer: {
        domain: 'transfer',
        ...(overrides.maxBytes === undefined ? {} : { maxBytes: overrides.maxBytes }),
        ...(overrides.maxRetryTransferRequests === undefined
          ? {}
          : { maxRetryTransferRequests: overrides.maxRetryTransferRequests }),
      },
      globalSafety: {
        domain: 'global_safety',
        ...(overrides.globalMaxTotalGeneratedRequests === undefined
          ? {}
          : { maxTotalGeneratedRequests: overrides.globalMaxTotalGeneratedRequests }),
      },
    }),
  );
}

export interface RequestOverrides {
  readonly effectId?: string;
  readonly contractId?: string;
  readonly slice?: 'S1' | 'S3';
  readonly selectedMemberId?: string;
  readonly targetId?: string;
  readonly binding?: LocatorBinding<LogicalTargetId>;
  readonly expectedSha256?: string;
  readonly expectedTotalBytes?: number;
  readonly allowedRedirectHosts?: readonly string[];
  readonly attempt?: number;
  readonly mediaPolicy?: DirectTransferRequest['mediaPolicy'];
  readonly retryLineage?: { readonly effectId: string; readonly targetId: string };
}

/** Canonical direct-transfer request for the given payload/locator facts. */
export function directRequest(
  fixtureBaseUri: string,
  path: string,
  body: Uint8Array,
  overrides: RequestOverrides = {},
): DirectTransferRequest {
  const targetName = overrides.targetId ?? 'target-file-001';
  const initialUri = `${fixtureBaseUri}${path}`;
  const binding =
    overrides.binding ??
    unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: initialUri }, targetIdOf(targetName), {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: initialUri,
      }),
    );
  return {
    effectId: effectIdOf(overrides.effectId ?? 'effect-001'),
    contractId: overrides.contractId ?? 'contract-single-001',
    slice: overrides.slice ?? 'S1',
    selectedMemberId: memberIdOf(overrides.selectedMemberId ?? 'member-file-001'),
    binding,
    expectedSha256: overrides.expectedSha256 ?? sha256(body),
    ...(overrides.expectedTotalBytes === undefined
      ? {}
      : { expectedTotalBytes: overrides.expectedTotalBytes }),
    allowedRedirectHosts: overrides.allowedRedirectHosts ?? [new URL(fixtureBaseUri).host],
    attempt: overrides.attempt ?? 0,
    ...(overrides.mediaPolicy === undefined ? {} : { mediaPolicy: overrides.mediaPolicy }),
    ...(overrides.retryLineage === undefined
      ? {}
      : {
          retryLineage: {
            effectId: effectIdOf(overrides.retryLineage.effectId),
            targetId: targetIdOf(overrides.retryLineage.targetId),
          },
        }),
  };
}
