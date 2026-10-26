/**
 * T004 Core command/query authority server — the transport-neutral seam port.
 *
 * Pipeline per inbound frame (fail closed at every arrow; never begin an
 * authority transition before authorization, bounds, version and decode all
 * pass — EXECUTION_CONTRACT flow / REFERENCE_PACK §3.1):
 *
 *   raw frame bytes
 *   → JSON framing integrity (corrupt framing rejects)
 *   → declared structural bounds (depth/fields/strings/arrays; pre-decode)
 *   → envelope version/shape decode (closed vocabularies, explicit version gate)
 *   → peer identity verification + same-install/same-user authorization (per frame)
 *   → declared payload byte bound (before any parse into authority state)
 *   → idempotency gate (duplicate converges / conflicting duplicate rejects)
 *   → revision gate (stale expected revision rejects)
 *   → payload decode via @xdownload/domain-contracts (canonical value or typed rejection)
 *   → Core-owned authority transition / projection read
 *   → response envelope (acceptance, typed rejection, or read-only projection)
 *
 * This server owns ALL authority transitions representable at the seam.
 * Surfaces (CLI/Desktop/Browser-shaped clients) submit commands and read
 * projections; they never own Core lifetime and never gain a second writer
 * path (frozen L2 invariant 1/2, ADR-001/010/012).
 */

import {
  assertContractTransition,
  createDomainGateway,
  canServeAsIndependentValidationOracle,
  coverageTargetFor,
  decodeAcquisitionContract,
  decodeEvidenceRecord,
  decodeSelectionSnapshot,
  makeMemberId,
  makeSnapshotId,
  type AcquisitionContract,
  type CoverageAccounting,
  type EvidenceLedger,
  type EvidenceRecord,
  type DomainGateway,
  type DomainValidationResult,
  type MemberId,
  type TerminalResult,
  type TerminalResultContext,
} from '@xdownload/domain-contracts';
import {
  checkStructureBounds,
  payloadByteLength,
  stableStringify,
  SEAM_MESSAGE_LIMITS,
} from './bounds.ts';
import {
  domainDiagnosticsToSeam,
  seamDiagnostic,
  seamFail,
  seamOk,
  type SeamDiagnostic,
  type SeamResult,
} from './diagnostics.ts';
import {
  currentSeamSchemaIdentity,
  decodeSeamEnvelope,
  type CommandEnvelope,
  type QueryEnvelope,
  type SeamAcceptance,
  type SeamResponse,
} from './envelope.ts';
import type { CommandRequestId } from './ids.ts';
import { createHash, randomBytes } from 'node:crypto';
import {
  S4_PUBLIC_MEDIA_PROFILE_ID,
  S4_SEAM12_COMMAND_TYPES,
  s4SelectionTupleDigest,
  type S4ConfirmBeginPayload,
  type S4ConfirmCommitPayload,
  type S4ExecutePayload,
  type S4PreviewPayload,
} from './s4-seam12-payload.ts';
import {
  S3_SEAM12_COMMAND_TYPES,
  s3SelectionTupleDigest,
  type S3ConfirmCandidatePayload,
  type S3ExecuteMediaPayload,
  type S3SelectionChallengeRequestPayload,
  type S3Seam12CommandType,
} from './s3-seam12-payload.ts';
import {
  S5_SEAM12_COMMAND_TYPES,
  s5GroupTupleDigest,
  s5SelectionTupleDigest,
  type S5ConfirmBeginPayload,
  type S5ConfirmCommitPayload,
  type S5ExecutePayload,
  type S5PreparePayload,
  type S5Seam12CommandType,
} from './s5-seam12-payload.ts';
import {
  S6_SEAM12_COMMAND_TYPES,
  s6CollectionTupleDigest,
  s6PageTupleDigest,
  s6SelectionTupleDigest,
  type S6AdmitPagePayload,
  type S6ConfirmBeginPayload,
  type S6ConfirmCommitPayload,
  type S6ExecutePayload,
  type S6PreparePayload,
  type S6RecordPagePayload,
  type S6Seam12CommandType,
} from './s6-seam12-payload.ts';
import {
  assertPeerTransportAuthorization,
  type VerifiedPeerSessionPort,
} from './verified-session.ts';
import { authorizePeer, type ExpectedPeerScope, type PeerIdentity } from './peer.ts';
import { projectAggregate, type SeamProjectionView } from './projection.ts';
import {
  createLineageState,
  createSeamAuthorityState,
  type AcceptedCommand,
  type AcceptedCommandJournalEntry,
  type LineageState,
  type S3CandidateRecord,
  type S3ExecutionIntent,
  type S4ConfirmedSelectionRecord,
  type S4ExecutionIntent,
  type S4PreviewRecord,
  type S4RenditionFact,
  type S5ConfirmedGroupRecord,
  type S5ExecutionIntent,
  type S5MemberOutcomeRecord,
  type S5PreparedGroupRecord,
  type S6ConfirmedCollectionRecord,
  type S6ExecutionIntent,
  type S6MemberOutcomeRecord,
  type S6PageRecord,
  type S6PreparedCollectionRecord,
  type SeamAuthorityState,
  type SeamJournal,
  type TargetEvidenceReceipt,
  type TargetWitnessReceipt,
} from './state.ts';

/**
 * Core-internal bridge for the durably committed user cancel order (#101
 * P2-1). Implemented by the Core runtime composition; never by a surface.
 * Fired strictly AFTER a `CANCEL_LINEAGE` command's accepted-command journal
 * commit, so the bridge only ever connects *durably committed* cancellation
 * authority into the canonical Core stores (scheduler + durable ledger) and
 * the abort checkpoint of any in-flight S1 transfer. Absent → the seam's
 * cancel stays a seam-authority fact only (legacy compositions).
 */
export interface S1LineageCancelBridge {
  cancelled(input: {
    readonly aggregateId: string;
    /** The cancelling command's surface, for the durable cancel-fact provenance. */
    readonly source: PeerIdentity['surface'];
  }): void;
}

export interface CoreSeamServerOptions {
  /** The only same-install/same-user peer scope this seam admits. */
  readonly expectedPeer: ExpectedPeerScope;
  /** Accepted-command journal; enables restart replay. Production port is T005. */
  readonly journal?: SeamJournal;
  /**
   * Core-internal executor for `EXECUTE_S2_ACQUISITION` (#95). Implemented by
   * the Core runtime composition over its canonical durable lifecycle; never
   * by a surface. Absent → the command fails closed (and journal replay of a
   * durably accepted S2 execution fails composition, never silently skips).
   */
  readonly s2DeliveredAcquisition?: S2DeliveredAcquisitionExecutor;
  /**
   * Core-internal beginner for `EXECUTE_S1_DIRECT_ACQUISITION` (#101 first
   * slice). The command's synchronous authority apply only registers one
   * durable execution intent (journaled with the command); the runtime
   * begins the real HTTP transfer strictly AFTER the accepted-command
   * journal commit through this port, and completes the lineage terminal
   * through `recordExecutedTerminal` (re-derived from durable truth on
   * restart replay — a submission ACK is never acquisition success).
   * Absent → the command fails closed.
   */
  readonly s1DirectAcquisition?: S1DirectAcquisitionBeginner;
  /**
   * Core-internal bridge connecting the durably committed user cancel order
   * into the canonical Core stores and the in-flight S1 transfer abort
   * checkpoint (#101 P2-1). Fired after the CANCEL_LINEAGE journal commit;
   * the bridge self-filters aggregates without a registered S1 execution, so
   * other lanes (e.g. synchronous S2 delivery) are unaffected. Absent → the
   * cancel remains a seam-authority fact only.
   */
  readonly s1LineageCancel?: S1LineageCancelBridge;
  /**
   * #150: the Core-owned closed supported-media profile registry behind S3
   * candidate admission (L2 S3 §2.4). Presence INSTALLS the private S3 1.2
   * command handlers behind the OS-verified session gate; absence keeps every
   * S3 command failing closed exactly as before (legacy compositions).
   */
  readonly s3MediaProfiles?: S3MediaProfilePort;
  /**
   * #150: clock/TTL knobs of the Core-issued one-time selection challenges.
   * Test compositions inject a deterministic clock; default is wall time with
   * a 120s single-use lifetime.
   */
  readonly s3Challenge?: { readonly ttlMs?: number; readonly now?: () => number };
  /**
   * #150: post-commit driver for one registered S3 selected-media execution.
   * The command's synchronous authority apply only registers one durable
   * execution intent (journaled with the command); the runtime begins the
   * real HTTP transfer strictly AFTER the accepted-command journal commit
   * through this port and completes the lineage terminal through
   * `recordExecutedTerminal`. Absent → EXECUTE_S3_SELECTED_MEDIA fails
   * closed while the confirmed candidate stays durable.
   */
  readonly s3SelectedMedia?: S3SelectedMediaBeginner;
  /**
   * #153: clock/TTL knobs of the S4 preview records and Core-issued one-time
   * selection challenges (L2 SEAM12 §3/§4). Test compositions inject a
   * deterministic clock; default is wall time with a 120s lifetime.
   */
  readonly s4Challenge?: { readonly ttlMs?: number; readonly now?: () => number };
  /**
   * #153: post-commit driver for one durably admitted S4 preview intent.
   * The PREVIEW_S4_HLS_VOD authority apply only journals the provisional
   * PENDING preview record (journal-before-network); the runtime performs
   * the bounded master read strictly AFTER the accepted-command journal
   * commit and publishes the Core-observed facts through
   * `recordS4PreviewResult`. Absent → PREVIEW_S4_HLS_VOD fails closed.
   */
  readonly s4Preview?: S4PreviewBeginner;
  /**
   * #153: post-commit driver for one registered S4 selected-HLS execution.
   * EXECUTE_S4_SELECTED_HLS_VOD only registers one durable execution intent
   * (journaled with the command); the runtime begins the real bounded
   * manifest/segment/FFmpeg acquisition strictly AFTER the accepted-command
   * journal commit and completes the lineage terminal through
   * `recordExecutedTerminal`. Absent → EXECUTE_S4_SELECTED_HLS_VOD fails
   * closed while the confirmed selection stays durable. Presence of this
   * port INSTALLS the S4 1.2 command handlers behind the OS-verified
   * session gate; absence keeps every S4 command failing closed exactly as
   * before (legacy compositions).
   */
  readonly s4SelectedHls?: S4SelectedHlsBeginner;
  /**
   * #151: clock/TTL knobs of the S5 prepared groups and Core-issued one-time
   * selection challenges. Test compositions inject a deterministic clock;
   * default is wall time with a 120s single-use lifetime.
   */
  readonly s5Challenge?: { readonly ttlMs?: number; readonly now?: () => number };
  /**
   * #151: post-commit driver for one registered S5 current-page collection
   * execution. EXECUTE_S5_COLLECTION only registers one durable execution
   * intent (journaled with the command); the runtime begins the real
   * bounded per-member acquisition strictly AFTER the accepted-command
   * journal commit through this port and completes the lineage terminal
   * through `recordExecutedTerminal`. Presence of this port INSTALLS the S5
   * 1.2 command handlers behind the OS-verified session gate; absence keeps
   * every S5 command failing closed exactly as before (legacy compositions).
   */
  readonly s5PageGroup?: S5PageGroupBeginner;
  /**
   * #154: clock/TTL knobs of the S6 prepared collections and Core-issued
   * one-time selection challenges. Test compositions inject a deterministic
   * clock; default is wall time with a 120s single-use lifetime.
   */
  readonly s6Challenge?: { readonly ttlMs?: number; readonly now?: () => number };
  /**
   * #154: post-commit driver for one registered S6 explicit-collection
   * execution. EXECUTE_S6_COLLECTION only registers one durable execution
   * intent (journaled with the command); the runtime begins the real
   * bounded per-member acquisition strictly AFTER the accepted-command
   * journal commit through this port and completes the lineage terminal
   * through `recordExecutedTerminal`. Presence of this port INSTALLS the S6
   * 1.2 command handlers behind the OS-verified session gate; absence keeps
   * every S6 command failing closed exactly as before (legacy compositions).
   */
  readonly s6Collection?: S6CollectionBeginner;
}

/**
 * #150 read-only view of the Core-owned supported-media profile registry.
 * Implemented by the Core runtime over @xdownload/direct-acquisition; the
 * seam keeps no media semantics of its own — it only admits Core-registered
 * profile identities and pins the registry content digest.
 */
export interface S3MediaProfilePort {
  /** True iff profileId names a supported profile in the current registry. */
  supportedProfile(profileId: string): boolean;
  /** The profile's container extension ('mp4'|'m4a'|'mp3'|'webm') or undefined. */
  profileContainerOf(profileId: string): string | undefined;
  /** The profile's structural probe semantics revision (replay pin). */
  profileProbeRevisionOf(profileId: string): number | undefined;
  /** SHA-256 over the canonical registry content (challenge/confirm pinning). */
  registryDigest(): string;
}

/** Post-commit driver for one registered S3 selected-media execution (#150). */
export interface S3SelectedMediaBeginner {
  begin(input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    /** The durably confirmed candidate this execution is bound to. */
    readonly candidate: S3CandidateRecord;
    /** The journaled EXECUTE command's idempotent identity. */
    readonly requestId: string;
  }): void;
}

/**
 * #153 post-commit driver for one durably admitted S4 preview intent
 * (journal-before-network): performs the bounded master read and publishes
 * the Core-observed preview facts (or the typed refusal) through the trusted
 * `recordS4PreviewResult` port. Fire-and-forget; a failed drive leaves the
 * PENDING record for a later reconcile.
 */
export interface S4PreviewBeginner {
  begin(input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    /** The durably journaled PENDING preview record (Core-owned source binding). */
    readonly preview: S4PreviewRecord;
  }): void;
}

/**
 * #153 post-commit driver for one registered S4 selected-HLS execution
 * (journal-before-effect): performs the real bounded manifest/segment/FFmpeg
 * acquisition and completes the lineage terminal through
 * `recordExecutedTerminal`. Fire-and-forget: a thrown/rejected drive leaves
 * the intent registered so a later reconcile can re-drive it.
 */
export interface S4SelectedHlsBeginner {
  begin(input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    /** The durably confirmed selection this execution is bound to. */
    readonly selection: S4ConfirmedSelectionRecord;
    /** The journaled EXECUTE command's idempotent identity. */
    readonly requestId: string;
  }): void;
}

/** #153: an S4 preview intent joined with the seam-authority contract. */
export interface PendingS4Preview {
  readonly aggregateId: string;
  readonly contract: AcquisitionContract;
  readonly preview: S4PreviewRecord;
}

/**
 * #151 post-commit driver for one registered S5 current-page collection
 * execution (journal-before-effect): performs the real bounded per-member
 * acquisition through the trusted collection flow and completes the lineage
 * terminal through `recordExecutedTerminal` with truthful per-member
 * outcomes. Fire-and-forget: a thrown/rejected drive leaves the intent
 * registered so a later reconcile can re-drive it.
 */
export interface S5ExecutionIntentInput {
  readonly aggregateId: string;
  /** The journaled EXECUTE command's idempotent identity. */
  readonly requestId: string;
  /** The Core-constructed durably confirmed group record (contract+snapshot). */
  readonly confirmed: S5ConfirmedGroupRecord;
  /** The Core-frozen observed member tuple this execution delivers from. */
  readonly prepared: S5PreparedGroupRecord;
}

export interface S5PageGroupBeginner {
  begin(input: S5ExecutionIntentInput): void;
}

/** #151: an S5 collection execution intent joined with its frozen truth. */
export type PendingS5Execution = S5ExecutionIntent;

/**
 * #154 post-commit driver for one registered S6 explicit-collection
 * execution (journal-before-effect): performs the real bounded per-member
 * acquisition through the trusted collection flow and completes the lineage
 * terminal through `recordExecutedTerminal` with truthful per-member
 * outcomes. Fire-and-forget: a thrown/rejected drive leaves the intent
 * registered so a later reconcile can re-drive it.
 */
export interface S6ExecutionIntentInput {
  readonly aggregateId: string;
  /** The journaled EXECUTE command's idempotent identity. */
  readonly requestId: string;
  /** The Core-constructed durably confirmed collection record (contract+snapshot). */
  readonly confirmed: S6ConfirmedCollectionRecord;
  /** The Core-frozen collection admission this execution delivers from. */
  readonly prepared: S6PreparedCollectionRecord;
  /** The Core-frozen observed pages (declared-range order). */
  readonly pages: readonly S6PageRecord[];
}

export interface S6CollectionBeginner {
  begin(input: S6ExecutionIntentInput): void;
}

/** #154: an S6 collection execution intent joined with its frozen truth. */
export type PendingS6Execution = S6ExecutionIntent;

/**
 * #154 live-only (never journal-replay) S6 admission context: the OS-verified
 * session facts of the connection the frame arrived on plus the Core-issued
 * challenge registry. Authority appliers receive it only on the live path;
 * journal replay trusts the already-gated durable truth.
 */
export interface S6LiveAdmissionContext {
  readonly commandType: S6Seam12CommandType;
  readonly connectionId: string;
  readonly verifiedPeer: NonNullable<ReturnType<VerifiedPeerSessionPort['verifiedSessionFor']>>;
  readonly challenges: S3ChallengeMint;
  readonly ttlMs: number;
  readonly now: () => number;
}

/**
 * #151 live-only (never journal-replay) S5 admission context: the OS-verified
 * session facts of the connection the frame arrived on plus the Core-issued
 * challenge registry. Authority appliers receive it only on the live path;
 * journal replay trusts the already-gated durable truth.
 */
export interface S5LiveAdmissionContext {
  readonly commandType: S5Seam12CommandType;
  readonly connectionId: string;
  readonly verifiedPeer: NonNullable<ReturnType<VerifiedPeerSessionPort['verifiedSessionFor']>>;
  readonly challenges: S3ChallengeMint;
  readonly ttlMs: number;
  readonly now: () => number;
}

/** #153: an S4 selected-HLS execution intent joined with its contract. */
export interface PendingS4Execution extends S4ExecutionIntent {
  readonly contract: AcquisitionContract;
}

/**
 * #153 live-only (never journal-replay) S4 admission context: the OS-verified
 * session facts of the connection the frame arrived on plus the Core-issued
 * challenge registry. Authority appliers receive it only on the live path;
 * journal replay trusts the already-gated durable truth.
 */
export interface S4LiveAdmissionContext {
  readonly commandType:
    'PREVIEW_S4_HLS_VOD' | 'CONFIRM_S4_SELECTION' | 'EXECUTE_S4_SELECTED_HLS_VOD';
  readonly connectionId: string;
  readonly verifiedPeer: NonNullable<ReturnType<VerifiedPeerSessionPort['verifiedSessionFor']>>;
  readonly challenges: S3ChallengeMint;
  /** The same injectable clock/TTL the preview records and challenges use. */
  readonly ttlMs: number;
  readonly now: () => number;
}

/**
 * Live-only (never journal-replay) S3 admission context: the OS-verified
 * session facts of the connection the frame arrived on plus the Core-issued
 * challenge registry. Authority appliers receive it only on the live path;
 * journal replay trusts the already-gated durable truth.
 */
export interface S3LiveAdmissionContext {
  readonly commandType: S3Seam12CommandType;
  readonly connectionId: string;
  readonly verifiedPeer: NonNullable<ReturnType<VerifiedPeerSessionPort['verifiedSessionFor']>>;
  readonly challenges: S3ChallengeMint;
  /** The same injectable clock the challenge registry bounds lifetimes by. */
  readonly now: () => number;
}

/**
 * #150 Core-minted one-time selection challenge registry (L2 S3 §2.1 R2 F01).
 * In-memory by design: challenges are short-lived single-use values bound to
 * a live OS-verified connection; a restart invalidates every outstanding
 * challenge (fail closed — the CLI requests a fresh one), while confirmed
 * candidates and execution intents survive in the journal.
 */
export interface S3ChallengeMint {
  /** Bind one freshly minted challenge; returns the stored record. */
  mint(input: {
    readonly connectionId: string;
    readonly aggregateId: string;
    readonly tupleDigest: string;
    readonly revision: number;
    readonly ttlMs: number;
    readonly expiresAtIso: string;
  }): { readonly challenge: string };
  /** Verify an unconsumed, unexpired challenge bound to these exact facts. */
  verify(input: {
    readonly challenge: string;
    readonly connectionId: string;
    readonly aggregateId: string;
    readonly tupleDigest: string;
    readonly revision: number;
  }): boolean;
  /** Consume (single use) — called atomically with the candidate journal commit. */
  consume(challenge: string): void;
}

/**
 * Post-commit driver for one registered S1 direct execution. Implemented by
 * the Core runtime composition over the canonical durable direct flow; never
 * by a surface. Fire-and-forget: the runtime owns the lifecycle and reports
 * completion through `recordExecutedTerminal`; a thrown/rejected drive must
 * leave the intent registered so a later reconcile can re-drive it.
 */
export interface S1DirectAcquisitionBeginner {
  begin(input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly payload: unknown;
  }): void;
}

/** One registered S1 direct execution intent (rebuilt from the journaled command on replay). */
export interface S1ExecutionIntent {
  readonly aggregateId: string;
  readonly requestId: string;
  readonly payload: unknown;
}

/** Intent joined with the seam-authority contract for runtime reconcile/drive. */
export interface PendingS1Execution extends S1ExecutionIntent {
  readonly contract: AcquisitionContract;
}

/** #150: an S3 selected-media execution intent joined with its contract. */
export interface PendingS3Execution extends S3ExecutionIntent {
  readonly contract: AcquisitionContract;
}

/**
 * The execution outcome the Core-side S2 executor returns. `terminal` is the
 * Core-DERIVED terminal result value; it still passes the same projector
 * gate as `PROJECT_TERMINAL_RESULT` before becoming lineage authority — the
 * executor can never assert an unvalidated terminal.
 *
 * STAGED (#95 R1/F04): one slab of a chunked delivered stream was staged and
 * no terminal truth exists yet — the lineage stays open for the remaining
 * chunks. Only a TERMINAL outcome projects terminal authority.
 */
export type S2DeliveredAcquisitionExecution =
  | {
      readonly kind: 'TERMINAL';
      /** Terminal result value (domain-decoded through the projector gate). */
      readonly terminal: unknown;
      /** Projector evidence context fields a surface command could also carry. */
      readonly context: Pick<
        TerminalResultContext,
        'selectedValidationOutcomes' | 'coverageEvidence' | 'knownAuthInaccessibleRequestedCount'
      >;
      /** Members whose execution failed truthfully (recorded for the retry domain). */
      readonly failedMemberIds: readonly string[];
    }
  | { readonly kind: 'STAGED' };

/** Narrow executor port for the one browser-delivered S2 acquisition command. */
export interface S2DeliveredAcquisitionExecutor {
  /**
   * Execute one delivered-bytes S2 acquisition for an EXISTING aggregate.
   * The contract comes from seam authority state — never from the payload
   * (scope drift is impossible by construction). The payload is raw; the
   * executor owns the strict fail-closed decode. A truthful execution
   * failure (digest/format/target) returns a FAILED terminal, not a
   * rejection; malformed input rejects.
   */
  execute(input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly payload: unknown;
  }): SeamResult<S2DeliveredAcquisitionExecution>;
}

