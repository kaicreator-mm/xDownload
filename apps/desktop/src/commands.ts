/**
 * T014 desktop command/query envelope assembly.
 *
 * The desktop surface builds and stamps idempotent command/query envelopes
 * and submits them through `@xdownload/core-seam` with a `DESKTOP_UI` peer
 * identity. Envelope payloads are *proposals* assembled from user intent:
 * they become canonical only when Core accepts them through its fail-closed
 * decode/admission gates. No authoritative contract/snapshot/result truth is
 * decided, derived or cached here (frozen L2 invariant 2; T004 seam
 * contract).
 *
 * Recorded F2 wiring choice: request/aggregates identities are derived
 * deterministically from a per-adapter monotonic counter so re-submission
 * across reconnects reuses the exact same idempotent identity (the
 * SeamClient re-send contract), and tests can reproduce every identity.
 */

import {
  currentSeamSchemaIdentity,
  type CommandEnvelope,
  type CommandType,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamCorrelation,
} from '@xdownload/core-seam';
import { makeCommandRequestId } from '@xdownload/core-seam';

/** The desktop surface kind is fixed: this adapter is the DESKTOP_UI peer. */
export function createDesktopPeer(input: {
  readonly installId: string;
  readonly userId: string;
}): PeerIdentity {
  return { installId: input.installId, userId: input.userId, surface: 'DESKTOP_UI' };
}

/**
 * Deterministic identity allocator (per adapter instance).
 *
 * The per-instance salt keeps request/aggregate identities distinct across
 * independent surface instances sharing one install (C13 concurrency): the
 * seam's idempotency gate keys on requestId, and two different logical
 * commands must never collide on one identity. Within one instance the
 * counter is monotonic, so re-sends of the SAME envelope reuse the exact
 * same idempotent identity.
 */
export class DesktopIdentitySequence {
  private next = 0;
  private readonly salt: string;

  constructor(salt?: string) {
    this.salt = salt ?? Math.random().toString(36).slice(2, 10);
  }

  requestId(): string {
    this.next += 1;
    return `req-desktop-${this.salt}-${String(this.next).padStart(6, '0')}`;
  }

  contractId(): string {
    this.next += 1;
    return `contract-desktop-${this.salt}-${String(this.next).padStart(6, '0')}`;
  }

  snapshotId(): string {
    this.next += 1;
    return `snapshot-desktop-${this.salt}-${String(this.next).padStart(6, '0')}`;
  }
}

export interface DesktopEnvelopeFacts {
  readonly peer: PeerIdentity;
  readonly aggregateId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly correlation?: SeamCorrelation;
}

/** Build one idempotent command envelope for the seam. */
export function desktopCommand(input: {
  readonly facts: DesktopEnvelopeFacts;
  readonly commandType: CommandType;
  readonly payload: unknown;
}): CommandEnvelope {
  const requestId = makeCommandRequestId(input.facts.requestId);
  if (!requestId.ok) {
    throw new Error(`desktop request id rejected by seam id rules: ${input.facts.requestId}`);
  }
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: input.facts.peer,
    requestId: requestId.value,
    aggregateId: input.facts.aggregateId,
    expectedRevision: input.facts.expectedRevision,
    correlation: input.facts.correlation ?? {},
    issuedAt: input.facts.issuedAt,
    payload: input.payload,
  };
}

/** Build one read-only projection query envelope for the seam. */
export function desktopProjectionQuery(input: {
  readonly peer: PeerIdentity;
  readonly aggregateId: string;
  readonly requestId: string;
  readonly issuedAt: string;
}): QueryEnvelope {
  const requestId = makeCommandRequestId(input.requestId);
  if (!requestId.ok) {
    throw new Error(`desktop request id rejected by seam id rules: ${input.requestId}`);
  }
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    queryType: 'READ_PROJECTION',
    peer: input.peer,
    requestId: requestId.value,
    aggregateId: input.aggregateId,
    issuedAt: input.issuedAt,
  };
}
