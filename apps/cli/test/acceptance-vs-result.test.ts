/**
 * TEST_MATRIX suite `acceptance-vs-final-result`: submit acceptance
 * (ACCEPTED with requestId/revision/converged) is exposed separately from
 * the final acquisition result; submit exit success does not imply final
 * task success; wait-mode final exit reflects the final request/selection
 * result.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  harnessClient,
  projectTerminal,
  rawCommand,
  runCli,
  singleResourceContract,
  startSeam,
  terminalPayload,
  type RunningSeam,
} from './helpers.ts';

const TIMEOUT_FLAGS = ['--wait', '--timeout-ms', '4000', '--poll-ms', '20'];

describe('acceptance vs final result separation', () => {
  it('submit-success followed by a terminal non-success: acceptance accepted, final exit is 4', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([['contract.json', JSON.stringify(singleResourceContract())]]);
    const runPromise = runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-acc-001', ...TIMEOUT_FLAGS],
      seam.target,
      { files },
    );
    // As soon as the CLI's submit is accepted (aggregate exists), the Core
    // runtime lane projects a terminal non-success while the CLI is waiting.
    await vi.waitFor(() => {
      expect(seam.server.inspectProjection('contract-single-001')).toBeDefined();
    });
    const client = harnessClient(seam.target);
    await projectTerminal(
      client,
      'contract-single-001',
      1,
      terminalPayload({
        contractId: 'contract-single-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'VALIDATION_FAILED',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    );
    const run = await runPromise;
    expect(run.exitCode).toBe(4);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.status');
    expect(json['SelectionAcquisitionStatus']).toBe('FAILED');
    expect(json['RequestFulfillmentStatus']).toBe('UNSATISFIED');
  });

  it('the same submit produces an acceptance record and a distinct terminal record', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([['contract.json', JSON.stringify(singleResourceContract())]]);
    const accepted = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-acc-002'],
      seam.target,
      { files },
    );
    expect(accepted.exitCode).toBe(0);
    const acceptance = accepted.json as Record<string, unknown>;
    expect(acceptance['document']).toBe('xdownload.cli.acceptance');
    expect(acceptance['outcome']).toBe('ACCEPTED');
    expect(acceptance['revision']).toBe(1);
    expect(acceptance['converged']).toBe(false);
    // Acceptance is observable while no terminal truth exists yet.
    const preTerminal = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect((preTerminal.json as Record<string, unknown>)['RequestFulfillmentStatus']).toBe(null);
    // The final acquisition result is a distinct, independently observable record.
    const client = harnessClient(seam.target);
    await projectTerminal(
      client,
      'contract-single-001',
      1,
      terminalPayload({
        contractId: 'contract-single-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'VALIDATION_FAILED',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    );
    const final = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect((final.json as Record<string, unknown>)['SelectionAcquisitionStatus']).toBe('FAILED');
    expect(final.json).not.toEqual(acceptance);
  });

  it('wait-mode final exit is 0 only when the projected request AND acquisition are COMPLETE', async () => {
    const seam: RunningSeam = await startSeam();
    const contract = singleResourceContract({ contractId: 'contract-single-success' });
    // Harness pre-accepts the exact contract under the id the CLI will reuse.
    const seeded = await rawCommand(harnessClient(seam.target), {
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-success',
      payload: contract,
      requestId: 'req-acc-003',
    });
    expect(seeded.outcome).toBe('ACCEPTED');
    const client = harnessClient(seam.target);
    await projectTerminal(
      client,
      'contract-single-success',
      1,
      terminalPayload({
        contractId: 'contract-single-success',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'NONE',
        passedCount: 1,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
      }),
    );
    // The CLI resubmits the SAME idempotent identity with the SAME payload;
    // the seam converges the duplicate and wait observes the success tuple.
    const files = new Map([['contract.json', JSON.stringify(contract)]]);
    const run = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-acc-003', ...TIMEOUT_FLAGS],
      seam.target,
      { files },
    );
    expect(run.exitCode).toBe(0);
    const json = run.json as Record<string, unknown>;
    expect(json['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
  });

  it('submit acceptance never claims the final task succeeded', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(['submit', '--file', 'contract.json'], seam.target, {
      files: new Map([['contract.json', JSON.stringify(singleResourceContract())]]),
    });
    expect(run.exitCode).toBe(0);
    const json = run.json as Record<string, unknown>;
    expect(json['note']).toBe('submit acceptance is not final acquisition success');
    expect(json['outcome']).toBe('ACCEPTED');
    expect(json).not.toHaveProperty('RequestFulfillmentStatus');
  });
});
