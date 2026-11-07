import { rawPipeRequest, peer } from './lib.mjs';
for (const lineage of ['lin-c5-v1', 'lin-c5-vX']) {
  try {
    const r = await rawPipeRequest({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
      kind: 'query', route: 'v0.2', queryType: 'READ_JOB_PROJECTION',
      peer: peer(), requestId: `req-proj-${lineage}`, aggregateId: lineage,
      issuedAt: new Date().toISOString(),
    }, { timeoutMs: 15000 });
    const p = r?.projection;
    console.log(JSON.stringify({ lineage, outcome: r?.outcome, status: p?.status, attempts: p?.attempts?.length, attemptIds: p?.attempts?.map(a => a.attemptId) }));
  } catch (e) { console.log(JSON.stringify({ lineage, outcome: 'ERROR', message: e.message.slice(0, 120) })); }
}
process.exit(0);
