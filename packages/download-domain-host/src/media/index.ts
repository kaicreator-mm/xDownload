/**
 * @xdownload/download-domain-host / src/media — v0.2.2 V022-A04 public face.
 *
 * Host-owned physical media adapters: the T06 HLS acquisition bridge over
 * the existing @xdownload/hls-vod-adapter engine (no second engine, no
 * second ledger), and the trusted opaque targetRef registry the S3/S4 media
 * lanes resolve handles through (relocated from the Domain App by A04 — the
 * registry grammar now imports only the neutral @xdownload/domain-contracts
 * surface, never App contracts). Consumers import only these named exports.
 */
export {
  acquireMediaViaHls,
  acquireSelectedHlsVod,
  s4HlsSelectionTupleDigest,
  MEDIA_SUPPORTED_PROTOCOLS,
  type MediaAcquisitionBridgeRequest,
  type MediaAcquisitionBridgeResult,
  type MediaAcquisitionSummary,
  type MediaBridgeCounters,
  type S4HlsVodBridgeRequest,
} from './media-acquisition-bridge.ts';
export {
  InMemoryMediaTargetRegistry,
  MEDIA_REGISTRY_PROTOCOLS,
  validateMediaTargetRecord,
  type MediaTargetRecord,
  type MediaTargetRefSeed,
} from './media-target-registry.ts';
