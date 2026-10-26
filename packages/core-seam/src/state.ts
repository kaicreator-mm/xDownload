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
  /**
   * #153 the Core-owned immutable S4 preview record (one per lineage; the
   * preview intent and its observed result are both journaled). Identical
   * re-preview converges; a conflicting manifest URI under the same lineage
   * rejects (a changed source requires a successor contract).
   */
  s4Preview?: S4PreviewRecord;
  /** #153 durably confirmed S4 rendition selection (exactly one per lineage). */
  s4ConfirmedSelection?: S4ConfirmedSelectionRecord;
  /**
   * #151 the Core-owned frozen S5 current-page group record (one per
   * lineage; the PREPARE intent is journaled). Identical re-prepare
   * converges; a conflicting tuple under the same lineage rejects (a
   * changed observed page requires a successor contract).
   */
  s5PreparedGroup?: S5PreparedGroupRecord;
  /** #151 durably confirmed S5 page-group selection (exactly one per lineage). */
  s5ConfirmedGroup?: S5ConfirmedGroupRecord;
  /**
   * #151 Core-internal per-member S5 batch outcomes (Core-derived only; set
   * by the S5 execution driver alongside the lineage terminal, rebuilt by
   * restart reconcile — never writable by any surface command).
   */
  s5MemberOutcomes?: readonly S5MemberOutcomeRecord[];
  /**
   * #154 the Core-owned frozen S6 collection admission (one per lineage; the
   * PREPARE_S6_COLLECTION intent is journaled). Identical re-prepare
   * converges; a conflicting tuple under the same lineage rejects (a changed
   * collection/scope requires a successor contract).
   */
  s6PreparedCollection?: S6PreparedCollectionRecord;
  /**
   * #154 the Core-frozen observed collection pages (one record per recorded
   * page, in ascending page order; each RECORD intent is journaled). A page
   * outside the declared range or out of sequence is rejected at the gate;
   * the walk never widens the declared bounds.
   */
  s6Pages?: readonly S6PageRecord[];
  /** #154 durably confirmed S6 collection selection (exactly one per lineage). */
  s6ConfirmedCollection?: S6ConfirmedCollectionRecord;
  /**
   * #154 pages whose navigation intent was durably admitted (journaled
   * ADMIT_S6_COLLECTION_PAGE acceptances; replay rebuilds the set). The
   * first declared page needs no admit (it is the already-open current
   * page); every later page must be admitted BEFORE the browser navigates.
   */
  s6AdmittedPages?: readonly number[];
  /**
   * #154 Core-internal per-member S6 outcomes (Core-derived only; set by the
   * S6 execution driver alongside the lineage terminal, rebuilt by restart
   * reconcile — never writable by any surface command).
   */
  s6MemberOutcomes?: readonly S6MemberOutcomeRecord[];
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
  /**
   * Replay pin (L2 S3 §3): the supported-media registry content digest and
   * the profile's structural probe revision, BOTH Core-computed at
   * confirmation time. Execution/replay re-derives mandatory checks only
   * from a byte-identical registry; any change fails closed and requires a
   * fresh confirmation/successor snapshot.
   */
  readonly mediaProfilesDigest: string;
  readonly mediaProfileProbeRevision: number;
  readonly byteConstraintSha256?: string;
  readonly expectedTotalBytes?: number;
  readonly expectedContentTypePrefix?: string;
}

/**
 * #153 one Core-observed renderable rendition fact of a previewed master
 * (L2 SEAM12 §3): secret-free, projection-safe. `key` is the stable
 * selection handle the user confirms; `uri` is the exact master-declared
 * variant URI the later execution binds to.
 */
export interface S4RenditionFact {
  readonly key: string;
  readonly uri: string;
  readonly bandwidth: number;
  readonly codecs?: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * #153 the Core-owned immutable preview record (L2 SEAM12 §3 + the adopted
 * transport-delta §5 preview bootstrap): the preview intent is journaled
 * (PENDING) BEFORE the first HTTP read; the Core-observed master facts
 * (AVAILABLE) or the typed refusal (FAILED) are recorded through the trusted
 * Core-internal receipt port and journaled for restart replay. Short
 * Core-enforced TTL; a restart drops nothing durable but re-observation only
 * happens while the TTL window is still open (an expired PENDING preview
 * closes truthfully FAILED without a fetch).
 */