export interface CoreSeamServer {
  /**
   * Transport-neutral port: one framed seam message in, one response out.
   * Transports adapt bytes/framing to this port; socket types never leak
   * into command semantics (ADR-012 replaceability).
   */
  /**
   * Core-host-only connection context. A verified-session port is owned by the
   * OS-authenticating transport, not supplied by the decoded wire envelope.
   * Missing/stale connection IDs fail closed for the 1.2 authority vocabulary.
   */
  handleFrame(
    frame: string,
    verifiedSessions?: VerifiedPeerSessionPort,
    connectionId?: string,
  ): SeamResponse;
  /**
   * Core-internal runtime fact recording (NOT a wire command): the transfer/
   * scheduler runtime reports the original failed-member identity domain for
   * a lineage. Surface commands can never write this — retry authority is
   * Core-owned (C12).
   */
  recordFailedMembers(aggregateId: string, memberIds: readonly string[]): SeamResult<void>;
  /**
   * Trusted Core-runtime fact path. A validated CoverageAccounting value is
   * bound to the immutable contract/snapshot and journaled for restart replay.
   * No surface command can invoke this method.
   */
  recordCoverageAccounting(
    aggregateId: string,
    accounting: CoverageAccounting,
    evidenceLedger?: EvidenceLedger,
  ): SeamResult<{ readonly converged: boolean }>;
  /** Read-only projection view; the same value a READ_PROJECTION query returns. */
  inspectProjection(aggregateId: string): SeamProjectionView | undefined;
  /**
   * Core-internal (never a wire command): registered S1 direct execution
   * intents awaiting drive/completion. The runtime reconciles these against
   * durable ledger truth after composition and on restart; each non-terminal
   * intent is re-driven through the canonical direct flow so terminal truth
   * is re-derived deterministically (no re-download of an accepted artifact).
   */
  pendingS1Executions(): readonly PendingS1Execution[];
  /**
   * Core-internal (never a wire command): registered S3 selected-media
   * execution intents awaiting drive/completion, joined with the seam
   * authority contract. The runtime reconciles these against durable ledger
   * truth after composition and on restart (identical discipline to S1).
   */
  pendingS3Executions(): readonly PendingS3Execution[];
  /**
   * #153 Core-internal (never a wire command): PENDING S4 preview intents
   * awaiting the bounded master read, joined with the seam-authority
   * contract. The runtime reconciles these after composition and on restart;
   * an expired PENDING record closes truthfully FAILED without a fetch.
   */
  pendingS4Previews(): readonly PendingS4Preview[];
  /**
   * #153 Core-internal (never a wire command): registered S4 selected-HLS
   * execution intents awaiting drive/completion, joined with the seam
   * authority contract (identical discipline to S1/S3).
   */
  pendingS4Executions(): readonly PendingS4Execution[];
  /**
   * #151 Core-internal (never a wire command): registered S5 collection
   * execution intents awaiting drive/completion (identical discipline to
   * S1/S3/S4). The runtime reconciles these against durable truth after
   * composition and on restart.
   */
  pendingS5Executions(): readonly PendingS5Execution[];
  /**
   * #151 Core-internal (never a wire command): record the Core-derived
   * per-member S5 batch outcomes for one executing lineage. Verbatim truth
   * from the collection flow; presentation only — the aggregate terminal
   * stays owned by `recordExecutedTerminal`. Not journaled: restart
   * reconcile re-derives the identical outcomes from durable truth.
   */
  recordS5MemberOutcomes(
    aggregateId: string,
    members: readonly S5MemberOutcomeRecord[],
  ): SeamResult<void>;
  /**
   * #154 Core-internal (never a wire command): registered S6 collection
   * execution intents awaiting drive/completion (identical discipline to
   * S1/S3/S4/S5). The runtime reconciles these against durable truth after
   * composition and on restart.
   */
  pendingS6Executions(): readonly PendingS6Execution[];
  /**
   * #154 Core-internal (never a wire command): record the Core-derived
   * per-member S6 outcomes for one executing lineage. Verbatim truth from
   * the collection flow; presentation only — the aggregate terminal stays
   * owned by `recordExecutedTerminal`. Not journaled: restart reconcile
   * re-derives the identical outcomes from durable truth.
   */
  recordS6MemberOutcomes(
    aggregateId: string,
    members: readonly S6MemberOutcomeRecord[],
  ): SeamResult<void>;
  /**
   * #153 trusted Core-runtime fact path: publish the Core-observed preview
   * result (AVAILABLE variants or typed FAILED refusal) for one durably
   * admitted PENDING preview record. Journaled for restart replay; identical
   * receipts converge, conflicting receipts reject, and no surface command
   * can invoke this method — the renderable preview facts a surface later
   * reads from the projection are always Core-observed.
   */
  recordS4PreviewResult(
    aggregateId: string,
    record: S4PreviewRecord,
  ): SeamResult<{ readonly converged: boolean }>;
  /**
   * Core-internal (never a wire command): record the Core-derived terminal
   * result for one executed S1 lineage. The value MUST be the verbatim
   * projector output (the same gate `PROJECT_TERMINAL_RESULT` passes); the
   * seam stores it as lineage authority without a second projection. Not
   * journaled: replay re-derives the identical terminal from durable truth
   * via the intent reconcile. A second completion on a terminal lineage is
   * a typed LATE rejection (terminal truth is never rewritten).
   */
  recordExecutedTerminal(aggregateId: string, terminal: TerminalResult): SeamResult<void>;
  /**
   * Core-internal (never a wire command): close a CANCELLED lineage with its
   * truthful Core-derived terminal (#101 P2-1). The value MUST be the
   * verbatim projector output derived from durable truth AFTER the durable
   * cancel is committed — the projector's ADR-013 cutoff decides COMPLETE
   * (acceptance already stood before the cancel) vs USER_CANCELLED (cancel
   * wins), so a cancellation closure can never fabricate a COMPLETED escape.
   * Gates: the lineage must be CANCELLED (ACTIVE execution completions go
   * through `recordExecutedTerminal`; terminal truth is never rewritten);
   * not journaled — restart reconcile re-derives the identical closure.
   */
  closeCancelledLineage(aggregateId: string, terminal: TerminalResult): SeamResult<void>;
  /**
   * Trusted Core-runtime fact path (#101 P2-2): persist the secret-free typed
   * Target evidence basis + certainty of one successful S1 record with its
   * exact artifact/effect identity. Journaled for restart replay; identical
   * receipts converge (never rewritten), conflicting receipts reject. No
   * surface command can invoke this method.
   */
  recordTargetEvidence(
    aggregateId: string,
    receipt: TargetEvidenceReceipt,
  ): SeamResult<{ readonly converged: boolean }>;
  /**
   * Trusted Core-runtime fact path (#113, #103 §2.2): journal the Core-private
   * S1 requested-target-resolution witness of one execution — durably, BEFORE
   * terminal authority is handed over, including on failed digest/no accepted
   * bytes. Identical witnesses converge (restart replay never rewrites); a
   * conflicting witness rejects (the recorded resolution fact is immutable
   * and bound to the exact contract/snapshot/member/effect + declared
   * delivery graph). No surface command can invoke this method.
   */
  recordTargetWitness(
    aggregateId: string,
    receipt: TargetWitnessReceipt,
  ): SeamResult<{ readonly converged: boolean }>;
  /**
   * Core-internal (never a wire command): the durable target-resolution
   * witness recorded for one aggregate, when one exists. The canonical Core
   * read port the projector's S1 target facts derive from — a caller-supplied
   * resolution string never substitutes for it.
   */
  targetWitnessFor(aggregateId: string): TargetWitnessReceipt | undefined;
  /** Accepted-command count (concern-test observation; not a wire surface). */
  readonly acceptedCommandCount: number;
}

export type CoreSeamServerFactoryResult =
  | { readonly ok: true; readonly value: CoreSeamServer }
  | { readonly ok: false; readonly diagnostics: readonly SeamDiagnostic[] };

/** Reply id used for rejections of frames too malformed to carry one. */
const UNKNOWN_REPLY_ID = 'unknown' as CommandRequestId;

