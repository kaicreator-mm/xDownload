/**
 * V022-A03 — Host-owned physical T09 lineage store (dormant plain-file CAS).
 *
 * Moved verbatim from the Domain App migration lane behind the Host package:
 * the trusted Host owns every physical adapter while the App keeps the
 * lineage POLICY port dormant (no active Core caller is added here and no
 * UNKNOWN auto-clear exists — the T09 ledger stays exactly as dormant as it
 * was in the App lane).
 *
 * The App `LineageStore` policy port stays structurally compatible WITHOUT
 * an App import: the Host doc/record shapes below mirror the App
 * `LineageLedgerDoc` field-for-field (same key names, same revision/schema
 * invariant, same typed error codes), so an App-typed document is
 * assignable to the Host seam and vice versa; A04 performs the actual
 * assignability proof at the composition call site. No second store, no
 * schema change, no multi-process claim: one JSON file, tmp+rename atomic
 * persistence, revision compared against the durable bytes on every save.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Which runtime owns a lineage's physical state writes (App port mirror). */
export type HostLineageOwnerKind = 'old-core' | 'new-k';

/** Identity of a business writer attempting lineage authority (App mirror). */
export interface HostLineageWriterIdentity {
  readonly writerId: string;
  readonly kind: HostLineageOwnerKind;
}

/** Durable ownership record for one lineage (App `LineageClaimRecord` mirror). */
export interface HostLineageClaimRecord {
  readonly lineageId: string;
  readonly ownerKind: HostLineageOwnerKind;
  readonly ownerWriterId: string;
  readonly state: 'owned' | 'released';
  readonly claimId: string;
  readonly authorization: string;
  readonly claimedAt: string;
  readonly releasedAt?: string;
}

/** One pending-or-resolved UNKNOWN effect in the reconciliation book (App mirror). */
export interface HostUnknownEffectRecord {
  readonly unknownId: string;
  readonly lineageId: string;
  readonly writerId: string;
  readonly effect: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly resolvedAt: string | null;
  readonly resolvedWithAuthorization: string | null;
}

/** Append-only audit event (App `LineageHistoryEvent` mirror). */
export interface HostLineageHistoryEvent {
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

/** Root shape of the durable ledger document (schema 1; fail-closed on drift). */
export interface HostLineageLedgerDoc {
  readonly schemaVersion: 1;
  /** Monotonic CAS revision; 0 means "never persisted". */
  readonly revision: number;
  /** Active ownership records by lineageId (released records are kept, not deleted). */
  readonly claims: Readonly<Record<string, HostLineageClaimRecord>>;
  /** UNKNOWN reconciliation book — records are immutable once appended. */
  readonly unknownEffects: readonly HostUnknownEffectRecord[];
  /** Append-only audit history (registrations, claims, releases, UNKNOWN bookkeeping). */
  readonly history: readonly HostLineageHistoryEvent[];
}

export type HostLineageStoreErrorCode = 'LINEAGE_CAS_CONFLICT' | 'MALFORMED_LEDGER_DOC';

/** Typed store failure — callers classify by code, never by message matching. */
export class LineageStoreError extends Error {
  readonly code: HostLineageStoreErrorCode;

  constructor(code: HostLineageStoreErrorCode, message: string) {
    super(message);
    this.name = 'LineageStoreError';
    this.code = code;
  }
}

/**
 * The physical CAS seam: load the durable document (null = no ledger yet) and
 * save a new revision under a compare-and-swap condition. Structurally
 * identical to the App `LineageStore` policy port: an App-typed document
 * loads and saves through this seam without adaptation.
 */
export interface HostLineageStore {
  load(): HostLineageLedgerDoc | null;
  /** Persist `next`; returns the durably stored document (revision advanced). */
  save(next: HostLineageLedgerDoc): HostLineageLedgerDoc;
}

function parseLedgerDoc(raw: string, path: string): HostLineageLedgerDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LineageStoreError(
      'MALFORMED_LEDGER_DOC',
      `lineage ledger at ${path} is not valid JSON; failing closed`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (parsed as { revision?: unknown }).revision !== 'number' ||
    typeof (parsed as { claims?: unknown }).claims !== 'object' ||
    (parsed as { claims?: unknown }).claims === null ||
    !Array.isArray((parsed as { unknownEffects?: unknown }).unknownEffects) ||
    !Array.isArray((parsed as { history?: unknown }).history)
  ) {
    throw new LineageStoreError(
      'MALFORMED_LEDGER_DOC',
      `lineage ledger at ${path} does not match schema version 1; failing closed`,
    );
  }
  return parsed as HostLineageLedgerDoc;
}

/**
 * Atomic plain-file CAS store: one JSON file, `tmp + rename` persistence,
 * revision compared against the on-disk bytes on every save (create only
 * accepted at revision 0 against a missing file). Reopening the file after a
 * real process boundary observes exactly the durable bytes — this is what
 * the kill-simulation tests rely on. DORMANT: no Core caller is wired to
 * this adapter in A03; it exists as the physical leg of the dormant T09
 * port. Single-process-safe by construction; cross-process concurrent
 * writers are NOT proven by this store.
 */
export class PlainFileLineageStore implements HostLineageStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): HostLineageLedgerDoc | null {
    if (!existsSync(this.path)) return null;
    return parseLedgerDoc(readFileSync(this.path, 'utf8'), this.path);
  }

  save(next: HostLineageLedgerDoc): HostLineageLedgerDoc {
    const onDisk = this.load();
    if (onDisk === null) {
      if (next.revision !== 0) {
        throw new LineageStoreError(
          'LINEAGE_CAS_CONFLICT',
          `create refused: ledger file absent but incoming revision is ${next.revision} (expected 0)`,
        );
      }
    } else if (onDisk.revision !== next.revision) {
      throw new LineageStoreError(
        'LINEAGE_CAS_CONFLICT',
        `CAS conflict on ${this.path}: durable revision ${onDisk.revision}, incoming revision ${next.revision}`,
      );
    }
    const persisted: HostLineageLedgerDoc = { ...next, revision: next.revision + 1 };
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(persisted, null, 2));
    renameSync(temporary, this.path);
    return persisted;
  }
}
