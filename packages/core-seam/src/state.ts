/**
 * T004 Core-owned authority state representation at the seam.
 *
 * This is the in-package seam representation of Core authority — enough to
 * prove idempotent acceptance, revision gating, lineage control order and
 * restart replay at the boundary. It is NOT the production persistence
 * ledger (T005), scheduler (T006) or result projector (T007): durable
 * storage is behind the `SeamJournal` port and the durable command/effect
 * ledger remains a downstream lane. The only writer of this state is the
 * seam server pipeline (frozen L2 invariant 1 / ADR-001).
 */

import type {
  AcquisitionContract,
  CoverageAccounting,
  EvidenceRecord,
  MemberId,
  SelectionSnapshot,
  TerminalResult,
} from '@xdownload/domain-contracts';
import type { CommandEnvelope, SeamResponse } from './envelope.ts';
import type { CommandRequestId } from './ids.ts';

export type LineageStatus = 'ACTIVE' | 'CANCELLED' | 'TERMINAL';

/**
 * The durable, secret-free typed Target evidence basis + certainty of one
 * successful S1 record (#101 P2-2, C34): which identity basis validated the
 * target, how decisive that claim is, and the exact artifact/effect identity
 * it belongs to. Written only through the trusted Core-runtime receipt port;
 * no locator/query/cookie material ever enters it.
 */
export interface TargetEvidenceReceipt {
  /** The artifact store identity this basis certifies. */
  readonly artifactId: string;
  /** The frozen effect identity of the executed lineage. */
  readonly effectId: string;
  /** Lowercase hex SHA-256 of the durably accepted bytes. */
  readonly artifactSha256: string;
  /** C34 identity basis: publisher-digest anchor or requested-locator provenance. */
  readonly basis: 'PUBLISHED_SHA256' | 'REQUESTED_LOCATOR_PROVENANCE';
  /** DECISIVE for the publisher-digest anchor, PROBATIVE for provenance. */
  readonly certaintyClass: 'DECISIVE' | 'PROBATIVE';
}

/**
 * Core-private, durable S1 requested-target-resolution witness (#113, #103
 * §2.2 T007 separation): the immutable fact that the user-selected delivery
 * locator + declared redirect graph actually served the frozen requested
 * member for one exact contract/snapshot/effect execution — recorded BEFORE
 * any terminal authority is handed over, including when the transfer's bytes
 * failed validation or no bytes were accepted at all. Written only by the
 * trusted Core-runtime S1 driver from its own observed transfer truth; no
 * surface/AI/Recipe command can inject one. Secret-free: hosts only, never
 * credentials/tokens/cookies. The resolved Target identity is distinct from
 * artifact acceptance; `PROVENANCE_UNPROVEN` is distinct from auth/unsupported.
 */
export interface TargetWitnessReceipt {
  /** The frozen snapshot identity of the executed lineage. */
  readonly snapshotId: string;
  /** The sole frozen requested member this witness is bound to. */
  readonly memberId: string;
  /** The artifact-store identity the attempt targeted (bytes may be absent). */
  readonly artifactId: string;
  /** The frozen canonical effect identity of the executed lineage. */
  readonly effectId: string;
  /** The user-selected delivery locator the witness is bound to. */
  readonly locatorUri: string;
  /** The declared delivery-graph hosts (selected host + authorized redirects). */
  readonly declaredRedirectHosts: readonly string[];
  /** Hosts the attempt actually traversed, in hop order (secret-free). */
  readonly observedRedirectHosts: readonly string[];
  /**
   * RESOLVED: the declared delivery graph actually served the frozen target
   * (bytes arrived through it). PROVENANCE_UNPROVEN: the attempt stopped
   * inside the delivery graph itself (undeclared redirect/locator
   * substitution) — no reliable requested-locator fact exists.
   */
  readonly status: 'RESOLVED' | 'PROVENANCE_UNPROVEN';
  /** True only when a real transfer was attempted. */
  readonly transferAttempted: boolean;
  /**
   * Present iff status === 'RESOLVED': the validated identity basis. The
   * publisher-digest anchor with DECISIVE certainty is recorded only when the
   * durably accepted bytes actually matched it; a failed/unaccepted transfer
   * resolves on the REQUESTED_LOCATOR_PROVENANCE basis (PROBATIVE) alone.
   */
  readonly basis?: 'PUBLISHED_SHA256' | 'REQUESTED_LOCATOR_PROVENANCE';
  readonly certaintyClass?: 'DECISIVE' | 'PROBATIVE';
  /**
   * Present iff status === 'PROVENANCE_UNPROVEN': the canonical terminal
   * reason the delivery graph failed closed with.
   */
  readonly unprovenReason?: string;
}