/** Create the Core-owned command/query seam server over restored state. */
export function createCoreSeamServer(options: CoreSeamServerOptions): CoreSeamServerFactoryResult {
  const state: SeamAuthorityState = createSeamAuthorityState();
  const journal = options.journal;
  const gateway: DomainGateway = createDomainGateway();
  // #101: registered S1 direct execution intents, keyed by aggregate. The
  // intent is authority state rebuilt deterministically from the journaled
  // EXECUTE_S1_DIRECT_ACQUISITION command on replay; the runtime reconciles
  // non-terminal intents against durable ledger truth after composition.
  const s1Intents = new Map<string, S1ExecutionIntent>();
  // #150: Core-minted one-time selection challenges. Bounded, in-memory,
  // single-use: a restart drops them (fail closed — fresh challenge), while
  // confirmed candidates/intents live in the journal.
  const S3_CHALLENGE_TTL_MS = options.s3Challenge?.ttlMs ?? 120_000;
  const s3Now = options.s3Challenge?.now ?? (() => Date.now());
  const s3ChallengeResponses = new Map<
    CommandRequestId,
    { readonly response: SeamResponse; readonly payloadDigest: string }
  >();
  // #153: S4 preview/selection TTL and the same injectable clock discipline.
  // Preview records and confirmed selections are durable; their short
  // Core-enforced lifetime is re-checked from THIS clock at every gate, and
  // the S4 challenge mint below runs on the SAME clock (a composition that
  // injects only s4Challenge never leaves S4 challenge TTLs on wall time).
  const S4_TTL_MS = options.s4Challenge?.ttlMs ?? 120_000;
  const s4Now = options.s4Challenge?.now ?? (() => Date.now());
  // #153: idempotent BEGIN response cache — a duplicate BEGIN replays the
  // prior acceptance WITHOUT the raw private challenge value (L2 SEAM12 §4).
  const s4BeginResponses = new Map<
    CommandRequestId,
    { readonly response: SeamResponse; readonly payloadDigest: string }
  >();
  const makeChallengeMint = (
    now: () => number,
  ): S3ChallengeMint & {
    /** #153 review F3 (#171): revoke pending challenges of one connection+aggregate. */
    revokePending(connectionId: string, aggregateId: string): void;
  } => {
    const challenges = new Map<
      string,
      {
        readonly challenge: string;
        readonly connectionId: string;
        readonly aggregateId: string;
        readonly tupleDigest: string;
        readonly revision: number;
        readonly expiresAtMs: number;
        consumed: boolean;
      }
    >();
    return {
      mint(input) {
        if (challenges.size > 256) {
          const nowMs = now();
          for (const [key, record] of challenges) {
            if (record.expiresAtMs < nowMs || record.consumed) {
              challenges.delete(key);
            }
          }
        }
        const challenge = randomBytes(32).toString('hex');
        challenges.set(challenge, {
          challenge,
          connectionId: input.connectionId,
          aggregateId: input.aggregateId,
          tupleDigest: input.tupleDigest,
          revision: input.revision,
          expiresAtMs: now() + input.ttlMs,
          consumed: false,
        });
        return { challenge };
      },
      verify(input) {
        const record = challenges.get(input.challenge);
        return (
          record !== undefined &&
          !record.consumed &&
          record.connectionId === input.connectionId &&
          record.aggregateId === input.aggregateId &&
          record.tupleDigest === input.tupleDigest &&
          record.revision === input.revision &&
          record.expiresAtMs >= now()
        );
      },
      consume(challenge) {
        const record = challenges.get(challenge);
        if (record !== undefined) {
          record.consumed = true;
          challenges.delete(challenge);
        }
      },
      revokePending(connectionId, aggregateId) {
        for (const [key, record] of challenges) {
          if (record.connectionId === connectionId && record.aggregateId === aggregateId) {
            challenges.delete(key);
          }
        }
      },
    };
  };
  const s3ChallengeMint = makeChallengeMint(s3Now);
  const s4ChallengeMint = makeChallengeMint(s4Now);
  const S5_TTL_MS = options.s5Challenge?.ttlMs ?? 120_000;
  const s5Now = options.s5Challenge?.now ?? (() => Date.now());
  const s5ChallengeMint = makeChallengeMint(s5Now);
  const s5BeginResponses = new Map<
    string,
    { readonly payloadDigest: string; readonly response: SeamResponse }
  >();
  const S6_TTL_MS = options.s6Challenge?.ttlMs ?? 120_000;
  const s6Now = options.s6Challenge?.now ?? (() => Date.now());
  const s6ChallengeMint = makeChallengeMint(s6Now);
  const s6BeginResponses = new Map<
    string,
    { readonly payloadDigest: string; readonly response: SeamResponse }
  >();
  let recoveryFenceReason: string | undefined;

  function recoveryFenceMessage(): string {
    return `Core seam authority is fenced; reopen/recovery required${
      recoveryFenceReason === undefined ? '' : `: ${recoveryFenceReason}`
    }`;
  }

  function poisonForRecovery(reason: string): never {
    recoveryFenceReason ??= reason;
    throw new Error(recoveryFenceMessage());
  }

  function recoveryFenceDiagnostic(): SeamDiagnostic {
    return seamDiagnostic('ADMISSION_REJECTED', 'runtime', recoveryFenceMessage(), 'L2-§6.8');
  }

  // Restart replay: re-apply every durably accepted command through the same
  // deterministic authority path, gate-bypassed (they were gated at
  // acceptance). Any replay failure is journal corruption → fail closed.
  if (journal !== undefined) {
    for (const entry of journal.replayAll()) {
      const restored =
        entry.kind === 'COVERAGE_ACCOUNTING'
          ? applyCoverageAccountingReceipt(
              state,
              entry.aggregateId,
              entry.accounting,
              entry.classificationEvidence,
            )
          : entry.kind === 'TARGET_EVIDENCE'
            ? applyTargetEvidenceReceipt(state, entry.aggregateId, entry.receipt)
            : entry.kind === 'TARGET_WITNESS'
              ? applyTargetWitnessReceipt(state, entry.aggregateId, entry.receipt)
              : entry.kind === 'S4_PREVIEW'
                ? applyS4PreviewReceipt(state, entry.aggregateId, entry.record)
                : restoreAcceptedCommand(
                    state,
                    gateway,
                    entry,
                    options.s2DeliveredAcquisition,
                    options.s1DirectAcquisition,
                    s1Intents,
                    options.s3MediaProfiles,
                    options.s3SelectedMedia,
                    options.s4Preview,
                    options.s4SelectedHls,
                    options.s5PageGroup,
                    options.s6Collection,
                  );
      if (!restored.ok) {
        const subject =
          entry.kind === 'COVERAGE_ACCOUNTING'
            ? `aggregate '${entry.aggregateId}'`
            : entry.kind === 'TARGET_EVIDENCE'
              ? `target evidence receipt for aggregate '${entry.aggregateId}'`
              : entry.kind === 'TARGET_WITNESS'
                ? `target witness receipt for aggregate '${entry.aggregateId}'`
                : entry.kind === 'S4_PREVIEW'
                  ? `S4 preview receipt for aggregate '${entry.aggregateId}'`
                  : `request '${entry.envelope.requestId}'`;
        return {
          ok: false,
          diagnostics: [
            seamDiagnostic(
              'ENVELOPE_MALFORMED',
              'journal',
              `journal replay failed for ${subject}; failing closed`,
            ),
            ...restored.diagnostics,
          ],
        };
      }
    }
  }

  function rejected(
    inReplyTo: CommandRequestId,
    diagnostics: readonly SeamDiagnostic[],
    currentRevision?: number,
  ): SeamResponse {
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo,
      outcome: 'REJECTED',
      diagnostics,
      currentRevision,
    };
  }

  function rejectedUnknown(diagnostics: readonly SeamDiagnostic[]): SeamResponse {
    return rejected(UNKNOWN_REPLY_ID, diagnostics);
  }

  function handleFrame(
    frame: string,
    verifiedSessions?: VerifiedPeerSessionPort,
    connectionId?: string,
  ): SeamResponse {
    if (recoveryFenceReason !== undefined) {
      return rejectedUnknown([recoveryFenceDiagnostic()]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame) as unknown;
    } catch {
      return rejectedUnknown([
        seamDiagnostic('ENVELOPE_MALFORMED', '$', 'corrupt framing: frame is not valid JSON'),
      ]);
    }
    // Declared structural bounds before any decode into authority state.
    const bounded = checkStructureBounds(parsed, SEAM_MESSAGE_LIMITS);
    if (!bounded.ok) {
      return rejectedUnknown(bounded.diagnostics);
    }
    const decoded = decodeSeamEnvelope(parsed);
    if (!decoded.ok) {
      // Pre-decode failure: the request identity (if any) is not trustworthy,
      // so the rejection cannot be correlated to a request id.
      return rejectedUnknown(decoded.diagnostics);
    }
    const envelope = decoded.value;
    // Per-frame peer authorization: never inherited from an earlier frame.
    const authorized = authorizePeer(envelope.peer, options.expectedPeer);
    if (!authorized.ok) {
      // The envelope decoded, so the rejection is correlated to its request.
      return rejected(envelope.requestId, authorized.diagnostics);
    }
    if (envelope.kind === 'query') {
      return handleQuery(envelope);
    }
    if (
      S4_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S4_SEAM12_COMMAND_TYPES)[number],
      ) ||
      S3_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S3_SEAM12_COMMAND_TYPES)[number],
      ) ||
      S5_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S5_SEAM12_COMMAND_TYPES)[number],
      ) ||
      S6_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S6_SEAM12_COMMAND_TYPES)[number],
      )
    ) {
      // This is a live, per-frame lookup in the native transport's private
      // registry. A claimed peer, command payload or remembered requestId
      // cannot substitute for an OS-verified *current* connection. The host
      // supplies this capability out-of-band, never from JSON.
      let verifiedPeer;
      if (connectionId !== undefined && connectionId.length > 0) {
        try {
          const current = verifiedSessions?.verifiedSessionFor(connectionId);
          // Reject a mismatched record even if an injected port returns one.
          if (current?.connectionId === connectionId) verifiedPeer = current;
        } catch {
          // A broken or revoked registry must not grant private authority.
          verifiedPeer = undefined;
        }
      }
      const verified = assertPeerTransportAuthorization({
        commandType: envelope.commandType,
        verifiedPeer,
      });
      if (!verified.ok) return rejected(envelope.requestId, verified.diagnostics);
      // #153: behind the OS-verified same-user/same-logon-session gate, the
      // installed S4 selected-HLS handlers run when this composition provides
      // the post-commit execution driver; CONFIRM_S4_SELECTION phase BEGIN is
      // the non-journaled Core-minted challenge half (mirrors the S3
      // REQUEST_S3_SELECTION_CHALLENGE discipline). Without the driver every
      // S4 command keeps failing closed exactly as before (legacy
      // compositions), before idempotency, revision, persistence or network.
      const s4Command = S4_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S4_SEAM12_COMMAND_TYPES)[number],
      );
      if (s4Command && options.s4SelectedHls !== undefined && verifiedPeer !== undefined) {
        const s4Live = {
          commandType: envelope.commandType as S4LiveAdmissionContext['commandType'],
          connectionId: connectionId as string,
          verifiedPeer,
          challenges: s4ChallengeMint,
          ttlMs: S4_TTL_MS,
          now: s4Now,
        };
        if (envelope.commandType === 'CONFIRM_S4_SELECTION') {
          const phase = (envelope.payload as { readonly phase?: unknown }).phase;
          if (phase === 'BEGIN') {
            return handleS4ConfirmBegin(envelope, connectionId as string, S4_TTL_MS, s4Now);
          }
          return handleCommand(envelope, undefined, s4Live);
        }
        return handleCommand(envelope, undefined, s4Live);
      }
      // #151: behind the OS-verified same-user/same-logon-session gate, the
      // installed S5 current-page collection handlers run when this
      // composition provides the post-commit execution driver; CONFIRM
      // BEGIN is the non-journaled Core-minted challenge half (the S3/S4
      // discipline). Without the driver every S5 command keeps failing
      // closed exactly as before (legacy compositions).
      const s5Command = S5_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S5_SEAM12_COMMAND_TYPES)[number],
      );
      if (s5Command && options.s5PageGroup !== undefined && verifiedPeer !== undefined) {
        const s5Live = {
          commandType: envelope.commandType as S5LiveAdmissionContext['commandType'],
          connectionId: connectionId as string,
          verifiedPeer,
          challenges: s5ChallengeMint,
          ttlMs: S5_TTL_MS,
          now: s5Now,
        };
        if (envelope.commandType === 'CONFIRM_S5_PAGE_GROUP') {
          const phase = (envelope.payload as { readonly phase?: unknown }).phase;
          if (phase === 'BEGIN') {
            return handleS5ConfirmBegin(envelope, connectionId as string, S5_TTL_MS, s5Now);
          }
          return handleCommand(envelope, undefined, undefined, s5Live);
        }
        return handleCommand(envelope, undefined, undefined, s5Live);
      }
      // #154: behind the OS-verified same-user/same-logon-session gate, the
      // installed S6 explicit-collection handlers run when this composition
      // provides the post-commit execution driver; CONFIRM BEGIN is the
      // non-journaled Core-minted challenge half (the S3/S4/S5 discipline).
      // Without the driver every S6 command keeps failing closed exactly as
      // before (legacy compositions).
      const s6Command = S6_SEAM12_COMMAND_TYPES.includes(
        envelope.commandType as (typeof S6_SEAM12_COMMAND_TYPES)[number],
      );
      if (s6Command && options.s6Collection !== undefined && verifiedPeer !== undefined) {
        const s6Live = {
          commandType: envelope.commandType as S6LiveAdmissionContext['commandType'],
          connectionId: connectionId as string,
          verifiedPeer,
          challenges: s6ChallengeMint,
          ttlMs: S6_TTL_MS,
          now: s6Now,
        };
        if (envelope.commandType === 'CONFIRM_S6_COLLECTION') {
          const phase = (envelope.payload as { readonly phase?: unknown }).phase;
          if (phase === 'BEGIN') {
            return handleS6ConfirmBegin(envelope, connectionId as string, S6_TTL_MS, s6Now);
          }
          return handleCommand(envelope, undefined, undefined, undefined, s6Live);
        }
        return handleCommand(envelope, undefined, undefined, undefined, s6Live);
      }
      // #150: behind the OS-verified same-user/same-logon-session gate, the
      // installed S3 selected-media handlers run when this composition
      // provides the Core-owned supported-media profile registry; without it
      // every S3 command keeps failing closed exactly as before (legacy
      // compositions), before idempotency, revision, persistence or network.
      if (
        !s4Command &&
        !s5Command &&
        options.s3MediaProfiles !== undefined &&
        verifiedPeer !== undefined
      ) {
        const command = envelope.commandType as S3Seam12CommandType;
        if (command === 'REQUEST_S3_SELECTION_CHALLENGE') {
          return handleS3ChallengeRequest(
            envelope,
            verifiedPeer,
            connectionId as string,
            options.s3MediaProfiles,
          );
        }
        return handleCommand(envelope, {
          commandType: command,
          connectionId: connectionId as string,
          verifiedPeer,
          challenges: s3ChallengeMint,
          now: s3Now,
        });
      }
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S3/S4/S5 verified session admitted but no installed private Core command handler exists',
        ),
      ]);
    }
    return handleCommand(envelope);
  }

  /**
   * #150 REQUEST_S3_SELECTION_CHALLENGE: mint one Core-issued single-use
   * challenge bound to the live OS-verified connection, the current aggregate
   * revision and the canonical displayed selection tuple. No authority
   * transition, no journal write, no revision change — the durable candidate
   * exists only with the later CONFIRM_S3_CANDIDATE commit that consumes
   * this challenge atomically.
   */
  function handleS3ChallengeRequest(
    envelope: CommandEnvelope,
    verifiedPeer: NonNullable<ReturnType<VerifiedPeerSessionPort['verifiedSessionFor']>>,
    connectionId: string,
    profiles: S3MediaProfilePort,
  ): SeamResponse {
    const prior = s3ChallengeResponses.get(envelope.requestId);
    if (prior !== undefined) {
      // Same idempotent identity with a different tuple is a conflict
      // (ADR-010 discipline), never a silent re-mint for another candidate.
      if (prior.payloadDigest !== stableStringify(envelope.payload)) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same challenge request identity was already answered for a different candidate tuple; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      return prior.response;
    }
    if (s3ChallengeResponses.size > 512) {
      const oldest = s3ChallengeResponses.keys().next();
      if (oldest.done !== true) {
        s3ChallengeResponses.delete(oldest.value);
      }
    }
    if (envelope.peer.surface !== 'CLI') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S3 selection challenges serve the installed CLI surface only',
          'L2-S3-§2.3',
        ),
      ]);
    }
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const lineage = state.lineages.get(envelope.aggregateId);
    if (aggregate === undefined || lineage === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    if (lineage.status !== 'ACTIVE') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'LATE_COMMAND',
          'lineage.status',
          `lineage is ${lineage.status}; late S3 selection challenge is rejected`,
          'L2-§11',
        ),
      ]);
    }
    const payload = envelope.payload as S3SelectionChallengeRequestPayload;
    const tupleCheck = s3CandidateTupleChecks(state, envelope, payload, profiles);
    if (!tupleCheck.ok) {
      return rejected(envelope.requestId, tupleCheck.diagnostics);
    }
    const revision = aggregate.revision;
    if (envelope.expectedRevision !== revision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `S3 selection challenge requires the current aggregate revision ${String(revision)}`,
            'L2-§10',
          ),
        ],
        revision,
      );
    }
    const tupleDigest = s3SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      memberId: payload.memberId,
      variantKey: payload.variantKey,
      selectedLocator: payload.locatorUri,
      mediaProfileId: payload.mediaProfileId,
    });
    const expiresAtMs = s3Now() + S3_CHALLENGE_TTL_MS;
    const minted = s3ChallengeMint.mint({
      connectionId,
      aggregateId: envelope.aggregateId,
      tupleDigest,
      revision,
      ttlMs: S3_CHALLENGE_TTL_MS,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    });
    const response: SeamResponse = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      challenge: {
        challenge: minted.challenge,
        tupleDigest,
        coreRevision: revision,
        expiresAt: new Date(expiresAtMs).toISOString(),
        mediaProfilesDigest: profiles.registryDigest(),
      },
    };
    s3ChallengeResponses.set(envelope.requestId, {
      response,
      payloadDigest: stableStringify(envelope.payload),
    });
    return response;
  }

  /**
   * #153 CONFIRM_S4_SELECTION phase BEGIN (L2 SEAM12 §4): mint one Core-issued
   * single-use challenge bound to the live OS-verified connection, the current
   * aggregate revision, the AVAILABLE preview record and the canonical
   * displayed rendition tuple digest. No authority transition, no journal
   * write — the durable confirmed selection exists only with the later COMMIT
   * that consumes this challenge atomically. The raw value travels ONLY on
   * this direct response; a duplicate BEGIN with the same idempotent identity
   * replays the secret-free prior acceptance without re-emitting the token.
   */
  function handleS4ConfirmBegin(
    envelope: CommandEnvelope,
    connectionId: string,
    ttlMs: number,
    now: () => number,
  ): SeamResponse {
    const prior = s4BeginResponses.get(envelope.requestId);
    if (prior !== undefined) {
      if (prior.payloadDigest !== stableStringify(envelope.payload)) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same S4 BEGIN identity was already answered for a different tuple; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      // No raw token replay: the caller must start a fresh BEGIN (fresh
      // requestId), which revokes the previously minted pending challenge.
      // JSON.stringify drops the undefined field, so the wire form carries no
      // raw token on replay.
      return { ...prior.response, s4PrivateChallenge: undefined };
    }
    if (s4BeginResponses.size > 512) {
      const oldest = s4BeginResponses.keys().next();
      if (oldest.done !== true) {
        s4BeginResponses.delete(oldest.value);
      }
    }
    if (envelope.peer.surface !== 'CLI') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S4 selection challenges serve the installed CLI surface only',
          'L2-S4-§4',
        ),
      ]);
    }
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const lineage = state.lineages.get(envelope.aggregateId);
    if (aggregate === undefined || lineage === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    if (lineage.status !== 'ACTIVE') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'LATE_COMMAND',
          'lineage.status',
          `lineage is ${lineage.status}; late S4 selection challenge is rejected`,
          'L2-§11',
        ),
      ]);
    }
    // #153 review F7 (#171): the same declared payload byte bound as every
    // journaled command, before any challenge material is derived.
    const previewBytes = payloadByteLength(envelope.payload);
    if (previewBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'PAYLOAD_TOO_LARGE',
          'payload',
          `serialized payload of ${String(previewBytes)} bytes exceeds declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)}`,
        ),
      ]);
    }
    const payload = envelope.payload as S4ConfirmBeginPayload;
    const tuple = s4RenditionTupleOf(state, envelope, payload, now);
    if (!tuple.ok) {
      return rejected(envelope.requestId, tuple.diagnostics);
    }
    const revision = aggregate.revision;
    if (envelope.expectedRevision !== revision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `S4 selection challenge requires the current aggregate revision ${String(revision)}`,
            'L2-§10',
          ),
        ],
        revision,
      );
    }
    if (payload.displayedTupleDigest !== tuple.value.digest) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.displayedTupleDigest',
          'the CLI-displayed tuple digest does not match the Core-observed preview facts for this rendition; BEGIN fails closed',
          'L2-S4-§4',
        ),
      ]);
    }
    // #153 review F3 (#171): a fresh BEGIN (fresh requestId) revokes the
    // previous pending challenge of this connection+aggregate — only the
    // newest confirmation intent stays answerable (L2 SEAM12 §4).
    s4ChallengeMint.revokePending(connectionId, envelope.aggregateId);
    const expiresAtMs = now() + ttlMs;
    const minted = s4ChallengeMint.mint({
      connectionId,
      aggregateId: envelope.aggregateId,
      tupleDigest: tuple.value.digest,
      revision,
      ttlMs,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    });
    const response: SeamResponse = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      s4PrivateChallenge: {
        previewId: payload.previewId,
        renditionKey: payload.renditionKey,
        value: minted.challenge,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
      currentRevision: revision,
    };
    s4BeginResponses.set(envelope.requestId, {
      response,
      payloadDigest: stableStringify(envelope.payload),
    });
    return response;
  }

  /**
   * #151 CONFIRM_S5_PAGE_GROUP phase BEGIN: mint one Core-issued single-use
   * challenge bound to the live OS-verified connection, the current aggregate
   * revision, the AVAILABLE frozen page-group record and the canonical
   * displayed selection tuple digest (the user-chosen subset joined to the
   * frozen members). No authority transition, no journal write — the durable
   * confirmed group exists only with the later COMMIT that consumes this
   * challenge atomically. The raw value travels ONLY on this direct
   * response; a duplicate BEGIN with the same idempotent identity replays
   * the secret-free prior acceptance without re-emitting the token.
   */
  function handleS5ConfirmBegin(
    envelope: CommandEnvelope,
    connectionId: string,
    ttlMs: number,
    now: () => number,
  ): SeamResponse {
    const prior = s5BeginResponses.get(envelope.requestId);
    if (prior !== undefined) {
      if (prior.payloadDigest !== stableStringify(envelope.payload)) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same S5 BEGIN identity was already answered for a different tuple; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      return { ...prior.response, s5PrivateChallenge: undefined };
    }
    if (s5BeginResponses.size > 512) {
      const oldest = s5BeginResponses.keys().next();
      if (oldest.done !== true) {
        s5BeginResponses.delete(oldest.value);
      }
    }
    if (envelope.peer.surface !== 'BROWSER_EXTENSION') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S5 selection challenges serve the installed browser-extension surface only',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const lineage = state.lineages.get(envelope.aggregateId);
    if (aggregate === undefined || lineage === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    if (lineage.status !== 'ACTIVE') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'LATE_COMMAND',
          'lineage.status',
          `lineage is ${lineage.status}; late S5 selection challenge is rejected`,
          'L2-§11',
        ),
      ]);
    }
    const payloadBytes = payloadByteLength(envelope.payload);
    if (payloadBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'PAYLOAD_TOO_LARGE',
          'payload',
          `serialized payload of ${String(payloadBytes)} bytes exceeds declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)}`,
        ),
      ]);
    }
    const payload = envelope.payload as S5ConfirmBeginPayload;
    const prepared = lineage.s5PreparedGroup;
    if (
      prepared === undefined ||
      prepared.status !== 'AVAILABLE' ||
      prepared.prepareId !== payload.prepareId ||
      prepared.snapshotId !== payload.snapshotId
    ) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.prepareId',
          'no AVAILABLE frozen S5 page-group record matches this prepare/snapshot; confirmation fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const selection = s5SelectionOf(prepared, payload.selectedMemberIds);
    if (!selection.ok) {
      return rejected(envelope.requestId, selection.diagnostics);
    }
    const revision = aggregate.revision;
    if (envelope.expectedRevision !== revision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `S5 selection challenge requires the current aggregate revision ${String(revision)}`,
            'L2-§10',
          ),
        ],
        revision,
      );
    }
    const digest = s5SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      prepareId: payload.prepareId,
      selectedMemberIds: payload.selectedMemberIds,
    });
    if (payload.displayedTupleDigest !== digest) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.displayedTupleDigest',
          'the browser-displayed tuple digest does not match the frozen Core facts for this selection; BEGIN fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    // A fresh BEGIN (fresh requestId) revokes the previous pending challenge
    // of this connection+aggregate — only the newest confirmation intent
    // stays answerable (the S4 F3 discipline).
    s5ChallengeMint.revokePending(connectionId, envelope.aggregateId);
    const expiresAtMs = now() + ttlMs;
    const minted = s5ChallengeMint.mint({
      connectionId,
      aggregateId: envelope.aggregateId,
      tupleDigest: digest,
      revision,
      ttlMs,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    });
    const response: SeamResponse = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      s5PrivateChallenge: {
        prepareId: payload.prepareId,
        confirmedGroupId: `s5group:${envelope.aggregateId}:${payload.snapshotId}`,
        value: minted.challenge,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
      currentRevision: revision,
    };
    s5BeginResponses.set(envelope.requestId, {
      response,
      payloadDigest: stableStringify(envelope.payload),
    });
    return response;
  }

  /**
   * #154 CONFIRM_S6_COLLECTION phase BEGIN: mint the single-use
   * connection-bound Core challenge bound to the displayed selection tuple
   * over the frozen collection members (the S3/S4/S5 discipline; never
   * journaled — the COMMIT consumes it atomically with the durable record).
   */
  function handleS6ConfirmBegin(
    envelope: CommandEnvelope,
    connectionId: string,
    ttlMs: number,
    now: () => number,
  ): SeamResponse {
    const prior = s6BeginResponses.get(envelope.requestId);
    if (prior !== undefined) {
      if (prior.payloadDigest !== stableStringify(envelope.payload)) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same S6 BEGIN identity was already answered for a different tuple; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      return { ...prior.response, s6PrivateChallenge: undefined };
    }
    if (s6BeginResponses.size > 512) {
      const oldest = s6BeginResponses.keys().next();
      if (oldest.done !== true) {
        s6BeginResponses.delete(oldest.value);
      }
    }
    if (envelope.peer.surface !== 'BROWSER_EXTENSION') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S6 selection challenges serve the installed browser-extension surface only',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const lineage = state.lineages.get(envelope.aggregateId);
    if (aggregate === undefined || lineage === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    if (lineage.status !== 'ACTIVE') {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'LATE_COMMAND',
          'lineage.status',
          `lineage is ${lineage.status}; late S6 selection challenge is rejected`,
          'L2-§11',
        ),
      ]);
    }
    const payloadBytes = payloadByteLength(envelope.payload);
    if (payloadBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'PAYLOAD_TOO_LARGE',
          'payload',
          `serialized payload of ${String(payloadBytes)} bytes exceeds declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)}`,
        ),
      ]);
    }
    const payload = envelope.payload as S6ConfirmBeginPayload;
    const prepared = lineage.s6PreparedCollection;
    if (
      prepared === undefined ||
      prepared.status !== 'AVAILABLE' ||
      prepared.prepareId !== payload.prepareId ||
      prepared.snapshotId !== payload.snapshotId
    ) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.prepareId',
          'no AVAILABLE frozen S6 collection record matches this prepare/snapshot; confirmation fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const selection = s6SelectionOf(prepared, lineage.s6Pages ?? [], payload.selectedMemberIds);
    if (!selection.ok) {
      return rejected(envelope.requestId, selection.diagnostics);
    }
    const revision = aggregate.revision;
    if (envelope.expectedRevision !== revision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `S6 selection challenge requires the current aggregate revision ${String(revision)}`,
            'L2-§10',
          ),
        ],
        revision,
      );
    }
    const digest = s6SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      prepareId: payload.prepareId,
      selectedMemberIds: payload.selectedMemberIds,
    });
    if (payload.displayedTupleDigest !== digest) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.displayedTupleDigest',
          'the browser-displayed tuple digest does not match the frozen Core facts for this selection; BEGIN fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    // A fresh BEGIN (fresh requestId) revokes the previous pending challenge
    // of this connection+aggregate — only the newest confirmation intent
    // stays answerable (the S4 F3 discipline).
    s6ChallengeMint.revokePending(connectionId, envelope.aggregateId);
    const expiresAtMs = now() + ttlMs;
    const minted = s6ChallengeMint.mint({
      connectionId,
      aggregateId: envelope.aggregateId,
      tupleDigest: digest,
      revision,
      ttlMs,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    });
    const response: SeamResponse = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      s6PrivateChallenge: {
        prepareId: payload.prepareId,
        confirmedGroupId: `s6group:${envelope.aggregateId}:${payload.snapshotId}`,
        value: minted.challenge,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
      currentRevision: revision,
    };
    s6BeginResponses.set(envelope.requestId, {
      response,
      payloadDigest: stableStringify(envelope.payload),
    });
    return response;
  }

  function handleQuery(envelope: QueryEnvelope): SeamResponse {
    if (envelope.queryType !== 'READ_PROJECTION') {
      return rejected(envelope.requestId, [
        seamDiagnostic('UNKNOWN_QUERY_TYPE', 'queryType', 'unknown query discriminant'),
      ]);
    }
    const view = projectAggregate(state, envelope.aggregateId);
    if (view === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'PROJECTION',
      projection: view,
    };
  }

  function handleCommand(
    envelope: CommandEnvelope,
    s3Live?: S3LiveAdmissionContext,
    s4Live?: S4LiveAdmissionContext,
    s5Live?: S5LiveAdmissionContext,
    s6Live?: S6LiveAdmissionContext,
  ): SeamResponse {
    // Declared payload byte bound before any parse into authority state.
    const payloadBytes = payloadByteLength(envelope.payload);
    if (payloadBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'PAYLOAD_TOO_LARGE',
          'payload',
          `serialized payload of ${String(payloadBytes)} bytes exceeds declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)}`,
        ),
      ]);
    }
    // Idempotency gate before revision/decode/effect (frozen L2 §6.8/ADR-010).
    const prior = state.accepted.get(envelope.requestId);
    const digest = stableStringify(envelope.payload);
    if (prior !== undefined) {
      if (prior.payloadDigest !== digest) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same idempotent command identity was accepted with a different payload; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      return {
        ...prior.response,
        acceptance: prior.response.acceptance && {
          ...prior.response.acceptance,
          converged: true,
        },
      };
    }
    // Revision gate.
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const currentRevision = aggregate?.revision ?? 0;
    if (envelope.expectedRevision !== currentRevision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `expected revision ${String(envelope.expectedRevision)} but current aggregate revision is ${String(currentRevision)}`,
            'L2-§10',
          ),
        ],
        currentRevision,
      );
    }
    // Authority-affecting path: domain decode + semantic gates + state apply.
    const outcome = applyCommand(
      state,
      gateway,
      envelope,
      options.s2DeliveredAcquisition,
      options.s1DirectAcquisition,
      s1Intents,
      options.s3MediaProfiles,
      options.s3SelectedMedia,
      options.s4Preview,
      options.s4SelectedHls,
      options.s5PageGroup,
      options.s6Collection,
      s3Live,
      s4Live,
      s5Live,
      s6Live,
    );
    if (!outcome.ok) {
      return rejected(envelope.requestId, outcome.diagnostics, currentRevision);
    }
    const response = acceptedResponse(envelope, outcome.value.revision);
    const record: AcceptedCommand = { envelope, response, payloadDigest: digest };
    if (journal !== undefined) {
      // #150: the journaled CONFIRM_S3_CANDIDATE carries the Core-computed
      // candidate record (including the media-registry replay pin) as its
      // payload — the durable pin's only home; replay reuses it verbatim.
      // #153: the journaled S4 COMMIT carries the secret-free confirmed
      // selection record — the raw private challenge never reaches durable
      // state; replay re-applies the record shape without live verification.
      let journalEnvelope = envelope;
      if (envelope.commandType === 'CONFIRM_S3_CANDIDATE') {
        journalEnvelope = {
          ...envelope,
          payload: state.lineages.get(envelope.aggregateId)?.s3Candidate ?? envelope.payload,
        };
      } else if (envelope.commandType === 'CONFIRM_S4_SELECTION') {
        journalEnvelope = {
          ...envelope,
          payload:
            state.lineages.get(envelope.aggregateId)?.s4ConfirmedSelection ?? envelope.payload,
        };
      } else if (envelope.commandType === 'CONFIRM_S6_COLLECTION') {
        // #154: the journaled S6 COMMIT carries ONLY the secret-free
        // confirmed collection record — the raw private challenge never
        // reaches durable state (the identical S5 discipline).
        const s6Confirmed = state.lineages.get(envelope.aggregateId)?.s6ConfirmedCollection;
        if (s6Confirmed === undefined) {
          poisonForRecovery(
            `accepted S6 confirm has no durable confirmed record; refusing to journal the raw payload`,
          );
        }
        journalEnvelope = { ...envelope, payload: s6Confirmed };
      } else if (envelope.commandType === 'CONFIRM_S5_PAGE_GROUP') {
        // #151: the journaled S5 COMMIT carries ONLY the secret-free
        // confirmed group record — the raw private challenge never reaches
        // durable state. A missing record here means authority state is out
        // of sync with the applied command: fail closed (poison), never
        // journal the raw challenge-bearing payload.
        const s5Confirmed = state.lineages.get(envelope.aggregateId)?.s5ConfirmedGroup;
        if (s5Confirmed === undefined) {
          poisonForRecovery(
            `accepted S5 confirm has no durable confirmed record; refusing to journal the raw payload`,
          );
        }
        journalEnvelope = { ...envelope, payload: s5Confirmed };
      }
      let durability;
      try {
        durability = journal.append({
          kind: 'COMMAND',
          envelope: journalEnvelope,
          response,
          payloadDigest: digest,
        });
      } catch (error) {
        poisonForRecovery(
          `accepted command journal threw after authority apply; durability is uncertain: ${String(
            error,
          )}`,
        );
      }
      // A malformed/custom/legacy port result is itself durability uncertainty.
      // Authority was already mutated; never let a TypeError escape unfenced.
      if (
        durability === null ||
        typeof durability !== 'object' ||
        !['COMMITTED', 'NOT_COMMITTED', 'UNCERTAIN'].includes(durability.status)
      ) {
        poisonForRecovery('accepted command journal returned an invalid durability outcome');
      }
      if (durability.status !== 'COMMITTED') {
        poisonForRecovery(
          `accepted command authority changed before journal commit; durability=${durability.status}: ${durability.error}`,
        );
      }
    }
    state.accepted.set(envelope.requestId, record);
    // #150: the selection challenge is consumed single-use ATOMICALLY with
    // the candidate journal commit — never before the durability outcome.
    if (envelope.commandType === 'CONFIRM_S3_CANDIDATE' && s3Live !== undefined) {
      const attestation = (envelope.payload as S3ConfirmCandidatePayload).selectionAttestation;
      s3Live.challenges.consume(attestation.interactionId);
    }
    // #153: the S4 private challenge is consumed single-use ATOMICALLY with
    // the confirmed-selection journal commit — never before the durability
    // outcome, and never durably recorded (the journaled payload above is the
    // secret-free record).
    if (envelope.commandType === 'CONFIRM_S4_SELECTION' && s4Live !== undefined) {
      const commit = envelope.payload as S4ConfirmCommitPayload;
      if (commit.confirmationChallenge !== undefined) {
        s4Live.challenges.consume(commit.confirmationChallenge);
      }
    }
    // #151: the S5 private challenge is consumed single-use ATOMICALLY with
    // the confirmed-group journal commit (the same S3/S4 discipline).
    if (envelope.commandType === 'CONFIRM_S5_PAGE_GROUP' && s5Live !== undefined) {
      const commit = envelope.payload as S5ConfirmCommitPayload;
      if (commit.confirmationChallenge !== undefined) {
        s5Live.challenges.consume(commit.confirmationChallenge);
      }
    }
    // #154: the S6 private challenge is consumed single-use ATOMICALLY with
    // the confirmed-collection journal commit (the same S3/S4/S5 discipline).
    if (envelope.commandType === 'CONFIRM_S6_COLLECTION' && s6Live !== undefined) {
      const commit = envelope.payload as S6ConfirmCommitPayload;
      if (commit.confirmationChallenge !== undefined) {
        s6Live.challenges.consume(commit.confirmationChallenge);
      }
    }
    // #151: an accepted S5 collection execution only registered its intent
    // (apply); the real bounded per-member acquisition starts strictly AFTER
    // the accepted-command journal commit.
    if (envelope.commandType === 'EXECUTE_S5_COLLECTION' && options.s5PageGroup) {
      const intent = state.s5ExecutionIntents.get(envelope.aggregateId);
      if (intent !== undefined) {
        options.s5PageGroup.begin({
          aggregateId: envelope.aggregateId,
          requestId: envelope.requestId,
          confirmed: intent.confirmed,
          prepared: intent.prepared,
        });
      }
    }
    // #154: an accepted S6 collection execution only registered its intent
    // (apply); the real bounded per-member acquisition starts strictly AFTER
    // the accepted-command journal commit.
    if (envelope.commandType === 'EXECUTE_S6_COLLECTION' && options.s6Collection) {
      const intent = state.s6ExecutionIntents.get(envelope.aggregateId);
      if (intent !== undefined) {
        options.s6Collection.begin({
          aggregateId: envelope.aggregateId,
          requestId: envelope.requestId,
          confirmed: intent.confirmed,
          prepared: intent.prepared,
          pages: intent.pages,
        });
      }
    }
    // #153: the durably admitted preview intent drives its bounded master
    // read strictly AFTER the accepted-command journal commit.
    if (envelope.commandType === 'PREVIEW_S4_HLS_VOD' && options.s4Preview) {
      const preview = state.lineages.get(envelope.aggregateId)?.s4Preview;
      const contract = state.aggregates.get(envelope.aggregateId)?.contract;
      if (preview !== undefined && contract !== undefined) {
        options.s4Preview.begin({
          aggregateId: envelope.aggregateId,
          contract,
          preview,
        });
      }
    }
    // #153: an accepted S4 execution only registered its intent (apply); the
    // external bounded manifest/segment/FFmpeg effect starts strictly AFTER
    // the accepted-command journal commit.
    if (envelope.commandType === 'EXECUTE_S4_SELECTED_HLS_VOD' && options.s4SelectedHls) {
      const intent = state.s4ExecutionIntents.get(envelope.aggregateId);
      if (intent !== undefined) {
        options.s4SelectedHls.begin({
          aggregateId: envelope.aggregateId,
          contract: state.aggregates.get(envelope.aggregateId)!.contract,
          selection: intent.selection,
          requestId: envelope.requestId,
        });
      }
    }
    // #150: an accepted S3 selected-media execution only registered its
    // intent (apply); the external HTTP effect starts strictly AFTER the
    // accepted-command journal commit.
    if (envelope.commandType === 'EXECUTE_S3_SELECTED_MEDIA' && options.s3SelectedMedia) {
      const intent = state.s3ExecutionIntents.get(envelope.aggregateId);
      if (intent !== undefined) {
        options.s3SelectedMedia.begin({
          aggregateId: envelope.aggregateId,
          contract: state.aggregates.get(envelope.aggregateId)!.contract,
          candidate: intent.candidate,
          requestId: envelope.requestId,
        });
      }
    }
    // #101: an accepted S1 execution command only registered its intent
    // (apply); the external HTTP effect starts strictly AFTER the
    // accepted-command journal commit — never between apply and durability.
    if (envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION') {
      options.s1DirectAcquisition?.begin({
        aggregateId: envelope.aggregateId,
        contract: state.aggregates.get(envelope.aggregateId)!.contract,
        payload: envelope.payload,
      });
    }
    // #101 P2-1: a durably committed user cancel connects to the canonical
    // Core stores and the in-flight S1 transfer abort checkpoint strictly
    // AFTER the CANCEL_LINEAGE journal commit (the cancel bridge self-filters
    // aggregates without a registered S1 execution; the idempotent-replay
    // path above already returned and never re-fires).
    if (envelope.commandType === 'CANCEL_LINEAGE') {
      options.s1LineageCancel?.cancelled({
        aggregateId: envelope.aggregateId,
        source: envelope.peer.surface,
      });
    }
    return response;
  }

  function acceptedResponse(envelope: CommandEnvelope, revision: number): SeamResponse {
    const acceptance: SeamAcceptance = {
      requestId: envelope.requestId,
      aggregateId: envelope.aggregateId,
      revision,
      converged: false,
    };
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      acceptance,
      currentRevision: revision,
    };
  }

  function recordFailedMembers(
    aggregateId: string,
    memberIds: readonly string[],
  ): SeamResult<void> {
    if (recoveryFenceReason !== undefined) {
      return seamFail([recoveryFenceDiagnostic()]);
    }
    const lineage = state.lineages.get(aggregateId);
    if (lineage === undefined) {
      return seamFail([
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no lineage exists for this id'),
      ]);
    }
    const decoded: MemberId[] = [];
    for (const raw of memberIds) {
      const memberId = makeMemberId(raw);
      if (!memberId.ok) {
        return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
      }
      decoded.push(memberId.value);
    }
    const mutated = recordFailedMembersByIds(state, aggregateId, decoded);
    if (!mutated.ok) {
      return mutated;
    }
    return seamOk(undefined);
  }

  function recordCoverageAccounting(
    aggregateId: string,
    accounting: CoverageAccounting,
    evidenceLedger?: EvidenceLedger,
  ): SeamResult<{ readonly converged: boolean }> {
    if (recoveryFenceReason !== undefined) {
      return seamFail([recoveryFenceDiagnostic()]);
    }
    if (journal === undefined) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'journal',
          'durable Core journal is required before authoritative coverage accounting can be published',
          'PRD-§17/§27',
        ),
      ]);
    }
    const inaccessibleResult = validateAuthInaccessibleMembers(
      (accounting as { authInaccessible?: unknown } | null)?.authInaccessible,
    );
    if (!inaccessibleResult.ok) {
      return inaccessibleResult;
    }
    const referencedEvidenceIds = new Set(
      inaccessibleResult.value
        .filter((member) => member.independentlyAccounted)
        .map((member) => member.classificationEvidenceId),
    );
    const classificationEvidence = (evidenceLedger?.records() ?? []).filter((record) =>
      referencedEvidenceIds.has(record.evidenceId),
    );
    const applied = applyCoverageAccountingReceipt(
      state,
      aggregateId,
      accounting,
      classificationEvidence,
    );
    if (!applied.ok) {
      return applied;
    }
    if (!applied.value.converged) {
      const receiptEntry = {
        kind: 'COVERAGE_ACCOUNTING' as const,
        aggregateId,
        accounting,
        classificationEvidence,
      };
      let durability;
      try {
        durability = journal.append(receiptEntry);
      } catch (error) {
        poisonForRecovery(
          `coverage receipt journal threw after in-memory authority apply; durability is uncertain: ${String(
            error,
          )}`,
        );
      }
      // Journal ports are TypeScript interfaces, but runtime adapters may be
      // malformed (including a legacy void append); poison before any read.
      if (
        durability === null ||
        typeof durability !== 'object' ||
        !['COMMITTED', 'NOT_COMMITTED', 'UNCERTAIN'].includes(durability.status)
      ) {
        poisonForRecovery('coverage receipt journal returned an invalid durability outcome');
      }
      if (durability.status === 'UNCERTAIN') {
        poisonForRecovery(
          `coverage receipt durability is uncertain after in-memory authority apply: ${durability.error}`,
        );
      }
      if (durability.status === 'NOT_COMMITTED') {
        // This outcome is safe to reject because the journal implementation
        // explicitly proves no durable authority was created.
        const lineage = state.lineages.get(aggregateId);
        if (lineage !== undefined) lineage.coverageAccounting = undefined;
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'journal',
            `coverage receipt was not durably committed: ${durability.error}`,
            'L2-§6.8',
          ),
        ]);
      }
    }
    return applied;
  }

  const server: CoreSeamServer = {
    handleFrame,
    recordFailedMembers,
    recordCoverageAccounting,
    inspectProjection(aggregateId: string) {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      return projectAggregate(state, aggregateId);
    },
    pendingS1Executions() {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      const pending: PendingS1Execution[] = [];
      for (const intent of s1Intents.values()) {
        const aggregate = state.aggregates.get(intent.aggregateId);
        if (aggregate !== undefined) {
          pending.push({ ...intent, contract: aggregate.contract });
        }
      }
      return pending;
    },
    pendingS3Executions() {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      const pending: PendingS3Execution[] = [];
      for (const intent of state.s3ExecutionIntents.values()) {
        const aggregate = state.aggregates.get(intent.aggregateId);
        if (aggregate !== undefined) {
          pending.push({ ...intent, contract: aggregate.contract });
        }
      }
      return pending;
    },
    pendingS4Previews() {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      const pending: PendingS4Preview[] = [];
      for (const [aggregateId, aggregate] of state.aggregates) {
        const lineage = state.lineages.get(aggregateId);
        if (lineage?.s4Preview?.status === 'PENDING') {
          pending.push({
            aggregateId,
            contract: aggregate.contract,
            preview: lineage.s4Preview,
          });
        }
      }
      return pending;
    },
    pendingS5Executions() {
      return [...state.s5ExecutionIntents.values()] as PendingS5Execution[];
    },
    recordS5MemberOutcomes(aggregateId: string, members: readonly S5MemberOutcomeRecord[]) {
      const lineage = state.lineages.get(aggregateId);
      if (lineage === undefined) {
        return seamFail([
          seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
        ]);
      }
      lineage.s5MemberOutcomes = Object.freeze([...members]);
      return seamOk(undefined);
    },
    pendingS6Executions() {
      return [...state.s6ExecutionIntents.values()] as PendingS6Execution[];
    },
    recordS6MemberOutcomes(aggregateId: string, members: readonly S6MemberOutcomeRecord[]) {
      const lineage = state.lineages.get(aggregateId);
      if (lineage === undefined) {
        return seamFail([
          seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
        ]);
      }
      lineage.s6MemberOutcomes = Object.freeze([...members]);
      return seamOk(undefined);
    },
    pendingS4Executions() {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      const pending: PendingS4Execution[] = [];
      for (const intent of state.s4ExecutionIntents.values()) {
        const aggregate = state.aggregates.get(intent.aggregateId);
        if (aggregate !== undefined) {
          pending.push({ ...intent, contract: aggregate.contract });
        }
      }
      return pending;
    },
    recordS4PreviewResult(aggregateId: string, record: S4PreviewRecord) {
      if (recoveryFenceReason !== undefined) {
        return seamFail([recoveryFenceDiagnostic()]);
      }
      if (journal === undefined) {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'journal',
            'durable Core journal is required before an S4 preview result can be published',
            'L2-S4-§3',
          ),
        ]);
      }
      const applied = applyS4PreviewReceipt(state, aggregateId, record);
      if (!applied.ok) {
        return applied;
      }
      if (!applied.value.converged) {
        let durability;
        try {
          durability = journal.append({ kind: 'S4_PREVIEW', aggregateId, record });
        } catch (error) {
          poisonForRecovery(
            `S4 preview receipt journal threw after in-memory authority apply; durability is uncertain: ${String(
              error,
            )}`,
          );
        }
        if (
          durability === null ||
          typeof durability !== 'object' ||
          !['COMMITTED', 'NOT_COMMITTED', 'UNCERTAIN'].includes(durability.status)
        ) {
          poisonForRecovery('S4 preview receipt journal returned an invalid durability outcome');
        }
        if (durability.status === 'UNCERTAIN') {
          poisonForRecovery(
            `S4 preview receipt durability is uncertain after in-memory authority apply: ${durability.error}`,
          );
        }
        if (durability.status === 'NOT_COMMITTED') {
          return seamFail([
            seamDiagnostic(
              'ADMISSION_REJECTED',
              'journal',
              `S4 preview receipt was not durably committed: ${durability.error}`,
              'L2-§6.8',
            ),
          ]);
        }
      }
      return applied;
    },
    recordExecutedTerminal(aggregateId: string, terminal: TerminalResult) {
      if (recoveryFenceReason !== undefined) {
        return seamFail([recoveryFenceDiagnostic()]);
      }
      const aggregate = state.aggregates.get(aggregateId);
      const lineage = state.lineages.get(aggregateId);
      if (aggregate === undefined || lineage === undefined) {
        return seamFail([
          seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
        ]);
      }
      if (lineage.status === 'CANCELLED') {
        // #101 P2-1: a durably committed user cancel precedes any acceptance
        // this terminal could claim — executed-terminal recording across the
        // cutoff is rejected (the truthful cancellation closure goes through
        // `closeCancelledLineage`; acceptance that already stood before the
        // cancel is re-derived by the projector and closed there).
        return seamFail([
          seamDiagnostic(
            'LATE_COMMAND',
            'lineage.status',
            'lineage is CANCELLED; an executed terminal cannot be recorded across the durable user-cancel cutoff (L2 §11.1 / ADR-013)',
            'L2-inv20',
          ),
        ]);
      }
      if (lineage.status === 'TERMINAL') {
        return seamFail([
          seamDiagnostic(
            'LATE_COMMAND',
            'lineage.status',
            'lineage is already terminal; terminal truth is never rewritten',
            'L2-§11',
          ),
        ]);
      }
      // The value is the verbatim Core-derived projector output (the same
      // gate PROJECT_TERMINAL_RESULT passes); storage is authority handoff,
      // not a second projection. Not journaled: restart replay re-derives
      // the identical terminal from durable truth via the intent reconcile.
      lineage.terminal = terminal;
      lineage.status = 'TERMINAL';
      const revision = aggregate.revision + 1;
      aggregate.revision = revision;
      return seamOk(undefined);
    },
    closeCancelledLineage(aggregateId: string, terminal: TerminalResult) {
      if (recoveryFenceReason !== undefined) {
        return seamFail([recoveryFenceDiagnostic()]);
      }
      const aggregate = state.aggregates.get(aggregateId);
      const lineage = state.lineages.get(aggregateId);
      if (aggregate === undefined || lineage === undefined) {
        return seamFail([
          seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
        ]);
      }
      if (lineage.status === 'TERMINAL') {
        return seamFail([
          seamDiagnostic(
            'LATE_COMMAND',
            'lineage.status',
            'lineage is already terminal; terminal truth is never rewritten',
            'L2-§11',
          ),
        ]);
      }
      if (lineage.status !== 'CANCELLED') {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'lineage.status',
            'cancellation closure applies only to a CANCELLED lineage; an ACTIVE execution completes through recordExecutedTerminal',
            'L2-§11.1',
          ),
        ]);
      }
      // Same authority handoff discipline as recordExecutedTerminal: verbatim
      // projector output, no second projection, not journaled (restart
      // reconcile re-derives the identical closure from durable truth).
      lineage.terminal = terminal;
      lineage.status = 'TERMINAL';
      const revision = aggregate.revision + 1;
      aggregate.revision = revision;
      return seamOk(undefined);
    },
    recordTargetEvidence(aggregateId: string, receipt: TargetEvidenceReceipt) {
      if (recoveryFenceReason !== undefined) {
        return seamFail([recoveryFenceDiagnostic()]);
      }
      if (journal === undefined) {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'journal',
            'durable Core journal is required before a target evidence receipt can be published',
            'PRD-§17/§27',
          ),
        ]);
      }
      const applied = applyTargetEvidenceReceipt(state, aggregateId, receipt);
      if (!applied.ok) {
        return applied;
      }
      if (!applied.value.converged) {
        let durability;
        try {
          durability = journal.append({
            kind: 'TARGET_EVIDENCE',
            aggregateId,
            receipt: applied.value.receipt,
          });
        } catch (error) {
          poisonForRecovery(
            `target evidence receipt journal threw after in-memory authority apply; durability is uncertain: ${String(
              error,
            )}`,
          );
        }
        if (
          durability === null ||
          typeof durability !== 'object' ||
          !['COMMITTED', 'NOT_COMMITTED', 'UNCERTAIN'].includes(durability.status)
        ) {
          poisonForRecovery(
            'target evidence receipt journal returned an invalid durability outcome',
          );
        }
        if (durability.status === 'UNCERTAIN') {
          poisonForRecovery(
            `target evidence receipt durability is uncertain after in-memory authority apply: ${durability.error}`,
          );
        }
        if (durability.status === 'NOT_COMMITTED') {
          const lineage = state.lineages.get(aggregateId);
          if (lineage !== undefined) lineage.targetEvidence = undefined;
          return seamFail([
            seamDiagnostic(
              'ADMISSION_REJECTED',
              'journal',
              `target evidence receipt was not durably committed: ${durability.error}`,
              'L2-§6.8',
            ),
          ]);
        }
      }
      return applied;
    },
    get acceptedCommandCount() {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      return state.accepted.size;
    },
    recordTargetWitness(aggregateId: string, receipt: TargetWitnessReceipt) {
      if (recoveryFenceReason !== undefined) {
        return seamFail([recoveryFenceDiagnostic()]);
      }
      if (journal === undefined) {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'journal',
            'durable Core journal is required before a target witness can be recorded',
            'PRD-§17/§27',
          ),
        ]);
      }
      const applied = applyTargetWitnessReceipt(state, aggregateId, receipt);
      if (!applied.ok) {
        return applied;
      }
      if (!applied.value.converged) {
        let durability;
        try {
          durability = journal.append({
            kind: 'TARGET_WITNESS',
            aggregateId,
            receipt: applied.value.receipt,
          });
        } catch (error) {
          poisonForRecovery(
            `target witness journal threw after in-memory authority apply; durability is uncertain: ${String(
              error,
            )}`,
          );
        }
        if (
          durability === null ||
          typeof durability !== 'object' ||
          !['COMMITTED', 'NOT_COMMITTED', 'UNCERTAIN'].includes(durability.status)
        ) {
          poisonForRecovery('target witness journal returned an invalid durability outcome');
        }
        if (durability.status === 'UNCERTAIN') {
          poisonForRecovery(
            `target witness durability is uncertain after in-memory authority apply: ${durability.error}`,
          );
        }
        if (durability.status === 'NOT_COMMITTED') {
          const lineage = state.lineages.get(aggregateId);
          if (lineage !== undefined) lineage.targetWitness = undefined;
          return seamFail([
            seamDiagnostic(
              'ADMISSION_REJECTED',
              'journal',
              `target witness was not durably committed: ${durability.error}`,
              'L2-§6.8',
            ),
          ]);
        }
      }
      return applied;
    },
    targetWitnessFor(aggregateId: string) {
      if (recoveryFenceReason !== undefined) {
        throw new Error(recoveryFenceMessage());
      }
      return state.lineages.get(aggregateId)?.targetWitness;
    },
  };
  return { ok: true, value: server };
}

