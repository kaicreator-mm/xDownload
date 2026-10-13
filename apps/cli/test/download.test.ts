/**
 * #101 first slice — CLI `download` presentation over the S1 execution
 * command. The harness composes the REAL seam server (with a Core-stand-in
 * beginner stub) + loopback transports + the real seam client; the CLI
 * builds the canonical S1 contract itself (no hand-authored JSON), submits
 * it, issues EXECUTE_S1_DIRECT_ACQUISITION and renders the Core-derived
 * terminal. Acceptance of either command is never rendered as success.
 */

import { describe, expect, it } from 'vitest';
import type { CoreSeamServer, S1DirectAcquisitionBeginner } from '@xdownload/core-seam';
import { currentSchemaIdentity } from '@xdownload/domain-contracts';
import { runCli, startSeam, type RunningSeam } from './helpers.ts';

/** Core-stand-in terminal the beginner records on behalf of the driver. */
function s1Terminal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: currentSchemaIdentity(),
    contractId: 'unused',
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
    recordedAt: '2026-10-14T00:00:00Z',
    ...overrides,
  };
}

/** A beginner stub that records the given terminal as the Core-derived one. */
function terminalRecordingBeginner(
  holder: { server?: CoreSeamServer },
  terminal: (input: { aggregateId: string }) => Record<string, unknown>,
): S1DirectAcquisitionBeginner {
  return {
    begin: (input) => {
      holder.server?.recordExecutedTerminal(input.aggregateId, terminal(input) as never);
    },
  };
}

function trackedBeginner(
  holder: { server?: CoreSeamServer },
  calls: { aggregateId: string; payload: unknown }[],
): S1DirectAcquisitionBeginner {
  return {
    begin: (input) => {
      calls.push({ aggregateId: input.aggregateId, payload: input.payload });
    },
  };
}

function wire(server: CoreSeamServer, holder: { server?: CoreSeamServer }): void {
  holder.server = server;
}

const URL = 'http://127.0.0.1:9/file.bin';
const DIGEST = 'ab'.repeat(32);

