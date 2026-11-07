/**
 * v0.2 T13 — @xdownload/download-domain-app public export facade.
 *
 * V022-A02 curated domain-owned public API. The root exports ONLY:
 *
 *   - T01 contracts    → ./contracts/index.ts   (frozen K/B/C intent +
 *     operation vocabulary, no-widening validation)
 *   - T03 business     → ./business/composition.ts (sealed BUILD producer
 *     over the #183 payload bytes; confirmDownloadRequest admission)
 *   - T11 composition  → ./composition/{runtime,journey}.ts (the sealed
 *     direct BUILD producer `sealDirectComposition` + the
 *     `submitConfirmedDownload` domain journey)
 *   - T05 semantic     → ./semantic/index.ts (deterministic no-LLM
 *     recipe/selection, bounded advisory)
 *   - T09 migration    → ./migration/index.ts (dormant single-authority
 *     lineage policy + storage port types; the physical store is curated
 *     OUT of the root)
 *   - T12 integrations → ./integrations/index.ts (S2–S6 + media convergence
 *     journeys, sealed media/S4 BUILD producers, frozen routes, the media
 *     targetRef registry grammar, the S4 composition contribution)
 *
 * Deliberately NOT exported here (V022-A02; transitional Core compatibility
 * stays reachable at deep module paths only, marked RELOCATE-TO-CORE-A04):
 * runtime assemblers, Host bridge pins/implementations, Host pin registries,
 * physical adapter classes (`FileCasDocStore`, `PlainFileLineageStore`,
 * `InMemoryMediaTargetRegistry`), runtime option/counter types. No App
 * source imports @xdownload/download-domain-host anymore; the physical
 * Host assembly belongs to the Core composition root (A04).
 *
 * Consumption is `import { ... } from '@xdownload/download-domain-app'`.
 * The legacy deep specifier `@xdownload/download-domain-app/src/contracts/index.ts`
 * stays admitted through the manifest exports map for consumers whose
 * manifests are outside the T13 write set (see README "T13 normalization
 * ledger"); relative deep-path imports inside the workspace are unaffected.
 */
export * from './contracts/index.ts';
export * from './semantic/index.ts';
export {
  DEFAULT_LINEAGE_OWNER,
  LineageLedger,
  LineageLedgerError,
  LineageStoreError,
  type ClaimLineageInput,
  type LineageClaimRecord,
  type LineageHistoryEvent,
  type LineageLedgerDoc,
  type LineageLedgerErrorCode,
  type LineageOwnerKind,
  type LineageStore,
  type LineageStoreErrorCode,
  type LineageWriterIdentity,
  type OpenLineageLedgerOptions,
  type RecordUnknownEffectInput,
  type ReleaseLineageInput,
  type ResolveUnknownEffectInput,
  type UnknownEffectRecord,
} from './migration/index.ts';
export * from './integrations/index.ts';
export {
  ACQUISITION_ROUTE,
  APP_ID,
  AUDIENCE,
  BUILD_ID,
  SEALED_OPERATION_VOCABULARY,
  buildDownloadDomainApp,
  confirmDownloadRequest,
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
  verifySealedModules,
} from './business/composition.ts';
export type {
  BuiltDownloadDomainApp,
  ConfirmDownloadRequestOptions,
} from './business/composition.ts';
export {
  APP_ID_DIRECT,
  BUILD_ID_DIRECT,
  DIRECT_CAPABILITY_MODULE_ID,
  sealDirectComposition,
} from './composition/runtime.ts';
export type { SealedDirectComposition } from './composition/runtime.ts';
export { submitConfirmedDownload } from './composition/journey.ts';
export type { SubmissionOutcome, SubmitConfirmedDownloadOptions } from './composition/journey.ts';
