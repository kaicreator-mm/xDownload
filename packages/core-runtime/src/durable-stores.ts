/**
 * T015 Core runtime — durable ports binding the T004/T006 seams to real
 * storage in the composed runtime.
 *
 * Two file-backed stores implement upstream-owned ports as-is (no semantic
 * reinterpretation; EXECUTION_CONTRACT "Integration precedence rules": glue
 * may choose the durable storage binding, never the semantics):
 *
 * - `FileBackedControlFactLog` implements `@xdownload/core-scheduler`'s
 *   `DurableControlFactLog`: one JSON line per committed control fact,
 *   fsync'd per append (process-death/reopen tuple, L2 §6.2), decode
 *   fail-closed on reopen, and the port's own unforgeable consumption-token
 *   gate so budget facts stay writable only through the scheduler's single
 *   authoritative budget mutation path.
 * - `FileBackedSeamJournal` implements `@xdownload/core-seam`'s
 *   `SeamJournal`: durably accepted commands + their responses, replayed by
 *   `createCoreSeamServer` at reopen (ADR-010 idempotent acceptance).
 *
 * Both stores are composition glue: they hold no authority of their own and
 * no durable lifecycle/budget state outside the ports they implement. The
 * authoritative lifecycle ledger remains `AuthoritativeLedgerWriter` (T005)
 * — exactly one writable instance exists per runtime (single-writer
 * registry, L2 §10).
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  controlOk,
  controlReject,
  decodeFactLog,
  isConsumptionToken,
  type ConsumptionToken,
  type ControlResult,
  type DurableControlFact,
  type DurableControlFactLog,
} from '@xdownload/core-scheduler';
import type { SeamJournal, SeamJournalAppendResult, SeamJournalEntry } from '@xdownload/core-seam';

const BUDGET_FACT_KINDS: ReadonlySet<string> = new Set(['budgetReserved', 'budgetConsumed']);

/** Typed durable-store failure (corrupt/malformed durable truth fails closed). */
export class DurableStoreCorruptError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${message} (${path})`);
    this.name = 'DurableStoreCorruptError';
    this.path = path;
  }
}

function appendDurableLine(path: string, line: string): void {
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function appendDurableSeamLine(path: string, line: string): SeamJournalAppendResult {
  let fd: number;
  try {
    fd = openSync(path, 'a');
  } catch (error) {
    return {
      status: 'NOT_COMMITTED',
      error: `open failed before append: ${String(error)}`,
    };
  }

  let outcome: SeamJournalAppendResult = {
    status: 'UNCERTAIN',
    error: 'append did not reach a durable commit point',
  };
  try {
    const bytes = Buffer.from(`${line}\n`, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
      if (written <= 0) {
        throw new Error('write returned zero bytes');
      }
      offset += written;
    }
    try {
      fsyncSync(fd);
      outcome = { status: 'COMMITTED' };
    } catch (error) {
      outcome = {
        status: 'UNCERTAIN',
        error: `fsync failed after write; durability cannot be proven: ${String(error)}`,
      };
    }
  } catch (error) {
    outcome = {
      status: 'UNCERTAIN',
      error: `write failed after append began; partial durable state is possible: ${String(error)}`,
    };
  } finally {
    try {
      closeSync(fd);
    } catch (error) {
      if (outcome.status !== 'COMMITTED') {
        outcome = {
          status: 'UNCERTAIN',
          error: `${outcome.error}; close also failed: ${String(error)}`,
        };
      }
      // If fsync already completed successfully, close failure cannot revoke
      // that durable commit. Preserve COMMITTED and let higher-level runtime
      // lifecycle surface the handle-close problem separately if needed.
    }
  }
  return outcome;
}

function readDurableLines(path: string): readonly string[] {
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, 'utf8');
  if (raw.length === 0) {
    return [];
  }
  return raw.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * Durable control fact log over a JSONL file. `openExisting` is the reopen
 * path: every previously committed line is decoded through the scheduler's
 * own fail-closed `decodeFactLog`; any corruption refuses to reopen (no
 * partially-recovered authority).
 */
export class FileBackedControlFactLog implements DurableControlFactLog {
  readonly #path: string;
  #facts: DurableControlFact[];

  private constructor(path: string, facts: DurableControlFact[]) {
    this.#path = path;
    this.#facts = facts;
  }

  /** Open a fresh log; an existing non-empty durable log is refused (use openExisting). */
  static createFresh(path: string): FileBackedControlFactLog {
    if (existsSync(path) && readDurableLines(path).length > 0) {
      throw new DurableStoreCorruptError(
        path,
        'control fact log already holds committed facts; reopen instead of re-initializing',
      );
    }
    return new FileBackedControlFactLog(path, []);
  }

  /** Reopen: decode every committed fact fail-closed through the scheduler seam. */
  static openExisting(path: string): FileBackedControlFactLog {
    const lines = readDurableLines(path);
    if (lines.length === 0) {
      return new FileBackedControlFactLog(path, []);
    }
    let parsed: unknown;
    try {
      parsed = lines.map((line) => JSON.parse(line) as unknown);
    } catch (error) {
      throw new DurableStoreCorruptError(
        path,
        `control fact log contains a line that is not valid JSON: ${String(error)}`,
      );
    }
    const decoded = decodeFactLog(parsed);
    if (!decoded.ok) {
      throw new DurableStoreCorruptError(
        path,
        `control fact log failed durable decode: ${decoded.diagnostics
          .map((d) => `${d.code}:${d.path}`)
          .join(', ')}`,
      );
    }
    return new FileBackedControlFactLog(path, [...decoded.value]);
  }

  get path(): string {
    return this.#path;
  }

  append(
    fact: Parameters<DurableControlFactLog['append']>[0],
    authorization?: ConsumptionToken,
  ): ControlResult<DurableControlFact> {
    // Port-contract gate (mirrors the scheduler's in-memory log): budget
    // facts are writable only through the authoritative budget ledger, so a
    // second budget mutation path is unrepresentable in the composed runtime.
    if (BUDGET_FACT_KINDS.has(fact.kind) && !isConsumptionToken(authorization)) {
      return controlReject(
        'BUDGET_AUTHORITY_VIOLATION',
        `budget fact '${fact.kind}' is only writable through the single authoritative budget ledger`,
        'consumption records are unconstructible outside the Core-owned mutation path',
      );
    }
    const last = this.#facts[this.#facts.length - 1];
    const committed = Object.freeze({
      ...fact,
      sequence: (last?.sequence ?? 0) + 1,
    }) as DurableControlFact;
    let line: string;
    try {
      line = JSON.stringify(committed);
    } catch (error) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'control fact is not serializable to the durable log',
        String(error),
      );
    }
    appendDurableLine(this.#path, line);
    this.#facts.push(committed);
    return controlOk(committed);
  }

  readAll(): readonly DurableControlFact[] {
    return this.#facts;
  }
}

/**
 * Durable accepted-command journal for the seam server. Entries are the
 * seam's own `SeamJournalEntry` values; `createCoreSeamServer` replays them
 * at construction and fails closed on semantic replay failure.
 */
export class FileBackedSeamJournal implements SeamJournal {
  readonly #path: string;
  readonly #entries: SeamJournalEntry[];

  private constructor(path: string, entries: SeamJournalEntry[]) {
    this.#path = path;
    this.#entries = entries;
  }

  static createFresh(path: string): FileBackedSeamJournal {
    if (existsSync(path) && readDurableLines(path).length > 0) {
      throw new DurableStoreCorruptError(
        path,
        'seam journal already holds accepted commands; reopen instead of re-initializing',
      );
    }
    return new FileBackedSeamJournal(path, []);
  }

  /** Reopen: structurally decode every journaled entry; corruption fails closed. */
  static openExisting(path: string): FileBackedSeamJournal {
    const entries: SeamJournalEntry[] = [];
    for (const line of readDurableLines(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (error) {
        throw new DurableStoreCorruptError(
          path,
          `seam journal contains a line that is not valid JSON: ${String(error)}`,
        );
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new DurableStoreCorruptError(path, 'seam journal entry must be an object');
      }
      const record = parsed as Record<string, unknown>;
      if (record['kind'] === 'COVERAGE_ACCOUNTING') {
        if (
          typeof record['aggregateId'] !== 'string' ||
          record['aggregateId'].length === 0 ||
          typeof record['accounting'] !== 'object' ||
          record['accounting'] === null ||
          Array.isArray(record['accounting']) ||
          !Array.isArray(record['classificationEvidence'])
        ) {
          throw new DurableStoreCorruptError(
            path,
            'seam coverage receipt is missing identity, accounting object, or classification-evidence array',
          );
        }
      } else if (record['kind'] === 'TARGET_EVIDENCE') {
        // #101 P2-2: the trusted target-evidence receipt entry; semantic
        // validation happens during seam replay, also fail-closed.
        if (
          typeof record['aggregateId'] !== 'string' ||
          record['aggregateId'].length === 0 ||
          typeof record['receipt'] !== 'object' ||
          record['receipt'] === null ||
          Array.isArray(record['receipt'])
        ) {
          throw new DurableStoreCorruptError(
            path,
            'seam target-evidence receipt is missing identity or the receipt object',
          );
        }
      } else if (record['kind'] === 'TARGET_WITNESS') {
        // #113: the trusted target-resolution witness entry; semantic
        // validation happens during seam replay, also fail-closed.
        if (
          typeof record['aggregateId'] !== 'string' ||
          record['aggregateId'].length === 0 ||
          typeof record['receipt'] !== 'object' ||
          record['receipt'] === null ||
          Array.isArray(record['receipt'])
        ) {
          throw new DurableStoreCorruptError(
            path,
            'seam target witness is missing identity or the receipt object',
          );
        }
      } else if (record['kind'] === 'S4_PREVIEW') {
        // #153: the trusted Core-observed S4 preview receipt; semantic
        // validation happens during seam replay, also fail-closed.
        if (
          typeof record['aggregateId'] !== 'string' ||
          record['aggregateId'].length === 0 ||
          typeof record['record'] !== 'object' ||
          record['record'] === null ||
          Array.isArray(record['record'])
        ) {
          throw new DurableStoreCorruptError(
            path,
            'seam S4 preview receipt is missing identity or the record object',
          );
        }
      } else if (
        (record['kind'] !== undefined && record['kind'] !== 'COMMAND') ||
        typeof record['envelope'] !== 'object' ||
        record['envelope'] === null ||
        typeof record['response'] !== 'object' ||
        record['response'] === null ||
        typeof record['payloadDigest'] !== 'string'
      ) {
        throw new DurableStoreCorruptError(
          path,
          'seam journal entry is missing required accepted-command fields',
        );
      }
      // Semantic receipt validation occurs during seam replay, also fail-closed.
      entries.push(parsed as SeamJournalEntry);
    }
    return new FileBackedSeamJournal(path, entries);
  }

  get path(): string {
    return this.#path;
  }

  append(entry: SeamJournalEntry): SeamJournalAppendResult {
    const outcome = appendDurableSeamLine(this.#path, JSON.stringify(entry));
    if (outcome.status === 'COMMITTED') {
      this.#entries.push(entry);
    }
    return outcome;
  }

  replayAll(): readonly SeamJournalEntry[] {
    // Re-read the durable file rather than trusting only the in-process cache.
    // This is required for append-outcome reconciliation: write/fsync/close can
    // throw after bytes became visible/durable but before #entries.push().
    // openExisting applies the same structural fail-closed decoder.
    return [...FileBackedSeamJournal.openExisting(this.#path).#entries];
  }
}

/** Canonical durable layout under one runtime root directory. */
export interface DurableLayout {
  readonly rootDir: string;
  readonly factLogPath: string;
  readonly journalPath: string;
  readonly dbPath: string;
  readonly artifactRoot: string;
  /**
   * T02 single-K route fact log (absent file = no v0.2 lineage was ever
   * routed; legacy-only compositions never create it).
   */
  readonly domainAppRouteLogPath: string;
}

export function durableLayout(rootDir: string): DurableLayout {
  return {
    rootDir,
    factLogPath: join(rootDir, 'control-facts.jsonl'),
    journalPath: join(rootDir, 'seam-journal.jsonl'),
    dbPath: join(rootDir, 'ledger.sqlite'),
    artifactRoot: join(rootDir, 'artifacts'),
    domainAppRouteLogPath: join(rootDir, 'domain-app-route.jsonl'),
  };
}

// ------------------------------------------------------- v0.2 route fact log

/**
 * T02 one-authority lineage-owner facts of the single-K Domain App route.
 * These are the Core route's OWN durable routing decisions — never lifecycle
 * authority over a lineage (an old lineage stays owned by the old canonical
 * stores; a K lineage's authority stays the one Core-owned K):
 *
 * - `CLAIM` — the lineageId is durably claimed for the new v0.2 K lineage
 *   partition. Written (fsync'd) BEFORE the first K send of that lineage
 *   (journal-before-effect) and only after the frozen owner resolution
 *   proved the legacy partition does not own the lineage.
 * - `ATTEMPT` — one K occurrence was admitted on a claimed lineage
 *   (journal-before-effect: written before `app.send` runs).
 * - `OUTCOME` — the verbatim K receipt class of one admitted attempt
 *   (routing provenance for the Core job projection; recorded after the
 *   send settles, never invented).
 *
 * Same durability discipline as the other composition stores: one JSON line
 * per fact, fsync'd per append, fail-closed structural decode on reopen.
 */
export type DomainAppRouteFact =
  | { readonly kind: 'CLAIM'; readonly lineageId: string }
  | {
      readonly kind: 'ATTEMPT';
      readonly lineageId: string;
      readonly requestId: string;
      readonly attemptId: string;
      readonly sequence: number;
    }
  | {
      readonly kind: 'OUTCOME';
      readonly lineageId: string;
      readonly attemptId: string;
      readonly status: 'SUCCEEDED' | 'FAILED';
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly transferredBytes?: number;
    };

function boundedRouteToken(value: unknown, max = 256): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Reject ASCII control characters (including newline/DEL): route facts
    // are opaque bounded tokens, never multi-line payloads.
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return true;
}

function decodeRouteFact(record: Record<string, unknown>): DomainAppRouteFact {
  const kind = record['kind'];
  const lineageId = record['lineageId'];
  if (kind === 'CLAIM') {
    if (!boundedRouteToken(lineageId)) {
      throw new Error('route CLAIM fact is missing a bounded lineageId');
    }
    if (Object.keys(record).some((key) => key !== 'kind' && key !== 'lineageId')) {
      throw new Error('route CLAIM fact carries unknown fields');
    }
    return { kind: 'CLAIM', lineageId };
  }
  if (kind === 'ATTEMPT') {
    for (const field of ['requestId', 'attemptId'] as const) {
      if (!boundedRouteToken(record[field])) {
        throw new Error(`route ATTEMPT fact is missing a bounded ${field}`);
      }
    }
    const sequence = record['sequence'];
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('route ATTEMPT fact sequence must be a positive integer');
    }
    if (
      Object.keys(record).some(
        (key) =>
          key !== 'kind' &&
          key !== 'lineageId' &&
          key !== 'requestId' &&
          key !== 'attemptId' &&
          key !== 'sequence',
      )
    ) {
      throw new Error('route ATTEMPT fact carries unknown fields');
    }
    return {
      kind: 'ATTEMPT',
      lineageId: lineageId as string,
      requestId: record['requestId'] as string,
      attemptId: record['attemptId'] as string,
      sequence,
    };
  }
  if (kind === 'OUTCOME') {
    if (!boundedRouteToken(record['attemptId'])) {
      throw new Error('route OUTCOME fact is missing a bounded attemptId');
    }
    const status = record['status'];
    if (status !== 'SUCCEEDED' && status !== 'FAILED') {
      throw new Error('route OUTCOME fact status must be SUCCEEDED or FAILED');
    }
    const extra = Object.keys(record).filter(
      (key) =>
        key !== 'kind' &&
        key !== 'lineageId' &&
        key !== 'attemptId' &&
        key !== 'status' &&
        key !== 'errorCode' &&
        key !== 'errorMessage' &&
        key !== 'transferredBytes',
    );
    if (extra.length > 0) {
      throw new Error('route OUTCOME fact carries unknown fields');
    }
    if (record['errorCode'] !== undefined && !boundedRouteToken(record['errorCode'], 64)) {
      throw new Error('route OUTCOME fact errorCode must be a bounded string');
    }
    if (record['errorMessage'] !== undefined && !boundedRouteToken(record['errorMessage'], 512)) {
      throw new Error('route OUTCOME fact errorMessage must be a bounded string');
    }
    const transferred = record['transferredBytes'];
    if (
      transferred !== undefined &&
      (typeof transferred !== 'number' || !Number.isSafeInteger(transferred) || transferred < 0)
    ) {
      throw new Error('route OUTCOME fact transferredBytes must be a non-negative integer');
    }
    if (status === 'FAILED' && typeof record['errorCode'] !== 'string') {
      throw new Error('route OUTCOME FAILED fact is missing its errorCode');
    }
    return {
      kind: 'OUTCOME',
      lineageId: lineageId as string,
      attemptId: record['attemptId'] as string,
      status,
      ...(typeof record['errorCode'] === 'string' ? { errorCode: record['errorCode'] } : {}),
      ...(typeof record['errorMessage'] === 'string'
        ? { errorMessage: record['errorMessage'] }
        : {}),
      ...(typeof transferred === 'number' ? { transferredBytes: transferred } : {}),
    };
  }
  throw new Error(`route fact kind must be CLAIM, ATTEMPT or OUTCOME; got ${String(kind)}`);
}

/**
 * Durable owner/attempt/outcome fact log of the v0.2 Domain App route.
 * `createFresh` refuses an existing non-empty log (a fresh runtime never
 * clobbers routed-lineage truth); `openExisting` decodes every line
 * structurally and fails closed on corruption.
 */
export class FileBackedDomainAppRouteLog {
  readonly #path: string;
  readonly #facts: DomainAppRouteFact[];
  /** LineageIds with a durable CLAIM (the new v0.2 K partition). */
  readonly #claimed: Set<string>;

  private constructor(path: string, facts: DomainAppRouteFact[]) {
    this.#path = path;
    this.#facts = facts;
    this.#claimed = new Set(
      facts.flatMap((fact) => (fact.kind === 'CLAIM' ? [fact.lineageId] : [])),
    );
  }

  static createFresh(path: string): FileBackedDomainAppRouteLog {
    if (existsSync(path) && readDurableLines(path).length > 0) {
      throw new DurableStoreCorruptError(
        path,
        'domain-app route log already holds facts; reopen instead of re-initializing',
      );
    }
    return new FileBackedDomainAppRouteLog(path, []);
  }

  static openExisting(path: string): FileBackedDomainAppRouteLog {
    const facts: DomainAppRouteFact[] = [];
    for (const line of readDurableLines(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (error) {
        throw new DurableStoreCorruptError(
          path,
          `domain-app route log contains a line that is not valid JSON: ${String(error)}`,
        );
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new DurableStoreCorruptError(path, 'domain-app route fact must be an object');
      }
      try {
        facts.push(decodeRouteFact(parsed as Record<string, unknown>));
      } catch (error) {
        throw new DurableStoreCorruptError(
          path,
          `domain-app route fact rejected: ${String(error)}`,
        );
      }
    }
    return new FileBackedDomainAppRouteLog(path, facts);
  }

  get path(): string {
    return this.#path;
  }

  /** Durably append one route fact (fsync before returning). */
  append(fact: DomainAppRouteFact): void {
    appendDurableLine(this.#path, JSON.stringify(fact));
    this.#facts.push(fact);
    if (fact.kind === 'CLAIM') {
      this.#claimed.add(fact.lineageId);
    }
  }

  all(): readonly DomainAppRouteFact[] {
    return [...this.#facts];
  }

  /** True when the lineage is durably claimed for the new v0.2 K partition. */
  isClaimed(lineageId: string): boolean {
    return this.#claimed.has(lineageId);
  }

  /** Every lineage claimed for the new v0.2 K partition. */
  claimedLineageIds(): readonly string[] {
    return [...this.#claimed];
  }
}
