/**
 * TEST_MATRIX suite `cancel-retry-routing`: cancellation routes as
 * CANCEL_LINEAGE through the same Core transition Desktop/Browser use; retry
 * routes as RETRY_FAILED_MEMBERS and cannot add members; duplicate/reconnect
 * resubmission reuses the SAME idempotent requestId and converges.
 */

import { describe, expect, it } from 'vitest';
import {
  harnessClient,
  runCli,
  setupContract,
  singleResourceContract,
  startSeam,
  type RunningSeam,
} from './helpers.ts';

describe('cancel routing', () => {
  it('cancel routes CANCEL_LINEAGE through the seam and the projection shows it', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const run = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-cancel-001',
      ],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.acceptance');
    expect(json['command']).toBe('cancel');
    expect(json['revision']).toBe(2);
    const status = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect((status.json as Record<string, unknown>)['lineage_status']).toBe('CANCELLED');
  });

  it('duplicate cancel with the SAME requestId converges instead of double-applying', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const first = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-cancel-dup',
      ],
      seam.target,
    );
    expect(first.exitCode).toBe(0);
    expect((first.json as Record<string, unknown>)['converged']).toBe(false);
    // Replay with a stale revision still converges: the idempotency gate runs
    // before the revision gate and replays the original acceptance.
    const replay = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-cancel-dup',
      ],
      seam.target,
    );
    expect(replay.exitCode).toBe(0);
    expect((replay.json as Record<string, unknown>)['converged']).toBe(true);
    expect((replay.json as Record<string, unknown>)['revision']).toBe(2);
  });

  it('a second CLI client cancels through the same Core order with no local precedence', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const first = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-cancel-a',
      ],
      seam.target,
    );
    expect(first.exitCode).toBe(0);
    // A second concurrent client canceling again is a no-op on the SAME Core
    // order (revision unchanged) — no surface-local precedence exists.
    const second = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '2',
        '--request-id',
        'req-cancel-b',
      ],
      seam.target,
    );
    expect(second.exitCode).toBe(0);
    expect((second.json as Record<string, unknown>)['revision']).toBe(2);
  });

  it('cancel of a foreign/unknown aggregate routes the seam rejection verbatim (never success)', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(
      ['cancel', '--contract', 'contract-unknown-999', '--expected-revision', '0'],
      seam.target,
    );
    expect(run.exitCode).toBe(2);
    const json = run.json as { document: string; outcome: string; diagnostics: { code: string }[] };
    expect(json['outcome']).toBe('REJECTED');
    expect(json['diagnostics'][0]?.['code']).toBe('AGGREGATE_NOT_FOUND');
  });

  it('a non-admitted install/user identity is projected, not masked', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(
      [
        'cancel',
        '--contract',
        'contract-single-001',
        '--expected-revision',
        '1',
        '--install-id',
        'install-999',
        '--user-id',
        'user-999',
      ],
      seam.target,
    );
    expect(run.exitCode).toBe(2);
    const json = run.json as { diagnostics: { code: string }[] };
    expect(json['diagnostics'][0]?.['code']).toBe('PEER_IDENTITY_REJECTED');
  });
});

describe('retry routing', () => {
  it('retry routes explicit failed members as RETRY_FAILED_MEMBERS and reflects the Core-accepted scope', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract({ contractId: 'contract-retry-001' }));
    // Core-internal runtime fact recording (never a surface command): the
    // failed-member authority domain for the lineage.
    const recorded = seam.server.recordFailedMembers('contract-retry-001', [
      'member-001',
      'member-002',
    ]);
    expect(recorded.ok).toBe(true);
    const run = await runCli(
      [
        'retry',
        '--contract',
        'contract-retry-001',
        '--expected-revision',
        '1',
        '--members',
        'member-001',
        '--request-id',
        'req-retry-001',
      ],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    expect((run.json as Record<string, unknown>)['command']).toBe('retry');
    const status = await runCli(['status', '--contract', 'contract-retry-001'], seam.target);
    const json = status.json as { retried_member_ids: string[]; failed_member_count: number };
    expect(json['retried_member_ids']).toStrictEqual(['member-001']);
    expect(json['failed_member_count']).toBe(2);
  });

  it('retry of members outside the Core failed-member domain projects the typed rejection (C12)', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract({ contractId: 'contract-retry-002' }));
    seam.server.recordFailedMembers('contract-retry-002', ['member-001']);
    const run = await runCli(
      [
        'retry',
        '--contract',
        'contract-retry-002',
        '--expected-revision',
        '1',
        '--members',
        'member-001,member-999',
      ],
      seam.target,
    );
    expect(run.exitCode).toBe(2);
    const json = run.json as {
      diagnostics: { code: string; invariant?: string; message: string }[];
    };
    expect(json['diagnostics'][0]?.['code']).toBe('RETRY_AUTHORITY_DOMAIN_REJECTED');
    expect(json['diagnostics'][0]?.['invariant']).toBe('C12');
  });

  it('the CLI computes no membership: retry without an explicit member list is a usage error', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(['retry', '--contract', 'c', '--expected-revision', '1'], seam.target);
    expect(run.exitCode).toBe(1);
    expect((run.json as Record<string, unknown>)['error']).toBe('USAGE');
  });

  it('duplicate retry resubmission reuses the SAME idempotent requestId', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract({ contractId: 'contract-retry-003' }));
    seam.server.recordFailedMembers('contract-retry-003', ['member-001']);
    const argv = [
      'retry',
      '--contract',
      'contract-retry-003',
      '--expected-revision',
      '1',
      '--members',
      'member-001',
      '--request-id',
      'req-retry-dup',
    ];
    const first = await runCli(argv, seam.target);
    expect(first.exitCode).toBe(0);
    const replay = await runCli(argv, seam.target);
    expect(replay.exitCode).toBe(0);
    expect((replay.json as Record<string, unknown>)['converged']).toBe(true);
  });
});

describe('seam-only command vocabulary', () => {
  it('the CLI never authors terminal results through any command', async () => {
    const seam: RunningSeam = await startSeam();
    // The seam itself would reject a CLI-invented PROJECT_TERMINAL_RESULT
    // route; the CLI exposes no such command at all (fail closed by grammar).
    const run = await runCli(['project-terminal-result', '--contract', 'c'], seam.target);
    expect(run.exitCode).toBe(1);
    expect((run.json as Record<string, unknown>)['error']).toBe('USAGE');
  });
});
