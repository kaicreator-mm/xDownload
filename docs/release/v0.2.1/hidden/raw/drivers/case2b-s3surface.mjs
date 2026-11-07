import { rawPipeRequest, peer, logRun } from './lib.mjs';
const payload = {
  snapshotId: 'snap-s3x', memberId: 'mem-s3x', variantKey: 'v1',
  locatorUri: 'https://media.example.com/media/clip1.mp4',
  declaredRedirectHosts: ['cdn.example.com'], mediaProfileId: 'profile-a',
};
async function go(label, surface) {
  const env = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
    kind: 'command', commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
    peer: peer({ surface }), requestId: `req-${label}`, aggregateId: 'contract-none-s3',
    expectedRevision: 0, correlation: {}, issuedAt: new Date().toISOString(),
    payload,
  };
  try {
    const r = await rawPipeRequest(env, { timeoutMs: 15000 });
    const d = r?.diagnostics?.[0];
    logRun({ event: 'case2b', label, outcome: r?.outcome, code: d?.code ?? null });
    console.log(JSON.stringify({ label, outcome: r?.outcome, code: d?.code ?? null, message: (d?.message ?? '').slice(0, 140) }));
  } catch (e) { console.log(JSON.stringify({ label, outcome: 'ERROR', message: e.message.slice(0, 140) })); }
}
await go('s3-cli-surface', 'CLI');
await go('s3-desktop-surface', 'DESKTOP_UI');
await go('s3-browser-surface', 'BROWSER_EXTENSION');
process.exit(0);