interface CoverageReceiptApply {
  readonly converged: boolean;
}

function sameIdentitySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function validateCoverageIdentitySet(
  value: unknown,
  path: string,
  requested?: ReadonlySet<string>,
): SeamResult<readonly string[]> {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        path,
        'coverage receipt identity set must be an array of non-empty strings',
      ),
    ]);
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) {
    return seamFail([
      seamDiagnostic(
        'DUPLICATE_IDENTITY',
        path,
        'coverage receipt identity sets reject duplicates',
      ),
    ]);
  }
  if (requested !== undefined) {
    const outside = ids.filter((id) => !requested.has(id));
    if (outside.length > 0) {
      return seamFail([
        seamDiagnostic(
          'SCOPE_MUTATION',
          path,
          `coverage receipt contains identities outside immutable requested scope (${outside.join(', ')})`,
          'PRD-§17',
        ),
      ]);
    }
  }
  return seamOk(ids);
}

interface RuntimeAuthInaccessibleMember {
  readonly memberId: string;
  readonly independentlyAccounted: boolean;
  readonly classificationEvidenceId?: string;
}

function validateAuthInaccessibleMembers(
  value: unknown,
): SeamResult<readonly RuntimeAuthInaccessibleMember[]> {
  if (!Array.isArray(value)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'coverageAccounting.authInaccessible',
        'auth-inaccessible receipt entries must be an array',
        'PRD-§17/§19',
      ),
    ]);
  }
  const decoded: RuntimeAuthInaccessibleMember[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'coverageAccounting.authInaccessible',
          'auth-inaccessible receipt member must be an object',
          'PRD-§17/§19',
        ),
      ]);
    }
    const member = raw as Record<string, unknown>;
    if (
      typeof member['memberId'] !== 'string' ||
      member['memberId'].length === 0 ||
      typeof member['independentlyAccounted'] !== 'boolean'
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'coverageAccounting.authInaccessible',
          'auth-inaccessible receipt member requires non-empty memberId and boolean independentlyAccounted',
          'PRD-§17/§19',
        ),
      ]);
    }
    const evidenceId = member['classificationEvidenceId'];
    if (evidenceId !== undefined && (typeof evidenceId !== 'string' || evidenceId.length === 0)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'coverageAccounting.authInaccessible.classificationEvidenceId',
          'classification evidence id must be a non-empty string when present',
          'PRD-§19',
        ),
      ]);
    }
    if (member['independentlyAccounted'] && evidenceId === undefined) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'coverageAccounting.authInaccessible',
          'independently accounted inaccessible members require evidence identity',
          'PRD-§19',
        ),
      ]);
    }
    decoded.push({
      memberId: member['memberId'],
      independentlyAccounted: member['independentlyAccounted'],
      ...(evidenceId === undefined ? {} : { classificationEvidenceId: evidenceId }),
    });
  }
  return seamOk(decoded);
}

/**
 * Validate and apply one trusted Core-runtime CoverageAccounting receipt.
 * Counts are never trusted directly: projection derives cardinalities from the
 * persisted identity sets. Surface peers have no wire command for this path.
 */
function applyCoverageAccountingReceipt(
  state: SeamAuthorityState,
  aggregateId: string,
  accounting: CoverageAccounting,
  classificationEvidence: readonly EvidenceRecord[] = [],
): SeamResult<CoverageReceiptApply> {
  const aggregate = state.aggregates.get(aggregateId);
  const lineage = state.lineages.get(aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic(
        'AGGREGATE_NOT_FOUND',
        'aggregateId',
        'no aggregate exists for this accounting receipt',
      ),
    ]);
  }
  if (lineage.status === 'TERMINAL') {
    return seamFail([
      seamDiagnostic(
        'LATE_COMMAND',
        'lineage.status',
        'coverage accounting cannot be added after terminal truth is accepted',
        'L2-§11',
      ),
    ]);
  }
  if (typeof accounting !== 'object' || accounting === null) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'coverageAccounting',
        'coverage accounting receipt must be an object',
      ),
    ]);
  }

  const requestedResult = validateCoverageIdentitySet(
    (accounting as { requested?: unknown }).requested,
    'coverageAccounting.requested',
  );
  if (!requestedResult.ok) return requestedResult;
  const requested = requestedResult.value;
  const requestedSet = new Set(requested);

  const setFields: readonly [string, unknown][] = [
    [
      'coverageAccounting.authAccessible',
      (accounting as { authAccessible?: unknown }).authAccessible,
    ],
    ['coverageAccounting.resolved', (accounting as { resolved?: unknown }).resolved],
    ['coverageAccounting.selected', (accounting as { selected?: unknown }).selected],
    ['coverageAccounting.validated', (accounting as { validated?: unknown }).validated],
    ['coverageAccounting.accounted', (accounting as { accounted?: unknown }).accounted],
  ];
  const parsed = new Map<string, readonly string[]>();
  for (const [path, value] of setFields) {
    const checked = validateCoverageIdentitySet(value, path, requestedSet);
    if (!checked.ok) return checked;
    parsed.set(path, checked.value);
  }

  const selected = parsed.get('coverageAccounting.selected') ?? [];
  const validated = parsed.get('coverageAccounting.validated') ?? [];
  if (validated.some((id) => !selected.includes(id))) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'coverageAccounting.validated',
        'validated identities must remain within the frozen selected identity set',
        'PRD-§19',
      ),
    ]);
  }

  const inaccessibleResult = validateAuthInaccessibleMembers(
    (accounting as { authInaccessible?: unknown }).authInaccessible,
  );
  if (!inaccessibleResult.ok) return inaccessibleResult;
  const authInaccessible = inaccessibleResult.value;
  // Evidence *identity* is not independent proof. Persist canonical evidence
  // records with the receipt and re-decode/oracle-check them on every reopen.
  if (!Array.isArray(classificationEvidence)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'classificationEvidence', 'invalid witness array'),
    ]);
  }
  const evidenceById = new Map<string, EvidenceRecord>();
  for (const raw of classificationEvidence) {
    const decoded = decodeEvidenceRecord(raw);
    if (!decoded.ok || evidenceById.has(raw?.evidenceId)) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'classificationEvidence',
          'classification evidence must be valid and have unique identities',
          'PRD-§19',
        ),
      ]);
    }
    evidenceById.set(decoded.value.evidenceId, decoded.value);
  }
  const requiredEvidenceIds = new Set(
    authInaccessible
      .filter((member) => member.independentlyAccounted)
      .map((member) => member.classificationEvidenceId as string),
  );
  if (
    evidenceById.size !== requiredEvidenceIds.size ||
    [...evidenceById.keys()].some((evidenceId) => !requiredEvidenceIds.has(evidenceId))
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'classificationEvidence',
        'classification evidence set must exactly match the receipt-referenced independent authorization witnesses',
        'PRD-§19',
      ),
    ]);
  }
  for (const raw of authInaccessible) {
    const item = raw as {
      memberId: string;
      independentlyAccounted: boolean;
      classificationEvidenceId?: string;
    };
    if (!item.independentlyAccounted) continue;
    const evidence = evidenceById.get(item.classificationEvidenceId ?? '');
    if (
      evidence === undefined ||
      !canServeAsIndependentValidationOracle(evidence) ||
      evidence.claimType !== 'AUTHORIZATION' ||
      evidence.scope.domain !== 'AUTHORIZATION' ||
      evidence.provenance.executionContext?.authorizationContextRef !==
        accounting.authorizationContextRef ||
      evidence.claimSubject.kind !== 'MEMBER' ||
      evidence.claimSubject.ref !== item.memberId ||
      evidence.scope.contractRef !== aggregateId ||
      (lineage.snapshot === undefined
        ? evidence.scope.snapshotRef !== undefined
        : evidence.scope.snapshotRef !== lineage.snapshot.snapshotId)
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'classificationEvidence',
          'independently-accounted inaccessible identity requires matching independent authorization evidence',
          'PRD-§19',
        ),
      ]);
    }
  }
  const inaccessibleIds = authInaccessible.map((item) => item.memberId);
  const inaccessibleSetCheck = validateCoverageIdentitySet(
    inaccessibleIds,
    'coverageAccounting.authInaccessible',
    requestedSet,
  );
  if (!inaccessibleSetCheck.ok) return inaccessibleSetCheck;
  const evidencedInaccessible = authInaccessible
    .filter((item) => item.independentlyAccounted)
    .map((item) => item.memberId);
  const accounted = parsed.get('coverageAccounting.accounted') ?? [];
  const resolved = parsed.get('coverageAccounting.resolved') ?? [];
  const expectedAccounted = [...new Set([...validated, ...evidencedInaccessible])];
  if (
    !sameIdentitySet(accounted, expectedAccounted) ||
    evidencedInaccessible.some((id) => !resolved.includes(id)) ||
    selected.some((id) => !resolved.includes(id))
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'coverageAccounting.accounted',
        'accounted must equal validated plus independently-classified inaccessible; selected and evidenced inaccessible must be resolved',
        'PRD-§17/§19',
      ),
    ]);
  }
  const authAccessible = parsed.get('coverageAccounting.authAccessible') ?? [];
  if (authAccessible.some((id) => inaccessibleIds.includes(id))) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'coverageAccounting.authAccessible',
        'one identity cannot be both auth-accessible and auth-inaccessible',
        'PRD-§17',
      ),
    ]);
  }

  const counts = (accounting as { counts?: unknown }).counts;
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'coverageAccounting.counts',
        'coverage receipt counts must be an object',
        'PRD-§17',
      ),
    ]);
  }
  const countRecord = counts as Record<string, unknown>;
  if (
    countRecord['requested'] !== requested.length ||
    countRecord['authAccessible'] !== authAccessible.length ||
    countRecord['authInaccessible'] !== inaccessibleIds.length ||
    countRecord['selected'] !== selected.length ||
    countRecord['validated'] !== validated.length ||
    countRecord['accounted'] !== (parsed.get('coverageAccounting.accounted') ?? []).length
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'coverageAccounting.counts',
        'receipt counts must match the authoritative persisted identity sets',
        'PRD-§17',
      ),
    ]);
  }

  if (accounting.authorizationContextRef !== aggregate.contract.authorizationContextRef) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'coverageAccounting.authorizationContextRef',
        'coverage accounting authorization context does not bind the immutable contract',
        'PRD-§17',
      ),
    ]);
  }

  const snapshot = lineage.snapshot;
  if (snapshot !== undefined) {
    if (stableStringify(accounting.coverageTarget) !== stableStringify(snapshot.coverageTarget)) {
      return seamFail([
        seamDiagnostic(
          'CORRELATION_BINDING_REJECTED',
          'coverageAccounting.coverageTarget',
          'coverage target does not bind the confirmed snapshot identity/version',
          'PRD-§17',
        ),
      ]);
    }
    if (accounting.authorizationContextRef !== snapshot.authorizationContextRef) {
      return seamFail([
        seamDiagnostic(
          'CORRELATION_BINDING_REJECTED',
          'coverageAccounting.authorizationContextRef',
          'coverage accounting authorization context does not bind the confirmed snapshot',
          'PRD-§17',
        ),
      ]);
    }
    if (!sameIdentitySet(selected, snapshot.selectedMemberIds)) {
      return seamFail([
        seamDiagnostic(
          'SCOPE_MUTATION',
          'coverageAccounting.selected',
          'coverage selected identities must exactly match the confirmed snapshot selection',
          'PRD-§12/§17',
        ),
      ]);
    }
    if (
      snapshot.requestedMemberBasis.kind === 'EXPLICIT_IDENTITIES' &&
      !sameIdentitySet(requested, snapshot.requestedMemberBasis.memberIds)
    ) {
      return seamFail([
        seamDiagnostic(
          'SCOPE_MUTATION',
          'coverageAccounting.requested',
          'coverage requested identities must match the snapshot requested-member basis',
          'PRD-§17',
        ),
      ]);
    }
    if (
      snapshot.authAccessibleBasis.kind === 'EXPLICIT_IDENTITIES' &&
      !sameIdentitySet(authAccessible, snapshot.authAccessibleBasis.memberIds)
    ) {
      return seamFail([
        seamDiagnostic(
          'CORRELATION_BINDING_REJECTED',
          'coverageAccounting.authAccessible',
          'coverage auth-accessible identities must match the snapshot authorization basis',
          'PRD-§17',
        ),
      ]);
    }
  } else if (aggregate.contract.intentType !== 'SINGLE_RESOURCE') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'coverageAccounting',
        'collection coverage accounting requires a confirmed snapshot binding',
        'PRD-§12/§17',
      ),
    ]);
  } else {
    // No selection snapshot exists for a single-resource contract. Its
    // requested identity must still come from the immutable contract rather
    // than an arbitrarily authored accounting receipt.
    const scope = aggregate.contract.requestedScope;
    const coverageTarget = accounting.coverageTarget as {
      readonly scopeKind?: unknown;
      readonly scopeIdentityKey?: unknown;
      readonly collectionIdentity?: unknown;
    };
    if (
      scope.kind !== 'single_resource' ||
      coverageTarget?.scopeKind !== 'single_resource' ||
      coverageTarget.scopeIdentityKey !== `single_resource:${scope.targetId}` ||
      (coverageTarget.collectionIdentity !== undefined &&
        coverageTarget.collectionIdentity !== null) ||
      !sameIdentitySet(requested, [scope.targetId]) ||
      selected.some((id) => id !== scope.targetId)
    ) {
      return seamFail([
        seamDiagnostic(
          'SCOPE_MUTATION',
          'coverageAccounting.requested',
          'unsnapshotted single-resource accounting must bind the original contract target and scope identity',
          'PRD-§17',
        ),
      ]);
    }
  }

  const prior = lineage.coverageAccounting;
  if (prior !== undefined) {
    if (stableStringify(prior) === stableStringify(accounting)) {
      return seamOk({ converged: true });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'coverageAccounting',
        'a different authoritative coverage receipt is already recorded for this lineage',
        'L2-§6.8',
      ),
    ]);
  }

  lineage.coverageAccounting = accounting;
  return seamOk({ converged: false });
}

interface AppliedCommand {
  readonly revision: number;
}

/**
 * Deterministic authority application shared by the live path and restart
 * replay: domain decode → semantic gates → Core-owned state mutation.
 * Gates (authorization/bounds/idempotency/revision) run in the caller.
 * `s3Live`/`s4Live` are present only on the live OS-verified path; journal
 * replay re-applies the already-gated durable truth without them.
 */
