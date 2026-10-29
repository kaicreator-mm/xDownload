/**
 * xDownload v0.2 T03 — Business Domain Package (B) (sealed module).
 *
 * Download acquisition policy over the canonical T01 ConfirmedDownloadIntent
 * vocabulary: one intent `confirmDownload`, one external effect
 * `effect:acquire` dispatched through the K→C external Effect Operation route
 * {capabilityId:'acquisition', operationId:'acquisition.acquire'} (frozen T01
 * DOWNLOAD_OPERATIONS vocabulary) with external await:'terminal'.
 *
 * The effect input projection carries exactly the T01 confirmed-intent fields
 * (requestId/lineageId/targetRef/outputRootScope/allowedOperation/slice/
 * digestAnchor/declaredBytes/caller) — the opaque targetRef is forwarded
 * untouched; only the trusted Host (T04) resolves it to a locator.
 *
 * This package owns business policy ONLY: no admission/journal mechanism, no
 * Host port, no byte transport. The loaded Kernel invokes it through its
 * sealed endpoint. Kernel ABI: v08-business-abi/1 — endpoint export
 * `getPolicy()`.
 */

export const MODULE_ID = "business-download@0.2.0-t03";
export const PACKAGE_KIND = "business";
export const ABI_VERSION = "v08-business-abi/1";
export const ENDPOINTS = [{ endpointId: "business:download", kind: "business-policy" }];

export const INTENT_TYPES = ["confirmDownload"];
export const EFFECT_TYPES = ["effect:acquire"];

/**
 * v0.2 T03 application-profile bound on the confirmed intent's declaredBytes.
 * The T01 contract maximum (MAX_DECLARED_BYTES, 1 TiB) remains the contract
 * grammar bound; THIS sealed policy additionally refuses to dispatch an
 * acquisition effect for a confirmed intent declaring more than 1 MiB in the
 * v0.2 T03 profile (the same bounded profile the #183 PoC drove).
 */
export const DECLARED_BYTES_PROFILE_BOUND = 1048576;

const GUARD_DECLARED_BYTES_OK = {
  guardId: "guard:declared-bytes-ok",
  predicate: {
    op: "lte",
    left: { source: "event", path: ["payload", "declaredBytes"] },
    right: { source: "literal", value: DECLARED_BYTES_PROFILE_BOUND },
  },
};

const INTENT_FIELD_PROJECTION = {
  requestId: { source: "event", path: ["payload", "requestId"] },
  lineageId: { source: "event", path: ["payload", "lineageId"] },
  targetRef: { source: "event", path: ["payload", "targetRef"] },
  outputRootScope: { source: "event", path: ["payload", "outputRootScope"] },
  allowedOperation: { source: "event", path: ["payload", "allowedOperation"] },
  slice: { source: "event", path: ["payload", "slice"] },
  digestAnchor: { source: "event", path: ["payload", "digestAnchor"] },
  declaredBytes: { source: "event", path: ["payload", "declaredBytes"] },
  caller: { source: "event", path: ["payload", "caller"] },
};

function makeDefinition() {
  return {
    workflowKey: "download-acquisition",
    initialState: "requested",
    initialContext: {},
    guards: [GUARD_DECLARED_BYTES_OK],
    states: [
      {
        stateKey: "requested",
        transitions: [
          {
            transitionKey: "acquire",
            trigger: { kind: "event", eventType: "DOWNLOAD_CONFIRMED" },
            targetState: "acquired",
            guardId: "guard:declared-bytes-ok",
            effectIntents: [
              {
                effectType: "effect:acquire",
                inputFrom: INTENT_FIELD_PROJECTION,
                idempotencyKeyFrom: { template: "acquire:download:{requestId}" },
              },
            ],
          },
          {
            transitionKey: "refuse",
            trigger: { kind: "event", eventType: "DOWNLOAD_CONFIRMED" },
            targetState: "refused",
          },
        ],
      },
      { stateKey: "acquired", kind: "final" },
      { stateKey: "refused", kind: "final" },
    ],
  };
}

const decisionSchema = {
  // Kernel ABI: this validates the DERIVED DECISION RECORD the kernel
  // produces when interpreting a sealed intent against this policy, not the
  // raw intent input.
  isValid(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const decision = value.decision;
    const event = value.event;
    if (typeof decision !== "object" || decision === null || Array.isArray(decision)) return false;
    if (typeof event !== "object" || event === null || Array.isArray(event)) return false;
    return typeof decision.outcome === "string" && typeof event.type === "string";
  },
};

export function getPolicy() {
  return {
    packageId: MODULE_ID,
    policyId: "download-acquisition",
    domainId: "downloads",
    workflowDefinition: makeDefinition(),
    decisionSchema,
    governanceSemantics: { hardInvariants: [] },
    initialStateKey: "requested",
    initialContext: {},
    rules: {
      "rule:download-confirmed": {
        ruleId: "rule:download-confirmed",
        eventType: "DOWNLOAD_CONFIRMED",
        payloadFromInput: {
          requestId: "requestId",
          lineageId: "lineageId",
          targetRef: "targetRef",
          outputRootScope: "outputRootScope",
          allowedOperation: "allowedOperation",
          slice: "slice",
          digestAnchor: "digestAnchor",
          declaredBytes: "declaredBytes",
          caller: "caller",
        },
      },
    },
    intentBindings: {
      confirmDownload: {
        trigger: { kind: "event", eventType: "DOWNLOAD_CONFIRMED" },
        ruleId: "rule:download-confirmed",
        roles: ["requester"],
      },
    },
    effectBindings: {
      "effect:acquire": {
        semantics: "non-idempotent",
        // T01 frozen operation vocabulary: capability 'acquisition' /
        // operation 'acquisition.acquire'. The kernel mints a LIVE one-time
        // permit, the K→C external Effect gate re-reads durable authority,
        // and only then does the sealed capability run. await:'terminal':
        // an accepted/running ACK can never settle this effect as success.
        resource: { key: "acquisition", operation: "acquisition.acquire" },
        external: { permitTtlMs: 60_000, await: "terminal" },
        handler: async ({ input, effectId, resources }) => {
          if (resources === undefined) {
            throw new Error("effect:acquire requires the Host resource port");
          }
          return resources.call("acquisition", "acquisition.acquire", { ...input, effectId });
        },
      },
    },
  };
}
