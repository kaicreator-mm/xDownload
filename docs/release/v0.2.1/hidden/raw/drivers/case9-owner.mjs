// Case 9 — lineage-owner conflicts between the legacy (v0.1) partition and
// the v0.2 Domain App partition, both directions.
import { rawPipeRequest, peer, logRun } from './lib.mjs';

function legacySubmit(aggregateId, requestId) {
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', commandType: 'SUBMIT_CONTRACT',
    peer: peer(), requestId, aggregateId,
    expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
    payload: {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId: aggregateId, status: 'CONFIRMED', intentType: 'SINGLE_RESOURCE',
      requestedTarget: `target-${aggregateId}`, requestedScope: { kind: 'single_resource', targetId: `target-${aggregateId}` },
      continuationScope: { kind: 'NONE' }, selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
      automationMode: 'AUTO', explorationPermission: 'NONE',
      budgetProfile: { discovery: { domain: 'discovery' }, transfer: { domain: 'transfer', maxBytes: 1048576, maxSegments: 100, maxActiveTransferMs: 600000, maxRetryTransferRequests: 3 }, globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 50, maxActiveElapsedMs: 3600000 } },
      authorizationContextRef: 'authctx/t19h', validationPolicy: { requiredLayers: ['target', 'transfer'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' }, resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: new Date().toISOString(),
    },
  };
}

function v02Send(lineageId, requestId) {
  const now = Date.now();
  const intent = {
    requestId, lineageId, contractId: `contract-${lineageId}`, targetRef: 'tok-c9',
    outputRootScope: 'C:\\xDev\\kAiCreator\\_tmp\\v021\\t19final\\case1-authorized',
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: `sel-${lineageId}`, previewId: `prev-${lineageId}`,
      snapshotId: `snap-${lineageId}`, memberId: `mem-${lineageId}`,
      manifestUri: 'http://127.0.0.1:49651/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1', renditionKey: 'rend-1',
      renditionUri: 'http://127.0.0.1:49651/rend.m3u8',
      displayedTupleDigest: 'e'.repeat(64),
      confirmedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
    },
    caller: { actor: 't19h-attacker', sessionRef: 't19h-session' },
  };
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
    logRun({ event: 'case9', label, outcome: r?.outcome, code: d?.code ?? null });
    console.log(JSON.stringify({ label, outcome: r?.outcome, code: d?.code ?? null, message: (d?.message ?? '').slice(0, 150) }));
  } catch (e) {
    console.log(JSON.stringify({ label, outcome: 'ERROR', message: e.message.slice(0, 150) }));
  }
}

// lin-c5-v1 was durably CLAIMED by the v0.2 K partition in case 5.
await go('legacy-command-into-k-owned-lineage', legacySubmit('lin-c5-v1', 'req-c9a'));
// contract-s1-4e7dd081-9046-48 is a COMPLETE legacy-owned lineage.
await go('v02-send-into-legacy-owned-lineage', v02Send('contract-s1-4e7dd081-9046-48', 'req-c9b'));
// v0.2 lineage that FAILED earlier (lin-1base, K-owned terminal FAILED):
// a legacy command must still be refused (owner facts survive terminal truth).
await go('legacy-command-into-k-owned-failed-lineage', legacySubmit('lin-1base', 'req-c9c'));
// Sanity: a FRESH lineage on each side still works (no cross-contamination).
await go('v02-fresh-lineage-still-admitted', v02Send('lin-c9-fresh', 'req-c9d'));
process.exit(0);
