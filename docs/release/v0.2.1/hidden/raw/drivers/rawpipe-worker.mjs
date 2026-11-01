// Worker thread: synchronous raw pipe request (fenced by the caller's timeout).
import { parentPort, workerData } from 'node:worker_threads';
import { rawPipeSync } from './rawpipe.mjs';

try {
  const value = rawPipeSync(workerData.pipeName, workerData.envelopeJson);
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
