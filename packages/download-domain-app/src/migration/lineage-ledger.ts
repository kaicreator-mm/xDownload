/**
 * v0.2 T09 — single-authority lineage ownership ledger (migration lane).
 *
 * Authority: Issue #209 / TASK_PACKS_R0 T09; L2_R0 A03 + U02 (no-migration
 * partition form, #183 N06 evidence: legacy-writer refusal with
 * `WRITER_IDENTITY_CONFLICT` on a K-owned lineage).
 *
 * ## Ownership partition (L2 A03, frozen default policy = NO migration)
 *
 * Every download lineage is owned by exactly ONE business writer at a time:
 *
 * - `old-core` — the v0.1 legacy runtime (packages/core-scheduler +
 *   packages/persistence-ledger). Old lineages are recorded in this ledger
 *   via {@link LineageLedger.registerLegacyLineage} and stay old-core owned
 *   FOREVER. A new-K writer attempting to claim a recorded old lineage is
 *   refused typed (`LINEAGE_PARTITION_VIOLATION`); there is no API that
 *   moves, copies or rewrites an old lineage into the new K runtime.
 * - `new-k` — exactly one v0.2 Kernel writer per NEW lineage, established by
 *   an exclusive CAS claim ({@link LineageLedger.claimLineage}); a second
 *   writer identity on the same lineage is refused typed
 *   (`WRITER_IDENTITY_CONFLICT`, the U02/PoC code).
 *
 * The partition decision for an unregistered lineage is
 * {@link DEFAULT_LINEAGE_OWNER} = `'old-core'`: absent an explicit owned
 * new-K record, the new K must NOT write the lineage. Mass/irreversible
 * migration is forbidden by the Task Pack; this ledger structurally cannot
 * express it (no bulk claim, no ownership transfer, no old-lineage release).
 *
 * ## Durability and crash/restart
 *
 * Every authoritative mutation is persisted through the atomic CAS store
 * (temp+rename, revision-checked — see lineage-store.ts) BEFORE the call
 * returns. Reopening the ledger file after a process kill observes all
 * claims and UNKNOWN records (kill-simulation tests). The physical SQLite
 * CAS sub-leg is NOT_PROVEN in this lane (better-sqlite3 unavailable; see
 * lineage-store.ts header for the real probe evidence) — the ledger logic is
 * store-agnostic so the real SQLite CAS slots in at T13 without semantic
 * change.
 *
 * ## UNKNOWN reconciliation book (never auto-clear, never auto-replay)
 *
 * An external effect whose outcome was UNKNOWN (writer died mid-effect,
 * timeout without terminal evidence) is APPENDED to the durable
 * unknownEffects book via {@link LineageLedger.recordUnknownEffect}. The
 * ledger never clears, resolves or replays a pending record on its own: the
 * only transition is the explicit {@link LineageLedger.resolveUnknownEffect},
 * which requires a NEW authorization grant and only STAMPS the resolution
 * onto the record (records are never deleted — audit stays complete).
 *
 * ## Rollback (documented; acceptance "rollback documented")
 *
 * - NEW v0.2-K lineage: rollback = explicit {@link LineageLedger.releaseLineage}
 *   by the owning writer. The claim record is preserved in `released` state
 *   with its full history (never deleted); the lineage becomes unclaimed and
 *   falls back to the default old-core partition (new K must not write it).
 *   Re-claim is possible ONLY with a NEW authorization grant — re-using the
 *   released claim's grant is refused typed (`STALE_AUTHORIZATION`).
 * - OLD v0.1 lineage: rollback into the new K runtime is NOT possible and is
 *   not supposed to be (A03: "permanently keep old lineages in the old
 *   runtime"). {@link LineageLedger.releaseLineage} on an old lineage is
 *   refused typed (`OLD_LINEAGE_IMMUTABLE`).
 *
 * Authorization here is an opaque, bounded, non-empty grant reference (e.g.
 * an accepted task-issue/JIT-claim identity). This ledger records and
 * enforces its presence/uniqueness; it does not verify grant provenance —
 * that authority lives upstream (frozen task DAG + task issues).
 */
import { randomUUID } from 'node:crypto';
import { LineageStoreError, PlainFileLineageStore } from './lineage-store.ts';
import type { LineageLedgerDoc, LineageStore } from './lineage-store.ts';

/** Which runtime owns a lineage's physical state writes. */
export type LineageOwnerKind = 'old-core' | 'new-k';

