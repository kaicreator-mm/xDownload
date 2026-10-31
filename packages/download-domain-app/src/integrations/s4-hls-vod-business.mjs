/**
 * T06 S4 HLS VOD Business package. The intent carries an explicit confirmed
 * rendition selection; no S1/S3 slice projection is present or inferred.
 */
export const MODULE_ID = 'business-s4-hls-vod@0.2.1';
export const PACKAGE_KIND = 'business';
export const ABI_VERSION = 'v08-business-abi/1';
export const ENDPOINTS = [{ endpointId: 'business:s4-hls-vod', kind: 'business-policy' }];
export const INTENT_TYPES = ['confirmDownload'];
export const EFFECT_TYPES = ['effect:acquire'];

const PROJECTION = {
  requestId: { source: 'event', path: ['payload', 'requestId'] },
  lineageId: { source: 'event', path: ['payload', 'lineageId'] },
  contractId: { source: 'event', path: ['payload', 'contractId'] },
  targetRef: { source: 'event', path: ['payload', 'targetRef'] },
  outputRootScope: { source: 'event', path: ['payload', 'outputRootScope'] },
  allowedOperation: { source: 'event', path: ['payload', 'allowedOperation'] },
  selection: { source: 'event', path: ['payload', 'selection'] },
  caller: { source: 'event', path: ['payload', 'caller'] },
  digestAnchor: { source: 'event', path: ['payload', 'digestAnchor'] },
};

function makeDefinition() {
  return {
    workflowKey: 's4-hls-vod',
    initialState: 'requested',
    initialContext: {},
    states: [
      {
        stateKey: 'requested',
        transitions: [
          {
            transitionKey: 'acquire',
            trigger: { kind: 'event', eventType: 'S4_HLS_VOD_CONFIRMED' },
            targetState: 'acquired',
            effectIntents: [
              {
                effectType: 'effect:acquire',
                inputFrom: PROJECTION,
                idempotencyKeyFrom: { template: 's4-hls-vod:{requestId}' },
              },
            ],
          },
          {
            transitionKey: 'refuse',
            trigger: { kind: 'event', eventType: 'S4_HLS_VOD_CONFIRMED' },
            targetState: 'refused',
          },
        ],
      },
      { stateKey: 'acquired', kind: 'final' },
      { stateKey: 'refused', kind: 'final' },
    ],
  };
}

const decisionSchema = {
  isValid(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const decision = value.decision;
    const event = value.event;
    if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) return false;
    if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
    return typeof decision.outcome === 'string' && typeof event.type === 'string';
  },
};

export function getPolicy() {
  return {
    packageId: MODULE_ID,
    policyId: 's4-hls-vod',
    domainId: 'downloads',
    workflowDefinition: makeDefinition(),
    decisionSchema,
    governanceSemantics: { hardInvariants: [] },
    initialStateKey: 'requested',
    initialContext: {},
    rules: {
      'rule:s4-hls-vod-confirmed': {
        ruleId: 'rule:s4-hls-vod-confirmed',
        eventType: 'S4_HLS_VOD_CONFIRMED',
        payloadFromInput: {
          requestId: 'requestId',
          lineageId: 'lineageId',
          contractId: 'contractId',
          targetRef: 'targetRef',
          outputRootScope: 'outputRootScope',
          allowedOperation: 'allowedOperation',
          selection: 'selection',
          caller: 'caller',
          digestAnchor: 'digestAnchor',
        },
      },
    },
    intentBindings: {
      confirmDownload: {
        trigger: { kind: 'event', eventType: 'S4_HLS_VOD_CONFIRMED' },
        ruleId: 'rule:s4-hls-vod-confirmed',
        roles: ['requester'],
      },
    },
    effectBindings: {
      'effect:acquire': {
        semantics: 'non-idempotent',
        resource: { key: 'media', operation: 'media.acquire' },
        external: { permitTtlMs: 60_000, await: 'terminal' },
        handler: async ({ input, effectId, resources }) => {
          if (resources === undefined) {
            throw new Error('S4 HLS requires the Host media resource port');
          }
          return resources.call('media', 'media.acquire', { ...input, effectId });
        },
      },
    },
  };
}
