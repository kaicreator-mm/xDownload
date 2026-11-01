// Case 5 — duplicate / concurrent submission idempotency matrix.
// Legacy seam (SUBMIT_CONTRACT) + v0.2 route (DOMAIN_APP_SEND), raw-pipe
// forged envelopes, concurrent same-requestId and same-lineage races.
import { rawPipeRequest, peer, logRun, sleep } from './lib.mjs';

function legacySubmit(requestId, contractId, extra = {}) {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', commandType: 'SUBMIT_CONTRACT',
    peer: peer(), requestId, aggregateId: contractId,
    expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
    payload: {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId, status: 'CONFIRMED', intentType: 'SINGLE_RESOURCE',
      requestedTarget: `target-${contractId}`, requestedScope: { kind: 'single_resource', targetId: `target-${contractId}` },
      continuationScope: { kind: 'NONE' }, selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
      automationMode: 'AUTO', explorationPermission: 'NONE',
      budgetProfile: { discovery: { domain: 'discovery' }, transfer: { domain: 'transfer', maxBytes: 1048576, maxSegments: 100, maxActiveTransferMs: 600000, maxRetryTransferRequests: 3 }, globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 50, maxActiveElapsedMs: 3600000 } },
      authorizationContextRef: 'authctx/t19h', validationPolicy: { requiredLayers: ['target', 'transfer'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' }, resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: new Date().toISOString(),
      ...extra,
    },
  };
}

function s4Intent(requestId, lineageId, targetRef = 'tok-c5') {
  const now = Date.now();
  return {
    requestId, lineageId, contractId: `contract-${lineageId}`, targetRef,
    outputRootScope: 'C:\\xDev\\kAiCreator\\_tmp\\v021\\t19final\\case1-authorized',
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: `sel-${lineageId}`, previewId: `prev-${lineageId}`,
      snapshotId: `snap-${lineageId}`, memberId: `mem-${lineageId}`,
      manifestUri: 'http://127.0.0.1:49651/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1', renditionKey: 'rend-1',
      renditionUri: 'http://127.0.0.1:49651/rend.m3u8',
      displayedTupleDigest: 'c'.repeat(64),
      confirmedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
    },
    caller: { actor: 't19h-attacker', sessionRef: 't19h-session' },
  };
}
function v02SendEnvelope(requestId, lineageId, targetRef) {
  const intent = s4Intent(requestId, lineageId, targetRef);
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', route: 'v0.2', commandType: 'DOMAIN_APP_SEND',
    peer: peer(), requestId, aggregateId: lineageId,
    issuedAt: new Date().toISOString(), payload: { intent },
  };
}

async function go(label, env) {
  try {
    const r = await rawPipeRequest(env, { timeoutMs: 15000 });
    const d = r?.diagnostics?.[0];
    logRun({ event: 'case5', label, outcome: r?.outcome, code: d?.code ?? null, converged: r?.acceptance?.converged ?? null, revision: r?.acceptance?.revision ?? null });
    console.log(JSON.stringify({ label, outcome: r?.outcome, code: d?.code ?? null, message: (d?.message ?? '').slice(0, 130), converged: r?.acceptance?.converged ?? null, revision: r?.acceptance?.revision ?? null }));
    return r;
  } catch (e) {
    logRun({ event: 'case5', label, outcome: 'ERROR', message: e.message.slice(0, 130) });
    console.log(JSON.stringify({ label, outcome: 'ERROR', message: e.message.slice(0, 130) }));
    return null;
  }
}

// ---- Legacy lane ----
const contractA = 'contract-c5-a';
await go('legacy-first-submit', legacySubmit('req-c5-1', contractA));
await go('legacy-same-requestid-replay', legacySubmit('req-c5-1', contractA)); // identical: converge
await go('legacy-same-requestid-conflict', legacySubmit('req-c5-1', 'contract-c5-b')); // same id, different aggregate/payload
await go('legacy-second-requestid-same-lineage', legacySubmit('req-c5-2', contractA)); // new id, existing lineage, expectedRevision 0
// Concurrent same-requestId race: both in flight at once.
const [r1, r2] = await Promise.all([
  go('legacy-concurrent-same-id-A', legacySubmit('req-c5-race', 'contract-c5-race')),
  go('legacy-concurrent-same-id-B', legacySubmit('req-c5-race', 'contract-c5-race')),
]);
void r1; void r2;

// ---- v0.2 lane ----
await go('v02-first-send', v02SendEnvelope('req-c5-v1', 'lin-c5-v1'));
await go('v02-same-requestid-replay', v02SendEnvelope('req-c5-v1', 'lin-c5-v1'));
await go('v02-same-requestid-different-lineage', v02SendEnvelope('req-c5-v1', 'lin-c5-vX'));
await go('v02-second-requestid-same-lineage', v02SendEnvelope('req-c5-v2', 'lin-c5-v1'));
const [v1, v2] = await Promise.all([
  go('v02-concurrent-same-id-A', v02SendEnvelope('req-c5-vrace', 'lin-c5-vrace')),
  go('v02-concurrent-same-id-B', v02SendEnvelope('req-c5-vrace', 'lin-c5-vrace')),
]);
void v1; void v2;
await sleep(1500);
process.exit(0);