function applyCommand(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
  s2Executor: S2DeliveredAcquisitionExecutor | undefined,
  s1Beginner: S1DirectAcquisitionBeginner | undefined,
  s1Intents: Map<string, S1ExecutionIntent>,
  s3Profiles: S3MediaProfilePort | undefined,
  s3Beginner: S3SelectedMediaBeginner | undefined,
  s4PreviewDriver: S4PreviewBeginner | undefined,
  s4Beginner: S4SelectedHlsBeginner | undefined,
  s5Beginner: S5PageGroupBeginner | undefined,
  s6Beginner: S6CollectionBeginner | undefined,
  s3Live?: S3LiveAdmissionContext,
  s4Live?: S4LiveAdmissionContext,
  s5Live?: S5LiveAdmissionContext,
  s6Live?: S6LiveAdmissionContext,
): SeamResult<AppliedCommand> {
  switch (envelope.commandType) {
    case 'SUBMIT_CONTRACT':
      return applySubmitContract(state, gateway, envelope);
    case 'CONFIRM_SNAPSHOT':
      return applyConfirmSnapshot(state, gateway, envelope);
    case 'CANCEL_LINEAGE':
      return applyCancelLineage(state, envelope);
    case 'RETRY_FAILED_MEMBERS':
      return applyRetryFailedMembers(state, envelope);
    case 'PROJECT_TERMINAL_RESULT':
      return applyProjectTerminalResult(state, gateway, envelope);
    case 'EXECUTE_S2_ACQUISITION':
      return applyExecuteS2Acquisition(state, gateway, envelope, s2Executor);
    case 'EXECUTE_S1_DIRECT_ACQUISITION':
      return applyExecuteS1DirectAcquisition(state, envelope, s1Beginner, s1Intents);
    case 'CONFIRM_S3_CANDIDATE':
      return applyConfirmS3Candidate(state, envelope, s3Profiles, s3Live);
    case 'EXECUTE_S3_SELECTED_MEDIA':
      return applyExecuteS3SelectedMedia(state, envelope, s3Profiles, s3Beginner, s3Live);
    case 'PREVIEW_S4_HLS_VOD':
      return applyPreviewS4HlsVod(state, envelope, s4PreviewDriver, s4Live);
    case 'CONFIRM_S4_SELECTION':
      return applyConfirmS4Selection(state, envelope, s4Beginner, s4Live);
    case 'EXECUTE_S4_SELECTED_HLS_VOD':
      return applyExecuteS4SelectedHls(state, envelope, s4Beginner, s4Live);
    case 'PREPARE_S5_PAGE_GROUP':
      return applyPrepareS5PageGroup(state, envelope, s5Beginner, s5Live);
    case 'CONFIRM_S5_PAGE_GROUP':
      return applyConfirmS5PageGroup(state, envelope, s5Beginner, s5Live);
    case 'EXECUTE_S5_COLLECTION':
      return applyExecuteS5Collection(state, envelope, s5Beginner, s5Live);
    case 'PREPARE_S6_COLLECTION':
      return applyPrepareS6Collection(state, envelope, s6Beginner, s6Live);
    case 'ADMIT_S6_COLLECTION_PAGE':
      return applyAdmitS6CollectionPage(state, envelope, s6Beginner, s6Live);
    case 'RECORD_S6_COLLECTION_PAGE':
      return applyRecordS6CollectionPage(state, envelope, s6Beginner, s6Live);
    case 'CONFIRM_S6_COLLECTION':
      return applyConfirmS6Collection(state, envelope, s6Beginner, s6Live);
    case 'EXECUTE_S6_COLLECTION':
      return applyExecuteS6Collection(state, envelope, s6Beginner, s6Live);
    default:
      // This internal authority application also runs during journal reopen.
      // No unlisted command may be silently promoted through old journal
      // replay, even if a crafted journal bypasses the live verified-peer
      // gate.
      return seamFail([
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S3/S4/S5/S6 1.2 execution has no installed verified Core handler; fail closed',
        ),
      ]);
  }
}

function bindCorrelation(envelope: CommandEnvelope): SeamResult<void> {
  const referenced = envelope.correlation.contractId;
  if (referenced !== undefined && referenced !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'correlation.contractId',
        'command correlation references a different aggregate than the command targets; cross-task/cross-aggregate replay rejects',
        'L2-§12',
      ),
    ]);
  }
  return seamOk(undefined);
}

function domainFailure<T>(result: DomainValidationResult<T>): SeamResult<T> {
  return result.ok ? seamOk(result.value) : seamFail(domainDiagnosticsToSeam(result.diagnostics));
}

function requireLineage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<RequiredLineage> {
  const aggregate = state.aggregates.get(envelope.aggregateId);
  const lineage = state.lineages.get(envelope.aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
    ]);
  }
  return seamOk({ aggregate, lineage });
}

interface RequiredLineage {
  readonly aggregate: { readonly contract: AcquisitionContract; revision: number };
  readonly lineage: LineageState;
}

function rejectLate(lineageStatus: string, what: string): SeamResult<never> {
  return seamFail([
    seamDiagnostic(
      'LATE_COMMAND',
      'lineage.status',
      `lineage is ${lineageStatus}; late ${what} is recorded and rejected, terminal truth unchanged`,
      'L2-§11',
    ),
  ]);
}

function applySubmitContract(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const decoded = gateway.submitContract(envelope.payload);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  const contract = decoded.value;
  if (contract.contractId !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'aggregateId',
        'decoded contract identity does not bind the addressed aggregate',
      ),
    ]);
  }
  const existing = state.aggregates.get(envelope.aggregateId);
  if (existing !== undefined) {
    // Same identity: any semantic change requires successor identity (PRD §8).
    const transition = assertContractTransition(existing.contract, contract);
    if (!transition.ok) {
      return domainFailure(transition);
    }
    return seamFail([
      seamDiagnostic(
        'DUPLICATE_ALLOCATION',
        'aggregateId',
        'aggregate identity already exists; re-creation or mutation requires a successor contract identity',
        'L2-§6.8',
      ),
    ]);
  }
  // Successor path: a new identity may supersede an existing aggregate.
  const supersedes = contract.supersedesContractId;
  if (supersedes !== undefined) {
    const predecessor = state.aggregates.get(supersedes);
    if (predecessor === undefined) {
      return seamFail([
        seamDiagnostic(
          'AGGREGATE_NOT_FOUND',
          'contract.supersedesContractId',
          'successor references an unknown predecessor aggregate',
        ),
      ]);
    }
    const transition = assertContractTransition(predecessor.contract, contract);
    if (!transition.ok) {
      return domainFailure(transition);
    }
  }
  state.aggregates.set(envelope.aggregateId, { contract, revision: 1 });
  state.lineages.set(envelope.aggregateId, createLineageState());
  return seamOk({ revision: 1 });
}

function applyConfirmSnapshot(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'snapshot confirmation');
  }
  if (lineage.snapshot !== undefined) {
    return seamFail([
      seamDiagnostic(
        'SNAPSHOT_MUTATION',
        'lineage.snapshot',
        'selection snapshot already confirmed for this lineage; refresh/re-enumeration requires successor contract/snapshot identity',
        'C11',
      ),
    ]);
  }
  const decoded = gateway.confirmSnapshot(envelope.payload, aggregate.contract);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  const snapshot = decoded.value;
  if (snapshot.contractId !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'aggregateId',
        'decoded snapshot binds a different contract than the addressed aggregate; cross-task replay rejects',
        'C31',
      ),
    ]);
  }
  lineage.snapshot = snapshot;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

function applyCancelLineage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return rejectLate(lineage.status, 'cancel command');
  }
  if (lineage.status === 'CANCELLED') {
    // A second cancel resolves through the same Core order: no new
    // precedence, no revision bump (single authority across surfaces,
    // L2 §11.1 rule 7).
    return seamOk({ revision: aggregate.revision });
  }
  lineage.status = 'CANCELLED';
  state.cancelOrderCounter += 1;
  lineage.cancelOrder = state.cancelOrderCounter;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

function applyRetryFailedMembers(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return rejectLate(lineage.status, 'retry command');
  }
  const payloadResult = decodeRetryPayload(envelope.payload);
  if (!payloadResult.ok) {
    return payloadResult;
  }
  const requested = payloadResult.value;
  if (lineage.failedMembers.length === 0) {
    return seamFail([
      seamDiagnostic(
        'RETRY_AUTHORITY_DOMAIN_REJECTED',
        'payload.memberIds',
        'no failed-member authority domain is recorded for this lineage; retry cannot invent one',
        'C12',
      ),
    ]);
  }
  const outside = requested.filter((memberId) => !lineage.failedMembers.includes(memberId));
  if (outside.length > 0) {
    return seamFail([
      seamDiagnostic(
        'RETRY_AUTHORITY_DOMAIN_REJECTED',
        'payload.memberIds',
        `retry authority domain is the original failed member identities; ${String(outside.length)} requested member(s) are outside that domain`,
        'C12',
      ),
    ]);
  }
  for (const memberId of requested) {
    if (!lineage.retriedMembers.includes(memberId)) {
      lineage.retriedMembers.push(memberId);
    }
  }
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

const RETRY_PAYLOAD_KEYS: readonly string[] = ['memberIds'];

function decodeRetryPayload(payload: unknown): SeamResult<readonly MemberId[]> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'retry payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !RETRY_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `payload.${key}`, 'unknown field on retry payload'),
      ),
    );
  }
  const raw = record['memberIds'];
  if (!Array.isArray(raw) || raw.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.memberIds',
        'memberIds must be a non-empty array',
      ),
    ]);
  }
  const memberIds: MemberId[] = [];
  for (const item of raw) {
    const memberId = makeMemberId(typeof item === 'string' ? item : '');
    if (!memberId.ok) {
      return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
    }
    if (memberIds.includes(memberId.value)) {
      return seamFail([
        seamDiagnostic(
          'DUPLICATE_IDENTITY',
          'payload.memberIds',
          `duplicate member identity '${memberId.value}' in one command`,
        ),
      ]);
    }
    memberIds.push(memberId.value);
  }
  return seamOk(memberIds);
}

function applyProjectTerminalResult(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return seamFail([
      seamDiagnostic(
        'LATE_COMMAND',
        'lineage.status',
        'lineage is already terminal; terminal truth is never rewritten',
        'L2-§11',
      ),
    ]);
  }
  // Seam-owned context derivation: Core canonical state supplies the subject
  // facts; the command may carry the projector's evidence context (closed
  // fields, shape-checked here, semantics validated by the domain layer).
  const selectedMemberCount =
    lineage.snapshot !== undefined
      ? lineage.snapshot.selectedMemberIds.length
      : aggregate.contract.intentType === 'SINGLE_RESOURCE'
        ? 1
        : 0;
  const command = decodeTerminalCommand(envelope.payload);
  if (!command.ok) {
    return command;
  }
  const context: TerminalResultContext = {
    intentType: aggregate.contract.intentType,
    scopeKind: aggregate.contract.requestedScope.kind,
    selectedMemberCount,
    ...command.value.context,
  };
  const decoded = gateway.projectTerminalResult(command.value.result, context);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  lineage.terminal = decoded.value;
  lineage.status = 'TERMINAL';
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/** Closed top-level payload fields of EXECUTE_S2_ACQUISITION (executor owns the deep decode). */
const S2_PAYLOAD_KEYS: readonly string[] = [
  'snapshotId',
  'memberId',
  'artifactId',
  'authorizationContextRef',
  'delivery',
  'browserResponse',
  'bytes',
  'chunk',
];

/** Idempotent failed-member fact mutation shared by the trusted port and S2 execution. */
function recordFailedMembersByIds(
  state: SeamAuthorityState,
  aggregateId: string,
  memberIds: readonly MemberId[],
): SeamResult<void> {
  const lineage = state.lineages.get(aggregateId);
  if (lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no lineage exists for this id'),
    ]);
  }
  for (const memberId of memberIds) {
    if (!lineage.failedMembers.includes(memberId)) {
      lineage.failedMembers.push(memberId);
    }
  }
  return seamOk(undefined);
}

const TARGET_EVIDENCE_FIELDS: readonly string[] = [
  'artifactId',
  'effectId',
  'artifactSha256',
  'basis',
  'certaintyClass',
];
const TARGET_EVIDENCE_BASIS_VALUES: readonly string[] = [
  'PUBLISHED_SHA256',
  'REQUESTED_LOCATOR_PROVENANCE',
];
const TARGET_EVIDENCE_CERTAINTY_VALUES: readonly string[] = ['DECISIVE', 'PROBATIVE'];
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Validate one secret-free typed Target evidence receipt (#101 P2-2, C34):
 * exact artifact/effect identities, lowercase-hex digest, closed basis/
 * certainty vocabularies and the frozen C34 pairing (a publisher-digest
 * anchor is decisive; requested-locator provenance is probative only).
 */
function decodeTargetEvidenceReceipt(value: unknown): SeamResult<TargetEvidenceReceipt> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetEvidence',
        'target evidence receipt must be an object',
      ),
    ]);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !TARGET_EVIDENCE_FIELDS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `targetEvidence.${key}`, 'unknown receipt field'),
      ),
    );
  }
  const missing = TARGET_EVIDENCE_FIELDS.filter((key) => record[key] === undefined);
  if (missing.length > 0) {
    return seamFail(
      missing.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `targetEvidence.${key}`, 'receipt field is required'),
      ),
    );
  }
  for (const key of ['artifactId', 'effectId'] as const) {
    const id = record[key];
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `targetEvidence.${key}`,
          'receipt identity must be a non-empty bounded string',
        ),
      ]);
    }
  }
  const digest = record['artifactSha256'];
  if (typeof digest !== 'string' || !SHA256_HEX_PATTERN.test(digest)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetEvidence.artifactSha256',
        'receipt digest must be a lowercase hex SHA-256 of the accepted bytes',
      ),
    ]);
  }
  const basis = record['basis'];
  if (typeof basis !== 'string' || !TARGET_EVIDENCE_BASIS_VALUES.includes(basis)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetEvidence.basis',
        'receipt basis is a closed C34 vocabulary value',
      ),
    ]);
  }
  const certainty = record['certaintyClass'];
  if (typeof certainty !== 'string' || !TARGET_EVIDENCE_CERTAINTY_VALUES.includes(certainty)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetEvidence.certaintyClass',
        'receipt certaintyClass is a closed vocabulary value',
      ),
    ]);
  }
  if (
    (basis === 'PUBLISHED_SHA256' && certainty !== 'DECISIVE') ||
    (basis === 'REQUESTED_LOCATOR_PROVENANCE' && certainty !== 'PROBATIVE')
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetEvidence.certaintyClass',
        'C34 pairing violated: a publisher-digest anchor is DECISIVE, requested-locator provenance is PROBATIVE',
        'C34',
      ),
    ]);
  }
  return seamOk({
    artifactId: record['artifactId'] as string,
    effectId: record['effectId'] as string,
    artifactSha256: digest,
    basis: basis as TargetEvidenceReceipt['basis'],
    certaintyClass: certainty as TargetEvidenceReceipt['certaintyClass'],
  });
}

/**
 * Validate and apply one trusted Core-runtime Target evidence receipt.
 * Identical receipts converge (restart replay never rewrites authority); a
 * conflicting receipt for the same lineage rejects — the recorded identity
 * basis is never rewritten. Internal authority fact: no surface revision is
 * consumed (mirrors recordFailedMembers).
 */
function applyTargetEvidenceReceipt(
  state: SeamAuthorityState,
  aggregateId: string,
  raw: unknown,
): SeamResult<{ readonly converged: boolean; readonly receipt: TargetEvidenceReceipt }> {
  const aggregate = state.aggregates.get(aggregateId);
  const lineage = state.lineages.get(aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic(
        'AGGREGATE_NOT_FOUND',
        'aggregateId',
        'no aggregate exists for this target evidence receipt',
      ),
    ]);
  }
  const decoded = decodeTargetEvidenceReceipt(raw);
  if (!decoded.ok) {
    return decoded;
  }
  const receipt = decoded.value;
  if (lineage.targetEvidence !== undefined) {
    if (stableStringify(lineage.targetEvidence) === stableStringify(receipt)) {
      return seamOk({ converged: true, receipt });
    }
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetEvidence',
        'a different target evidence receipt is already recorded for this lineage; the recorded basis is never rewritten',
        'C34',
      ),
    ]);
  }
  lineage.targetEvidence = receipt;
  return seamOk({ converged: false, receipt });
}

const TARGET_WITNESS_FIELDS: readonly string[] = [
  'snapshotId',
  'memberId',
  'artifactId',
  'effectId',
  'locatorUri',
  'declaredRedirectHosts',
  'observedRedirectHosts',
  'status',
  'transferAttempted',
  'basis',
  'certaintyClass',
  'unprovenReason',
];
const TARGET_WITNESS_STATUS_VALUES: readonly string[] = ['RESOLVED', 'PROVENANCE_UNPROVEN'];
/** #103 §2.2: at most 8 declared redirect hosts (selected host included). */
const TARGET_WITNESS_MAX_DECLARED_HOSTS = 8;
const TARGET_WITNESS_MAX_OBSERVED_HOSTS = 16;
const MAX_LOCATOR_URI_LENGTH = 2048;

function boundedHostList(value: unknown, path: string, max: number): SeamResult<readonly string[]> {
  if (!Array.isArray(value) || value.length > max) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        path,
        `must be an array of at most ${String(max)} host strings`,
      ),
    ]);
  }
  for (const host of value) {
    if (typeof host !== 'string' || host.length === 0 || host.length > 255) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          path,
          'entries must be non-empty host strings of at most 255 characters',
        ),
      ]);
    }
    if (/\s/u.test(host)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          path,
          'entries must be plain hosts without whitespace',
        ),
      ]);
    }
  }
  return seamOk(value as readonly string[]);
}

/**
 * Validate one secret-free S1 target-resolution witness (#113): closed field
 * set, exact identity binding, http(s) selected locator, bounded delivery
 * graphs, status-conditional basis/unproven pairing (a RESOLVED witness
 * carries its validated basis + certainty; a PROVENANCE_UNPROVEN witness
 * carries the canonical failure reason and never an identity claim).
 */
function decodeTargetWitnessReceipt(value: unknown): SeamResult<TargetWitnessReceipt> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'targetWitness', 'target witness must be an object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !TARGET_WITNESS_FIELDS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `targetWitness.${key}`, 'unknown witness field'),
      ),
    );
  }
  for (const key of ['snapshotId', 'memberId', 'artifactId', 'effectId'] as const) {
    const id = record[key];
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `targetWitness.${key}`,
          'witness identity must be a non-empty bounded string',
        ),
      ]);
    }
  }
  const locatorUri = record['locatorUri'];
  if (
    typeof locatorUri !== 'string' ||
    locatorUri.length === 0 ||
    locatorUri.length > MAX_LOCATOR_URI_LENGTH ||
    !/^https?:\/\//u.test(locatorUri)
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.locatorUri',
        'the selected locator must be a bounded http(s) URI',
      ),
    ]);
  }
  const declared = boundedHostList(
    record['declaredRedirectHosts'],
    'targetWitness.declaredRedirectHosts',
    TARGET_WITNESS_MAX_DECLARED_HOSTS,
  );
  if (!declared.ok) {
    return declared;
  }
  let selectedHost: string;
  let selectedHostname: string;
  try {
    const locator = new URL(locatorUri);
    selectedHost = locator.host.toLowerCase();
    selectedHostname = locator.hostname.toLowerCase();
  } catch {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.locatorUri',
        'invalid selected HTTP locator',
      ),
    ]);
  }
  // Declarations may name the host with or without the explicit port; the
  // target witness must never assert an origin absent from its authorized
  // delivery graph. A nonempty but unrelated graph is insufficient.
  if (
    !declared.value.some((host) => {
      const normalized = host.toLowerCase();
      return normalized === selectedHost || normalized === selectedHostname;
    })
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.declaredRedirectHosts',
        'the declared delivery graph must include the selected locator host',
      ),
    ]);
  }
  const observed = boundedHostList(
    record['observedRedirectHosts'],
    'targetWitness.observedRedirectHosts',
    TARGET_WITNESS_MAX_OBSERVED_HOSTS,
  );
  if (!observed.ok) {
    return observed;
  }
  const status = record['status'];
  if (typeof status !== 'string' || !TARGET_WITNESS_STATUS_VALUES.includes(status)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.status',
        'witness status is a closed vocabulary value',
      ),
    ]);
  }
  const transferAttempted = record['transferAttempted'];
  if (typeof transferAttempted !== 'boolean') {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.transferAttempted',
        'transferAttempted must be a boolean',
      ),
    ]);
  }
  const basis = record['basis'];
  const certainty = record['certaintyClass'];
  const unprovenReason = record['unprovenReason'];
  if (status === 'RESOLVED') {
    if (typeof basis !== 'string' || !TARGET_EVIDENCE_BASIS_VALUES.includes(basis)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'targetWitness.basis',
          'a RESOLVED witness carries its closed C34 identity basis',
        ),
      ]);
    }
    if (typeof certainty !== 'string' || !TARGET_EVIDENCE_CERTAINTY_VALUES.includes(certainty)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'targetWitness.certaintyClass',
          'a RESOLVED witness carries its closed certainty value',
        ),
      ]);
    }
    if (
      (basis === 'PUBLISHED_SHA256' && certainty !== 'DECISIVE') ||
      (basis === 'REQUESTED_LOCATOR_PROVENANCE' && certainty !== 'PROBATIVE')
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'targetWitness.certaintyClass',
          'C34 pairing violated: a publisher-digest anchor is DECISIVE, requested-locator provenance is PROBATIVE',
          'C34',
        ),
      ]);
    }
    if (unprovenReason !== undefined) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'targetWitness.unprovenReason',
          'a RESOLVED witness carries no unproven reason',
        ),
      ]);
    }
    return seamOk({
      snapshotId: record['snapshotId'] as string,
      memberId: record['memberId'] as string,
      artifactId: record['artifactId'] as string,
      effectId: record['effectId'] as string,
      locatorUri,
      declaredRedirectHosts: declared.value,
      observedRedirectHosts: observed.value,
      status: 'RESOLVED',
      transferAttempted,
      basis: basis as TargetWitnessReceipt['basis'],
      certaintyClass: certainty as TargetWitnessReceipt['certaintyClass'],
    });
  }
  if (basis !== undefined || certainty !== undefined) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.basis',
        'an unproven witness carries no target identity claim',
      ),
    ]);
  }
  if (typeof unprovenReason !== 'string' || unprovenReason.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'targetWitness.unprovenReason',
        'an unproven witness carries the canonical delivery-graph failure reason',
      ),
    ]);
  }
  return seamOk({
    snapshotId: record['snapshotId'] as string,
    memberId: record['memberId'] as string,
    artifactId: record['artifactId'] as string,
    effectId: record['effectId'] as string,
    locatorUri,
    declaredRedirectHosts: declared.value,
    observedRedirectHosts: observed.value,
    status: 'PROVENANCE_UNPROVEN',
    transferAttempted,
    unprovenReason,
  });
}

/**
 * Validate and apply one trusted Core-runtime target witness (#113).
 * Identical witnesses converge (restart replay never rewrites authority); a
 * conflicting witness for the same lineage rejects — the recorded resolution
 * fact is immutable. The witness must be bound to the aggregate's actual
 * single-resource contract: canonical composite effect identity, frozen
 * snapshot, and the contract's own requested target. Internal authority
 * fact: no surface revision is consumed (mirrors recordTargetEvidence).
 */
