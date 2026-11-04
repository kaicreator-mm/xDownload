/**
 * v0.2 T09 — durable CAS store seam behind the lineage authority ledger.
 *
 * V022-A04 R2 (review P2 closure): the Domain App no longer owns a PHYSICAL
 * lineage store. This module now carries only the domain-facing seam:
 *
 *   - {@link LineageLedgerDoc} — the durable document shape (schema 1);
 *   - {@link LineageStore} — the tiny physical CAS port (load / revision-checked
 *     save) that the Host-owned physical store satisfies structurally;
 *   - {@link LineageStoreError} — the App's typed store failure (the ledger
 *     classifies by this constructor; it is DISTINCT from the Host store's own
 *     same-named error class — the composition layer maps foreign store errors
 *     onto this constructor before they reach the ledger, see the A04
 *     composition-boundary test in packages/core-runtime);
 *   - {@link PlainFileLineageStore} — the REMOVED physical default, kept only
 *     as a name-bound fail-closed shim: the frozen `LineageLedger.open()`
 *     default-construction call site references this identifier, and the
 *     A04 write set forbids touching that file. Construction now refuses
 *     closed with an explicit injection instruction instead of silently
 *     owning bytes on disk. Physical storage lives in the trusted Host
 *     (`@xdownload/download-domain-host` migration exports) and is injected
 *     through `OpenLineageLedgerOptions.store`.
 *
 * T09 remains dormant: no new production caller, no second route authority,
 * no SQLite leg, no UNKNOWN auto-resolution and no multi-process CAS claim.
 * The REAL SQLITE CAS SUB-LEG stays NOT_PROVEN in this lane (the honest
 * probe record from the T09 era: `@kaicreator/domain-harness-host-node`
 * `openSqliteCasStore` is not resolvable from the App install site and its
 * probe fails typed on the missing better-sqlite3 driver; adding the driver
 * is the T13 packaging writer's lockfile change, not this lane's). The
 * plain-file CAS contract the port describes (tmp+rename, revision-checked,
 * single-process-safe) is Host-owned and dormant.
 */
import type {
  LineageClaimRecord,
  LineageHistoryEvent,
  UnknownEffectRecord,
} from './lineage-ledger.ts';

/** Root shape of the durable ledger document (schema 1; fail-closed on drift). */
export interface LineageLedgerDoc {
  readonly schemaVersion: 1;
  /** Monotonic CAS revision; 0 means "never persisted". */
  readonly revision: number;
  /** Active ownership records by lineageId (released records are kept, not deleted). */
  readonly claims: Readonly<Record<string, LineageClaimRecord>>;
  /** UNKNOWN reconciliation book — records are immutable once appended. */
  readonly unknownEffects: readonly UnknownEffectRecord[];
  /** Append-only audit history (registrations, claims, releases, UNKNOWN bookkeeping). */
  readonly history: readonly LineageHistoryEvent[];
}

export type LineageStoreErrorCode = 'LINEAGE_CAS_CONFLICT' | 'MALFORMED_LEDGER_DOC';

/** Typed store failure — callers classify by code, never by message matching. */
export class LineageStoreError extends Error {
  readonly code: LineageStoreErrorCode;

  constructor(code: LineageStoreErrorCode, message: string) {
    super(message);
    this.name = 'LineageStoreError';
    this.code = code;
  }
}

/**
 * The physical CAS seam: load the durable document (null = no ledger yet) and
 * save a new revision under a compare-and-swap condition. Implementations must
 * persist atomically (readers never observe a torn document) and must refuse a
 * save whose expected revision does not match the durable bytes.
 *
 * V022-A04 R2: this port is the App's ONLY storage surface. The Host-owned
 * `PlainFileLineageStore` (`@xdownload/download-domain-host` migration
 * barrel) is structurally assignable to it — the composition call site where
 * Core injects the Host store performs the actual assignability + typed error
 * mapping proof (A04 composition-boundary test). The App never imports Host.
 */
export interface LineageStore {
  load(): LineageLedgerDoc | null;
  /** Persist `next`; returns the durably stored document (revision advanced). */
  save(next: LineageLedgerDoc): LineageLedgerDoc;
}

/**
 * REMOVED physical default (V022-A04 R2, review P2 closure).
 *
 * The Domain App must not own physical lineage storage — the trusted Host
 * owns every physical adapter. This identifier survives ONLY because the
 * frozen `LineageLedger.open()` call site (`options.store ??
 * new PlainFileLineageStore(options.path)`) references it and the write set
 * forbids editing that file; the class is now a fail-closed shim whose
 * construction refuses with an explicit injection instruction. There is no
 * App-owned bytes-on-disk path anymore: callers must inject the Host-owned
 * store through `OpenLineageLedgerOptions.store`.
 */
export class PlainFileLineageStore implements LineageStore {
  constructor(path: string) {
    throw new Error(
      `LINEAGE_STORE_INJECTION_REQUIRED: the Domain App no longer owns a physical ` +
        `lineage store (V022-A04); '${path}' cannot be opened from here. Physical ` +
        `lineage storage is Host-owned and dormant — inject it through ` +
        `OpenLineageLedgerOptions.store (see the @xdownload/download-domain-host ` +
        `migration barrel) at the Core composition boundary.`,
    );
  }

  load(): LineageLedgerDoc | null {
    throw new Error('LINEAGE_STORE_INJECTION_REQUIRED: physical storage is Host-owned; inject it');
  }

  save(next: LineageLedgerDoc): LineageLedgerDoc {
    void next;
    throw new Error('LINEAGE_STORE_INJECTION_REQUIRED: physical storage is Host-owned; inject it');
  }
}
