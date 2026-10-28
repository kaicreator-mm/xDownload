/**
 * xDownload #183 PoC — Capability Domain Package (C) v0.0.0 (sealed module).
 *
 * BUILD-selected acquisition capability: exactly one callable operation
 * `acquisition.acquire` (effectClass 'non-idempotent'), routed from the
 * sealed Business intent `confirmDownload`. Declared `externalEffect: true`
 * in the BUILD, so every Kernel dispatch of this operation is forced through
 * the selected Kernel's external Effect Permit gate (durable permit / journal
 * row / fence / dispatch claim) BEFORE these handlers run; without a live
 * permit the Kernel refuses with `V10_EFFECT_PERMIT_REQUIRED` and this module
 * is never invoked.
 *
 * The physical download is performed by the trusted Host application through
 * the `globalThis.__xdAcquisitionBridge` pin (installed before `load`, the
 * same host-dependency pattern as the v0.10 rich fixture). The bridge owns
 * the existing xDownload DirectHttpAdapter and the artifact file writer and
 * returns BOUNDED EVIDENCE ONLY (digests, sizes, terminal reasons) — never
 * raw bytes, cookies or streams into the Kernel.
 *
 * Kernel ABI: v08-capability-abi/1 — MODULE_ID/PACKAGE_KIND/ABI_VERSION/
 * ENDPOINTS identity, sealed OPERATIONS table, BUILD-bound handlers.
 */

export const MODULE_ID = "capability-acquisition@0.1.0";
export const PACKAGE_KIND = "capability";
export const ABI_VERSION = "v08-capability-abi/1";
export const ENDPOINTS = [{ endpointId: "capability:acquisition", kind: "capability-endpoint" }];

export const OPERATIONS = [
  {
    operationId: "acquisition.acquire",
    effectClass: "non-idempotent",
    intentType: "confirmDownload",
    resource: { key: "acquisition", operation: "acquire" },
  },
];

function bridge() {
  const b = globalThis.__xdAcquisitionBridge;
  if (b === undefined || b === null || typeof b.acquire !== "function") {
    throw new Error("acquisition.acquire requires the trusted Host acquisition bridge");
  }
  return b;
}

/**
 * EFFECTFUL physical adapter for acquisition.acquire: executed ONLY through
 * the Host resource `acquisition.acquire` after the Kernel's effect dispatch
 * authorizes it. Receives exactly one plain-data payload (the Business effect
 * handler's input projection plus the Kernel-assigned durable effectId) and
 * returns exactly one plain-data evidence record. One call = at most one
 * physical transfer attempt; there is no internal retry, no auto-redownload
 * and no journal access here.
 */
export function acquireFile(payload, dispatchContext) {
  if (arguments.length !== 2) {
    throw new Error("acquisition.acquire receives exactly (payload, dispatchContext)");
  }
  const record = payload === null || typeof payload !== "object" ? {} : payload;
  const permit =
    dispatchContext && typeof dispatchContext === "object" ? dispatchContext.effectPermit : undefined;
  return bridge().acquire(record, permit);
}
