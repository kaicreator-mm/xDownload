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
   * Trusted Core-runtime CoverageAccounting receipt. This is internal authority
   * state only: surfaces cannot write it through the command vocabulary.
   */
  coverageAccounting?: CoverageAccounting;
  /** Original failed-member identity domain (the only legal retry domain, C12). */
  failedMembers: MemberId[];
  /** Members whose explicit retry has been authorized through the seam. */
  retriedMembers: MemberId[];
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
  /** Monotonic counter implementing the single Core control order for cancels. */
  cancelOrderCounter: number;
}

export function createSeamAuthorityState(): SeamAuthorityState {
  return {
    aggregates: new Map(),
    lineages: new Map(),
    accepted: new Map(),
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

export type SeamJournalEntry = AcceptedCommandJournalEntry | CoverageAccountingJournalEntry;

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
