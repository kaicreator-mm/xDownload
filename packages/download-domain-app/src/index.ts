/**
 * v0.2 T13 — @xdownload/download-domain-app public export facade.
 *
 * Pure aggregation of the merged lane public surfaces; nothing here
 * re-designs or re-exports anything the lane indexes do not already
 * publish. Each lane's own index stays the authority for its surface:
 *
 *   - T01 contracts    → ./contracts/index.ts   (frozen K/B/C intent +
 *     operation vocabulary, no-widening validation)
 *   - T03 business     → ./business/composition.ts (sealed BUILD producer
 *     over the #183 payload bytes; confirmDownloadRequest admission)
 *   - T11 composition  → ./composition/{runtime,journey}.ts (one
 *     authoritative direct K→C runtime: sealed composition, FileCas
 *     single-process doc store, submitConfirmedDownload journey)
 *   - T05 semantic     → ./semantic/index.ts (deterministic no-LLM
 *     recipe/selection, bounded advisory)
 *   - T09 migration    → ./migration/index.ts (single-authority lineage
 *     ledger + plain-file store)
 *   - T12 integrations → ./integrations/index.ts (S2–S6 + media
 *     convergence under K; the media C/Host bridge itself is pinned
 *     through the `MEDIA_BRIDGE_PIN` globalThis seam and ships from
 *     @xdownload/download-domain-host)
 *
 * Consumption is `import { ... } from '@xdownload/download-domain-app'`.
 * The legacy deep specifier `@xdownload/download-domain-app/src/contracts/index.ts`
 * stays admitted through the manifest exports map for consumers whose
 * manifests are outside the T13 write set (see README "T13 normalization
 * ledger"); relative deep-path imports inside the workspace are unaffected.
 */
export * from './contracts/index.ts';
export * from './semantic/index.ts';
export * from './migration/index.ts';
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
  DIRECT_BRIDGE_PIN,
  DIRECT_CAPABILITY_MODULE_ID,
  FileCasDocStore,
  assembleDownloadRuntime,
  sealDirectComposition,
} from './composition/runtime.ts';
export type {
  AssembleDownloadRuntimeOptions,
  DownloadRuntime,
  FileCasDocStoreCounts,
  SealedDirectComposition,
  TargetRefSeed,
} from './composition/runtime.ts';
export { submitConfirmedDownload } from './composition/journey.ts';
export type { SubmissionOutcome, SubmitConfirmedDownloadOptions } from './composition/journey.ts';