export interface ContractAggregate {
  readonly contract: AcquisitionContract;
  /** Monotonic per-aggregate revision; starts at 1 on creation. */
  revision: number;
}

export interface LineageState {
  status: LineageStatus;
  snapshot?: SelectionSnapshot;
  /** Durable cancel order among control transitions (single Core order, L2 §11). */
  cancelOrder?: number;
  terminal?: TerminalResult;
  /**
   * Trusted Core-runtime Target evidence receipt (#101 P2-2). Internal
   * authority state only: surfaces cannot write it through the command
   * vocabulary. Journaled for restart replay so the recorded identity basis
   * survives restarts identically.
   */
  targetEvidence?: TargetEvidenceReceipt;
  /**
   * Trusted Core-runtime S1 target-resolution witness (#113). Internal
   * authority state only: surfaces cannot write it through the command
   * vocabulary. Journaled for restart replay so the durable resolution fact
   * exists before terminal truth and survives restarts identically.
   */
  targetWitness?: TargetWitnessReceipt;
  /**
   * Trusted Core-runtime CoverageAccounting receipt. This is internal authority
   * state only: surfaces cannot write it through the command vocabulary.
   */
  coverageAccounting?: CoverageAccounting;
  /**
   * #150 durably confirmed S3 selected-media candidate for this lineage:
   * the immutable journaled CONFIRM_S3_CANDIDATE payload (one per lineage
   * key `(contractId,snapshotId,memberId)`; identical re-confirmation
   * converges, a different tuple rejects). Rebuilt from the accepted-command
   * journal on restart replay; never writable by any other command.
   */
  s3Candidate?: S3CandidateRecord;
  /** Original failed-member identity domain (the only legal retry domain, C12). */
  failedMembers: MemberId[];
  /** Members whose explicit retry has been authorized through the seam. */
  retriedMembers: MemberId[];
}

/**
 * The frozen, secret-free confirmed S3 candidate (#150, L2 S3 §2.4). Stored
 * verbatim from the decoded CONFIRM_S3_CANDIDATE payload — the journal
 * entry IS the durable record; this typed view rides the lineage only.
 */
export interface S3CandidateRecord {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly variantKey: string;
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  readonly mediaProfileId: string;
  readonly byteConstraintSha256?: string;
  readonly expectedTotalBytes?: number;
  readonly expectedContentTypePrefix?: string;
}

export function createLineageState(): LineageState {
  return { status: 'ACTIVE', failedMembers: [], retriedMembers: [] };
}

export interface AcceptedCommand {
  readonly envelope: CommandEnvelope;
  readonly response: SeamResponse;
  /** Canonical payload digest at acceptance time (conflict detection). */
  readonly payloadDigest: string;
}

/**
 * The full seam authority state. Maps are keyed by aggregate/request id
 * strings; canonical identity semantics live in the domain values.
 */
export interface SeamAuthorityState {
  readonly aggregates: Map<string, ContractAggregate>;
  readonly lineages: Map<string, LineageState>;
  readonly accepted: Map<CommandRequestId, AcceptedCommand>;
  /**
   * #150 registered S3 selected-media execution intents (one per lineage):
   * the durably journaled EXECUTE_S3_SELECTED_MEDIA commands, rebuilt from
   * journal replay, awaiting/under runtime drive through the S3 flow.
   */
  readonly s3ExecutionIntents: Map<string, S3ExecutionIntent>;
  /** Monotonic counter implementing the single Core control order for cancels. */
  cancelOrderCounter: number;
}

