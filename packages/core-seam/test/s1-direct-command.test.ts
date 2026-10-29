/**
 * #101 first slice — `EXECUTE_S1_DIRECT_ACQUISITION` seam authority gates.
 *
 * The execution command registers exactly one durable S1 intent at apply
 * (fail-closed on every gate); the Core-side beginner fires strictly after
 * the accepted-command journal commit; the terminal enters lineage state
 * only through the Core-internal `recordExecutedTerminal` (projector output,
 * never a surface assertion); restart replay rebuilds intents from the
 * journal without re-running side effects.
 */

import { describe, expect, it } from 'vitest';
import type { AcquisitionContract } from '@xdownload/domain-contracts';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  type CommandRequestId,
  type S1DirectAcquisitionBeginner,
} from '../src/index.ts';
import {
  EXPECTED_PEER,
  peer,
  rawCollectionContract,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  rawTerminalResult,
} from './helpers.ts';

interface BeginnerCall {
  readonly aggregateId: string;
  readonly contract: AcquisitionContract;
  readonly payload: unknown;
}

function s1Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 's1snap-001',
    memberId: 's1member-001',
    artifactId: 's1artifact-001',
    delivery: {
      locatorUri: 'http://127.0.0.1:9/file.bin',
      declaredRedirectHosts: ['127.0.0.1:9'],
      expectedSha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

function makeBeginner() {
  const calls: BeginnerCall[] = [];
  const beginner: S1DirectAcquisitionBeginner = {
    begin: (input) => {
      calls.push(input);
    },
  };
  return { beginner, calls };
}

function serverWith(
  options: {
    readonly journal?: ReturnType<typeof createInMemorySeamJournal>;
    readonly beginner?: S1DirectAcquisitionBeginner;
  } = {},
) {
  const result = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.beginner === undefined ? {} : { s1DirectAcquisition: options.beginner }),
  });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function submitSingle(s: ReturnType<typeof serverWith>, aggregateId = 'contract-single-001'): void {
  const response = s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId,
        payload: rawSingleResourceContract({ contractId: aggregateId }),
      }),
    ),
  );
  expect(response.outcome).toBe('ACCEPTED');
}

function executeS1(
  s: ReturnType<typeof serverWith>,
  options: {
    readonly aggregateId?: string;
    readonly payload?: unknown;
    readonly requestId?: string;
    readonly expectedRevision?: number;
    readonly asPeer?: ReturnType<typeof peer>;
  } = {},
) {
  return s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: options.aggregateId ?? 'contract-single-001',
        payload: options.payload ?? s1Payload(),
        ...(options.requestId === undefined
          ? {}
          : { requestId: options.requestId as CommandRequestId }),
        ...(options.expectedRevision === undefined
          ? {}
          : { expectedRevision: options.expectedRevision }),
        ...(options.asPeer === undefined ? {} : { asPeer: options.asPeer }),
      }),
    ),
  );
}

