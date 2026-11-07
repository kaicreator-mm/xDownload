/**
 * @xdownload/download-domain-host / src/migration — v0.2.2 V022-A03 public face.
 *
 * Host-owned physical adapters of the dormant T09 migration lane. The
 * plain-file lineage store moved here from the Domain App migration lane;
 * the App policy port stays dormant and NO active Core caller is wired in
 * A03 — this barrel exports the physical adapter only, never a second route
 * authority. Consumers import only these named exports.
 */
export {
  LineageStoreError,
  PlainFileLineageStore,
  type HostLineageClaimRecord,
  type HostLineageHistoryEvent,
  type HostLineageLedgerDoc,
  type HostLineageOwnerKind,
  type HostLineageStore,
  type HostLineageStoreErrorCode,
  type HostLineageWriterIdentity,
  type HostUnknownEffectRecord,
} from './plain-file-lineage-store.ts';