/** One registered S3 selected-media execution intent (rebuilt from journal). */
export interface S3ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly candidate: S3CandidateRecord;
}

export function createSeamAuthorityState(): SeamAuthorityState {
  return {
    aggregates: new Map(),
    lineages: new Map(),
    accepted: new Map(),
    s3ExecutionIntents: new Map(),
    cancelOrderCounter: 0,
  };
}

/** One durably accepted surface command + its response; replay input after restart. */
export interface AcceptedCommandJournalEntry {
  /**
   * Optional only for backward-compatible replay of journals written before
   * the Core-fact discriminator existed.
   */
  readonly kind?: 'COMMAND';
  readonly envelope: CommandEnvelope;
  readonly response: SeamResponse;
  readonly payloadDigest: string;
}

/**
 * Core-internal durable CoverageAccounting receipt. It is written only through
 * the trusted server API, never through a surface command.
 */
export interface CoverageAccountingJournalEntry {
  readonly kind: 'COVERAGE_ACCOUNTING';
  readonly aggregateId: string;
  readonly accounting: CoverageAccounting;
  /** Immutable oracle-grade authorization witnesses; validated on write and replay. */
  readonly classificationEvidence: readonly EvidenceRecord[];
}

/**
 * Core-internal durable Target evidence receipt (#101 P2-2). Written only
 * through the trusted server API, never through a surface command; replay
 * re-establishes the identical recorded basis after restart.
 */
export interface TargetEvidenceJournalEntry {
  readonly kind: 'TARGET_EVIDENCE';
  readonly aggregateId: string;
  readonly receipt: TargetEvidenceReceipt;
}

/**
 * Core-internal durable S1 target-resolution witness (#113). Written only
 * through the trusted server API by the Core-runtime S1 driver, never through
 * a surface command; journaled BEFORE terminal authority so the resolution
 * fact survives restarts even when the process dies first (kill before/after
 * record), and replay re-establishes the identical witness (identical
 * replays converge, conflicting ones fail closed).
 */
export interface TargetWitnessJournalEntry {
  readonly kind: 'TARGET_WITNESS';
  readonly aggregateId: string;
  readonly receipt: TargetWitnessReceipt;
}

export type SeamJournalEntry =
  | AcceptedCommandJournalEntry
  | CoverageAccountingJournalEntry
  | TargetEvidenceJournalEntry
  | TargetWitnessJournalEntry;

/**
 * Persistence port for accepted commands. T004 ships only the port and an
 * in-memory concern-test representation; the durable Core-owned ledger is
 * T005. Production implementations must be Core-authoritative writers.
 */
export type SeamJournalAppendResult =
  | { readonly status: 'COMMITTED' }
  | { readonly status: 'NOT_COMMITTED'; readonly error: string }
  | { readonly status: 'UNCERTAIN'; readonly error: string };

export interface SeamJournal {
  /**
   * Append one authority record with an explicit durability outcome.
   *
   * COMMITTED means the implementation has crossed its durable commit point.
   * NOT_COMMITTED means it can prove no durable authority was created.
   * UNCERTAIN means callers must stop/recover rather than report success or
   * rejection, because restart may reveal either durable outcome.
   */
  append(entry: SeamJournalEntry): SeamJournalAppendResult;
  replayAll(): readonly SeamJournalEntry[];
}

/** In-memory journal for concern tests and deterministic restart simulation. */
export function createInMemorySeamJournal(): SeamJournal {
  const entries: SeamJournalEntry[] = [];
  return {
    append(entry) {
      entries.push(entry);
      return { status: 'COMMITTED' };
    },
    replayAll() {
      return [...entries];
    },
  };
}
