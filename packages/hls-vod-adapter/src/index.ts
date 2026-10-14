/**
 * @xdownload/hls-vod-adapter — T009 basic HLS VOD media adapter (S4).
 *
 * Specialized playlist/segment/rendition adapter (frozen L2 U6/ADR-006):
 * bounded deterministic playlist decoding, immutable manifest/rendition
 * binding to a frozen logical target, provenance-bound segment planning,
 * segment acquisition under canonical TransferBudget semantics, media
 * assembly/probing behind a replaceable tooling port, the applicable
 * validation chain, and canonical effect/evidence/terminal emission.
 * No opaque byte path, no DRM bypass, no mux/post-processing promises;
 * unsupported topologies fail closed.
 */

export * from './playlist.ts';
export * from './bind.ts';
export * from './topology.ts';
export * from './plan.ts';
export * from './budget.ts';
export * from './acquire.ts';
export * from './assemble.ts';
export * from './validate.ts';
export * from './request.ts';
export * from './pipeline.ts';
export * from './selected-preflight.ts';
export * from './http-segment.ts';
export * from './acquire-async.ts';
export * from './pipeline-async.ts';
export * from './manifest-http.ts';
