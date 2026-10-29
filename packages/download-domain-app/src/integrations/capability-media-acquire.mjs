/**
 * xDownload v0.2 T12 — Capability Domain Package (C), MEDIA composition
 * (sealed module; write set packages/download-domain-app/src/integrations/**).
 *
 * The REAL media acquisition C module of the integration-other lane:
 * identical identity/declaration surface to the T11 direct capability module
 * (same MODULE role, same sealed-operation shape, same `externalEffect: true`
 * BUILD fact) with the frozen T01 operation 'media.acquire' and the physical
 * implementation bound to the trusted Host MEDIA acquisition bridge (v0.2 T06
 * `acquireMediaViaHls` — the existing @xdownload/hls-vod-adapter engine
 * behind the T06 permit gate; this lane adds no second engine).
 *
 * Host-dependency seam (the #183 PoC / T11 pattern): the module reaches ONLY
 * the `globalThis.__xdownloadMediaAcquisitionBridge` pin installed by the
 * trusted composition BEFORE `load`. Declared `externalEffect: true` in the
 * BUILD, so every Kernel dispatch of this operation is forced through the
 * selected Kernel's external Effect Permit gate (durable permit / journal
 * row / fence / dispatch claim) BEFORE this handler runs; without a live
 * K-issued permit the gate refuses with `V10_EFFECT_PERMIT_REQUIRED` and
 * this module is never invoked. A missing pin fails closed (honest typed
 * error, zero transport).
 *
 * Kernel ABI: v08-capability-abi/1 — MODULE_ID/PACKAGE_KIND/ABI_VERSION/
 * ENDPOINTS identity, sealed OPERATIONS table, BUILD-bound handlers.
 */

export const MODULE_ID = 'capability-media-acquire@0.2.0-t12';
export const PACKAGE_KIND = 'capability';
export const ABI_VERSION = 'v08-capability-abi/1';
export const ENDPOINTS = [{ endpointId: 'capability:media-acquire', kind: 'capability-endpoint' }];

export const OPERATIONS = [
  {
    operationId: 'media.acquire',
    effectClass: 'non-idempotent',
    intentType: 'confirmDownload',
    resource: { key: 'media', operation: 'media.acquire' },
    externalEffect: true,
  },
];

const HOST_NOTICE =
  'the trusted T06 media acquisition bridge must be pinned by the composition before load';

function bridge() {
  const b = globalThis.__xdownloadMediaAcquisitionBridge;
  if (b === undefined || b === null || typeof b.acquireMedia !== 'function') {
    throw new Error(
      `media.acquire requires the trusted Host media acquisition bridge (${HOST_NOTICE})`,
    );
  }
  return b;
}

/**
 * Sealed media handler for media.acquire: executed ONLY after the Kernel's
 * external Effect gate authorizes the dispatch with a live K-issued permit.
 * Receives exactly one plain-data payload (the Business effect input
 * projection — the T01 ConfirmedDownloadIntent fields plus the Kernel-
 * assigned durable effectId) and returns exactly one plain-data phase
 * envelope from the T06 bridge (bounded evidence, never acquired media
 * bytes). One call = at most one engine execution (attempt 0); no internal
 * retry, no journal access, no byte transport in this module.
 */
export function acquireMedia(payload, dispatchContext) {
  if (arguments.length !== 2) {
    throw new Error('media.acquire receives exactly (payload, dispatchContext)');
  }
  const record = payload === null || typeof payload !== 'object' ? {} : payload;
  const permit =
    dispatchContext && typeof dispatchContext === 'object'
      ? dispatchContext.effectPermit
      : undefined;
  return bridge().acquireMedia(record, permit);
}