function applyTargetWitnessReceipt(
  state: SeamAuthorityState,
  aggregateId: string,
  raw: unknown,
): SeamResult<{ readonly converged: boolean; readonly receipt: TargetWitnessReceipt }> {
  const aggregate = state.aggregates.get(aggregateId);
  const lineage = state.lineages.get(aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic(
        'AGGREGATE_NOT_FOUND',
        'aggregateId',
        'no aggregate exists for this target witness',
      ),
    ]);
  }
  const decoded = decodeTargetWitnessReceipt(raw);
  if (!decoded.ok) {
    return decoded;
  }
  const receipt = decoded.value;
  const contract = aggregate.contract;
  if (
    contract.intentType !== 'SINGLE_RESOURCE' ||
    contract.requestedScope.kind !== 'single_resource'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'a target witness is bound to a SINGLE_RESOURCE contract only',
        'PRD-§28 S1',
      ),
    ]);
  }
  // A target witness belongs to the ONE accepted direct-execution intent (S1
  // wire command, the #150 S3 selected-media intent over the durably
  // confirmed candidate, or the #153 S4 selected-HLS intent over the durably
  // confirmed selection), not merely to any plausible effect string for this
  // aggregate. This also rejects well-shaped but substituted
  // member/artifact/locator facts during journal replay, before a terminal
  // can be reconstructed (#113).
  const s1Commands = [...state.accepted.values()].filter(
    ({ envelope }) =>
      envelope.aggregateId === aggregateId &&
      envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION',
  );
  const s3Intent = s1Commands.length === 0 ? state.s3ExecutionIntents.get(aggregateId) : undefined;
  const s4Intent =
    s1Commands.length === 0 && s3Intent === undefined
      ? state.s4ExecutionIntents.get(aggregateId)
      : undefined;
  if (s1Commands.length !== 1 && s3Intent === undefined && s4Intent === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'a target witness requires exactly one durably accepted direct execution command',
        '#103-§2.2/#113',
      ),
    ]);
  }
  // The accepted payload was validated through the closed vocabulary before
  // commit. Compare all identity and delivery-authority fields, including
  // the exact selected URL and host list, on both write and replay. The S3
  // lane compares against the durably CONFIRMED candidate and the S4 lane
  // against the durably CONFIRMED selection — both with their canonical
  // derived artifact identity, and neither can declare a publisher digest.
  let witnessIntent: {
    readonly snapshotId: string;
    readonly memberId: string;
    readonly artifactId: string;
    readonly locatorUri: string;
    readonly declaredRedirectHosts: readonly string[];
    readonly declaredPublishedDigest: boolean;
  };
  if (s1Commands.length === 1) {
    const intent = s1Commands[0]!.envelope.payload as {
      readonly snapshotId: string;
      readonly memberId: string;
      readonly artifactId: string;
      readonly delivery: {
        readonly locatorUri: string;
        readonly declaredRedirectHosts: readonly string[];
        readonly expectedSha256?: string;
      };
    };
    witnessIntent = {
      snapshotId: intent.snapshotId,
      memberId: intent.memberId,
      artifactId: intent.artifactId,
      locatorUri: intent.delivery.locatorUri,
      declaredRedirectHosts: intent.delivery.declaredRedirectHosts,
      declaredPublishedDigest: intent.delivery.expectedSha256 !== undefined,
    };
  } else if (s3Intent !== undefined) {
    const candidate = s3Intent.candidate;
    witnessIntent = {
      snapshotId: candidate.snapshotId,
      memberId: candidate.memberId,
      artifactId: `s3artifact:${aggregateId}:${candidate.snapshotId}:${candidate.memberId}`,
      locatorUri: candidate.locatorUri,
      declaredRedirectHosts: candidate.declaredRedirectHosts,
      declaredPublishedDigest: false,
    };
  } else {
    const selection = s4Intent!.selection;
    const deliveryHosts = [
      ...new Set(
        [selection.manifestUri, selection.renditionUri]
          .map((uri) => {
            try {
              return new URL(uri).host;
            } catch {
              return undefined;
            }
          })
          .filter((host): host is string => host !== undefined),
      ),
    ];
    witnessIntent = {
      snapshotId: selection.snapshotId,
      memberId: selection.memberId,
      artifactId: `s4artifact:${aggregateId}:${selection.snapshotId}:${selection.memberId}`,
      locatorUri: selection.renditionUri,
      declaredRedirectHosts: deliveryHosts,
      declaredPublishedDigest: false,
    };
  }
  if (
    receipt.snapshotId !== witnessIntent.snapshotId ||
    receipt.memberId !== witnessIntent.memberId ||
    receipt.artifactId !== witnessIntent.artifactId ||
    receipt.locatorUri !== witnessIntent.locatorUri ||
    stableStringify(receipt.declaredRedirectHosts) !==
      stableStringify(witnessIntent.declaredRedirectHosts)
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'witness member/artifact/snapshot/locator/hosts disagree with the accepted direct execution intent',
        '#103-§2.2/#113',
      ),
    ]);
  }
  // A DECISIVE publisher SHA claim is impossible unless the exact accepted
  // command declared an independent publisher digest (never on the S3 lane).
  // PROBATIVE remains legal even when a digest was declared but mismatched
  // (failed/unaccepted bytes).
  if (receipt.basis === 'PUBLISHED_SHA256' && !witnessIntent.declaredPublishedDigest) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness.basis',
        'publisher-digest witness not declared in the accepted direct execution intent',
        'C34/#103-§2.2',
      ),
    ]);
  }
  if (receipt.transferAttempted !== true) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness.transferAttempted',
        'no target-resolution witness may assert an unattempted transfer',
        '#103-§2.2/#113',
      ),
    ]);
  }
  // Exact owned-witness binding: canonical effect identity of the accepted
  // contract and its actual selected snapshot, not a caller-chosen snapshot.
  const canonicalEffectId = `effect:${aggregateId}:${receipt.snapshotId}:${contract.requestedTarget}`;
  if (receipt.effectId !== canonicalEffectId) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness.effectId',
        'the witness effect identity does not match the canonical effect of this contract/aggregate',
        'L2-§6.8',
      ),
    ]);
  }
  if (lineage.targetWitness !== undefined) {
    if (stableStringify(lineage.targetWitness) === stableStringify(receipt)) {
      return seamOk({ converged: true, receipt });
    }
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'a different target witness is already recorded for this lineage; the recorded resolution fact is never rewritten',
        '#103-§2.2/#113',
      ),
    ]);
  }
  lineage.targetWitness = receipt;
  return seamOk({ converged: false, receipt });
}

/**
 * `EXECUTE_S2_ACQUISITION` (#95): execute one browser-delivered single-
 * resource acquisition through the Core-owned durable lifecycle and derive
 * its terminal truth. The contract is read from seam authority state — the
 * payload can never rewrite scope/target. The terminal passes the SAME
 * projector gate as `PROJECT_TERMINAL_RESULT`; a truthful execution failure
 * returns a FAILED terminal (the command is accepted, the download failed).
 */
function applyExecuteS2Acquisition(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
  executor: S2DeliveredAcquisitionExecutor | undefined,
): SeamResult<AppliedCommand> {
  if (executor === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S2 delivered-acquisition executor; EXECUTE_S2_ACQUISITION fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  // The delivered-bytes lane exists for the browser surface only: the bytes'
  // provenance is a page-authorized browser fetch, and only the browser lane
  // carries that provenance through the native broker.
  if (envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'EXECUTE_S2_ACQUISITION is admissible only from the BROWSER_EXTENSION surface',
        'L2-§6.4',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return seamFail([
      seamDiagnostic(
        'LATE_COMMAND',
        'lineage.status',
        'lineage is already terminal; terminal truth is never rewritten',
        'L2-§11',
      ),
    ]);
  }
  // Wire-boundary shape gate: closed top-level fields before the executor's
  // own strict decode (defense in depth; the executor re-validates).
  if (
    typeof envelope.payload !== 'object' ||
    envelope.payload === null ||
    Array.isArray(envelope.payload)
  ) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'S2 acquisition payload must be an object'),
    ]);
  }
  const record = envelope.payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !S2_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `payload.${key}`,
          'unknown field on S2 acquisition command',
        ),
      ),
    );
  }
  const executed = executor.execute({
    aggregateId: envelope.aggregateId,
    contract: aggregate.contract,
    payload: envelope.payload,
  });
  if (!executed.ok) {
    return executed;
  }
  if (executed.value.kind === 'STAGED') {
    // Chunked delivered stream in progress (F04): the slab was staged, no
    // terminal truth exists yet — bump the revision (the chunk command is a
    // durably journaled authority input) and keep the lineage open.
    const revision = aggregate.revision + 1;
    aggregate.revision = revision;
    return seamOk({ revision });
  }
  if (executed.value.failedMemberIds.length > 0) {
    const decodedFailed: MemberId[] = [];
    for (const raw of executed.value.failedMemberIds) {
      const memberId = makeMemberId(raw);
      if (!memberId.ok) {
        return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
      }
      decodedFailed.push(memberId.value);
    }
    const recorded = recordFailedMembersByIds(state, envelope.aggregateId, decodedFailed);
    if (!recorded.ok) {
      return recorded;
    }
  }
  const selectedMemberCount =
    lineage.snapshot !== undefined
      ? lineage.snapshot.selectedMemberIds.length
      : aggregate.contract.intentType === 'SINGLE_RESOURCE'
        ? 1
        : 0;
  const context: TerminalResultContext = {
    intentType: aggregate.contract.intentType,
    scopeKind: aggregate.contract.requestedScope.kind,
    selectedMemberCount,
    ...executed.value.context,
  };
  const decoded = gateway.projectTerminalResult(executed.value.terminal, context);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  lineage.terminal = decoded.value;
  lineage.status = 'TERMINAL';
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/** Closed top-level payload fields of EXECUTE_S1_DIRECT_ACQUISITION (the runtime owns the deep decode). */
const S1_PAYLOAD_KEYS: readonly string[] = ['snapshotId', 'memberId', 'artifactId', 'delivery'];

/**
 * `EXECUTE_S1_DIRECT_ACQUISITION` (#101 first slice): register one Core-
 * executed direct single-resource acquisition for an ALREADY-ACCEPTED
 * contract. The synchronous authority apply records exactly one durable
 * execution intent (the command journals before any external effect); the
 * runtime begins the real HTTP transfer strictly AFTER the accepted-command
 * journal commit and completes the lineage through `recordExecutedTerminal`
 * with a Core-derived projector terminal — never a surface-asserted one, and
 * never conflating submission ACK with acquisition success. Delivery facts
 * carry an optional independently published digest: supplied, it is enforced
 * as the target identity anchor; omitted, the Target claim uses the
 * conservative REQUESTED_LOCATOR_PROVENANCE basis (#101 R1/F01, C34).
 */
function applyExecuteS1DirectAcquisition(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  beginner: S1DirectAcquisitionBeginner | undefined,
  s1Intents: Map<string, S1ExecutionIntent>,
): SeamResult<AppliedCommand> {
  if (beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S1 direct-acquisition driver; EXECUTE_S1_DIRECT_ACQUISITION fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  // The Core-executed direct lane serves the CLI surface (curl-like S1).
  if (envelope.peer.surface !== 'CLI') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'EXECUTE_S1_DIRECT_ACQUISITION is admissible only from the CLI surface',
        'L2-§6.4',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S1 direct-acquisition command');
  }
  // Contract gates from seam authority state — the payload can never widen
  // the accepted contract (the S1 lane serves single-resource direct
  // contracts only).
  if (
    aggregate.contract.intentType !== 'SINGLE_RESOURCE' ||
    aggregate.contract.requestedScope.kind !== 'single_resource'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S1 direct-acquisition executor serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S1',
      ),
    ]);
  }
  if (s1Intents.has(envelope.aggregateId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'aggregateId',
        'an S1 direct execution is already registered for this lineage; duplicate registration rejects (the registered intent reconciles from durable truth)',
        'L2-§6.8',
      ),
    ]);
  }
  const validated = validateS1IntentPayload(envelope.payload);
  if (!validated.ok) {
    return validated;
  }
  // The canonical composite effect identity must fit the 128-char id bound;
  // an overflowing identity can never execute, so it rejects before any
  // intent exists (no uncompletable intent may wedge the lineage).
  const snapshotRaw = (envelope.payload as Record<string, unknown>)['snapshotId'];
  const effectIdentity = `effect:${envelope.aggregateId}:${String(snapshotRaw)}:${aggregate.contract.requestedTarget}`;
  if (effectIdentity.length > 128) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'the canonical composite effect identity exceeds the 128-char id bound',
      ),
    ]);
  }
  s1Intents.set(envelope.aggregateId, {
    aggregateId: envelope.aggregateId,
    requestId: envelope.requestId,
    payload: envelope.payload,
  });
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

// ------------------------------------------------- #150 S3 selected media

/**
 * Shared live+replay semantic checks binding one S3 candidate tuple to the
 * frozen contract/snapshot authority (L2 S3 §2.2/§2.4): SINGLE_RESOURCE
 * contract, confirmed snapshot identity, the attested member is the frozen
 * selected member, and a Core-registered supported media profile whose
 * container matches the selected locator's extension.
 */
function s3CandidateTupleChecks(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  payload: {
    readonly snapshotId: string;
    readonly memberId: string;
    readonly mediaProfileId: string;
    readonly locatorUri: string;
  },
  profiles: S3MediaProfilePort,
): SeamResult<void> {
  const aggregate = state.aggregates.get(envelope.aggregateId);
  const lineage = state.lineages.get(envelope.aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
    ]);
  }
  if (
    aggregate.contract.intentType !== 'SINGLE_RESOURCE' ||
    aggregate.contract.requestedScope.kind !== 'single_resource'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S3 selected-media lane serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S3',
      ),
    ]);
  }
  const snapshot = lineage.snapshot;
  if (snapshot === undefined || snapshot.snapshotId !== payload.snapshotId) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.snapshotId',
        'S3 candidate must bind the one confirmed selection snapshot of this lineage',
        'L2-S3-§2.2',
      ),
    ]);
  }
  if (!snapshot.selectedMemberIds.includes(payload.memberId as MemberId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.memberId',
        'S3 candidate member is not the frozen selected member of the confirmed snapshot',
        'L2-S3-§2.2',
      ),
    ]);
  }
  if (!profiles.supportedProfile(payload.mediaProfileId)) {
    return seamFail([
      seamDiagnostic(
        'MEDIA_POLICY_REQUIRED',
        'payload.mediaProfileId',
        'mediaProfileId does not name a Core-registered supported media profile',
        'L2-S3-§2.4',
      ),
    ]);
  }
  const container = profiles.profileContainerOf(payload.mediaProfileId);
  const extension = /\.([a-z0-9]+)$/u.exec(new URL(payload.locatorUri).pathname)?.[1];
  if (container === undefined || extension !== container) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.mediaProfileId',
        `supported profile container '${String(container)}' does not match the selected locator extension '${String(extension)}'`,
        'L2-S3-§2.4',
      ),
    ]);
  }
  return seamOk(undefined);
}

/** The frozen secret-free candidate record of one confirmed tuple (L2 §2.4). */
function s3CandidateRecordOf(
  payload: S3ConfirmCandidatePayload,
  profiles: S3MediaProfilePort,
): S3CandidateRecord {
  // Replay pin source: the live wire can never supply these fields (the
  // closed payload grammar rejects them), so a live confirm computes them
  // from the current registry; a journal replay reuses the pin journaled at
  // confirmation time — the durable record is the pin's only home.
  const pinned = payload as unknown as {
    readonly mediaProfilesDigest?: string;
    readonly mediaProfileProbeRevision?: number;
  };
  return Object.freeze({
    snapshotId: payload.snapshotId,
    memberId: payload.memberId,
    variantKey: payload.variantKey,
    locatorUri: payload.locatorUri,
    declaredRedirectHosts: payload.declaredRedirectHosts,
    mediaProfileId: payload.mediaProfileId,
    mediaProfilesDigest: pinned.mediaProfilesDigest ?? profiles.registryDigest(),
    mediaProfileProbeRevision:
      pinned.mediaProfileProbeRevision ??
      profiles.profileProbeRevisionOf(payload.mediaProfileId) ??
      0,
    ...(payload.byteConstraintSha256 === undefined
      ? {}
      : { byteConstraintSha256: payload.byteConstraintSha256 }),
    ...(payload.expectedTotalBytes === undefined
      ? {}
      : { expectedTotalBytes: payload.expectedTotalBytes }),
    ...(payload.expectedContentTypePrefix === undefined
      ? {}
      : { expectedContentTypePrefix: payload.expectedContentTypePrefix }),
  });
}

/**
 * #150 CONFIRM_S3_CANDIDATE (#150): durably bind the displayed selected
 * URI+variant tuple to the already confirmed single selected snapshot
 * member. The live path additionally consumes a Core-issued single-use
 * challenge bound to the OS-verified session, current revision and the
 * canonical tuple digest (L2 S3 §2.1 R2 F01); journal replay re-applies the
 * already-gated durable truth without the live challenge registry. The
 * candidate record is the journaled command payload itself; an identical
 * re-confirmation converges, a different tuple under the same lineage key
 * is an immutable-truth conflict.
 */
function applyConfirmS3Candidate(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  profiles: S3MediaProfilePort | undefined,
  s3Live: S3LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (profiles === undefined) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'commandType',
        'this Core composition provides no S3 selected-media registry; CONFIRM_S3_CANDIDATE fails closed',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const payload = envelope.payload as S3ConfirmCandidatePayload;
  const tupleCheck = s3CandidateTupleChecks(state, envelope, payload, profiles);
  if (!tupleCheck.ok) {
    return tupleCheck;
  }
  const aggregate = state.aggregates.get(envelope.aggregateId)!;
  const lineage = state.lineages.get(envelope.aggregateId)!;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S3 candidate confirmation');
  }
  // Canonical composite effect identity must fit the 128-char bound before
  // any candidate exists (an unexecutable candidate cannot wedge a lineage).
  const effectIdentity = `effect:${envelope.aggregateId}:${payload.snapshotId}:${aggregate.contract.requestedTarget}`;
  if (effectIdentity.length > 128) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'the canonical composite effect identity exceeds the 128-char id bound',
      ),
    ]);
  }
  // Immutable-truth convergence: an identical re-confirmation converges (the
  // first attested tuple stays recorded); a different tuple under the same
  // lineage key is a conflict, never a silent rewrite (L2 S3 §2.5).
  const candidate = s3CandidateRecordOf(payload, profiles);
  if (lineage.s3Candidate !== undefined) {
    if (stableStringify(lineage.s3Candidate) === stableStringify(candidate)) {
      // Identical tuple under a new request id: converges on the recorded
      // candidate without a second authority transition.
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S3 candidate is already durably confirmed for this lineage; changed selection requires a successor contract/snapshot',
        'L2-S3-§2.5',
      ),
    ]);
  }
  // Live-only admission (never journal replay): the Core-issued challenge is
  // single-use, unexpired, bound to THIS OS-verified connection, the current
  // revision and the canonical displayed tuple digest; the attestation's
  // digest and confirmedAt freshness are verified against the same facts.
  if (s3Live !== undefined) {
    if (envelope.peer.surface !== 'CLI') {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S3 candidate confirmation serves the installed CLI surface only',
          'L2-S3-§2.3',
        ),
      ]);
    }
    const attestation = payload.selectionAttestation;
    const tupleDigest = s3SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      memberId: payload.memberId,
      variantKey: payload.variantKey,
      selectedLocator: payload.locatorUri,
      mediaProfileId: payload.mediaProfileId,
    });
    const confirmedAtMs = Date.parse(attestation.confirmedAt);
    const fresh =
      Number.isFinite(confirmedAtMs) && Math.abs(s3Live.now() - confirmedAtMs) <= 10 * 60_000;
    if (
      !fresh ||
      attestation.displayTupleDigest !== tupleDigest ||
      attestation.expectedRevision !== aggregate.revision ||
      !s3Live.challenges.verify({
        challenge: attestation.interactionId,
        connectionId: s3Live.connectionId,
        aggregateId: envelope.aggregateId,
        tupleDigest,
        revision: aggregate.revision,
      })
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.selectionAttestation',
          'the Core-issued selection challenge did not verify against this session, revision and displayed tuple; confirmation fails closed',
          'L2-S3-§2.1',
        ),
      ]);
    }
  }
  lineage.s3Candidate = candidate;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #150 EXECUTE_S3_SELECTED_MEDIA: register one durable S3 execution intent
 * over the already confirmed candidate (journal-before-effect); the runtime
 * begins the real transfer strictly after the journal commit. A second
 * distinct request can never create another effect, budget or HTTP request —
 * recovery operates on the prior durable intent only (L2 S3 §2.5).
 */
function applyExecuteS3SelectedMedia(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  profiles: S3MediaProfilePort | undefined,
  s3Beginner: S3SelectedMediaBeginner | undefined,
  s3Live: S3LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (profiles === undefined || s3Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S3 selected-media driver; EXECUTE_S3_SELECTED_MEDIA fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s3Live !== undefined && envelope.peer.surface !== 'CLI') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S3 selected-media execution serves the installed CLI surface only',
        'L2-S3-§2.3',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S3 selected-media execution');
  }
  const payload = envelope.payload as S3ExecuteMediaPayload;
  const candidate = lineage.s3Candidate;
  if (
    candidate === undefined ||
    candidate.snapshotId !== payload.snapshotId ||
    candidate.memberId !== payload.memberId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload',
        'no durably confirmed S3 candidate matches this snapshot/member; execution requires the confirmed candidate',
        'L2-S3-§2.4',
      ),
    ]);
  }
  if (state.s3ExecutionIntents.has(envelope.aggregateId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'aggregateId',
        'an S3 selected-media execution is already registered for this lineage; the registered intent reconciles from durable truth',
        'L2-S3-§2.5',
      ),
    ]);
  }
  state.s3ExecutionIntents.set(envelope.aggregateId, {
    aggregateId: envelope.aggregateId,
    requestId: envelope.requestId,
    candidate,
  });
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #153 PREVIEW_S4_HLS_VOD (L2 SEAM12 §3 + the adopted transport-delta §5
 * preview bootstrap): journal the provisional Core-owned immutable manifest
 * selection (PENDING preview record) BEFORE any network read. Identical
 * re-preview converges; a conflicting manifest URI under the same lineage
 * rejects — a changed source requires a successor contract, never a silent
 * rewrite. The bounded master read starts strictly after the journal commit
 * through the S4PreviewBeginner port.
 */
function applyPreviewS4HlsVod(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s4PreviewDriver: S4PreviewBeginner | undefined,
  s4Live: S4LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s4PreviewDriver === undefined) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'commandType',
        'this Core composition provides no S4 selected-HLS preview driver; PREVIEW_S4_HLS_VOD fails closed',
      ),
    ]);
  }
  if (s4Live !== undefined && envelope.peer.surface !== 'CLI') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S4 preview serves the installed CLI surface only',
        'L2-S4-§3',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const payload = envelope.payload as S4PreviewPayload;
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S4 preview');
  }
  if (
    aggregate.contract.intentType !== 'SINGLE_RESOURCE' ||
    aggregate.contract.requestedScope.kind !== 'single_resource'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S4 selected-HLS lane serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S4',
      ),
    ]);
  }
  const snapshot = lineage.snapshot;
  if (snapshot === undefined || snapshot.snapshotId !== payload.snapshotId) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.snapshotId',
        'S4 preview must bind the one confirmed selection snapshot of this lineage',
        'L2-S4-§1',
      ),
    ]);
  }
  if (!snapshot.selectedMemberIds.includes(payload.memberId as MemberId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.memberId',
        'S4 preview member is not the frozen selected member of the confirmed snapshot',
        'L2-S4-§1',
      ),
    ]);
  }
  if (payload.mediaProfileId !== S4_PUBLIC_MEDIA_PROFILE_ID) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.mediaProfileId',
        'S4 preview serves the closed basic public HLS VOD profile only',
        'L2-S4-§2',
      ),
    ]);
  }
  // Canonical composite identities must fit their 128-char bounds BEFORE the
  // preview exists (an unexecutable selection can never wedge a lineage).
  const previewId = `s4preview:${envelope.aggregateId}:${payload.snapshotId}:${payload.memberId}`;
  const confirmedSelectionId = `s4select:${envelope.aggregateId}:${payload.snapshotId}:${payload.memberId}`;
  const effectId = `effect:${envelope.aggregateId}:${payload.snapshotId}:${aggregate.contract.requestedTarget}`;
  const artifactId = `s4artifact:${envelope.aggregateId}:${payload.snapshotId}:${payload.memberId}`;
  if (
    previewId.length > 128 ||
    confirmedSelectionId.length > 128 ||
    effectId.length > 128 ||
    artifactId.length > 128
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'the canonical composite S4 identity exceeds the 128-char id bound',
      ),
    ]);
  }
  const existing = lineage.s4Preview;
  if (existing !== undefined) {
    const sameIntent =
      existing.snapshotId === payload.snapshotId &&
      existing.memberId === payload.memberId &&
      existing.manifestUri === payload.manifestUri &&
      existing.mediaProfileId === payload.mediaProfileId;
    if (!sameIntent) {
      return seamFail([
        seamDiagnostic(
          'IDEMPOTENCY_CONFLICT',
          'payload.manifestUri',
          'a different S4 manifest source is already durably bound to this lineage; a changed source requires a successor contract',
          'L2-S4-§3',
        ),
      ]);
    }
    // Identical intent under a new request id: converges on the recorded
    // preview (its observed result, if any, stays the durable truth).
    return seamOk({ revision: aggregate.revision });
  }
  const nowMs = s4Live?.now() ?? Date.now();
  lineage.s4Preview = {
    previewId,
    snapshotId: payload.snapshotId,
    memberId: payload.memberId,
    manifestUri: payload.manifestUri,
    mediaProfileId: payload.mediaProfileId,
    status: 'PENDING',
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + (s4Live?.ttlMs ?? 120_000)).toISOString(),
  };
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * Resolve the exact Core-observed rendition tuple for a BEGIN/COMMIT payload
 * against the lineage's AVAILABLE preview record: the renditionKey must name
 * exactly one observed variant; the returned digest covers every displayed
 * fact (L2 SEAM12 §4). Shared by the live BEGIN handler and the COMMIT apply.
 */
function s4RenditionTupleOf(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  payload: { readonly previewId: string; readonly renditionKey: string },
  now?: () => number,
): SeamResult<{ readonly variant: S4RenditionFact; readonly digest: string }> {
  const lineage = state.lineages.get(envelope.aggregateId);
  if (lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
    ]);
  }
  const preview = lineage.s4Preview;
  if (
    preview === undefined ||
    preview.previewId !== payload.previewId ||
    preview.status !== 'AVAILABLE'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.previewId',
        'no AVAILABLE Core-observed preview matches this identity; an explicit fresh preview is required',
        'L2-S4-§3',
      ),
    ]);
  }
  // #153 review F2 (#171): the preview record's own Core-enforced TTL gates
  // every challenge derived from it (L2 SEAM12 §3), not just the mint TTL.
  if (now !== undefined) {
    const expiresAtMs = Date.parse(preview.expiresAt);
    if (!Number.isFinite(expiresAtMs) || now() >= expiresAtMs) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.previewId',
          'the observed preview has expired; a fresh preview and confirmation are required',
          'L2-S4-§3',
        ),
      ]);
    }
  }
  const matches = (preview.variants ?? []).filter(
    (variant) => variant.key === payload.renditionKey,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.renditionKey',
        'the selected rendition key must correspond to exactly one Core-observed preview variant',
        'L2-S4-§4',
      ),
    ]);
  }
  const variant = matches[0];
  return seamOk({
    variant,
    digest: s4SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: preview.snapshotId,
      memberId: preview.memberId,
      previewId: preview.previewId,
      renditionKey: variant.key,
      renditionUri: variant.uri,
      manifestUri: preview.manifestUri,
      mediaProfileId: preview.mediaProfileId,
      bandwidth: variant.bandwidth,
      ...(variant.width === undefined ? {} : { width: variant.width }),
      ...(variant.height === undefined ? {} : { height: variant.height }),
    }),
  });
}

/**
 * #153 CONFIRM_S4_SELECTION phase COMMIT (L2 SEAM12 §4): consume the
 * Core-issued one-use challenge atomically with the durable confirmed
 * selection record (the consumption itself happens in the live post-commit
 * hook, after the journal durability outcome). Identical re-confirmation
 * converges; a different tuple under the same lineage is an immutable
 * conflict. Journal replay re-applies the record-shaped payload (the raw
 * challenge never reached durable state) without live verification.
 */
