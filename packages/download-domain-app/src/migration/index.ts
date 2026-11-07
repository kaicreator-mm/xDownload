/**
 * v0.2 T09 — migration lane public surface (single-authority lineage
 * ledger). Consumers import only these named exports.
 *
 * V022-A04 R2 (review P2 closure): the lane barrel no longer exports any
 * physical store class. `PlainFileLineageStore` was the last App-owned
 * physical implementation; it is REMOVED (a fail-closed shim name survives
 * inside lineage-store.ts only because the frozen `LineageLedger.open()`
 * call site references the identifier, and the write set forbids editing
 * that file). Physical lineage storage is Host-owned and dormant
 * (`@xdownload/download-domain-host` migration barrel); it reaches the
 * ledger ONLY through the domain-facing `LineageStore` port injection.
 * The App public root (`src/index.ts`) curates its re-exports and never
 * surfaced the physical store. T09 remains dormant — no new production
 * caller, no second route authority, no SQLite/multi-process claim.
 */
export {
  DEFAULT_LINEAGE_OWNER,
  LineageLedger,
  LineageLedgerError,
  type ClaimLineageInput,
  type LineageClaimRecord,
  type LineageHistoryEvent,
  type LineageLedgerErrorCode,
  type LineageOwnerKind,
  type LineageWriterIdentity,
  type OpenLineageLedgerOptions,
  type RecordUnknownEffectInput,
  type ReleaseLineageInput,
  type ResolveUnknownEffectInput,
  type UnknownEffectRecord,
} from './lineage-ledger.ts';
export {
  LineageStoreError,
  type LineageLedgerDoc,
  type LineageStore,
  type LineageStoreErrorCode,
} from './lineage-store.ts';
