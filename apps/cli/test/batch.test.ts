/**
 * TEST_MATRIX suite `batch-input`: multiple targets submit in one invocation
 * with per-item identity/correlation preserved; per-item failures are
 * reported per item without merging or cross-promoting results; batch
 * handling cannot enlarge requested scope or add continuation authority
 * through defaults.
 */

import { describe, expect, it } from 'vitest';
import {
  harnessClient,
  rawCommand,
  runCli,
  singleResourceContract,
  startSeam,
  type RunningSeam,
} from './helpers.ts';

function batchLine(contractId: string): string {
  return JSON.stringify(singleResourceContract({ contractId }));
}

describe('batch input', () => {
  it('submits multiple requests with per-item identity/correlation preserved', async () => {
    const seam: RunningSeam = await startSeam();
    const stdin = ['contract-batch-001', 'contract-batch-002'].map(batchLine).join('\n');
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-b'], seam.target, {
      stdinText: stdin,
    });
    expect(run.exitCode).toBe(0);
    const json = run.json as {
      document: string;
      accepted_count: number;
      rejected_count: number;
      input_error_count: number;
      items: {
        index: number;
        contract_id: string | null;
        outcome: string;
        request_id: string | null;
        needs_user_action: boolean | null;
      }[];
    };
    expect(json['document']).toBe('xdownload.cli.batch-result');
    expect(json['accepted_count']).toBe(2);
    expect(json['items']).toHaveLength(2);
    expect(json['items'][0]).toMatchObject({
      index: 0,
      contract_id: 'contract-batch-001',
      outcome: 'ACCEPTED',
      request_id: 'req-b-0',
    });
    expect(json['items'][1]).toMatchObject({
      index: 1,
      contract_id: 'contract-batch-002',
      outcome: 'ACCEPTED',
      request_id: 'req-b-1',
    });
  });

  it('per-item input failure is isolated: valid items still submit, exit is 1', async () => {
    const seam: RunningSeam = await startSeam();
    const stdin = [batchLine('contract-batch-ok'), '{"broken":'].join('\n');
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-b'], seam.target, {
      stdinText: stdin,
    });
    expect(run.exitCode).toBe(1);
    const json = run.json as {
      accepted_count: number;
      input_error_count: number;
      items: { outcome: string; input_error: { kind: string } | null }[];
    };
    expect(json['accepted_count']).toBe(1);
    expect(json['input_error_count']).toBe(1);
    expect(json['items'][1]?.['outcome']).toBe('INPUT_ERROR');
    expect(json['items'][1]?.['input_error']?.['kind']).toBe('USAGE');
  });

  it('per-item seam rejection is isolated and reported verbatim without merging', async () => {
    const seam: RunningSeam = await startSeam();
    // The same contract identity twice: the second is a duplicate allocation.
    const line = batchLine('contract-batch-dup');
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-b'], seam.target, {
      stdinText: [line, line].join('\n'),
    });
    expect(run.exitCode).toBe(2);
    const json = run.json as {
      accepted_count: number;
      rejected_count: number;
      items: {
        outcome: string;
        diagnostics: { code: string }[] | null;
      }[];
    };
    expect(json['accepted_count']).toBe(1);
    expect(json['rejected_count']).toBe(1);
    expect(json['items'][0]?.['outcome']).toBe('ACCEPTED');
    expect(json['items'][1]?.['outcome']).toBe('REJECTED');
    // The second submission carries expectedRevision 0 against a now-existing
    // aggregate: the seam's revision gate rejects before the allocation gate.
    // The typed rejection is projected per item, verbatim, without merging.
    expect(json['items'][1]?.['diagnostics']?.[0]?.['code']).toBe('REVISION_MISMATCH');
  });

  it('batch passes payloads through unchanged: digest equality via idempotent convergence', async () => {
    const seam: RunningSeam = await startSeam();
    const payload = singleResourceContract({ contractId: 'contract-batch-passthrough' });
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-p'], seam.target, {
      stdinText: JSON.stringify(payload),
    });
    expect(run.exitCode).toBe(0);
    // Resubmit the ORIGINAL input payload under the SAME idempotent identity
    // the CLI used for item 0. Acceptance with converged:true proves the
    // payload digest is identical — the CLI added and changed nothing.
    const replay = await rawCommand(harnessClient(seam.target), {
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-batch-passthrough',
      payload,
      requestId: 'req-p-0',
    });
    expect(replay.outcome).toBe('ACCEPTED');
    expect(replay.acceptance?.converged).toBe(true);
  });

  it('an oversized batch item respects the declared SEAM_MESSAGE_LIMITS as a typed error', async () => {
    const seam: RunningSeam = await startSeam();
    // 10000 unique maximal-length member ids: canonical payload well over the
    // declared 768 KiB payload bound, under the array bound.
    const memberIds: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const suffix = String(i).padStart(7, '0');
      memberIds.push(`m${'a'.repeat(120 - suffix.length)}${suffix}`);
    }
    const oversized = singleResourceContract({
      contractId: 'contract-batch-oversized',
      intentType: 'COLLECTION',
      collectionIdentity: 'collection/big-001',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: { kind: 'explicit_member_set', memberIds },
      explorationPermission: 'NONE',
    });
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-big'], seam.target, {
      stdinText: JSON.stringify(oversized),
    });
    expect(run.exitCode).toBe(1);
    const json = run.json as {
      items: { outcome: string; input_error: { kind: string; message: string } | null }[];
    };
    expect(json['items'][0]?.['outcome']).toBe('INPUT_ERROR');
    expect(json['items'][0]?.['input_error']?.['kind']).toBe('PAYLOAD_TOO_LARGE');
    expect(json['items'][0]?.['input_error']?.['message']).toContain('786432');
  });
});