export interface S4PreviewRecord {
  readonly previewId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly manifestUri: string;
  readonly mediaProfileId: string;
  readonly status: 'PENDING' | 'AVAILABLE' | 'FAILED';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly variants?: readonly S4RenditionFact[];
  readonly failureReason?: string;
}

/**
 * #153 the durably confirmed S4 rendition selection (L2 SEAM12 §4): created
 * atomically with the single-use private-challenge consumption at the COMMIT
 * journal commit. Secret-free — the raw challenge never reaches durable
 * state; the journaled CONFIRM command carries exactly this record shape.
 */
export interface S4ConfirmedSelectionRecord {
  readonly confirmedSelectionId: string;
  readonly previewId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly manifestUri: string;
  readonly mediaProfileId: string;
  readonly renditionKey: string;
  readonly renditionUri: string;
  readonly displayedTupleDigest: string;
  readonly confirmedAt: string;
  readonly expiresAt: string;
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
  /**
   * #153 registered S4 selected-HLS execution intents (one per lineage):
   * the durably journaled EXECUTE_S4_SELECTED_HLS_VOD commands, rebuilt from
   * journal replay, awaiting/under runtime drive through the S4 flow.
   */
  readonly s4ExecutionIntents: Map<string, S4ExecutionIntent>;
  /**
   * #151 registered S5 current-page collection execution intents (one per
   * lineage): the durably journaled EXECUTE_S5_COLLECTION commands, rebuilt
   * from journal replay, awaiting/under runtime drive through the S5 flow.
   */
  readonly s5ExecutionIntents: Map<string, S5ExecutionIntent>;
  /**
   * #154 registered S6 explicit-collection execution intents (one per
   * lineage): the durably journaled EXECUTE_S6_COLLECTION commands, rebuilt
   * from journal replay, awaiting/under runtime drive through the S6 flow.
   */
  readonly s6ExecutionIntents: Map<string, S6ExecutionIntent>;
  /** Monotonic counter implementing the single Core control order for cancels. */
  cancelOrderCounter: number;
}

/** One registered S3 selected-media execution intent (rebuilt from journal). */
export interface S3ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly candidate: S3CandidateRecord;
}

/** #153 one registered S4 selected-HLS execution intent (rebuilt from journal). */
export interface S4ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly selection: S4ConfirmedSelectionRecord;
}

/**
 * #151 the Core-owned frozen S5 current-page group (the journaled
 * PREPARE_S5_PAGE_GROUP record). The frozen member set is immutable truth:
 * CONFIRM_S5_PAGE_GROUP may only select a subset of it, and the execution
 * driver derives every member delivery from it — a browser can never mint
 * this record, only the OS-verified PREPARE handler can.
 */
export interface S5PreparedGroupRecord {
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly pageOrigin: string;
  readonly provenanceKey: string;
  /** Core-minted immutable member identities joined to observed anchor facts. */
  readonly members: readonly {
    readonly memberId: string;
    readonly href: string;
    readonly text: string;
  }[];
  readonly observedTupleDigest: string;
  readonly status: 'AVAILABLE';
  readonly preparedAt: string;
}

/**
 * #151 the Core-constructed confirmed S5 page-group selection (the secret-
 * free journaled CONFIRM_S5_PAGE_GROUP COMMIT record). Core alone mints the
 * CONFIRMED contract and the BATCH selection snapshot over the frozen
 * members; the raw confirmation challenge never reaches durable state.
 */
export interface S5ConfirmedGroupRecord {
  readonly confirmedGroupId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
  readonly contract: AcquisitionContract;
  readonly snapshot: SelectionSnapshot;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

/**
 * #151 Core-internal per-member S5 outcome as recorded by the execution
 * driver (verbatim truth from the collection flow; presentation only).
 */
export interface S5MemberOutcomeRecord {
  readonly memberId: string;
  readonly href: string;
  readonly outcome: 'ACQUIRED' | 'AUTH_DENIED' | 'NOT_RUN';
  readonly accepted: boolean;
  readonly detail: string;
}

/** #151 one registered S5 collection execution intent (rebuilt from journal). */
export interface S5ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly confirmed: S5ConfirmedGroupRecord;
  readonly prepared: S5PreparedGroupRecord;
}

