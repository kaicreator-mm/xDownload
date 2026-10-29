/**
 * xDownload v0.2 T03 — Capability Domain Package (C) STUB (sealed module).
 *
 * MINIMAL stub: identity + sealed operation/handler declaration ONLY. The
 * real acquisition C/Host bridge (DirectHttpAdapter binding, budgets, digest
 * acceptance, file writer) belongs to v0.2 T04 and replaces this stub in a
 * later BUILD; T03 seals it so the K→C external Effect route
 * `acquisition.acquire` exists end-to-end and can be exercised by tests
 * through a test-installed trusted-bridge pin (the same host-dependency
 * pattern as the #183 PoC).
 *
 * Declared `externalEffect: true` in the BUILD, so every Kernel dispatch of
 * this operation is forced through the selected Kernel's external Effect
 * Permit gate (durable permit / journal row / fence / dispatch claim) BEFORE
 * this handler runs; without a live K-issued permit the gate refuses with
 * `V10_EFFECT_PERMIT_REQUIRED` and this module is never invoked.
 *
 * Kernel ABI: v08-capability-abi/1 — MODULE_ID/PACKAGE_KIND/ABI_VERSION/
 * ENDPOINTS identity, sealed OPERATIONS table, BUILD-bound handlers.
 */

export const MODULE_ID = "capability-acquisition-stub@0.2.0-t03";
export const PACKAGE_KIND = "capability";
export const ABI_VERSION = "v08-capability-abi/1";
export const ENDPOINTS = [{ endpointId: "capability:acquisition-stub", kind: "capability-endpoint" }];

export const OPERATIONS = [
  {
    operationId: "acquisition.acquire",
    effectClass: "non-idempotent",
    intentType: "confirmDownload",
    resource: { key: "acquisition", operation: "acquisition.acquire" },
    externalEffect: true,
  },
];

const T04_NOTICE = "the real acquisition C/Host bridge belongs to v0.2 T04";

/**
 * Test-only trusted-bridge seam. A production BUILD has no such pin: the
 * real T04 C module binds the trusted Host application bridge instead, and a
 * missing bridge fails closed (honest typed error, zero transport).
 */
function bridge() {
  const b = globalThis.__xdownloadAcquisitionStubBridge;
  if (b === undefined || b === null || typeof b.acquire !== "function") {
    throw new Error(`acquisition.acquire requires the trusted Host acquisition bridge (${T04_NOTICE})`);
  }
  return b;
}

/**
 * Sealed stub handler for acquisition.acquire: executed ONLY after the
 * Kernel's external Effect gate authorizes the dispatch with a live K-issued
 * permit. Receives exactly one plain-data payload (the Business effect
 * input projection — T01 ConfirmedDownloadIntent fields plus the
 * Kernel-assigned durable effectId — and returns exactly one plain-data
 * phase envelope. One call = at most one transfer attempt; no internal
 * retry, no journal access, no byte transport in this stub.
 */
export function acquire(payload, dispatchContext) {
  if (arguments.length !== 2) {
    throw new Error("acquisition.acquire receives exactly (payload, dispatchContext)");
  }
  const record = payload === null || typeof payload !== "object" ? {} : payload;
  const permit =
    dispatchContext && typeof dispatchContext === "object" ? dispatchContext.effectPermit : undefined;
  return bridge().acquire(record, permit);
}