function applyConfirmS4Selection(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s4Beginner: S4SelectedHlsBeginner | undefined,
  s4Live: S4LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s4Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'commandType',
        'this Core composition provides no S4 selected-HLS driver; CONFIRM_S4_SELECTION fails closed',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S4 selection confirmation');
  }
  const raw = envelope.payload as Record<string, unknown>;
  const isRecordShape = raw['phase'] === undefined;
  let record: S4ConfirmedSelectionRecord;
  if (isRecordShape) {
    // Journal replay: the durable secret-free record is the already-gated
    // truth; revalidate it against the observed preview, never the clock.
    const replay = raw as unknown as S4ConfirmedSelectionRecord;
    // Replay path: durable truth only — never the clock.
    const tuple = s4RenditionTupleOf(state, envelope, replay);
    if (!tuple.ok) {
      return tuple;
    }
    if (
      tuple.value.digest !== replay.displayedTupleDigest ||
      tuple.value.variant.uri !== replay.renditionUri ||
      replay.confirmedSelectionId !==
        `s4select:${envelope.aggregateId}:${replay.snapshotId}:${replay.memberId}` ||
      replay.manifestUri !== lineage.s4Preview?.manifestUri ||
      replay.mediaProfileId !== lineage.s4Preview?.mediaProfileId ||
      replay.previewId !== lineage.s4Preview?.previewId
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload',
          'the journaled S4 confirmed-selection record does not match the observed preview facts; replay fails closed',
          'L2-S4-§4',
        ),
      ]);
    }
    record = replay;
  } else {
    // Live COMMIT: verify the Core-issued challenge against this OS-verified
    // connection, the current revision and the canonical displayed tuple.
    if (s4Live === undefined) {
      return seamFail([
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S4 selection confirmation requires the live OS-verified admission context',
        ),
      ]);
    }
    if (envelope.peer.surface !== 'CLI') {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S4 selection confirmation serves the installed CLI surface only',
          'L2-S4-§4',
        ),
      ]);
    }
    const payload = envelope.payload as S4ConfirmCommitPayload;
    const tuple = s4RenditionTupleOf(state, envelope, payload, s4Live.now);
    if (!tuple.ok) {
      return tuple;
    }
    if (
      payload.displayedTupleDigest !== tuple.value.digest ||
      !s4Live.challenges.verify({
        challenge: payload.confirmationChallenge,
        connectionId: s4Live.connectionId,
        aggregateId: envelope.aggregateId,
        tupleDigest: tuple.value.digest,
        revision: aggregate.revision,
      })
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmationChallenge',
          'the Core-issued S4 selection challenge did not verify against this session, revision and displayed tuple; confirmation fails closed',
          'L2-S4-§4',
        ),
      ]);
    }
    const nowMs = s4Live.now();
    record = {
      confirmedSelectionId: `s4select:${envelope.aggregateId}:${payload.snapshotId}:${payload.memberId}`,
      previewId: payload.previewId,
      snapshotId: payload.snapshotId,
      memberId: payload.memberId,
      manifestUri: lineage.s4Preview!.manifestUri,
      mediaProfileId: lineage.s4Preview!.mediaProfileId,
      renditionKey: payload.renditionKey,
      renditionUri: tuple.value.variant.uri,
      displayedTupleDigest: tuple.value.digest,
      confirmedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + s4Live.ttlMs).toISOString(),
    };
  }
  // Immutable-truth convergence: an identical re-confirmation converges on
  // the recorded selection; a different one is a conflict, never a rewrite.
  const existing = lineage.s4ConfirmedSelection;
  if (existing !== undefined) {
    if (stableStringify(existing) === stableStringify(record)) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S4 confirmed selection is already durably recorded for this lineage; changed selection requires a successor contract/snapshot',
        'L2-S4-§4',
      ),
    ]);
  }
  lineage.s4ConfirmedSelection = record;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #153 EXECUTE_S4_SELECTED_HLS_VOD (L2 SEAM12 §5): register one durable S4
 * execution intent over the already confirmed selection
 * (journal-before-effect); the runtime begins the real bounded
 * manifest/segment/FFmpeg acquisition strictly after the journal commit. A
 * second distinct request can never create another effect, budget or HTTP
 * request — recovery operates on the prior durable intent only.
 */
function applyExecuteS4SelectedHls(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s4Beginner: S4SelectedHlsBeginner | undefined,
  s4Live: S4LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s4Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S4 selected-HLS driver; EXECUTE_S4_SELECTED_HLS_VOD fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s4Live !== undefined && envelope.peer.surface !== 'CLI') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S4 selected-HLS execution serves the installed CLI surface only',
        'L2-S4-§5',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S4 selected-HLS execution');
  }
  const payload = envelope.payload as S4ExecutePayload;
  const selection = lineage.s4ConfirmedSelection;
  if (
    selection === undefined ||
    selection.confirmedSelectionId !== payload.confirmedSelectionId ||
    selection.snapshotId !== payload.snapshotId ||
    selection.memberId !== payload.memberId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedSelectionId',
        'no durably confirmed S4 selection matches this snapshot/member; execution requires the confirmed selection',
        'L2-S4-§5',
      ),
    ]);
  }
  // Live-only freshness gate (never journal replay: the replayed intent is
  // already durably gated truth; restart reconcile re-drives it).
  if (s4Live !== undefined) {
    const expiresAtMs = Date.parse(selection.expiresAt);
    if (!Number.isFinite(expiresAtMs) || s4Live.now() >= expiresAtMs) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmedSelectionId',
          'the confirmed S4 selection has expired; a fresh preview and confirmation are required',
          'L2-S4-§4',
        ),
      ]);
    }
  }
  if (state.s4ExecutionIntents.has(envelope.aggregateId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'aggregateId',
        'an S4 selected-HLS execution is already registered for this lineage; the registered intent reconciles from durable truth',
        'L2-S4-§5',
      ),
    ]);
  }
  state.s4ExecutionIntents.set(envelope.aggregateId, {
    aggregateId: envelope.aggregateId,
    requestId: envelope.requestId,
    selection,
  });
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #151 validate a user-chosen member subset against the frozen Core record:
 * nonempty, unique, and every id an element of the frozen member set — the
 * browser can never introduce, duplicate or drop-then-replace membership.
 */
function s5SelectionOf(
  prepared: S5PreparedGroupRecord,
  selectedMemberIds: readonly string[],
): SeamResult<{ readonly memberIds: readonly string[]; readonly hrefs: readonly string[] }> {
  if (
    selectedMemberIds.length === 0 ||
    selectedMemberIds.length > prepared.members.length ||
    new Set(selectedMemberIds).size !== selectedMemberIds.length
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.selectedMemberIds',
        'the S5 selection must be a nonempty unique subset of the frozen members',
        'L2-#151-§confirm',
      ),
    ]);
  }
  const frozen = new Map(prepared.members.map((member) => [member.memberId, member.href]));
  const hrefs: string[] = [];
  for (const memberId of selectedMemberIds) {
    const href = frozen.get(memberId);
    if (href === undefined) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.selectedMemberIds',
          'the selection references a member outside the frozen Core page-group; forged or stale membership rejects',
          'L2-#151-§confirm',
        ),
      ]);
    }
    hrefs.push(href);
  }
  return seamOk({ memberIds: [...selectedMemberIds], hrefs: Object.freeze(hrefs) });
}

/** Deterministic Core-minted S5 member identity for one frozen href. */
function s5MemberIdOf(aggregateId: string, href: string): string {
  return `s5m-${createHash('sha256').update(`${aggregateId}\n${href}`).digest('hex').slice(0, 16)}`;
}

/**
 * #151 PREPARE_S5_PAGE_GROUP: freeze the observed current-page member tuple
 * as immutable Core truth (journal-before-effect; no network). Core mints
 * the member identities; the browser can never construct this record. An
 * identical re-prepare converges; a different tuple under the same lineage
 * rejects (a changed observed page requires a successor contract).
 */
function applyPrepareS5PageGroup(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s5Beginner: S5PageGroupBeginner | undefined,
  s5Live: S5LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s5Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S5 collection driver; PREPARE_S5_PAGE_GROUP fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s5Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S5 page-group preparation serves the installed browser-extension surface only',
        'L2-#151-§prepare',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S5 page-group preparation');
  }
  const payload = envelope.payload as S5PreparePayload;
  const members = payload.members.map((member) => ({
    memberId: s5MemberIdOf(envelope.aggregateId, member.href),
    href: member.href,
    text: member.text,
  }));
  const observedTupleDigest = s5GroupTupleDigest({
    pageOrigin: payload.pageOrigin,
    provenanceKey: payload.provenanceKey,
    hrefs: members.map((member) => member.href),
  });
  const record: S5PreparedGroupRecord = {
    prepareId: `s5prepare:${envelope.aggregateId}:${payload.snapshotId}`,
    snapshotId: payload.snapshotId,
    pageOrigin: payload.pageOrigin,
    provenanceKey: payload.provenanceKey,
    members: Object.freeze(members),
    observedTupleDigest,
    status: 'AVAILABLE',
    preparedAt: new Date(s5Live?.now() ?? Date.now()).toISOString(),
  };
  const existing = lineage.s5PreparedGroup;
  if (existing !== undefined) {
    if (
      existing.prepareId === record.prepareId &&
      existing.observedTupleDigest === record.observedTupleDigest &&
      stableStringify(existing.members) === stableStringify(record.members)
    ) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S5 frozen page-group is already durably recorded for this lineage; a changed observed page requires a successor contract',
        'L2-#151-§prepare',
      ),
    ]);
  }
  lineage.s5PreparedGroup = record;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #151 CONFIRM_S5_PAGE_GROUP COMMIT: consume the Core-issued single-use
 * challenge atomically with the journal commit and construct the durable
 * CONFIRMED contract + BATCH selection snapshot over the user-chosen subset
 * of the frozen members. Core alone mints these authority objects; the raw
 * challenge never reaches durable state.
 */
function applyConfirmS5PageGroup(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s5Beginner: S5PageGroupBeginner | undefined,
  s5Live: S5LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s5Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'commandType',
        'this Core composition provides no S5 collection driver; CONFIRM_S5_PAGE_GROUP fails closed',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S5 page-group confirmation');
  }
  const raw = envelope.payload as Record<string, unknown>;
  const isRecordShape = raw['phase'] === undefined;
  let record: S5ConfirmedGroupRecord;
  if (isRecordShape) {
    // Journal replay: the durable secret-free record is the already-gated
    // truth; revalidate it against the frozen prepare, never the clock.
    const replay = raw as unknown as S5ConfirmedGroupRecord;
    const prepared = lineage.s5PreparedGroup;
    if (
      prepared === undefined ||
      replay.prepareId !== prepared.prepareId ||
      replay.snapshotId !== prepared.snapshotId ||
      replay.confirmedGroupId !== `s5group:${envelope.aggregateId}:${replay.snapshotId}` ||
      !replay.selectedMemberIds.every((id) =>
        prepared.members.some((member) => member.memberId === id),
      )
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload',
          'the journaled S5 confirmed-group record does not match the frozen prepare facts; replay fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const digest = s5SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: replay.snapshotId,
      prepareId: replay.prepareId,
      selectedMemberIds: replay.selectedMemberIds,
    });
    if (digest !== replay.displayedTupleDigest) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload',
          'the journaled S5 confirmed-group tuple digest does not re-derive; replay fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    record = replay;
  } else {
    // Live COMMIT: verify the Core-issued challenge against this OS-verified
    // connection, the current revision and the canonical displayed tuple.
    if (s5Live === undefined) {
      return seamFail([
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S5 page-group confirmation requires the live OS-verified admission context',
        ),
      ]);
    }
    if (envelope.peer.surface !== 'BROWSER_EXTENSION') {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S5 page-group confirmation serves the installed browser-extension surface only',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const payload = envelope.payload as S5ConfirmCommitPayload;
    const prepared = lineage.s5PreparedGroup;
    if (
      prepared === undefined ||
      prepared.status !== 'AVAILABLE' ||
      prepared.prepareId !== payload.prepareId ||
      prepared.snapshotId !== payload.snapshotId
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.prepareId',
          'no AVAILABLE frozen S5 page-group record matches this prepare/snapshot; confirmation fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const selection = s5SelectionOf(prepared, payload.selectedMemberIds);
    if (!selection.ok) {
      return selection;
    }
    const digest = s5SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      prepareId: payload.prepareId,
      selectedMemberIds: payload.selectedMemberIds,
    });
    if (
      payload.displayedTupleDigest !== digest ||
      !s5Live.challenges.verify({
        challenge: payload.confirmationChallenge,
        connectionId: s5Live.connectionId,
        aggregateId: envelope.aggregateId,
        tupleDigest: digest,
        revision: aggregate.revision,
      })
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmationChallenge',
          'the Core-issued S5 selection challenge did not verify against this session, revision and displayed tuple; confirmation fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    // Core alone constructs the CONFIRMED contract and the BATCH selection
    // snapshot over the chosen subset (a browser can never mint these).
    const draft = aggregate.contract;
    const nowMs = s5Live.now();
    const confirmedAt = new Date(nowMs).toISOString();
    const confirmedContract = decodeAcquisitionContract({
      ...JSON.parse(stableStringify(draft)),
      status: 'CONFIRMED',
      selectionSnapshotRef: payload.snapshotId,
      confirmedAt,
    });
    if (!confirmedContract.ok) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'contract',
          'the Core-constructed confirmed S5 contract fails canonical decode; confirmation fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    const snapshot = decodeSelectionSnapshot({
      schemaIdentity: draft.schemaIdentity,
      snapshotId: payload.snapshotId,
      contractId: draft.contractId,
      collectionIdentity: draft.collectionIdentity,
      requestedScope: draft.requestedScope,
      continuationScope: draft.continuationScope,
      coverageTarget: coverageTargetFor(draft.requestedScope, 1),
      requestedMemberBasis: { kind: 'CONFIRMED_PAGE_SNAPSHOT' },
      authAccessibleBasis: { kind: 'UNKNOWN' },
      selectedMemberIds: [...payload.selectedMemberIds],
      authorizationContextRef: draft.authorizationContextRef,
      profileContextRef: 'profile/default-001',
      selectionClaims: [
        {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [...payload.selectedMemberIds],
        },
      ],
      sourceMarker: { system: 'xdownload-core-seam', version: 'v0.1.0' },
      createdAt: confirmedAt,
    });
    if (!snapshot.ok) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'snapshot',
          'the Core-constructed S5 selection snapshot fails canonical decode; confirmation fails closed',
          'L2-#151-§confirm',
        ),
      ]);
    }
    record = {
      confirmedGroupId: `s5group:${envelope.aggregateId}:${payload.snapshotId}`,
      prepareId: payload.prepareId,
      snapshotId: payload.snapshotId,
      selectedMemberIds: Object.freeze([...payload.selectedMemberIds]),
      displayedTupleDigest: digest,
      contract: confirmedContract.value,
      snapshot: snapshot.value,
      confirmedAt,
      expiresAt: new Date(nowMs + s5Live.ttlMs).toISOString(),
    };
  }
  // Immutable-truth convergence: an identical re-confirmation converges on
  // the recorded group; a different one is a conflict, never a rewrite.
  const existing = lineage.s5ConfirmedGroup;
  if (existing !== undefined) {
    if (stableStringify(existing) === stableStringify(record)) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S5 confirmed group is already durably recorded for this lineage; changed selection requires a successor contract/snapshot',
        'L2-#151-§confirm',
      ),
    ]);
  }
  lineage.s5ConfirmedGroup = record;
  // Bind the Core-constructed confirmed snapshot on the lineage exactly as
  // the generic CONFIRM_SNAPSHOT command does: the collection coverage
  // accounting gate requires a confirmed snapshot binding for COLLECTION
  // contracts (the projection's requested-identity basis).
  lineage.snapshot = record.snapshot;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #151 EXECUTE_S5_COLLECTION: register one durable S5 execution intent over
 * the already confirmed page group (journal-before-effect); the runtime
 * begins the real bounded per-member acquisition strictly after the journal
 * commit. A second distinct request can never create another effect,
 * budget or HTTP request — recovery operates on the prior durable intent.
 */
function applyExecuteS5Collection(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s5Beginner: S5PageGroupBeginner | undefined,
  s5Live: S5LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s5Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S5 collection driver; EXECUTE_S5_COLLECTION fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s5Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S5 collection execution serves the installed browser-extension surface only',
        'L2-#151-§execute',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S5 collection execution');
  }
  const payload = envelope.payload as S5ExecutePayload;
  const confirmed = lineage.s5ConfirmedGroup;
  if (
    confirmed === undefined ||
    confirmed.confirmedGroupId !== payload.confirmedGroupId ||
    confirmed.snapshotId !== payload.snapshotId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedGroupId',
        'no durably confirmed S5 page group matches this snapshot; execution requires the confirmed group',
        'L2-#151-§execute',
      ),
    ]);
  }
  const prepared = lineage.s5PreparedGroup;
  if (prepared === undefined || prepared.prepareId !== confirmed.prepareId) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedGroupId',
        'the frozen prepare record backing this confirmed group is missing; execution fails closed',
        'L2-#151-§execute',
      ),
    ]);
  }
  // Live-only freshness gate (never journal replay: the replayed intent is
  // already durably gated truth; restart reconcile re-drives it).
  if (s5Live !== undefined) {
    const expiresAtMs = Date.parse(confirmed.expiresAt);
    if (!Number.isFinite(expiresAtMs) || s5Live.now() >= expiresAtMs) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmedGroupId',
          'the confirmed S5 page group has expired; a fresh prepare and confirmation are required',
          'L2-#151-§execute',
        ),
      ]);
    }
  }
  if (state.s5ExecutionIntents.has(envelope.aggregateId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'aggregateId',
        'an S5 collection execution is already registered for this lineage; the registered intent reconciles from durable truth',
        'L2-#151-§execute',
      ),
    ]);
  }
  state.s5ExecutionIntents.set(envelope.aggregateId, {
    aggregateId: envelope.aggregateId,
    requestId: envelope.requestId,
    confirmed,
    prepared,
  });
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #154 validate a user-chosen member subset against the frozen Core page
 * records: nonempty, unique, and every id an element of the frozen members
 * across the recorded declared-range pages — the browser can never
 * introduce, duplicate or drop-then-replace membership.
 */
function s6SelectionOf(
  prepared: S6PreparedCollectionRecord,
  pages: readonly S6PageRecord[],
  selectedMemberIds: readonly string[],
): SeamResult<{ readonly memberIds: readonly string[] }> {
  if (prepared.status !== 'AVAILABLE' || pages.length === 0 || selectedMemberIds.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.selectedMemberIds',
        'the S6 selection requires an AVAILABLE collection admission with at least one recorded page',
        'L2-#154-§confirm',
      ),
    ]);
  }
  const frozen = new Set<string>();
  for (const page of pages) {
    for (const member of page.members) {
      frozen.add(member.memberId);
    }
  }
  if (
    selectedMemberIds.length > frozen.size ||
    new Set(selectedMemberIds).size !== selectedMemberIds.length ||
    selectedMemberIds.some((memberId) => !frozen.has(memberId))
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.selectedMemberIds',
        'the selection references a member outside the frozen Core collection pages; forged or stale membership rejects',
        'L2-#154-§confirm',
      ),
    ]);
  }
  return seamOk({ memberIds: [...selectedMemberIds] });
}

/** Deterministic Core-minted S6 member identity for one frozen page href. */
function s6MemberIdOf(aggregateId: string, pageNumber: number, href: string): string {
  return `s6m-${createHash('sha256')
    .update(`${aggregateId}\n${String(pageNumber)}\n${href}`)
    .digest('hex')
    .slice(0, 16)}`;
}

/**
 * #154 PREPARE_S6_COLLECTION: freeze the explicit collection admission
 * (identity, user-confirmed finite page range, provenance) as immutable Core
 * truth (journal-before-effect; no network). The declared range is the ONLY
 * navigation bound; the aggregate's DRAFT contract must already carry the
 * SAME collection_page_range scope and identity or the prepare rejects. An
 * identical re-prepare converges; a different tuple under the same lineage
 * rejects (a changed collection requires a successor contract).
 */
function applyPrepareS6Collection(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s6Beginner: S6CollectionBeginner | undefined,
  s6Live: S6LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s6Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S6 collection driver; PREPARE_S6_COLLECTION fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s6Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S6 collection preparation serves the installed browser-extension surface only',
        'L2-#154-§prepare',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S6 collection preparation');
  }
  const payload = envelope.payload as S6PreparePayload;
  // The submitted DRAFT contract must be the matching S6 page-range scope —
  // a prepare can never widen or rebind the already-submitted scope.
  const contract = aggregate.contract;
  if (
    contract.intentType !== 'COLLECTION' ||
    contract.requestedScope.kind !== 'collection_page_range' ||
    contract.requestedScope.collectionIdentity !== payload.collectionIdentity ||
    contract.requestedScope.fromPage !== payload.fromPage ||
    contract.requestedScope.toPage !== payload.toPage
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.collectionIdentity',
        'the S6 prepare tuple does not match the submitted collection_page_range contract scope; fails closed',
        'L2-#154-§prepare',
      ),
    ]);
  }
  const observedTupleDigest = s6CollectionTupleDigest({
    collectionOrigin: payload.collectionOrigin,
    provenanceKey: payload.provenanceKey,
    collectionIdentity: payload.collectionIdentity,
    fromPage: payload.fromPage,
    toPage: payload.toPage,
  });
  const record: S6PreparedCollectionRecord = {
    prepareId: `s6prepare:${envelope.aggregateId}:${payload.snapshotId}`,
    snapshotId: payload.snapshotId,
    collectionOrigin: payload.collectionOrigin,
    provenanceKey: payload.provenanceKey,
    collectionIdentity: payload.collectionIdentity,
    fromPage: payload.fromPage,
    toPage: payload.toPage,
    observedTupleDigest,
    status: 'AVAILABLE',
    preparedAt: new Date(s6Live?.now() ?? Date.now()).toISOString(),
  };
  const existing = lineage.s6PreparedCollection;
  if (existing !== undefined) {
    if (
      existing.prepareId === record.prepareId &&
      existing.observedTupleDigest === record.observedTupleDigest
    ) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S6 collection admission is already durably recorded for this lineage; a changed collection/scope requires a successor contract',
        'L2-#154-§prepare',
      ),
    ]);
  }
  lineage.s6PreparedCollection = record;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #154 ADMIT_S6_COLLECTION_PAGE: journal the navigation intent for one page
 * of the declared range BEFORE the privileged browser navigates (L2 §2 —
 * durable intent precedes the generated navigation effect). Only the next
 * page in the declared range is ever admissible: the walk cannot skip,
 * revisit or leave the frozen bounds. An admit for an already-recorded page
 * converges (restart replay idempotency).
 */
function applyAdmitS6CollectionPage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s6Beginner: S6CollectionBeginner | undefined,
  s6Live: S6LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s6Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S6 collection driver; ADMIT_S6_COLLECTION_PAGE fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s6Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S6 page navigation admission serves the installed browser-extension surface only',
        'L2-#154-§navigate',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S6 page navigation admission');
  }
  const payload = envelope.payload as S6AdmitPagePayload;
  const prepared = lineage.s6PreparedCollection;
  if (
    prepared === undefined ||
    prepared.status !== 'AVAILABLE' ||
    prepared.prepareId !== payload.prepareId ||
    prepared.snapshotId !== payload.snapshotId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.prepareId',
        'no AVAILABLE frozen S6 collection record matches this prepare/snapshot; navigation admission fails closed',
        'L2-#154-§navigate',
      ),
    ]);
  }
  const pages = lineage.s6Pages ?? [];
  const nextAdmissible =
    pages.length > 0 ? (pages[pages.length - 1]?.pageNumber ?? 0) + 1 : prepared.fromPage;
  if (payload.pageNumber > prepared.toPage) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.pageNumber',
        `page ${String(payload.pageNumber)} is outside the declared frozen range (${String(prepared.fromPage)}..${String(prepared.toPage)}); the walk never widens`,
        'L2-#154-§navigate',
      ),
    ]);
  }
  if (pages.some((page) => page.pageNumber === payload.pageNumber)) {
    // Already recorded: an idempotent re-admit converges (no new effect).
    return seamOk({ revision: aggregate.revision });
  }
  if (payload.pageNumber !== nextAdmissible) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.pageNumber',
        `page ${String(payload.pageNumber)} is not the next declared-range page (${String(nextAdmissible)}); skipping or revisiting pages rejects`,
        'L2-#154-§navigate',
      ),
    ]);
  }
  lineage.s6AdmittedPages = Object.freeze([...(lineage.s6AdmittedPages ?? []), payload.pageNumber]);
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #154 RECORD_S6_COLLECTION_PAGE: freeze one observed declared-range page
 * and its member tuple as immutable Core truth (journal-before-effect; no
 * network). Core mints the member identities; the browser can never
 * construct this record. The page must be the next one in the declared
 * range, and every page after the first must have had its navigation intent
 * durably admitted first.
 */
