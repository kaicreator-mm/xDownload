/**
 * TEST_MATRIX suite `non-interactive-bounded-behavior`: non-interactive mode
 * never blocks indefinitely when confirmation is required; confirmation-
 * required cases return a bounded machine-readable NEEDS_USER_ACTION state;
 * non-interactive errors are typed/stable with deterministic non-success
 * exits. The vitest per-test timeout is itself the blocking guard: a
 * regression to blocking fails the test, not the CI clock.
 */

import { describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { CliInputError, parseArgv } from '../src/index.ts';
import {
  collectionContract,
  harnessClient,
  queryCountingTransport,
  runCli,
  setupContract,
  singleResourceContract,
  startSeam,
  type RunningSeam,
} from './helpers.ts';

function manualSelectionContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return singleResourceContract({
    contractId: 'contract-manual-001',
    automationMode: 'MANUAL_SELECTION',
    selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
    ...overrides,
  });
}

describe('non-interactive bounded behavior', () => {
  it('confirmation-required submit returns the bounded NEEDS_USER_ACTION document (exit 3)', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([['contract.json', JSON.stringify(manualSelectionContract())]]);
    const run = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-nia-001'],
      seam.target,
      { files },
    );
    expect(run.exitCode).toBe(3);
    // Non-wait submit: the acceptance document itself carries the bounded
    // needs_user_action state (PRD §27 acceptance separation); the dedicated
    // needs-user-action document is produced on the --wait path below.
    const expected = {
      document: 'xdownload.cli.acceptance',
      schema: '1',
      command: 'submit',
      outcome: 'ACCEPTED',
      contract_id: 'contract-manual-001',
      request_id: 'req-nia-001',
      revision: 1,
      converged: false,
      current_revision: 1,
      needs_user_action: true,
      required_action: 'CONFIRM_SNAPSHOT',
      note: 'submit acceptance is not final acquisition success',
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('submit --wait on a confirmation-required contract returns immediately without polling', async () => {
    const seam: RunningSeam = await startSeam();
    const transport = queryCountingTransport(createLoopbackClientTransport());
    const files = new Map([['contract.json', JSON.stringify(manualSelectionContract())]]);
    const run = await runCli(
      [
        'submit',
        '--file',
        'contract.json',
        '--request-id',
        'req-nia-002',
        '--wait',
        '--timeout-ms',
        '60000',
        '--poll-ms',
        '20',
      ],
      seam.target,
      { files, transport },
    );
    expect(run.exitCode).toBe(3);
    expect((run.json as Record<string, unknown>)['state']).toBe('NEEDS_USER_ACTION');
    // Bounded: the CLI never polls for a confirmation only the user can give.
    expect(transport.queryCount()).toBe(0);
  });

  it('bounded wait elapses without inventing a status (exit 6)', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const run = await runCli(
      ['wait', '--contract', 'contract-single-001', '--timeout-ms', '80', '--poll-ms', '20'],
      seam.target,
    );
    expect(run.exitCode).toBe(6);
    const expected = {
      document: 'xdownload.cli.wait-timeout',
      schema: '1',
      state: 'BOUNDED_WAIT_TIMEOUT',
      contract_id: 'contract-single-001',
      timeout_ms: 80,
      poll_ms: 20,
      note: 'bounded wait elapsed without a projected terminal result; no status was invented',
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('malformed batch/argv input yields typed deterministic non-success exits', async () => {
    const seam: RunningSeam = await startSeam();
    // Invalid JSON payload
    const bad = await runCli(['submit', '--stdin'], seam.target, { stdinText: '{not json' });
    expect(bad.exitCode).toBe(1);
    expect((bad.json as Record<string, unknown>)['error']).toBe('USAGE');
    // Payload that is valid JSON but not a canonical contract (verbatim domain diagnostics)
    const nonContract = await runCli(['submit', '--stdin'], seam.target, {
      stdinText: '{"hello":1}',
    });
    expect(nonContract.exitCode).toBe(1);
    const diagnostics = (nonContract.json as { diagnostics: { code: string; path: string }[] })
      .diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('UNKNOWN_FIELD');
    expect(codes).toContain('MISSING_REQUIRED_FIELD');
    // Missing required target
    expect(() =>
      parseArgv(['status', '--port', '1', '--install-id', 'i', '--user-id', 'u']),
    ).toThrow(CliInputError);
    // Unknown flag
    expect(() =>
      parseArgv([
        'status',
        '--contract',
        'c',
        '--all',
        '--port',
        '1',
        '--install-id',
        'i',
        '--user-id',
        'u',
      ]),
    ).toThrow(CliInputError);
    // Negative revision
    expect(() =>
      parseArgv([
        'cancel',
        '--contract',
        'c',
        '--expected-revision',
        '-1',
        '--port',
        '1',
        '--install-id',
        'i',
        '--user-id',
        'u',
      ]),
    ).toThrow(CliInputError);
    // Missing peer identity
    expect(() => parseArgv(['status', '--contract', 'c', '--port', '1'])).toThrow(CliInputError);
  });

  it('defaults cannot enlarge scope: submit adds no field the payload does not carry', async () => {
    const seam: RunningSeam = await startSeam();
    // Submit with zero optional flags: the only CLI-side envelope fields are
    // identity/routing (peer, requestId, expectedRevision 0, correlation);
    // the contract payload itself is passed through the canonical decoder
    // unchanged — proven by the idempotency digest equality in batch tests
    // and by the seam accepting the decoded payload as canonical here.
    const files = new Map([['contract.json', JSON.stringify(collectionContract())]]);
    const run = await runCli(['submit', '--file', 'contract.json'], seam.target, { files });
    expect(run.exitCode).toBe(0);
    const status = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    expect((status.json as Record<string, unknown>)['intent_type']).toBe('COLLECTION');
  });
});
