/**
 * @xdownload/download-domain-host — package root (V022-A04).
 *
 * The trusted Host's stable public surface. Host owns every physical
 * adapter of the selected Domain App: direct/media acquisition bridges over
 * the existing engines, the opaque targetRef registries (direct + media),
 * the durable K document CAS (`FileCasDocStore`) and the dormant T09
 * plain-file lineage store. Core Runtime — the only production composition
 * root — consumes Host exclusively through this root (no deep imports).
 *
 * Dependency direction is one-way (A04): Host depends on the neutral
 * @xdownload/domain-contracts and the existing engine packages only; it
 * never imports the Domain App, and the Domain App never imports Host.
 *
 * This barrel re-exports the four lane barrels (`direct`, `media`,
 * `storage`, `migration`); consumers may also address a lane directly
 * through the package exports map (`@xdownload/download-domain-host/direct`,
 * `/media`, `/media/permit`).
 */

export * from './direct/index.ts';
export * from './media/index.ts';
export * from './storage/index.ts';
export * from './migration/index.ts';
