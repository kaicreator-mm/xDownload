/**
 * TEST_MATRIX suite `idempotent-commands-and-duplicate-submit`:
 * - duplicate submission of the same idempotent command identity converges to
 *   the same accepted command/effect lineage and does not silently create
 *   another acquisition (frozen L2 §6.8);
 * - same idempotency identity with a different payload rejects;
 * - expected/current revision mismatch rejects with a typed diagnostic;
 * - accepted command state after restart remains authoritative; replay does
 *   not re-execute accepted effects (ADR-010 idempotent acceptance).
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  EXPECTED_PEER,
  rawCommand,
  rawSingleResourceContract,
} from './helpers.ts';

function serverOver(journal?: ReturnType<typeof createInMemorySeamJournal>) {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, journal });
  if (!result.ok) {
    throw new Error(`server construction failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.value;
}

function submit(s: ReturnType<typeof serverOver>, contractId: string, payload?: unknown) {
  return s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: contractId,
        payload: payload ?? rawSingleResourceContract({ contractId }),
        expectedRevision: 0,
      }),
    ),
  );
}

describe('duplicate submit converges on one accepted lineage (L2 §6.8)', () => {
  it('same identity + same payload returns the original acceptance with converged=true', () => {
    const s = serverOver();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      requestId: 'req-dup-001',
    });
    const first = s.handleFrame(JSON.stringify(raw));
    const second = s.handleFrame(JSON.stringify(raw));
    expect(first.outcome).toBe('ACCEPTED');
    expect(second.outcome).toBe('ACCEPTED');
    expect(first.acceptance?.converged).toBe(false);
    expect(second.acceptance?.converged).toBe(true);
    expect(second.acceptance?.revision).toBe(first.acceptance?.revision);
    // Exactly one acquisition: one aggregate, one accepted record.
    expect(s.acceptedCommandCount).toBe(1);
    expect(s.inspectProjection('contract-single-001')).toBeDefined();
  });

  it('duplicate submit after intervening commands still converges to the original revision', () => {
    const s = serverOver();
    const original = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      requestId: 'req-dup-002',
    });
    s.handleFrame(JSON.stringify(original));
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          requestId: 'req-dup-002-cancel',
        }),
      ),
    );
    const replay = s.handleFrame(JSON.stringify(original));
    expect(replay.outcome).toBe('ACCEPTED');
    expect(replay.acceptance?.revision).toBe(1);
    expect(replay.acceptance?.converged).toBe(true);
  });
});

describe('conflicting duplicate rejects', () => {
  it('same identity + different payload rejects with IDEMPOTENCY_CONFLICT', () => {
    const s = serverOver();
    const first = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          requestId: 'req-conflict-001',
        }),
      ),
    );
    expect(first.outcome).toBe('ACCEPTED');
    const conflicting = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract({ automationMode: 'ASSISTED' }),
          requestId: 'req-conflict-001',
        }),
      ),
    );
    expect(conflicting.outcome).toBe('REJECTED');
    expect(conflicting.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
    // Still exactly one accepted command.
    expect(s.acceptedCommandCount).toBe(1);
  });
});

describe('revision gate', () => {
  it('stale expected revision rejects with a typed diagnostic carrying the current revision', () => {
    const s = serverOver();
    submit(s, 'contract-single-001');
    const stale = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 0,
        }),
      ),
    );
    expect(stale.outcome).toBe('REJECTED');
    expect(stale.diagnostics?.[0]?.code).toBe('REVISION_MISMATCH');
    expect(stale.currentRevision).toBe(1);
  });

  it('creation commands assert revision 0 and an existing aggregate rejects the stale claim', () => {
    const s = serverOver();
    submit(s, 'contract-single-001');
    const recreate = submit(s, 'contract-single-001');
    // Revision gate fires before authority semantics: expectedRevision 0 vs current 1.
    expect(recreate.outcome).toBe('REJECTED');
    expect(recreate.diagnostics?.[0]?.code).toBe('REVISION_MISMATCH');
  });
});

describe('restart: accepted state remains authoritative; replay does not re-execute', () => {
  it('a fresh server over the same journal keeps accepted truth and converges re-submission', () => {
    const journal = createInMemorySeamJournal();
    const first = serverOver(journal);
    // Fixed identity: the client retries after restart with the SAME request id.
    const originalCommand = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      requestId: 'req-restart-fixed-001',
    });
    const accepted = first.handleFrame(JSON.stringify(originalCommand));
    expect(accepted.outcome).toBe('ACCEPTED');
    const revisionBefore = accepted.acceptance?.revision;

    // Core "restart": dispose the server, rebuild over the same journal.
    const restarted = serverOver(journal);
    // Authoritative state survived.
    expect(restarted.inspectProjection('contract-single-001')).toBeDefined();
    expect(restarted.acceptedCommandCount).toBe(1);
    // Re-submission of the same identity converges; no second acquisition.
    const resubmitted = restarted.handleFrame(JSON.stringify(originalCommand));
    expect(resubmitted.outcome).toBe('ACCEPTED');
    expect(resubmitted.acceptance?.converged).toBe(true);
    expect(resubmitted.acceptance?.revision).toBe(revisionBefore);
    expect(restarted.acceptedCommandCount).toBe(1);

    // New commands continue at the restored revision, not from scratch.
    const cancel = restarted.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
        }),
      ),
    );
    expect(cancel.outcome).toBe('ACCEPTED');
  });

  it('replay does not duplicate accepted external effects: each lineage transition applies once', () => {
    const journal = createInMemorySeamJournal();
    const first = serverOver(journal);
    submit(first, 'contract-single-001');
    first.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          requestId: 'req-cancel-001',
        }),
      ),
    );
    const restarted = serverOver(journal);
    // The cancel order is preserved exactly once: projection shows cancelled.
    const projection = restarted.inspectProjection('contract-single-001');
    expect(projection?.lineage.status).toBe('CANCELLED');
    expect(projection?.lineage.cancelOrder).toBe(1);
    // Re-delivery of the same cancel (client retry after restart) converges.
    const redelivered = restarted.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          requestId: 'req-cancel-001',
        }),
      ),
    );
    expect(redelivered.outcome).toBe('ACCEPTED');
    expect(redelivered.acceptance?.converged).toBe(true);
    expect(restarted.inspectProjection('contract-single-001')?.lineage.cancelOrder).toBe(1);
  });

  it('a corrupt journal entry fails server construction closed', () => {
    const journal = createInMemorySeamJournal();
    // Forge an entry whose command cannot apply (unknown aggregate).
    const forged = {
      envelope: rawCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-unknown-001',
        expectedRevision: 7,
        payload: {},
      }) as never,
      response: { ok: true } as never,
      payloadDigest: 'forged',
    };
    journal.append(forged);
    const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, journal });
    expect(result.ok).toBe(false);
  });
});