/**
 * #154 the Core-owned frozen S6 collection admission record (the journaled
 * PREPARE_S6_COLLECTION record). The explicit CollectionIdentity, the
 * user-confirmed finite page range and the observation provenance are
 * immutable truth: the declared range is the ONLY navigation bound (the
 * frozen validateScopeContinuationPair requires continuationScope NONE for
 * collection_page_range), and every page/member record must name THIS
 * prepare. A browser can never mint this record — only the OS-verified
 * PREPARE handler can.
 */
export interface S6PreparedCollectionRecord {
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly collectionOrigin: string;
  readonly provenanceKey: string;
  readonly collectionIdentity: string;
  readonly fromPage: number;
  readonly toPage: number;
  readonly observedTupleDigest: string;
  readonly status: 'AVAILABLE';
  readonly preparedAt: string;
}

/**
 * #154 one Core-frozen observed collection page (the journaled
 * RECORD_S6_COLLECTION_PAGE record). Core mints the member identities; the
 * observed member tuple digest is pinned for replay validation.
 */
export interface S6PageRecord {
  readonly pageNumber: number;
  /** Core-minted immutable member identities joined to observed anchor facts. */
  readonly members: readonly {
    readonly memberId: string;
    readonly href: string;
    readonly text: string;
  }[];
  readonly observedTupleDigest: string;
  readonly recordedAt: string;
}

/**
 * #154 the Core-constructed confirmed S6 collection selection (the secret-
 * free journaled CONFIRM_S6_COLLECTION COMMIT record). Core alone mints the
 * CONFIRMED contract and the BATCH selection snapshot over the frozen page
 * members; the raw confirmation challenge never reaches durable state.
 */
export interface S6ConfirmedCollectionRecord {
  readonly confirmedGroupId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
  readonly contract: AcquisitionContract;
  readonly snapshot: SelectionSnapshot;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

/**
 * #154 Core-internal per-member S6 outcome as recorded by the execution
 * driver (verbatim truth from the collection flow; presentation only).
 */
export interface S6MemberOutcomeRecord {
  readonly memberId: string;
  readonly href: string;
  readonly outcome: 'ACQUIRED' | 'AUTH_DENIED' | 'NOT_RUN';
  readonly accepted: boolean;
  readonly detail: string;
}

/** #154 one registered S6 collection execution intent (rebuilt from journal). */
export interface S6ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly confirmed: S6ConfirmedCollectionRecord;
  readonly prepared: S6PreparedCollectionRecord;
  /** The frozen observed pages this execution delivers from (range order). */
  readonly pages: readonly S6PageRecord[];
}

export function createSeamAuthorityState(): SeamAuthorityState {
  return {
    aggregates: new Map(),
    lineages: new Map(),
    accepted: new Map(),
    s3ExecutionIntents: new Map(),
    s4ExecutionIntents: new Map(),
    s5ExecutionIntents: new Map(),
    s6ExecutionIntents: new Map(),
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
 * through the trusted server API by the Core-runtime S1 driver, never
 * through a surface command; journaled BEFORE terminal authority so the
 * resolution fact survives restarts even when the process dies first (kill
 * before/after record), and replay re-establishes the identical witness
 * (identical replays converge, conflicting ones fail closed).
 */
export interface TargetWitnessJournalEntry {
  readonly kind: 'TARGET_WITNESS';
  readonly aggregateId: string;
  readonly receipt: TargetWitnessReceipt;
}

/**
 * #153 Core-internal durable S4 preview-result receipt: the truth the Core
 * actually observed when it read the previewed master (variants) or the typed
 * refusal. Written only through the trusted `recordS4PreviewResult` port by
 * the Core-runtime preview driver — never through a surface command — so the
 * renderable preview facts a surface later reads from the aggregate
 * projection are always Core-observed, never a CLI upload (L2 SEAM12 §2).
 */
export interface S4PreviewJournalEntry {
  readonly kind: 'S4_PREVIEW';
  readonly aggregateId: string;
  readonly record: S4PreviewRecord;
}

export type SeamJournalEntry =
  | AcceptedCommandJournalEntry
  | CoverageAccountingJournalEntry
  | TargetEvidenceJournalEntry
  | TargetWitnessJournalEntry
  | S4PreviewJournalEntry;

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
