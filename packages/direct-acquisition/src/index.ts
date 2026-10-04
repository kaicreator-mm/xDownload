/**
 * @xdownload/direct-acquisition — T008 S1/S3 direct HTTP/file byte transfer
 * behind the canonical acquisition port (frozen L2 §6.5, ADR-006).
 *
 * Consumes @xdownload/domain-contracts as the only canonical vocabulary:
 * effect lineage, logical-target/locator separation, budget domains and
 * typed evidence/result identities. No HLS, browser, collection, persistence
 * or scheduling behavior lives here.
 */

export type {
  DirectTransferOutcome,
  DirectTransferRequest,
  DirectTransferSlice,
  DirectTransferTerminalReason,
  MediaPolicy,
  MediaSignature,
  PartialTransferState,
  RepresentationIdentity,
  ResumeDecision,
  TransferBudgetLedgerPort,
  TransferConsumption,
  ValidationLayerOutcome,
} from './port.ts';
export { DirectHttpAdapter } from './direct-http-adapter.ts';
export {
  classifyRangeResponse,
  isSha256Hex,
  observeIdentity,
  planResume,
  type RangeResponseClassification,
} from './identity.ts';
export { validateFormat, validateMedia, validateTarget, validateTransfer } from './integrity.ts';
export { projectOutcome } from './projection.ts';
