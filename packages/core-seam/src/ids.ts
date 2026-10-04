/**
 * T004 seam-layer identities.
 *
 * Command/request idempotency identity, peer identity parts and revision
 * counters are seam-layer concepts and are nominally distinct from
 * `@xdownload/domain-contracts` branded ids (`ContractId`, `SnapshotId`,
 * `EffectId`, ...). They are never accepted as substitutes for domain
 * identity inside canonical payload values (IMPLEMENTATION_MAP "Identity
 * separation"); correlation fields that reference domain aggregates are
 * validated strings and are re-bound against decoded canonical values at
 * the authority gate.
 */

import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

declare const seamBrand: unique symbol;

/** Branded seam-layer identity; tag namespace is disjoint from domain id tags. */
export type SeamBranded<T extends string, Tag extends string> = T & {
  readonly [seamBrand]: Tag;
};

/** Idempotent command/request identity carried by every seam message. */
export type CommandRequestId = SeamBranded<string, 'CommandRequestId'>;
/** Same-install peer installation identity (application-level, same host). */
export type PeerInstallId = SeamBranded<string, 'PeerInstallId'>;
/** Same-user local identity (application-level, same host). */
export type PeerUserId = SeamBranded<string, 'PeerUserId'>;
/** Per-aggregate monotonic revision counter; distinct from any domain id. */
export type SeamRevision = number & { readonly [seamBrand]: 'SeamRevision' };

const SEAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function makeCommandRequestId(raw: string): SeamResult<CommandRequestId> {
  return decodeSeamId(raw, 'requestId');
}

export function makePeerInstallId(raw: string): SeamResult<PeerInstallId> {
  return decodeSeamId(raw, 'peer.installId');
}

export function makePeerUserId(raw: string): SeamResult<PeerUserId> {
  return decodeSeamId(raw, 'peer.userId');
}

function decodeSeamId<Tag extends string>(
  raw: string,
  path: string,
): SeamResult<SeamBranded<string, Tag>> {
  if (typeof raw !== 'string' || !SEAM_ID_PATTERN.test(raw)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        path,
        `expected a non-empty identifier of at most 128 characters matching ${String(SEAM_ID_PATTERN)}`,
      ),
    ]);
  }
  return seamOk(raw as SeamBranded<string, Tag>);
}

export function makeSeamRevision(raw: number): SeamResult<SeamRevision> {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'expectedRevision', 'expected a non-negative integer'),
    ]);
  }
  return seamOk(raw as SeamRevision);
}