/**
 * Frozen default partition: a lineage with no owned new-K record is old-core
 * territory. The new K writes a lineage only while an `owned` new-K record
 * exists (L2 A03 default = no migration).
 */
export const DEFAULT_LINEAGE_OWNER: LineageOwnerKind = 'old-core';

/** Identity of a business writer attempting lineage authority. */
export interface LineageWriterIdentity {
  /** Bounded opaque writer identity (e.g. `legacy-core:v0.1`, `k:v0.2:<run>`). */
  readonly writerId: string;
  /** Which runtime this writer speaks for. */
  readonly kind: LineageOwnerKind;
}

/** Durable ownership record for one lineage (kept forever, never deleted). */
export interface LineageClaimRecord {
  readonly lineageId: string;
  readonly ownerKind: LineageOwnerKind;
  readonly ownerWriterId: string;
  readonly state: 'owned' | 'released';
  /** Unique claim instance id (a re-claim after release mints a new one). */
  readonly claimId: string;
  /** Authorization grant that established (or, for re-claims, re-establishes) this claim. */
  readonly authorization: string;
  readonly claimedAt: string;
  /** Set on explicit release; the record and its history are preserved. */
  readonly releasedAt?: string;
}

/** One pending-or-resolved UNKNOWN effect in the reconciliation book. */
export interface UnknownEffectRecord {
  readonly unknownId: string;
  readonly lineageId: string;
  readonly writerId: string;
  /** The observed effect description (opaque bounded record). */
  readonly effect: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
  /** Null until an explicit authorized resolution stamps it. */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly resolvedAt: string | null;
  readonly resolvedWithAuthorization: string | null;
}

/** Append-only audit event. */
export interface LineageHistoryEvent {
  readonly at: string;
  readonly kind:
    | 'legacy-registered'
    | 'claimed'
    | 're-claimed'
    | 'released'
    | 'unknown-recorded'
    | 'unknown-resolved';
  readonly lineageId: string | null;
  readonly writerId: string | null;
  readonly detail: string;
}

export type LineageLedgerErrorCode =
  /** A second business writer attempted a lineage owned by another writer (U02 PoC code). */
  | 'WRITER_IDENTITY_CONFLICT'
  /** Cross-generation partition violation (new K claiming an old lineage, or an inversion attempt). */
  | 'LINEAGE_PARTITION_VIOLATION'
  /** Old lineages are permanent old-core territory and can never be released. */
  | 'OLD_LINEAGE_IMMUTABLE'
  /** Re-claim after release attempted with the released claim's (stale) authorization. */
  | 'STALE_AUTHORIZATION'
  /** Claim/resolve attempted without a non-empty authorization grant. */
  | 'LINEAGE_AUTHORIZATION_REQUIRED'
  /** Explicit resolution targeting an already-resolved UNKNOWN record. */
  | 'UNKNOWN_ALREADY_RESOLVED'
  /** Explicit resolution targeting an unknown unknownId. */
  | 'UNKNOWN_NOT_FOUND'
  /** Store-level CAS conflict (durable revision moved under the writer). */
  | 'LINEAGE_CAS_CONFLICT'
  /** Durable ledger bytes are corrupt / off-schema: fail closed. */
  | 'MALFORMED_LEDGER_DOC'
  /** Input outside the bounded identifier/record grammar. */
  | 'MALFORMED_LEDGER_INPUT';

/** Typed ledger failure — classify by code, never by message matching. */
export class LineageLedgerError extends Error {
  readonly code: LineageLedgerErrorCode;

  constructor(code: LineageLedgerErrorCode, message: string) {
    super(message);
    this.name = 'LineageLedgerError';
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function boundedId(kind: string, value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new LineageLedgerError('MALFORMED_LEDGER_INPUT', `${kind} must match ${ID_PATTERN.source}`);
  }
  return value;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LineageLedgerError('MALFORMED_LEDGER_INPUT', 'effect/resolution must be a plain object');
  }
  return value as Record<string, unknown>;
}

export interface OpenLineageLedgerOptions {
  /** Durable ledger file path (created on first mutation, parents included). */
  readonly path: string;
  /** Injectable clock (ISO strings); defaults to wall clock. */
  readonly now?: () => string;
  /** Injectable CAS store (defaults to the atomic plain-file store). */
  readonly store?: LineageStore;
}

