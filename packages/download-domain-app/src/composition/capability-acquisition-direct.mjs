/**
 * xDownload v0.2 T11 — Capability Domain Package (C), DIRECT composition
 * (sealed module; write set packages/download-domain-app/src/composition/**).
 *
 * The REAL acquisition C module of the integration-direct lane: identical
 * identity/declaration surface to the T03 stub (same MODULE role, same sealed
 * operation `acquisition.acquire` from the frozen T01 vocabulary, same
 * `externalEffect: true` BUILD fact, same capabilityId/handler binding the
 * T03 route declares) with the physical implementation bound to the trusted
 * Host DIRECT acquisition bridge (v0.2 T04 `DirectAcquisitionBridge` —
 * permit gate, registry-resolved targetRef, canonical budget ledger,
 * digest-backed atomic materialization).
 *
 * Host-dependency seam (the #183 PoC pattern): the module reaches ONLY the
 * `globalThis.__xdownloadDirectAcquisitionBridge` pin installed by the
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

export const MODULE_ID = "capability-acquisition-direct@0.2.0-t11";
export const PACKAGE_KIND = "capability";
export const ABI_VERSION = "v08-capability-abi/1";
export const ENDPOINTS = [{ endpointId: "capability:acquisition-direct", kind: "capability-endpoint" }];

export const OPERATIONS = [
  {
    operationId: "acquisition.acquire",
    effectClass: "non-idempotent",
    intentType: "confirmDownload",
    resource: { key: "acquisition", operation: "acquisition.acquire" },
    externalEffect: true,
  },
];

const HOST_NOTICE = "the trusted T04 DirectAcquisitionBridge must be pinned by the composition before load";

function bridge() {
  const b = globalThis.__xdownloadDirectAcquisitionBridge;
  if (b === undefined || b === null || typeof b.acquire !== "function") {
    throw new Error(`acquisition.acquire requires the trusted Host direct acquisition bridge (${HOST_NOTICE})`);
  }
  return b;
}

/**
 * Sealed direct handler for acquisition.acquire: executed ONLY after the
 * Kernel's external Effect gate authorizes the dispatch with a live K-issued
 * permit. Receives exactly one plain-data payload (the Business effect input
 * projection — the T01 ConfirmedDownloadIntent fields plus the Kernel-
 * assigned durable effectId) and returns exactly one plain-data phase
 * envelope from the T04 bridge (bounded evidence, never acquired bytes).
 * One call = at most one transfer attempt (attempt 0); no internal retry, no
 * journal access, no byte transport in this module.
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
