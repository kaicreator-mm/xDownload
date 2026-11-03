/**
 * v0.2 T09 — migration lane public surface (single-authority lineage
 * ledger). Consumers import only these named exports.
 *
 * V022-A02: the lane barrel keeps the physical `PlainFileLineageStore` (the
 * colocated lineage-ledger test consumes it from here); the App public root
 * (`src/index.ts`) curates its re-exports and does NOT surface the physical
 * store. T09 remains dormant — no new production caller, no second route
 * authority, no SQLite/multi-process claim.
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
  PlainFileLineageStore,
  type LineageLedgerDoc,
  type LineageStore,
  type LineageStoreErrorCode,
} from './lineage-store.ts';