describe('CLI download (S1 presentation)', () => {
  it('downloads through the seam and renders the Core-derived COMPLETE terminal', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: terminalRecordingBeginner(holder, () => s1Terminal()),
    });
    wire(seam.server, holder);

    const run = await runCli(
      ['download', '--url', URL, '--sha256', DIGEST, '--timeout-ms', '2000', '--poll-ms', '25'],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.status');
    expect(String(json['contract_id'])).toMatch(/^contract-s1-/);
    expect(json['lineage_status']).toBe('TERMINAL');
    expect(json['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['StopReason']).toBe('NONE');
  });

  it('a Core-derived FAILED terminal exits non-success (acceptance never equals success)', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: terminalRecordingBeginner(holder, () =>
        s1Terminal({
          requestFulfillment: 'FAILED',
          selectionAcquisition: 'NONE',
          stopReason: 'VALIDATION_FAILURE',
          validationSummary: { status: 'FAILED', passedCount: 1, failedCount: 2 },
        }),
      ),
    });
    wire(seam.server, holder);

    const run = await runCli(
      ['download', '--url', URL, '--sha256', DIGEST, '--timeout-ms', '2000', '--poll-ms', '25'],
      seam.target,
    );
    expect(run.exitCode).toBe(4);
    const json = run.json as Record<string, unknown>;
    expect(json['RequestFulfillmentStatus']).toBe('FAILED');
    expect(json['lineage_status']).toBe('TERMINAL');
  });

  it('delivery facts are presented verbatim: content-type, total bytes, extra redirect hosts', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const calls: { aggregateId: string; payload: unknown }[] = [];
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: {
        begin: (input) => {
          calls.push({ aggregateId: input.aggregateId, payload: input.payload });
          holder.server?.recordExecutedTerminal(input.aggregateId, s1Terminal() as never);
        },
      },
    });
    wire(seam.server, holder);

    const run = await runCli(
      [
        'download',
        '--url',
        URL,
        '--sha256',
        DIGEST,
        '--content-type-prefix',
        'application/octet-stream',
        '--total-bytes',
        '42',
        '--redirect-host',
        'cdn.example',
        '--timeout-ms',
        '2000',
        '--poll-ms',
        '25',
      ],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const payload = calls[0]!.payload as {
      snapshotId: string;
      memberId: string;
      artifactId: string;
      delivery: {
        locatorUri: string;
        declaredRedirectHosts: string[];
        expectedSha256: string;
        expectedContentTypePrefix: string;
        expectedTotalBytes: number;
      };
    };
    expect(payload.delivery.locatorUri).toBe(URL);
    expect(payload.delivery.expectedSha256).toBe(DIGEST);
    expect(payload.delivery.expectedContentTypePrefix).toBe('application/octet-stream');
    expect(payload.delivery.expectedTotalBytes).toBe(42);
    expect(payload.delivery.declaredRedirectHosts).toStrictEqual(['127.0.0.1:9', 'cdn.example']);
    expect(payload.snapshotId).toMatch(/^s1snap-/);
    expect(payload.memberId).toMatch(/^s1member-/);
    expect(payload.artifactId).toMatch(/^s1artifact-/);
  });

  it('fails closed when the Core composition provides no S1 driver', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(['download', '--url', URL, '--sha256', DIGEST], seam.target);
    expect(run.exitCode).toBe(2);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.rejection');
    expect(json['diagnostics']).toBeDefined();
  });

  it('a bounded wait that elapses without a terminal never invents one', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const calls: { aggregateId: string; payload: unknown }[] = [];
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: trackedBeginner(holder, calls),
    });
    wire(seam.server, holder);

    const run = await runCli(
      ['download', '--url', URL, '--sha256', DIGEST, '--timeout-ms', '150', '--poll-ms', '25'],
      seam.target,
    );
    expect(run.exitCode).toBe(6);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.wait-timeout');
    // The Core accepted the work item; nothing about the timeout asserts a result.
    expect(calls).toHaveLength(1);
  });

  it('typed usage errors reject before any envelope is built', async () => {
    const seam: RunningSeam = await startSeam();
    const badSha = await runCli(['download', '--url', URL, '--sha256', 'nope'], seam.target);
    expect(badSha.exitCode).toBe(1);
    const badUrl = await runCli(
      ['download', '--url', 'ftp://example/file', '--sha256', DIGEST],
      seam.target,
    );
    expect(badUrl.exitCode).toBe(1);
  });

  it('an ordinary download needs no --sha256 (#101 R1/F01): the payload omits the field', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const calls: { aggregateId: string; payload: unknown }[] = [];
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: {
        begin: (input) => {
          calls.push({ aggregateId: input.aggregateId, payload: input.payload });
          holder.server?.recordExecutedTerminal(input.aggregateId, s1Terminal() as never);
        },
      },
    });
    wire(seam.server, holder);

    const run = await runCli(
      ['download', '--url', URL, '--timeout-ms', '2000', '--poll-ms', '25'],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const delivery = (calls[0]!.payload as { delivery: Record<string, unknown> }).delivery;
    // The omitted digest is presented as an omitted field (the seam's closed
    // payload gate rejects nothing else; C34 provenance basis is Core-side).
    expect('expectedSha256' in delivery).toBe(false);
    expect(delivery['locatorUri']).toBe(URL);
  });

  it('each invocation mints a fresh acquisition identity (immutable completed truth)', async () => {
    const holder: { server?: CoreSeamServer } = {};
    const calls: { aggregateId: string; payload: unknown }[] = [];
    const seam: RunningSeam = await startSeam(undefined, {
      s1Beginner: {
        begin: (input) => {
          calls.push({ aggregateId: input.aggregateId, payload: input.payload });
          holder.server?.recordExecutedTerminal(input.aggregateId, s1Terminal() as never);
        },
      },
    });
    wire(seam.server, holder);

    const flags = ['--url', URL, '--sha256', DIGEST, '--timeout-ms', '2000', '--poll-ms', '25'];
    const first = await runCli(['download', ...flags], seam.target);
    expect(first.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const second = await runCli(['download', ...flags], seam.target);
    expect(second.exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.aggregateId).not.toBe(calls[0]!.aggregateId);
  });
});