function applyRecordS6CollectionPage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s6Beginner: S6CollectionBeginner | undefined,
  s6Live: S6LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s6Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S6 collection driver; RECORD_S6_COLLECTION_PAGE fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s6Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S6 page observation serves the installed browser-extension surface only',
        'L2-#154-§navigate',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S6 page observation');
  }
  const payload = envelope.payload as S6RecordPagePayload;
  const prepared = lineage.s6PreparedCollection;
  if (
    prepared === undefined ||
    prepared.status !== 'AVAILABLE' ||
    prepared.prepareId !== payload.prepareId ||
    prepared.snapshotId !== payload.snapshotId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.prepareId',
        'no AVAILABLE frozen S6 collection record matches this prepare/snapshot; page recording fails closed',
        'L2-#154-§navigate',
      ),
    ]);
  }
  if (payload.pageNumber < prepared.fromPage || payload.pageNumber > prepared.toPage) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.pageNumber',
        `page ${String(payload.pageNumber)} is outside the declared frozen range (${String(prepared.fromPage)}..${String(prepared.toPage)}); the walk never widens`,
        'L2-#154-§navigate',
      ),
    ]);
  }
  const pages = lineage.s6Pages ?? [];
  const nextRecordable =
    pages.length > 0 ? (pages[pages.length - 1]?.pageNumber ?? 0) + 1 : prepared.fromPage;
  if (payload.pageNumber !== nextRecordable) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.pageNumber',
        `page ${String(payload.pageNumber)} is not the next declared-range page (${String(nextRecordable)}); the declared walk is sequential and never skips`,
        'L2-#154-§navigate',
      ),
    ]);
  }
  if (
    payload.pageNumber !== prepared.fromPage &&
    !(lineage.s6AdmittedPages ?? []).includes(payload.pageNumber)
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.pageNumber',
        `page ${String(payload.pageNumber)} has no durably admitted navigation intent; record fails closed`,
        'L2-#154-§navigate',
      ),
    ]);
  }
  const members = payload.members.map((member) => ({
    memberId: s6MemberIdOf(envelope.aggregateId, payload.pageNumber, member.href),
    href: member.href,
    text: member.text,
  }));
  const totalFrozen = pages.reduce((sum, page) => sum + page.members.length, 0) + members.length;
  if (totalFrozen > 80) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.members',
        'the frozen collection member set exceeds the bounded installed-lane budget (80); fails closed',
        'L2-#154-§navigate',
      ),
    ]);
  }
  const observedTupleDigest = s6PageTupleDigest({
    pageNumber: payload.pageNumber,
    hrefs: members.map((member) => member.href),
  });
  const record: S6PageRecord = {
    pageNumber: payload.pageNumber,
    members: Object.freeze(members),
    observedTupleDigest,
    recordedAt: new Date(s6Live?.now() ?? Date.now()).toISOString(),
  };
  const existing = pages.find((page) => page.pageNumber === payload.pageNumber);
  if (existing !== undefined) {
    if (
      existing.observedTupleDigest === record.observedTupleDigest &&
      stableStringify(existing.members) === stableStringify(record.members)
    ) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S6 page observation is already durably recorded for this page; a changed page requires a successor contract',
        'L2-#154-§navigate',
      ),
    ]);
  }
  lineage.s6Pages = Object.freeze([...pages, record]);
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #154 CONFIRM_S6_COLLECTION COMMIT: consume the Core-issued single-use
 * challenge atomically with the journal commit and construct the durable
 * CONFIRMED contract + BATCH selection snapshot over the user-chosen subset
 * of the frozen page members. Core alone mints these authority objects; the
 * raw challenge never reaches durable state.
 */
function applyConfirmS6Collection(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s6Beginner: S6CollectionBeginner | undefined,
  s6Live: S6LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s6Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'commandType',
        'this Core composition provides no S6 collection driver; CONFIRM_S6_COLLECTION fails closed',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S6 collection confirmation');
  }
  const raw = envelope.payload as Record<string, unknown>;
  const isRecordShape = raw['phase'] === undefined;
  let record: S6ConfirmedCollectionRecord;
  if (isRecordShape) {
    // Journal replay: the durable secret-free record is the already-gated
    // truth; revalidate it against the frozen prepare, never the clock.
    const replay = raw as unknown as S6ConfirmedCollectionRecord;
    const prepared = lineage.s6PreparedCollection;
    if (
      prepared === undefined ||
      replay.prepareId !== prepared.prepareId ||
      replay.snapshotId !== prepared.snapshotId ||
      replay.confirmedGroupId !== `s6group:${envelope.aggregateId}:${replay.snapshotId}` ||
      !replay.selectedMemberIds.every((id) =>
        (lineage.s6Pages ?? []).some((page) =>
          page.members.some((member) => member.memberId === id),
        ),
      )
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload',
          'the journaled S6 confirmed-collection record does not match the frozen prepare facts; replay fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const digest = s6SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: replay.snapshotId,
      prepareId: replay.prepareId,
      selectedMemberIds: replay.selectedMemberIds,
    });
    if (digest !== replay.displayedTupleDigest) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload',
          'the journaled S6 confirmed-collection tuple digest does not re-derive; replay fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    record = replay;
  } else {
    // Live COMMIT: verify the Core-issued challenge against this OS-verified
    // connection, the current revision and the canonical displayed tuple.
    if (s6Live === undefined) {
      return seamFail([
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S6 collection confirmation requires the live OS-verified admission context',
        ),
      ]);
    }
    if (envelope.peer.surface !== 'BROWSER_EXTENSION') {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'peer.surface',
          'S6 collection confirmation serves the installed browser-extension surface only',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const payload = envelope.payload as S6ConfirmCommitPayload;
    const prepared = lineage.s6PreparedCollection;
    if (
      prepared === undefined ||
      prepared.status !== 'AVAILABLE' ||
      prepared.prepareId !== payload.prepareId ||
      prepared.snapshotId !== payload.snapshotId
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.prepareId',
          'no AVAILABLE frozen S6 collection record matches this prepare/snapshot; confirmation fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const selection = s6SelectionOf(prepared, lineage.s6Pages ?? [], payload.selectedMemberIds);
    if (!selection.ok) {
      return selection;
    }
    const digest = s6SelectionTupleDigest({
      contractId: envelope.aggregateId,
      snapshotId: payload.snapshotId,
      prepareId: payload.prepareId,
      selectedMemberIds: payload.selectedMemberIds,
    });
    if (
      payload.displayedTupleDigest !== digest ||
      !s6Live.challenges.verify({
        challenge: payload.confirmationChallenge,
        connectionId: s6Live.connectionId,
        aggregateId: envelope.aggregateId,
        tupleDigest: digest,
        revision: aggregate.revision,
      })
    ) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmationChallenge',
          'the Core-issued S6 selection challenge did not verify against this session, revision and displayed tuple; confirmation fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    // Core alone constructs the CONFIRMED contract and the BATCH selection
    // snapshot over the chosen subset (a browser can never mint these).
    const draft = aggregate.contract;
    const nowMs = s6Live.now();
    const confirmedAt = new Date(nowMs).toISOString();
    const confirmedContract = decodeAcquisitionContract({
      ...JSON.parse(stableStringify(draft)),
      status: 'CONFIRMED',
      selectionSnapshotRef: payload.snapshotId,
      confirmedAt,
    });
    if (!confirmedContract.ok) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'contract',
          'the Core-constructed confirmed S6 contract fails canonical decode; confirmation fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    const snapshot = decodeSelectionSnapshot({
      schemaIdentity: draft.schemaIdentity,
      snapshotId: payload.snapshotId,
      contractId: draft.contractId,
      collectionIdentity: draft.collectionIdentity,
      requestedScope: draft.requestedScope,
      continuationScope: draft.continuationScope,
      coverageTarget: {
        ...coverageTargetFor(draft.requestedScope, 1),
        collectionIdentity: draft.collectionIdentity,
      },
      requestedMemberBasis: { kind: 'SUPPORTED_COLLECTION_MEMBERSHIP' },
      authAccessibleBasis: { kind: 'UNKNOWN' },
      selectedMemberIds: [...payload.selectedMemberIds],
      authorizationContextRef: draft.authorizationContextRef,
      profileContextRef: 'profile/default-001',
      selectionClaims: [
        {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [...payload.selectedMemberIds],
        },
      ],
      sourceMarker: { system: 'xdownload-core-seam', version: 'v0.1.0' },
      createdAt: confirmedAt,
    });
    if (!snapshot.ok) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'snapshot',
          'the Core-constructed S6 selection snapshot fails canonical decode; confirmation fails closed',
          'L2-#154-§confirm',
        ),
      ]);
    }
    record = {
      confirmedGroupId: `s6group:${envelope.aggregateId}:${payload.snapshotId}`,
      prepareId: payload.prepareId,
      snapshotId: payload.snapshotId,
      selectedMemberIds: Object.freeze([...payload.selectedMemberIds]),
      displayedTupleDigest: digest,
      contract: confirmedContract.value,
      snapshot: snapshot.value,
      confirmedAt,
      expiresAt: new Date(nowMs + s6Live.ttlMs).toISOString(),
    };
  }
  // Immutable-truth convergence: an identical re-confirmation converges on
  // the recorded group; a different one is a conflict, never a rewrite.
  const existing = lineage.s6ConfirmedCollection;
  if (existing !== undefined) {
    if (stableStringify(existing) === stableStringify(record)) {
      return seamOk({ revision: aggregate.revision });
    }
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        'payload',
        'a different S6 confirmed collection is already durably recorded for this lineage; changed selection requires a successor contract/snapshot',
        'L2-#154-§confirm',
      ),
    ]);
  }
  lineage.s6ConfirmedCollection = record;
  // Bind the Core-constructed confirmed snapshot on the lineage exactly as
  // the generic CONFIRM_SNAPSHOT command does: the collection coverage
  // accounting gate requires a confirmed snapshot binding for COLLECTION
  // contracts (the projection's requested-identity basis).
  lineage.snapshot = record.snapshot;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

/**
 * #154 EXECUTE_S6_COLLECTION: register one durable S6 execution intent over
 * the already confirmed collection (journal-before-effect); the runtime
 * begins the real bounded per-member acquisition strictly after the journal
 * commit. A second distinct request can never create another effect,
 * budget or HTTP request — recovery operates on the prior durable intent.
 */
function applyExecuteS6Collection(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
  s6Beginner: S6CollectionBeginner | undefined,
  s6Live: S6LiveAdmissionContext | undefined,
): SeamResult<AppliedCommand> {
  if (s6Beginner === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'commandType',
        'this Core composition provides no S6 collection driver; EXECUTE_S6_COLLECTION fails closed',
        'L2-§6.1',
      ),
    ]);
  }
  if (s6Live !== undefined && envelope.peer.surface !== 'BROWSER_EXTENSION') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'peer.surface',
        'S6 collection execution serves the installed browser-extension surface only',
        'L2-#154-§execute',
      ),
    ]);
  }
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'S6 collection execution');
  }
  const payload = envelope.payload as S6ExecutePayload;
  const confirmed = lineage.s6ConfirmedCollection;
  if (
    confirmed === undefined ||
    confirmed.confirmedGroupId !== payload.confirmedGroupId ||
    confirmed.snapshotId !== payload.snapshotId
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedGroupId',
        'no durably confirmed S6 collection matches this snapshot; execution requires the confirmed collection',
        'L2-#154-§execute',
      ),
    ]);
  }
  const prepared = lineage.s6PreparedCollection;
  if (prepared === undefined || prepared.prepareId !== confirmed.prepareId) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedGroupId',
        'the frozen collection admission backing this confirmed selection is missing; execution fails closed',
        'L2-#154-§execute',
      ),
    ]);
  }
  const pages = lineage.s6Pages ?? [];
  if (pages.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'payload.confirmedGroupId',
        'the confirmed S6 collection has no frozen observed pages; execution fails closed',
        'L2-#154-§execute',
      ),
    ]);
  }
  // Live-only freshness gate (never journal replay: the replayed intent is
  // already durably gated truth; restart reconcile re-drives it).
  if (s6Live !== undefined) {
    const expiresAtMs = Date.parse(confirmed.expiresAt);
    if (!Number.isFinite(expiresAtMs) || s6Live.now() >= expiresAtMs) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'payload.confirmedGroupId',
          'the confirmed S6 collection has expired; a fresh prepare and confirmation are required',
          'L2-#154-§execute',
        ),
      ]);
    }
  }
  if (state.s6ExecutionIntents.has(envelope.aggregateId)) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'aggregateId',
        'an S6 collection execution is already registered for this lineage; the registered intent reconciles from durable truth',
        'L2-#154-§execute',
      ),
    ]);
  }
  state.s6ExecutionIntents.set(envelope.aggregateId, {
    aggregateId: envelope.aggregateId,
    requestId: envelope.requestId,
    confirmed,
    prepared,
    pages,
  });
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

const S4_RENDITION_KEY_PATTERN = /^rend-[0-9]+$/u;

/**
 * #153 trusted Core-internal S4 preview-result receipt application (live
 * `recordS4PreviewResult` and journal replay share it): only a PENDING
 * preview may observe its result; identical receipts converge; a different
 * receipt over an already-observed preview is an immutable conflict.
 */
function applyS4PreviewReceipt(
  state: SeamAuthorityState,
  aggregateId: string,
  record: S4PreviewRecord,
): SeamResult<{ readonly converged: boolean }> {
  const lineage = state.lineages.get(aggregateId);
  if (lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
    ]);
  }
  const current = lineage.s4Preview;
  if (current === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        's4Preview',
        'an S4 preview result receipt requires a durably admitted preview intent',
        'L2-S4-§3',
      ),
    ]);
  }
  if (stableStringify(current) === stableStringify(record)) {
    return seamOk({ converged: true });
  }
  if (current.status !== 'PENDING') {
    return seamFail([
      seamDiagnostic(
        'IDEMPOTENCY_CONFLICT',
        's4Preview',
        'the observed S4 preview truth is immutable; a second differing receipt rejects',
        'L2-S4-§3',
      ),
    ]);
  }
  // Receipt shape gates: the observation belongs to THIS preview, and the
  // observed facts are renderable, secret-free and bounded.
  if (
    record.previewId !== current.previewId ||
    record.snapshotId !== current.snapshotId ||
    record.memberId !== current.memberId ||
    record.manifestUri !== current.manifestUri ||
    record.mediaProfileId !== current.mediaProfileId ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        's4Preview',
        'the S4 preview receipt does not bind the admitted preview identity',
        'L2-S4-§3',
      ),
    ]);
  }
  if (record.status === 'AVAILABLE') {
    const variants = record.variants ?? [];
    if (variants.length === 0 || variants.length > 32) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          's4Preview.variants',
          'an AVAILABLE S4 preview must carry 1..32 observed variants',
          'L2-S4-§3',
        ),
      ]);
    }
    const keys = new Set<string>();
    const uris = new Set<string>();
    for (const variant of variants) {
      // Scheme/shape gate only (secret-free, canonical, bounded): the actual
      // per-hop transport policy (public HTTPS, or the explicit in-repo
      // loopback fixture lane) is enforced by the runtime's bounded ports.
      let variantUrl: URL | undefined;
      try {
        variantUrl = new URL(variant.uri);
      } catch {
        variantUrl = undefined;
      }
      if (
        typeof variant.key !== 'string' ||
        !S4_RENDITION_KEY_PATTERN.test(variant.key) ||
        typeof variant.uri !== 'string' ||
        variant.uri.length > 2048 ||
        variantUrl === undefined ||
        (variantUrl.protocol !== 'https:' && variantUrl.protocol !== 'http:') ||
        variantUrl.username !== '' ||
        variantUrl.password !== '' ||
        variantUrl.search !== '' ||
        variantUrl.hash !== '' ||
        !Number.isSafeInteger(variant.bandwidth) ||
        variant.bandwidth <= 0 ||
        keys.has(variant.key) ||
        uris.has(variant.uri)
      ) {
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            's4Preview.variants',
            'an observed variant fact is not canonical and renderable; the receipt rejects',
            'L2-S4-§3',
          ),
        ]);
      }
      keys.add(variant.key);
      uris.add(variant.uri);
    }
  } else if (record.status === 'FAILED') {
    if (typeof record.failureReason !== 'string' || record.failureReason.length === 0) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          's4Preview.failureReason',
          'a FAILED S4 preview receipt must carry a typed failure reason',
          'L2-S4-§3',
        ),
      ]);
    }
  } else {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        's4Preview.status',
        'an S4 preview result receipt must observe AVAILABLE or FAILED, never re-pend',
        'L2-S4-§3',
      ),
    ]);
  }
  lineage.s4Preview = record;
  return seamOk({ converged: false });
}

const S1_MAX_IDENTITY_LENGTH = 256;
/** Mirrored from persistence-ledger ARTIFACT_ID_PATTERN (seam has no ledger dependency). */
const S1_ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const S1_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const S1_MAX_REDIRECT_HOSTS = 8;

/**
 * Strict fail-closed validation of the S1 execution payload at the authority
 * boundary. A malformed payload REJECTS before any intent exists, so a bad
 * frame can never wedge a lineage with an uncompletable intent; the runtime
 * driver re-validates downstream (defense in depth).
 */
function validateS1IntentPayload(payload: unknown): SeamResult<void> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'S1 acquisition payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !S1_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `payload.${key}`,
          'unknown field on S1 acquisition command',
        ),
      ),
    );
  }
  if (!makeSnapshotId(typeof record['snapshotId'] === 'string' ? record['snapshotId'] : '').ok) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'not a canonical snapshot identity',
      ),
    ]);
  }
  if (!makeMemberId(typeof record['memberId'] === 'string' ? record['memberId'] : '').ok) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.memberId', 'not a canonical member identity'),
    ]);
  }
  if (
    typeof record['artifactId'] !== 'string' ||
    !S1_ARTIFACT_ID_PATTERN.test(record['artifactId'])
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.artifactId',
        'not a canonical artifact identity',
      ),
    ]);
  }
  const delivery = record['delivery'];
  if (typeof delivery !== 'object' || delivery === null || Array.isArray(delivery)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.delivery', 'delivery must be an object'),
    ]);
  }
  const deliveryRecord = delivery as Record<string, unknown>;
  const deliveryKeys = [
    'locatorUri',
    'declaredRedirectHosts',
    'expectedSha256',
    'expectedContentTypePrefix',
    'expectedTotalBytes',
  ];
  const unknownDelivery = Object.keys(deliveryRecord).filter((key) => !deliveryKeys.includes(key));
  if (unknownDelivery.length > 0) {
    return seamFail(
      unknownDelivery.map((key) =>
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `payload.delivery.${key}`,
          'unknown field on S1 delivery',
        ),
      ),
    );
  }
  const locator = requireS1HttpUrl(deliveryRecord['locatorUri'], 'payload.delivery.locatorUri');
  if (!locator.ok) {
    return locator;
  }
  const hosts = deliveryRecord['declaredRedirectHosts'];
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.length > S1_MAX_REDIRECT_HOSTS) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.declaredRedirectHosts',
        `expected 1..${String(S1_MAX_REDIRECT_HOSTS)} declared hosts`,
      ),
    ]);
  }
  for (const host of hosts) {
    if (typeof host !== 'string' || host.length === 0 || host.length > 255 || /[/\\]/.test(host)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.delivery.declaredRedirectHosts',
          'each entry must be a plain host string',
        ),
      ]);
    }
  }
  // Optional independently published digest (#101 R1/F01): when supplied it
  // is enforced as the target identity anchor (a mismatch fails the
  // download); when absent the Target claim rests on the conservative
  // REQUESTED_LOCATOR_PROVENANCE basis (user-selected URI + declared
  // redirect graph) and the computed artifact digest is recorded for
  // corruption detection — never promoted to an independent oracle (C34).
  const digest = deliveryRecord['expectedSha256'];
  if (digest !== undefined && (typeof digest !== 'string' || !S1_SHA256_PATTERN.test(digest))) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedSha256',
        'expected an omitted field or a lowercase hex SHA-256 digest',
      ),
    ]);
  }
  if (
    deliveryRecord['expectedContentTypePrefix'] !== undefined &&
    (typeof deliveryRecord['expectedContentTypePrefix'] !== 'string' ||
      (deliveryRecord['expectedContentTypePrefix'] as string).length === 0 ||
      (deliveryRecord['expectedContentTypePrefix'] as string).length > S1_MAX_IDENTITY_LENGTH)
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedContentTypePrefix',
        'expected a non-empty string within the declared identity bound',
      ),
    ]);
  }
  const declared = deliveryRecord['expectedTotalBytes'];
  if (
    declared !== undefined &&
    (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0)
  ) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedTotalBytes',
        'expected a non-negative integer',
      ),
    ]);
  }
  return seamOk(undefined);
}

function requireS1HttpUrl(value: unknown, at: string): SeamResult<void> {
  if (typeof value !== 'string' || value.length === 0 || value.length > S1_MAX_IDENTITY_LENGTH) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        at,
        `expected an absolute http(s) URL of at most ${String(S1_MAX_IDENTITY_LENGTH)} chars`,
      ),
    ]);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', at, 'expected an absolute http(s) URL')]);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', at, 'only http(s) locators are admissible'),
    ]);
  }
  return seamOk(undefined);
}

const TERMINAL_PAYLOAD_KEYS: readonly string[] = [
  'result',
  'selectedValidationOutcomes',
  'coverageEvidence',
  'knownAuthInaccessibleRequestedCount',
];

interface TerminalCommand {
  readonly result: unknown;
  readonly context: Omit<TerminalResultContext, 'intentType' | 'scopeKind' | 'selectedMemberCount'>;
}

function decodeTerminalCommand(payload: unknown): SeamResult<TerminalCommand> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'terminal-result payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !TERMINAL_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `payload.${key}`, 'unknown field on terminal command'),
      ),
    );
  }
  if (!('result' in record)) {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'payload.result', 'result is required')]);
  }
  let outcomes: { memberId: MemberId; requiredValidationPassed: boolean }[] | undefined;
  let coverageEvidence: TerminalResultContext['coverageEvidence'];
  let knownAuthInaccessibleRequestedCount: number | undefined;
  const rawOutcomes = record['selectedValidationOutcomes'];
  if (rawOutcomes !== undefined) {
    if (!Array.isArray(rawOutcomes)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.selectedValidationOutcomes',
          'expected an array',
        ),
      ]);
    }
    outcomes = [];
    for (const item of rawOutcomes) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'each outcome must be an object',
          ),
        ]);
      }
      const outcomeRecord = item as Record<string, unknown>;
      const keys = Object.keys(outcomeRecord);
      if (
        keys.length !== 2 ||
        !keys.includes('memberId') ||
        !keys.includes('requiredValidationPassed')
      ) {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'outcome fields are exactly { memberId, requiredValidationPassed }',
          ),
        ]);
      }
      const memberId = makeMemberId(
        typeof outcomeRecord['memberId'] === 'string' ? outcomeRecord['memberId'] : '',
      );
      if (!memberId.ok) {
        return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
      }
      if (typeof outcomeRecord['requiredValidationPassed'] !== 'boolean') {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'requiredValidationPassed must be a boolean',
          ),
        ]);
      }
      outcomes.push({
        memberId: memberId.value,
        requiredValidationPassed: outcomeRecord['requiredValidationPassed'] as boolean,
      });
    }
  }
  const rawCoverage = record['coverageEvidence'];
  if (rawCoverage !== undefined) {
    if (typeof rawCoverage !== 'object' || rawCoverage === null || Array.isArray(rawCoverage)) {
      return seamFail([
        seamDiagnostic('ENVELOPE_MALFORMED', 'payload.coverageEvidence', 'expected an object'),
      ]);
    }
    const coverageRecord = rawCoverage as Record<string, unknown>;
    if (
      (coverageRecord['kind'] !== 'SUFFICIENT' && coverageRecord['kind'] !== 'INSUFFICIENT') ||
      !('basis' in coverageRecord)
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.coverageEvidence',
          "coverage evidence is { kind: 'SUFFICIENT' | 'INSUFFICIENT', basis }",
        ),
      ]);
    }
    coverageEvidence = rawCoverage as TerminalResultContext['coverageEvidence'];
  }
  const rawInaccessible = record['knownAuthInaccessibleRequestedCount'];
  if (rawInaccessible !== undefined) {
    if (
      typeof rawInaccessible !== 'number' ||
      !Number.isInteger(rawInaccessible) ||
      rawInaccessible < 0
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.knownAuthInaccessibleRequestedCount',
          'expected a non-negative integer',
        ),
      ]);
    }
    knownAuthInaccessibleRequestedCount = rawInaccessible;
  }
  return seamOk({
    result: record['result'],
    context: {
      selectedValidationOutcomes: outcomes,
      coverageEvidence,
      knownAuthInaccessibleRequestedCount,
    },
  });
}

/**
 * Restart replay of one accepted journal entry: re-run the deterministic
 * authority application (gate-bypassed), then restore the idempotency
 * record so re-submission converges instead of re-executing (ADR-010).
 */
function restoreAcceptedCommand(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  entry: AcceptedCommandJournalEntry,
  s2Executor: S2DeliveredAcquisitionExecutor | undefined,
  s1Beginner: S1DirectAcquisitionBeginner | undefined,
  s1Intents: Map<string, S1ExecutionIntent>,
  s3Profiles: S3MediaProfilePort | undefined,
  s3Beginner: S3SelectedMediaBeginner | undefined,
  s4PreviewDriver: S4PreviewBeginner | undefined,
  s4Beginner: S4SelectedHlsBeginner | undefined,
  s5Beginner: S5PageGroupBeginner | undefined,
  s6Beginner: S6CollectionBeginner | undefined,
): SeamResult<void> {
  const applied = applyCommand(
    state,
    gateway,
    entry.envelope,
    s2Executor,
    s1Beginner,
    s1Intents,
    s3Profiles,
    s3Beginner,
    s4PreviewDriver,
    s4Beginner,
    s5Beginner,
    s6Beginner,
  );
  if (!applied.ok) {
    return applied;
  }
  state.accepted.set(entry.envelope.requestId, {
    envelope: entry.envelope,
    response: entry.response,
    payloadDigest: entry.payloadDigest,
  });
  return seamOk(undefined);
}
