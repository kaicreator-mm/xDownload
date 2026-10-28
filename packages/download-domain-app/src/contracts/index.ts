/**
 * v0.2 T01 — download Domain App canonical contracts (public index).
 *
 * Task Pack scope: pure additive contract source. No package manifest, no
 * runtime K authority, no Host ports — T02 owns the package bootstrap and
 * T03+ own the runtime wiring. Consumers import only these named exports.
 */
export {
  INTENT_FIELD_PATTERN,
  MAX_DECLARED_BYTES,
  REFERENCE_TOKEN_PATTERN,
  SHA256_PATTERN,
  validateArtifactPath,
  validateConfirmedIntent,
  validateOutputRoot,
  type ConfirmedDownloadIntent,
  type DownloadSlice,
  type IntentCaller,
} from './intent.ts';
export {
  DOWNLOAD_OPERATIONS,
  normalizeEffectEnvelope,
  validateMaterializedEvidence,
  validateRouteTable,
  type DownloadOperationId,
  type EffectClass,
  type EffectEnvelope,
  type MaterializedEvidence,
  type OperationDeclaration,
  type OperationRouteRow,
} from './operations.ts';
