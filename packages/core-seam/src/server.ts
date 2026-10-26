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
  decodeEvidenceRecord,
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
import { S4_SEAM12_COMMAND_TYPES } from './s4-seam12-payload.ts';
import { S3_SEAM12_COMMAND_TYPES } from './s3-seam12-payload.ts';
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
              : restoreAcceptedCommand(
                  state,
                  gateway,
                  entry,
                  options.s2DeliveredAcquisition,
                  options.s1DirectAcquisition,
                  s1Intents,
                );
      if (!restored.ok) {
        const subject =
          entry.kind === 'COVERAGE_ACCOUNTING'
            ? `aggregate '${entry.aggregateId}'`
            : entry.kind === 'TARGET_EVIDENCE'
              ? `target evidence receipt for aggregate '${entry.aggregateId}'`
              : entry.kind === 'TARGET_WITNESS'
                ? `target witness receipt for aggregate '${entry.aggregateId}'`
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
      // Even a genuinely live Win32 same-logon peer does not yet authorize an
      // effect or challenge. S3/S4 handlers, journal replay binding and private
      // response framing are separate reviewed #148/#150 implementation work.
      // Reject before idempotency lookup, revision, persistence or network.
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S3/S4 verified session admitted but no installed private Core command handler exists',
        ),
      ]);
    }
    return handleCommand(envelope);
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

  function handleCommand(envelope: CommandEnvelope): SeamResponse {
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
    );
    if (!outcome.ok) {
      return rejected(envelope.requestId, outcome.diagnostics, currentRevision);
    }
    const response = acceptedResponse(envelope, outcome.value.revision);
    const record: AcceptedCommand = { envelope, response, payloadDigest: digest };
    if (journal !== undefined) {
      let durability;
      try {
        durability = journal.append({ kind: 'COMMAND', envelope, response, payloadDigest: digest });
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
 */
function applyCommand(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
  s2Executor: S2DeliveredAcquisitionExecutor | undefined,
  s1Beginner: S1DirectAcquisitionBeginner | undefined,
  s1Intents: Map<string, S1ExecutionIntent>,
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
    default:
      // This internal authority application also runs during journal reopen.
      // No S4 command may be silently promoted through old journal replay,
      // even if a crafted journal bypasses the live verified-peer gate.
      return seamFail([
        seamDiagnostic(
          'TRANSPORT_UNAUTHORIZED',
          'commandType',
          'S3/S4 1.2 execution has no installed verified Core handler; fail closed',
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
  // A target witness belongs to the ONE accepted S1 execution intent, not
  // merely to any plausible effect string for this aggregate. This also
  // rejects well-shaped but substituted member/artifact/locator facts during
  // journal replay, before a terminal can be reconstructed (#113).
  const s1Commands = [...state.accepted.values()].filter(
    ({ envelope }) =>
      envelope.aggregateId === aggregateId &&
      envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION',
  );
  if (s1Commands.length !== 1) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'a target witness requires exactly one durably accepted S1 execution command',
        '#103-§2.2/#113',
      ),
    ]);
  }
  // The accepted S1 payload was validated through the closed vocabulary
  // before commit. Compare all identity and delivery-authority fields,
  // including the exact selected URL and host list, on both write and replay.
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
  if (
    receipt.snapshotId !== intent.snapshotId ||
    receipt.memberId !== intent.memberId ||
    receipt.artifactId !== intent.artifactId ||
    receipt.locatorUri !== intent.delivery.locatorUri ||
    stableStringify(receipt.declaredRedirectHosts) !==
      stableStringify(intent.delivery.declaredRedirectHosts)
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness',
        'witness member/artifact/snapshot/locator/hosts disagree with the accepted S1 execution intent',
        '#103-§2.2/#113',
      ),
    ]);
  }
  // A DECISIVE publisher SHA claim is impossible unless the exact accepted
  // command declared an independent publisher digest. PROBATIVE remains legal
  // even when a digest was declared but mismatched (failed/unaccepted bytes).
  if (receipt.basis === 'PUBLISHED_SHA256' && intent.delivery.expectedSha256 === undefined) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'targetWitness.basis',
        'publisher-digest witness not declared in accepted S1 intent',
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
): SeamResult<void> {
  const applied = applyCommand(state, gateway, entry.envelope, s2Executor, s1Beginner, s1Intents);
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
