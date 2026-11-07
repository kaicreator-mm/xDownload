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
  type CommandRequestId,
  type CommandType,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamCorrelation,
  type SeamSchemaIdentity,
} from '@xdownload/core-seam';
import { makeCommandRequestId } from '@xdownload/core-seam';
import {
  diagnostic,
  fail,
  makeMemberId,
  makeSnapshotId,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';

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

// ---------------------------------------------------------------------------
// U05-T02: S1 direct-acquisition command assembly + S1 job-index query.
//
// The S1 execute command and the index query discriminant are vocabulary the
// frozen L2 U05 amendment adds to the existing legacy seam surface; the
// Core-side implementation lands with T01 (#351, schema 1.4.0). This module
// assembles the desktop's typed envelopes and payloads against those frozen
// contracts and validates everything fail-closed before routing; nothing here
// decides admission, status or terminal truth.
// ---------------------------------------------------------------------------

/** The reserved query subject of the read-only S1 job-index (L2 U05 §2). */
export const S1_JOB_INDEX_QUERY_SUBJECT = 'core:s1-job-index' as const;

/** The L2 U05 bound: the index returns at most the latest 200 projections. */
export const S1_JOB_INDEX_MAX_ITEMS = 200;

/**
 * The canonical artifact-identity shape the Core S1 gate enforces. There is
 * deliberately no domain factory for artifact identities, so the desktop
 * mirrors the exact pattern rather than inventing a weaker local rule.
 */
const S1_ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

/** The 128-character bound of the canonical composite effect identity. */
const S1_EFFECT_IDENTITY_MAX_LENGTH = 128;

/**
 * The opaque S1 execution identities. They are derived ONCE per logical
 * command (from the accepted contract identity) and preserved verbatim
 * across retry/reconnect — the seam's idempotency keys on the request
 * identity, and a re-invoked logical command must never mint divergent
 * identities (L2 U05 §3).
 */
export interface S1ExecutionIdentities {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
}

/**
 * Derive the canonical S1 snapshot/member/artifact identities for one
 * accepted contract. The derivation is deterministic (same contract → same
 * identities), so a re-derived set always equals the preserved one; the
 * canonical id factories still fail closed on any pattern violation.
 */
export function deriveS1ExecutionIdentities(
  contractId: string,
): DomainValidationResult<S1ExecutionIdentities> {
  const base = contractId.replace(/^contract-/, '').slice(-16);
  const snapshotId = makeSnapshotId(`s1snap-${base}`);
  if (!snapshotId.ok) {
    return rebindFailure(snapshotId);
  }
  const memberId = makeMemberId(`s1member-${base}`);
  if (!memberId.ok) {
    return rebindFailure(memberId);
  }
  const artifactId = `s1artifact-${base}`;
  if (!S1_ARTIFACT_ID_PATTERN.test(artifactId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'artifactId',
        'derived artifact identity does not match the canonical artifact id pattern',
      ),
    ]);
  }
  return {
    ok: true,
    value: { snapshotId: snapshotId.value, memberId: memberId.value, artifactId },
  };
}

/** The canonical composite effect identity bound the Core S1 gate enforces. */
export function s1CompositeEffectIdentity(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly requestedTarget: string;
}): string {
  return `effect:${input.contractId}:${input.snapshotId}:${input.requestedTarget}`;
}

export function s1EffectIdentityWithinBound(effectIdentity: string): boolean {
  return effectIdentity.length <= S1_EFFECT_IDENTITY_MAX_LENGTH;
}

/** The S1 delivery facts: the U05 form carries the locator and the URL's own host only. */
export interface S1DeliveryFacts {
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
}

/** The closed S1 execution payload (no digest/content-type/total-byte fields in U05). */
export interface S1DirectExecutionPayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly delivery: S1DeliveryFacts;
}

/**
 * Build the S1 execution payload for one accepted contract and the locator
 * this surface submitted. `declaredRedirectHosts` defaults to exactly the
 * URL's own `host` (port included), matching the CLI default; the optional
 * independently-published digest/content-type/total-byte fields stay absent
 * from the U05 form. The locator re-passes the Core's HTTP(S) gate shape
 * here, fail closed, before anything is routed.
 */
export function buildS1DirectExecutionPayload(input: {
  readonly identities: S1ExecutionIdentities;
  readonly locatorUri: string;
}): DomainValidationResult<S1DirectExecutionPayload> {
  const locator = input.locatorUri;
  if (typeof locator !== 'string' || locator.length === 0 || hasWhitespaceOrControl(locator)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'delivery.locatorUri',
        'S1 locator must be a non-empty string without control characters or whitespace',
      ),
    ]);
  }
  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'delivery.locatorUri',
        'S1 locator is not a valid URL',
      ),
    ]);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'delivery.locatorUri',
        'S1 locator must be an http(s) URL',
      ),
    ]);
  }
  if (parsed.host.length === 0) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'delivery.locatorUri', 'S1 locator has no host'),
    ]);
  }
  return {
    ok: true,
    value: {
      snapshotId: input.identities.snapshotId,
      memberId: input.identities.memberId,
      artifactId: input.identities.artifactId,
      delivery: { locatorUri: locator, declaredRedirectHosts: [parsed.host] },
    },
  };
}

function hasWhitespaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * One typed `LIST_S1_JOB_PROJECTIONS` query envelope. The closed seam query
 * vocabulary gains this discriminant with the T01 Core-side index (schema
 * 1.4.0); until that integration lands, the desktop types the envelope
 * itself and bridges it through the unchanged client surface at the single
 * documented call site in the adapter.
 */
export interface DesktopS1JobIndexQueryEnvelope {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'query';
  readonly queryType: 'LIST_S1_JOB_PROJECTIONS';
  readonly peer: PeerIdentity;
  readonly requestId: CommandRequestId;
  readonly aggregateId: typeof S1_JOB_INDEX_QUERY_SUBJECT;
  readonly issuedAt: string;
}

/** Build the read-only S1 job-index query envelope (reserved subject, no user filter). */
export function desktopS1JobIndexQuery(input: {
  readonly peer: PeerIdentity;
  readonly requestId: string;
  readonly issuedAt: string;
}): DesktopS1JobIndexQueryEnvelope {
  const requestId = makeCommandRequestId(input.requestId);
  if (!requestId.ok) {
    throw new Error(`desktop request id rejected by seam id rules: ${input.requestId}`);
  }
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    queryType: 'LIST_S1_JOB_PROJECTIONS',
    peer: input.peer,
    requestId: requestId.value,
    aggregateId: S1_JOB_INDEX_QUERY_SUBJECT,
    issuedAt: input.issuedAt,
  };
}

/** Re-binding helper for shared fail-closed id validation results. */
function rebindFailure<T>(result: DomainValidationResult<unknown>): DomainValidationResult<T> {
  return result as DomainValidationResult<T>;
}