export interface ClaimLineageInput {
  readonly lineageId: string;
  readonly writer: LineageWriterIdentity;
  /** Non-empty authorization grant establishing this claim (recorded for audit). */
  readonly authorization: string;
}

export interface ReleaseLineageInput {
  readonly lineageId: string;
  readonly writer: LineageWriterIdentity;
}

export interface RecordUnknownEffectInput {
  readonly lineageId: string;
  readonly writerId: string;
  readonly effect: Record<string, unknown>;
}

export interface ResolveUnknownEffectInput {
  readonly unknownId: string;
  /** NEW authorization grant required for the explicit resolution. */
  readonly authorization: string;
  readonly resolution: Record<string, unknown>;
}

/**
 * The single-authority lineage ledger. One instance owns one ledger file;
 * reopen the same path (fresh instance) to simulate a process restart.
 */
export class LineageLedger {
  private doc: LineageLedgerDoc;
  private readonly store: LineageStore;
  private readonly now: () => string;

  private constructor(doc: LineageLedgerDoc, store: LineageStore, now: () => string) {
    this.doc = doc;
    this.store = store;
    this.now = now;
  }

  /** Open (or create-on-first-mutation) the ledger at the given durable path. */
  static open(options: OpenLineageLedgerOptions): LineageLedger {
    const store = options.store ?? new PlainFileLineageStore(options.path);
    const loaded = store.load();
    const fresh: LineageLedgerDoc = {
      schemaVersion: 1,
      revision: 0,
      claims: {},
      unknownEffects: [],
      history: [],
    };
    return new LineageLedger(loaded ?? fresh, store, options.now ?? (() => new Date().toISOString()));
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /** Owner recorded in the ledger, or null when the lineage has no record. */
  recordedOwnerOf(lineageId: string): LineageOwnerKind | null {
    return this.doc.claims[lineageId]?.ownerKind ?? null;
  }

  /**
   * The frozen partition decision: the owner whose authority applies NOW.
   * Unregistered (or released) lineages resolve to {@link DEFAULT_LINEAGE_OWNER}
   * — i.e. "old-core owns / the new K must not write this".
   */
  effectiveOwnerOf(lineageId: string): LineageOwnerKind {
    const record = this.doc.claims[lineageId];
    if (record === undefined || record.state !== 'owned') return DEFAULT_LINEAGE_OWNER;
    return record.ownerKind;
  }

  /** The durable claim record for a lineage (any state), or null. */
  claimFor(lineageId: string): LineageClaimRecord | null {
    return this.doc.claims[lineageId] ?? null;
  }

  /** Pending (unresolved) UNKNOWN records — never auto-cleared, never auto-replayed. */
  listUnknownEffects(options?: { includeResolved?: boolean }): readonly UnknownEffectRecord[] {
    const all = this.doc.unknownEffects;
    if (options?.includeResolved === true) return all;
    return all.filter((record) => record.resolvedAt === null);
  }

  /** Append-only audit history (read-only view). */
  history(): readonly LineageHistoryEvent[] {
    return this.doc.history;
  }

  // ------------------------------------------------------------------
  // Mutations (durable before return)
  // ------------------------------------------------------------------

  /**
   * Record a v0.1 legacy lineage as permanently old-core owned (idempotent).
   * Refused typed if a new-K claim already exists (partition inversion is
   * never allowed, in either direction).
   */
  registerLegacyLineage(lineageId: string): LineageClaimRecord {
    const id = boundedId('lineageId', lineageId);
    const existing = this.doc.claims[id];
    if (existing !== undefined) {
      if (existing.ownerKind === 'new-k') {
        throw new LineageLedgerError(
          'LINEAGE_PARTITION_VIOLATION',
          `lineage '${id}' is owned by the new K runtime; it can never be re-registered as a legacy lineage`,
        );
      }
      return existing; // idempotent re-registration of the same old lineage
    }
    const record: LineageClaimRecord = {
      lineageId: id,
      ownerKind: 'old-core',
      ownerWriterId: 'legacy-core:v0.1',
      state: 'owned',
      claimId: `legacy-claim-${randomUUID()}`,
      authorization: 'partition-default:old-core',
      claimedAt: this.now(),
    };
    this.commit({
      ...this.doc,
      claims: { ...this.doc.claims, [id]: record },
      history: [
        ...this.doc.history,
        { at: this.now(), kind: 'legacy-registered', lineageId: id, writerId: record.ownerWriterId, detail: 'old lineage permanently partitioned to the v0.1 legacy runtime (no migration)' },
      ],
    });
    return record;
  }

  /**
   * Exclusive new-K claim (CAS create semantics). The new K writes a lineage
   * only while this claim is `owned`. Idempotent for the SAME writer;
   * `WRITER_IDENTITY_CONFLICT` for any other writer; refused typed for an
   * old-core lineage (default partition, no migration) and for old-core
   * writers (legacy ownership is established by registerLegacyLineage only).
   */
  claimLineage(input: ClaimLineageInput): LineageClaimRecord {
    const id = boundedId('lineageId', input.lineageId);
    const writer = input.writer;
    if (
      typeof writer !== 'object' ||
      writer === null ||
      (writer.kind !== 'old-core' && writer.kind !== 'new-k')
    ) {
      throw new LineageLedgerError('MALFORMED_LEDGER_INPUT', 'writer.kind must be old-core | new-k');
    }
    boundedId('writer.writerId', writer.writerId);
    const authorization = this.requireAuthorization(input.authorization);
    if (writer.kind === 'old-core') {
      throw new LineageLedgerError(
        'LINEAGE_PARTITION_VIOLATION',
        'old-core ownership is established by registerLegacyLineage; claimLineage is new-K only',
      );
    }
    const existing = this.doc.claims[id];
    if (existing !== undefined && existing.state === 'owned') {
      if (existing.ownerKind === 'old-core') {
        throw new LineageLedgerError(
          'LINEAGE_PARTITION_VIOLATION',
          `lineage '${id}' is a recorded v0.1 legacy lineage owned by the old runtime; the default partition forbids new-K claims (no migration)`,
        );
      }
      if (existing.ownerWriterId !== writer.writerId) {
        throw new LineageLedgerError(
          'WRITER_IDENTITY_CONFLICT',
          `lineage '${id}' is already owned by writer '${existing.ownerWriterId}'; writer '${writer.writerId}' is refused (one writer per lineage)`,
        );
      }
      return existing; // idempotent convergence by the owning writer
    }
    const isReclaim = existing !== undefined && existing.state === 'released';
    if (isReclaim && existing.authorization === authorization) {
      throw new LineageLedgerError(
        'STALE_AUTHORIZATION',
        `re-claim of released lineage '${id}' requires a NEW authorization grant; the released claim's grant is stale`,
      );
    }
    const at = this.now();
    const record: LineageClaimRecord = {
      lineageId: id,
      ownerKind: 'new-k',
      ownerWriterId: writer.writerId,
      state: 'owned',
      claimId: `claim-${randomUUID()}`,
      authorization,
      claimedAt: at,
    };
    this.commit({
      ...this.doc,
      claims: { ...this.doc.claims, [id]: record },
      history: [
        ...this.doc.history,
        {
          at,
          kind: isReclaim ? 're-claimed' : 'claimed',
          lineageId: id,
          writerId: writer.writerId,
          detail: isReclaim ? 'released lineage re-claimed under a new authorization grant' : 'exclusive new-K claim (CAS create)',
        },
      ],
    });
    return record;
  }

  /**
   * Explicit rollback of a NEW v0.2-K lineage: the lineage becomes unclaimed
   * and falls back to the default old-core partition (new K must not write
   * it); the released record and its history are preserved, never deleted.
   * Old lineages refuse with `OLD_LINEAGE_IMMUTABLE` (permanent partition).
   * Returns the durable record after release (idempotent for an already
   * released lineage), or null when the lineage has no record at all.
   */
  releaseLineage(input: ReleaseLineageInput): LineageClaimRecord | null {
    const id = boundedId('lineageId', input.lineageId);
    const writer = input.writer;
    if (typeof writer !== 'object' || writer === null) {
      throw new LineageLedgerError('MALFORMED_LEDGER_INPUT', 'writer must be a LineageWriterIdentity');
    }
    boundedId('writer.writerId', writer.writerId);
    const existing = this.doc.claims[id];
    if (existing === undefined) return null;
    if (existing.state === 'released') return existing;
    if (existing.ownerKind === 'old-core') {
      throw new LineageLedgerError(
        'OLD_LINEAGE_IMMUTABLE',
        `lineage '${id}' is a v0.1 legacy lineage: old lineages can never be released or rolled into the new K runtime (permanent default partition)`,
      );
    }
    if (existing.ownerWriterId !== writer.writerId) {
      throw new LineageLedgerError(
        'WRITER_IDENTITY_CONFLICT',
        `lineage '${id}' is owned by writer '${existing.ownerWriterId}'; writer '${writer.writerId}' cannot release it`,
      );
    }
    const at = this.now();
    const released: LineageClaimRecord = { ...existing, state: 'released', releasedAt: at };
    this.commit({
      ...this.doc,
      claims: { ...this.doc.claims, [id]: released },
      history: [
        ...this.doc.history,
        { at, kind: 'released', lineageId: id, writerId: writer.writerId, detail: 'explicit new-K release; claim history preserved' },
      ],
    });
    return released;
  }

  /**
   * Append an UNKNOWN-outcome effect to the durable reconciliation book.
   * The record is immutable once appended; nothing in this ledger ever
   * clears it automatically or replays its effect.
   */
  recordUnknownEffect(input: RecordUnknownEffectInput): UnknownEffectRecord {
    const lineageId = boundedId('lineageId', input.lineageId);
    const writerId = boundedId('writerId', input.writerId);
    const effect = plainRecord(input.effect);
    const at = this.now();
    const record: UnknownEffectRecord = {
      unknownId: `unknown-${randomUUID()}`,
      lineageId,
      writerId,
      effect,
      recordedAt: at,
      resolution: null,
      resolvedAt: null,
      resolvedWithAuthorization: null,
    };
    this.commit({
      ...this.doc,
      unknownEffects: [...this.doc.unknownEffects, record],
      history: [
        ...this.doc.history,
        { at, kind: 'unknown-recorded', lineageId, writerId, detail: `UNKNOWN effect recorded as ${record.unknownId}; awaiting explicit authorized resolution` },
      ],
    });
    return record;
  }

  /**
   * The ONLY transition out of "pending" for an UNKNOWN record: explicit,
   * human/operator-driven, and requires a NEW authorization grant. The record
   * is stamped (resolution + grant + timestamp) and stays in the book forever
   * (audit); no effect is ever replayed by this ledger.
   */
  resolveUnknownEffect(input: ResolveUnknownEffectInput): UnknownEffectRecord {
    const unknownId = boundedId('unknownId', input.unknownId);
    const authorization = this.requireAuthorization(input.authorization);
    const resolution = plainRecord(input.resolution);
    const index = this.doc.unknownEffects.findIndex((record) => record.unknownId === unknownId);
    if (index < 0) {
      throw new LineageLedgerError('UNKNOWN_NOT_FOUND', `no UNKNOWN effect '${unknownId}' in the reconciliation book`);
    }
    const existing = this.doc.unknownEffects[index];
    if (existing === undefined) {
      throw new LineageLedgerError('UNKNOWN_NOT_FOUND', `no UNKNOWN effect '${unknownId}' in the reconciliation book`);
    }
    if (existing.resolvedAt !== null) {
      throw new LineageLedgerError('UNKNOWN_ALREADY_RESOLVED', `UNKNOWN effect '${unknownId}' was already resolved at ${existing.resolvedAt}`);
    }
    const at = this.now();
    const resolved: UnknownEffectRecord = {
      ...existing,
      resolution,
      resolvedAt: at,
      resolvedWithAuthorization: authorization,
    };
    const unknownEffects = [...this.doc.unknownEffects];
    unknownEffects[index] = resolved;
    this.commit({
      ...this.doc,
      unknownEffects,
      history: [
        ...this.doc.history,
        { at, kind: 'unknown-resolved', lineageId: resolved.lineageId, writerId: resolved.writerId, detail: `UNKNOWN effect ${unknownId} explicitly resolved under a new authorization grant` },
      ],
    });
    return resolved;
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  private requireAuthorization(authorization: unknown): string {
    if (typeof authorization !== 'string' || authorization.length === 0 || !ID_PATTERN.test(authorization)) {
      throw new LineageLedgerError(
        'LINEAGE_AUTHORIZATION_REQUIRED',
        'a bounded non-empty authorization grant is required for this authority transition',
      );
    }
    return authorization;
  }

  /** Apply a mutation and persist it durably BEFORE returning (CAS save). */
  private commit(next: LineageLedgerDoc): void {
    try {
      this.doc = this.store.save(next);
    } catch (error) {
      if (error instanceof LineageStoreError) {
        throw new LineageLedgerError(error.code, error.message);
      }
      throw error;
    }
  }
}
