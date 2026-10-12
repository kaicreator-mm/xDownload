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
  type CoverageAccounting,
  type CoverageAccountingInput,
  type EvidenceRecord,
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
  /** Original failed-member identity domain (the only legal retry domain, C12). */
  failedMembers: MemberId[];
  /** Members whose explicit retry has been authorized through the seam. */
  retriedMembers: MemberId[];
  /**
   * Canonical Core-only requested/auth/resolved accounting. It is admitted
   * only through the trusted internal receipt path and rebuilt on replay.
   */
  coverageAccounting?: CoverageAccounting;
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

/** One durably accepted surface command + its response. Legacy wire shape is preserved. */
export interface AcceptedCommandJournalEntry {
  readonly envelope: CommandEnvelope;
  readonly response: SeamResponse;
  readonly payloadDigest: string;
}

/**
 * Core-only durable coverage-accounting receipt. This is never a seam command:
 * surfaces cannot submit it. Replay revalidates the input/evidence against the
 * already-restored immutable contract + snapshot before publishing counts.
 */
export interface CoverageAccountingJournalEntry {
  readonly internalFactKind: 'COVERAGE_ACCOUNTING_V1';
  readonly aggregateId: string;
  readonly input: CoverageAccountingInput;
  readonly evidenceRecords: readonly EvidenceRecord[];
}

export type SeamJournalEntry = AcceptedCommandJournalEntry | CoverageAccountingJournalEntry;

/**
 * Persistence port for accepted commands. T004 ships only the port and an
 * in-memory concern-test representation; the durable Core-owned ledger is
 * T005. Production implementations must be Core-authoritative writers.
 */
export interface SeamJournal {
  append(entry: SeamJournalEntry): void;
  replayAll(): readonly SeamJournalEntry[];
}

/** In-memory journal for concern tests and deterministic restart simulation. */
export function createInMemorySeamJournal(): SeamJournal {
  const entries: SeamJournalEntry[] = [];
  return {
    append(entry) {
      entries.push(entry);
    },
    replayAll() {
      return [...entries];
    },
  };
}
