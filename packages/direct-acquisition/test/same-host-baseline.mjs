/**
 * Same-host direct-transfer baseline for T03.
 * Runs the same loopback payload through the public DirectHttpAdapter API.
 * The Woodpecker carrier runs this exact script once on the T01 base and once
 * on the T03 candidate, on the same Node process host and local fixture.
 */
import { performance } from 'node:perf_hooks';

import { DirectHttpAdapter } from '../src/index.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { directRequest, payload, transferProfile } from './helpers/fixtures.ts';

const PAYLOAD_BYTES = 8 * 1024 * 1024;
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const label = process.env.XD_BASELINE_LABEL ?? 'candidate';
  const body = payload(PAYLOAD_BYTES, 23);
  const fixture = new ControlledHttpFixture();
  const baseUri = await fixture.start();
  fixture.serveFile('/same-host-baseline.bin', {
    body,
    etag: '"xdownload-v021-same-host-baseline"',
  });

  const samplesMs = [];
  try {
    for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
      const ledger = new InMemoryAuthoritativeLedger(
        transferProfile({ maxBytes: PAYLOAD_BYTES * 2 }),
      );
      const adapter = new DirectHttpAdapter(ledger);
      const startedAt = performance.now();
      const result = await adapter.acquire(
        directRequest(baseUri, '/same-host-baseline.bin', body, {
          effectId: `xd-t03-${label}-${run}`,
          contractId: `xd-t03-${label}-${run}`,
          targetId: `xd-t03-target-${run}`,
          expectedTotalBytes: PAYLOAD_BYTES,
        }),
      );
      const elapsedMs = performance.now() - startedAt;
      if (!result.ok) {
        throw new Error(`same-host baseline acquisition was refused: ${result.diagnostics.map((entry) => entry.code).join(',')}`);
      }
      if (
        result.value.bytes?.byteLength !== PAYLOAD_BYTES ||
        result.value.allApplicableValidationPassed !== true ||
        result.value.terminalResult.validationSummary.status !== 'PASSED'
      ) {
        throw new Error('same-host baseline did not produce a fully validated complete transfer');
      }
      if (run >= WARMUP_RUNS) samplesMs.push(elapsedMs);
    }
  } finally {
    await fixture.stop();
  }

  const medianMs = median(samplesMs);
  const medianMiBPerSecond = PAYLOAD_BYTES / (medianMs / 1_000) / (1024 * 1024);
  const record = {
    record: 'SAME_HOST_DIRECT_TRANSFER_BASELINE',
    label,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fixture: '127.0.0.1 controlled HTTP, one fixed 8 MiB payload, SHA-256 target validation',
    warmupRuns: WARMUP_RUNS,
    measuredRuns: MEASURED_RUNS,
    payloadBytes: PAYLOAD_BYTES,
    sampleMs: samplesMs.map((value) => Number(value.toFixed(3))),
    medianMs: Number(medianMs.toFixed(3)),
    medianMiBPerSecond: Number(medianMiBPerSecond.toFixed(3)),
    requestCount: fixture.requests.length,
    validation: 'PASSED',
  };
  process.stdout.write(`SAME_HOST_DIRECT_TRANSFER_BASELINE ${JSON.stringify(record)}\\n`);
}

main().catch((error) => {
  process.stderr.write(`SAME_HOST_DIRECT_TRANSFER_BASELINE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\\n`);
  process.exitCode = 1;
});