describe('EXECUTE_S1_DIRECT_ACQUISITION authority gates', () => {
  it('requires seam 1.1 only for the S1 effect; legacy 1.0 submit remains accepted', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    const legacySubmit = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
    });
    legacySubmit['schemaIdentity'] = { schema: 'xdownload.core-seam', version: '1.0.0' };
    const admitted = s.handleFrame(JSON.stringify(legacySubmit));
    expect(admitted.outcome).toBe('ACCEPTED');

    const legacyExecute = rawCommand({
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      aggregateId: 'contract-single-001',
      expectedRevision: 1,
      payload: s1Payload(),
    });
    legacyExecute['schemaIdentity'] = { schema: 'xdownload.core-seam', version: '1.0.0' };
    const rejected = s.handleFrame(JSON.stringify(legacyExecute));
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.diagnostics?.[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');
    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);

    legacyExecute['schemaIdentity'] = { schema: 'xdownload.core-seam', version: '1.1.0' };
    const accepted = s.handleFrame(JSON.stringify(legacyExecute));
    expect(accepted.outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
  });

  it('fails closed when the Core composition provides no S1 beginner', () => {
    const s = serverWith();
    submitSingle(s);
    const response = executeS1(s, { expectedRevision: 1 });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('accepts one intent and fires the beginner strictly after the journal commit', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const response = executeS1(s, { expectedRevision: 1 });
    expect(response.outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.aggregateId).toBe('contract-single-001');
    expect(calls[0]?.contract.contractId).toBe('contract-single-001');
    expect(s.pendingS1Executions()).toHaveLength(1);
    expect(s.pendingS1Executions()[0]?.payload).toEqual(s1Payload());
    // The intent alone is not terminal truth: the lineage stays open until
    // the Core records the executed terminal.
    const projection = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    expect((projection.projection as Record<string, unknown>)['terminal']).toBeUndefined();
  });

  it('accepts an intent whose delivery omits the digest (ordinary S1 download, #101 R1/F01)', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const noDigest = s1Payload();
    delete (noDigest.delivery as Record<string, unknown>).expectedSha256;
    const response = executeS1(s, { payload: noDigest, expectedRevision: 1 });
    expect(response.outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(s.pendingS1Executions()).toHaveLength(1);
    expect(s.pendingS1Executions()[0]?.payload).toEqual(noDigest);
    // The lineage stays open until the Core records the executed terminal.
    const projection = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    expect((projection.projection as Record<string, unknown>)['terminal']).toBeUndefined();
  });

  it('rejects malformed payloads before any intent exists', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const cases: unknown[] = [
      { ...s1Payload(), surprise: true },
      s1Payload({ snapshotId: 'not a snapshot id!' }),
      s1Payload({ artifactId: 'bad artifact id with spaces' }),
      s1Payload({
        delivery: {
          locatorUri: 'ftp://example/file.bin',
          declaredRedirectHosts: ['example'],
          expectedSha256: 'a'.repeat(64),
        },
      }),
      s1Payload({
        delivery: {
          locatorUri: 'http://127.0.0.1:9/file.bin',
          declaredRedirectHosts: ['127.0.0.1:9'],
          expectedSha256: 'ZZZ-not-hex',
        },
      }),
      s1Payload({ delivery: 'not-an-object' }),
    ];
    for (const [index, payload] of cases.entries()) {
      const response = executeS1(s, { payload, expectedRevision: 1 });
      expect(response.outcome, `case ${String(index)}`).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code, `case ${String(index)}`).toBe('ENVELOPE_MALFORMED');
    }
    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('admits the CLI surface only and single-resource contracts only', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const offSurface = executeS1(s, {
      expectedRevision: 1,
      asPeer: peer('BROWSER_EXTENSION'),
    });
    expect(offSurface.outcome).toBe('REJECTED');
    expect(offSurface.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');

    const collectionSubmit = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(collectionSubmit.outcome).toBe('ACCEPTED');
    const collectionExecute = executeS1(s, {
      aggregateId: 'contract-collection-001',
      expectedRevision: 1,
    });
    expect(collectionExecute.outcome).toBe('REJECTED');
    expect(collectionExecute.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');

    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('rejects a duplicate registration while an intent is pending and after cancel', () => {
    const { beginner } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    expect(executeS1(s, { expectedRevision: 1 }).outcome).toBe('ACCEPTED');
    const duplicate = executeS1(s, { expectedRevision: 2 });
    expect(duplicate.outcome).toBe('REJECTED');
    expect(duplicate.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');

    const cancelled = serverWith({ beginner });
    submitSingle(cancelled);
    expect(
      cancelled.handleFrame(
        JSON.stringify(
          rawCommand({
            commandType: 'CANCEL_LINEAGE',
            aggregateId: 'contract-single-001',
            payload: {},
            expectedRevision: 1,
          }),
        ),
      ).outcome,
    ).toBe('ACCEPTED');
    const late = executeS1(cancelled, { expectedRevision: 2 });
    expect(late.outcome).toBe('REJECTED');
    expect(late.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
    expect(cancelled.pendingS1Executions()).toHaveLength(0);
  });

  it('recordExecutedTerminal stores the Core-derived terminal once; a second completion is LATE', () => {
    const { beginner } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    expect(executeS1(s, { expectedRevision: 1 }).outcome).toBe('ACCEPTED');

    const terminal = rawTerminalResult();
    const recorded = s.recordExecutedTerminal('contract-single-001', terminal as never);
    expect(recorded.ok).toBe(true);
    const projection = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    const view = projection.projection as Record<string, unknown>;
    expect(view['terminal']).toEqual(terminal);
    expect((view['lineage'] as Record<string, unknown>)['status']).toBe('TERMINAL');

    const second = s.recordExecutedTerminal('contract-single-001', terminal as never);
    if (second.ok) {
      throw new Error('a second terminal completion must not succeed');
    }
    expect(second.diagnostics[0]?.code).toBe('LATE_COMMAND');
  });

  it('journal replay rebuilds intents without re-firing the beginner', () => {
    const journal = createInMemorySeamJournal();
    const first = makeBeginner();
    const a = serverWith({ journal, beginner: first.beginner });
    submitSingle(a);
    expect(executeS1(a, { expectedRevision: 1, requestId: 'req-s1-exec-fixed' }).outcome).toBe(
      'ACCEPTED',
    );
    expect(first.calls).toHaveLength(1);

    // Reopen from the same durable journal: replay re-registers the intent
    // but must not run side effects during composition.
    const second = makeBeginner();
    const b = serverWith({ journal, beginner: second.beginner });
    expect(second.calls).toHaveLength(0);
    const pending = b.pendingS1Executions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.aggregateId).toBe('contract-single-001');
    expect(pending[0]?.contract.contractId).toBe('contract-single-001');
    expect(pending[0]?.payload).toEqual(s1Payload());

    // Replay restored idempotency: re-submitting the identical command
    // identity converges instead of re-registering the intent.
    const replayed = executeS1(b, {
      expectedRevision: 1,
      requestId: 'req-s1-exec-fixed',
    });
    expect(replayed.outcome).toBe('ACCEPTED');
    expect(replayed.acceptance?.converged).toBe(true);
    expect(b.pendingS1Executions()).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });
});
