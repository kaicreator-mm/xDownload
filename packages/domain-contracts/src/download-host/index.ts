/**
 * V022 A01 — neutral Host-operation contracts (public index).
 *
 * The narrow cross-boundary contract surface shared by Domain App and
 * trusted Host: opaque targetRef grammar, output-root containment grammar,
 * the direct and S4/media Host request DTOs with their exact validators,
 * the typed EffectEnvelope / MaterializedEvidence output contracts and the
 * narrow shared Host port types. Business Intent, K/S/B/C declarations,
 * route-table/BUILD validation and Workflow policy remain in Domain App;
 * Host I/O, permits, registries and runtime assembly remain in Host. Pure:
 * no I/O, no App/Host/Core/Node/network/SDK imports.
 */
export {
  EXPLICIT_TIMEZONE_ISO_PATTERN,
  INTENT_FIELD_PATTERN,
  MAX_DECLARED_BYTES,
  SHA256_PATTERN,
  isBoundedByteCount,
  isBoundedIntentField,
  isExplicitTimezoneIso,
  isSha256Digest,
} from './fields.ts';
export {
  REFERENCE_TOKEN_PATTERN,
  isRawLocatorShape,
  validateOpaqueTargetRef,
} from './target-ref.ts';
export { validateArtifactPath, validateOutputRoot } from './paths.ts';
export {
  validateDirectHostAcquisitionRequest,
  validateHostCaller,
  type DirectHostAcquisitionRequest,
  type DirectHostCaller,
  type DirectHostSlice,
} from './direct-request.ts';
export {
  validateS4HostAcquisitionRequest,
  type S4HostAcquisitionRequest,
  type S4HostConfirmedSelection,
} from './s4-request.ts';
export {
  validateS3MediaHostAcquisitionRequest,
  type S3MediaHostAcquisitionRequest,
} from './s3-media-request.ts';
export {
  normalizeEffectEnvelope,
  validateMaterializedEvidence,
  type EffectEnvelope,
  type MaterializedEvidence,
} from './envelope.ts';
export {
  type DirectAcquisitionHostPort,
  type HostAcquisitionRequest,
  type HostAcquisitionSettlement,
  type S4MediaAcquisitionHostPort,
} from './ports.ts';
