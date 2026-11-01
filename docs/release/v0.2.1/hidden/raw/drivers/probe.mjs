import { rawPipeSync } from './rawpipe.mjs';
const env = {
  schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
  kind: 'query', queryType: 'READ_PROJECTION',
  peer: { installId: 't19h', userId: '15549', surface: 'CLI' },
  requestId: 'req-probe-1', aggregateId: 'contract-none',
  issuedAt: new Date().toISOString(),
};
try {
  const r = rawPipeSync(String.raw`\\.\pipe\xdownload-core-t19h`, JSON.stringify(env));
  console.log('RESPONSE', JSON.stringify(r).slice(0, 500));
} catch (e) { console.log('ERR', e.message); }
