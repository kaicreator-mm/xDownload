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
import type { SeamJournal, SeamJournalEntry } from '@xdownload/core-seam';

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
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('envelope' in parsed) ||
        !('response' in parsed) ||
        !('payloadDigest' in parsed)
      ) {
        throw new DurableStoreCorruptError(
          path,
          'seam journal entry is missing required accepted-command fields',
        );
      }
      entries.push(parsed as SeamJournalEntry);
    }
    return new FileBackedSeamJournal(path, entries);
  }

  get path(): string {
    return this.#path;
  }

  append(entry: SeamJournalEntry): void {
    appendDurableLine(this.#path, JSON.stringify(entry));
    this.#entries.push(entry);
  }

  replayAll(): readonly SeamJournalEntry[] {
    return [...this.#entries];
  }
}

/** Canonical durable layout under one runtime root directory. */
export interface DurableLayout {
  readonly rootDir: string;
  readonly factLogPath: string;
  readonly journalPath: string;
  readonly dbPath: string;
  readonly artifactRoot: string;
}

export function durableLayout(rootDir: string): DurableLayout {
  return {
    rootDir,
    factLogPath: join(rootDir, 'control-facts.jsonl'),
    journalPath: join(rootDir, 'seam-journal.jsonl'),
    dbPath: join(rootDir, 'ledger.sqlite'),
    artifactRoot: join(rootDir, 'artifacts'),
  };
}
