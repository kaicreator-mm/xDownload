/**
 * xDownload #183 PoC — Business Domain Package (B) v0.0.0 (sealed module).
 *
 * Download acquisition policy for exactly one business field (single-file
 * direct download). Mirrors the v0.8/v0.10 clean-consumer business ABI:
 * workflow 'download-acquisition', guard on declared size, one effect intent
 * `effect:acquire` dispatched through the Host resource route
 * {key:'acquisition', operation:'acquire'} to the BUILD-selected capability.
 *
 * This package owns business policy ONLY: no admission/journal mechanism, no
 * Host port, no byte transport. The loaded Kernel invokes it through its
 * sealed endpoint. Kernel ABI: v08-business-abi/1 — endpoint export
 * `getPolicy()`.
 */

export const MODULE_ID = "business-download@0.1.0";
export const PACKAGE_KIND = "business";
export const ABI_VERSION = "v08-business-abi/1";
export const ENDPOINTS = [{ endpointId: "business:download", kind: "business-policy" }];

export const INTENT_TYPES = ["confirmDownload"];
export const EFFECT_TYPES = ["effect:acquire"];

const GUARD_DECLARED_BYTES_OK = {
  guardId: "guard:declared-bytes-ok",
  predicate: {
    op: "lte",
    left: { source: "event", path: ["payload", "expectedTotalBytes"] },
    right: { source: "literal", value: 1048576 },
  },
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
                inputFrom: {
                  requestId: { source: "event", path: ["payload", "requestId"] },
                  url: { source: "event", path: ["payload", "url"] },
                  expectedSha256: { source: "event", path: ["payload", "expectedSha256"] },
                  expectedTotalBytes: { source: "event", path: ["payload", "expectedTotalBytes"] },
                  allowedHost: { source: "event", path: ["payload", "allowedHost"] },
                  outputRoot: { source: "event", path: ["payload", "outputRoot"] },
                },
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
  // produces when interpreting a sealed intent against this policy — the
  // same shape as the v0.8 golden business package (tiny example), not the
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
          url: "url",
          expectedSha256: "expectedSha256",
          expectedTotalBytes: "expectedTotalBytes",
          allowedHost: "allowedHost",
          outputRoot: "outputRoot",
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
        resource: { key: "acquisition", operation: "acquire" },
        // Route this dispatch through the selected K→C external Effect
        // Operation: the kernel mints a LIVE one-time permit, the gate
        // re-reads durable authority, and only then does C run. Our adapter
        // returns a settled terminal envelope in one await.
        external: { permitTtlMs: 60_000, await: "terminal" },
        handler: async ({ input, effectId, resources }) => {
          if (resources === undefined) {
            throw new Error("effect:acquire requires the Host resource port");
          }
          return resources.call("acquisition", "acquire", { ...input, effectId });
        },
      },
    },
  };
}
