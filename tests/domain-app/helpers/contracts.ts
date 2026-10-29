/**
 * T10 validation-harness — single import seam for the canonical T01 contracts
 * and the Core-owned domain-contract vocabulary.
 *
 * `@xdownload/download-domain-app` has no runtime facade yet (the packaged
 * facade is T13's write set), so the T01 canonical contract source is
 * imported by path here — and only here. Every harness module and test file
 * imports the contract surface from this module, keeping the relative path
 * owned by one file.
 */
export {
  INTENT_FIELD_PATTERN,
  MAX_DECLARED_BYTES,
  REFERENCE_TOKEN_PATTERN,
  SHA256_PATTERN,
  DOWNLOAD_OPERATIONS,
  normalizeEffectEnvelope,
  validateArtifactPath,
  validateConfirmedIntent,
  validateMaterializedEvidence,
  validateOutputRoot,
  validateRouteTable,
  type ConfirmedDownloadIntent,
  type DownloadOperationId,
  type DownloadSlice,
  type EffectEnvelope,
  type IntentCaller,
  type MaterializedEvidence,
  type OperationDeclaration,
} from '../../../packages/download-domain-app/src/contracts/index.ts';
export {
  SCOPE_PRIMITIVES,
  SUPPORT_SLICE_IDS,
  claimTypeForLayer,
  buildTerminalResult,
  createEvidenceLedger,
  createTerminalResultStore,
  createValidationRegistry,
  currentSchemaIdentity,
  decodeSupportSliceRef,
  evidenceRecord,
  makeContractId,
  makeEvidenceId,
  makeMemberId,
  makeSnapshotId,
  makeValidationRecordId,
  projectResult,
  requiredValidationOutcomes,
  supportSliceRepresentations,
  unwrapOrThrow,
  validateTerminalResult,
  type CoverageStatus,
  type DomainValidationResult,
  type EvidenceLedger,
  type ProjectionFacts,
  type ProjectedTerminalResult,
  type RequestFulfillmentStatus,
  type ScopePrimitive,
  type SelectionAcquisitionStatus,
  type StopReason,
  type SupportSliceId,
  type SupportSliceRepresentation,
  type TargetResolutionStatus,
  type TerminalResult,
  type ValidationLayer,
  type ValidationRegistry,
  type ValidationSummaryStatus,
} from '@xdownload/domain-contracts';
