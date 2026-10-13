/**
 * #101 P2 repairs — seam authority for the S1 cancel cutoff and the durable
 * Target evidence basis.
 *
 * P2-1 (CANCEL_CUTOFF): `recordExecutedTerminal` rejects any non-ACTIVE
 * lineage (a durably committed user cancel can never be crossed by a late
 * executed terminal); the truthful cancellation closure is its own
 * Core-internal port (`closeCancelledLineage`) gated to CANCELLED lineages;
 * the cancel bridge fires strictly after the CANCEL_LINEAGE journal commit
 * with the cancelling surface, and never fires for a rejected (late) cancel
 * or on journal replay.
 *
 * P2-2 (DURABLE_IDENTITY_BASIS): the secret-free typed Target evidence
 * receipt validates fail-closed (closed vocabularies, C34 basis↔certainty
 * pairing, exact artifact/effect identity), converges on identical replay,
 * rejects conflicting rewrites, and survives restart through the journal.
 */

import { describe, expect, it } from 'vitest';
import type { TerminalResult } from '@xdownload/domain-contracts';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  type S1LineageCancelBridge,
  type SeamProjectionView,
} from '../src/index.ts';
import {
  EXPECTED_PEER,
  rawCommand,
  rawSingleResourceContract,
  rawTerminalResult,
} from './helpers.ts';

function decodedTerminalOf(view: SeamProjectionView | undefined): TerminalResult | undefined {
  return view?.terminal;
}

function s1Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 's1snap-001',
    memberId: 's1member-001',
    artifactId: 's1artifact-001',
    delivery: {
      locatorUri: 'http://127.0.0.1:9/file.bin',
      declaredRedirectHosts: ['127.0.0.1:9'],
    },
    ...overrides,
  };
}

function makeCancelBridge(): {
  bridge: S1LineageCancelBridge;
  calls: { aggregateId: string; source: string }[];
} {
  const calls: { aggregateId: string; source: string }[] = [];
  return { bridge: { cancelled: (input) => calls.push(input) }, calls };
}

function serverWith(options: {
  readonly journal?: ReturnType<typeof createInMemorySeamJournal>;
  readonly cancelBridge?: S1LineageCancelBridge;
}) {
  const result = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    // The S1 execution command fails closed without a composed driver; these
    // seam-level tests only need the authority gates, so a no-op beginner
    // stands in for the runtime composition.
    s1DirectAcquisition: { begin: () => undefined },
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.cancelBridge === undefined ? {} : { s1LineageCancel: options.cancelBridge }),
  });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function frame(
  s: ReturnType<typeof serverWith>,
  raw: Record<string, unknown>,
): {
  outcome: string;
  code?: string;
  revision?: number;
} {
  const response = s.handleFrame(JSON.stringify(raw));
  return {
    outcome: response.outcome,
    code: response.diagnostics?.[0]?.code,
    revision: response.currentRevision,
  };
}

function submitAndExecute(
  s: ReturnType<typeof serverWith>,
  payload: Record<string, unknown> = s1Payload(),
): void {
  expect(
    frame(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
      }),
    ).outcome,
  ).toBe('ACCEPTED');
  expect(
    frame(
      s,
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: 'contract-single-001',
        payload,
        expectedRevision: 1,
      }),
    ).outcome,
  ).toBe('ACCEPTED');
}

describe('P2-1 cancel cutoff at the seam', () => {
  it('recordExecutedTerminal rejects a CANCELLED lineage (no terminal across the cutoff)', () => {
    const s = serverWith({});
    submitAndExecute(s);
    expect(
      frame(
        s,
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          payload: {},
          expectedRevision: 2,
        }),
      ).outcome,
    ).toBe('ACCEPTED');
    const recorded = s.recordExecutedTerminal(
      'contract-single-001',
      rawTerminalResult() as unknown as TerminalResult,
    );
    expect(recorded.ok).toBe(false);
    if (!recorded.ok) {
      expect(recorded.diagnostics[0]?.code).toBe('LATE_COMMAND');
    }
    const view = s.inspectProjection('contract-single-001');
    expect(view?.lineage.status).toBe('CANCELLED');
    expect(view?.terminal).toBeUndefined();
  });

  it('closeCancelledLineage stores the truthful closure on a CANCELLED lineage only', () => {
    const s = serverWith({});
    submitAndExecute(s);
    const cancelledTerminal = rawTerminalResult({
      requestFulfillment: 'UNSATISFIED',
      selectionAcquisition: 'CANCELLED',
      stopReason: 'USER_CANCELLED',
      validationSummary: { status: 'INSUFFICIENT_EVIDENCE', passedCount: 0, failedCount: 0 },
    }) as unknown as TerminalResult;

    // ACTIVE lineages complete through recordExecutedTerminal, never closure.
    const onActive = s.closeCancelledLineage('contract-single-001', cancelledTerminal);
    expect(onActive.ok).toBe(false);
    if (!onActive.ok) {
      expect(onActive.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
    }

    expect(
      frame(
        s,
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          payload: {},
          expectedRevision: 2,
        }),
      ).outcome,
    ).toBe('ACCEPTED');
    const closed = s.closeCancelledLineage('contract-single-001', cancelledTerminal);
    expect(closed.ok).toBe(true);
    const view = s.inspectProjection('contract-single-001');
    expect(view?.lineage.status).toBe('TERMINAL');
    expect(view?.terminal?.stopReason).toBe('USER_CANCELLED');
    expect(decodedTerminalOf(view)).toBeDefined();

    // Terminal truth is never rewritten: a second closure is a typed LATE.
    const again = s.closeCancelledLineage('contract-single-001', cancelledTerminal);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.diagnostics[0]?.code).toBe('LATE_COMMAND');
    }
  });

  it('the cancel bridge fires once after the journal commit and never for a late cancel', () => {
    const journal = createInMemorySeamJournal();
    const { bridge, calls } = makeCancelBridge();
    const s = serverWith({ journal, cancelBridge: bridge });
    submitAndExecute(s);
    expect(calls).toHaveLength(0);
    expect(
      frame(
        s,
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          payload: {},
          expectedRevision: 2,
        }),
      ).outcome,
    ).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStrictEqual({ aggregateId: 'contract-single-001', source: 'CLI' });

    // The cancel is durable: replay re-establishes it without re-firing the
    // bridge (the runtime reconcile owns post-restart closure).
    const replayed = serverWith({ journal: journal, cancelBridge: bridge });
    expect(replayed.inspectProjection('contract-single-001')?.lineage.status).toBe('CANCELLED');
    expect(calls).toHaveLength(1);

    // A cancel after a terminal lineage is LATE and never bridges.
    const closed = replayed.closeCancelledLineage(
      'contract-single-001',
      rawTerminalResult({
        requestFulfillment: 'UNSATISFIED',
        selectionAcquisition: 'CANCELLED',
        stopReason: 'USER_CANCELLED',
      }) as unknown as TerminalResult,
    );
    expect(closed.ok).toBe(true);
    expect(
      frame(
        replayed,
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          payload: {},
          expectedRevision: 4,
        }),
      ),
    ).toMatchObject({ outcome: 'REJECTED', code: 'LATE_COMMAND' });
    expect(calls).toHaveLength(1);
  });
});

describe('P2-2 durable target evidence receipt', () => {
  const DECISIVE = {
    artifactId: 's1artifact-001',
    effectId: 'effect:contract-single-001:s1snap-001:target-file-001',
    artifactSha256: 'a'.repeat(64),
    basis: 'PUBLISHED_SHA256',
    certaintyClass: 'DECISIVE',
  } as const;
  const PROBATIVE = {
    artifactId: 's1artifact-001',
    effectId: 'effect:contract-single-001:s1snap-001:target-file-001',
    artifactSha256: 'b'.repeat(64),
    basis: 'REQUESTED_LOCATOR_PROVENANCE',
    certaintyClass: 'PROBATIVE',
  } as const;

  it('validates fail-closed and exposes the receipt through the read projection', () => {
    const journal = createInMemorySeamJournal();
    const s = serverWith({ journal });
    submitAndExecute(
      s,
      s1Payload({
        delivery: {
          locatorUri: 'http://127.0.0.1:9/file.bin',
          declaredRedirectHosts: ['127.0.0.1:9'],
          expectedSha256: 'a'.repeat(64),
        },
      }),
    );

    // A typed but mismatched receipt is NOT this lineage's durable truth.
    expect(
      s.recordTargetEvidence('contract-single-001', {
        ...DECISIVE,
        artifactId: 'another-artifact',
      }).ok,
    ).toBe(false);
    expect(
      s.recordTargetEvidence('contract-single-001', {
        ...DECISIVE,
        effectId: 'effect:another-contract:s1snap-001:target-file-001',
      }).ok,
    ).toBe(false);
    expect(s.recordTargetEvidence('contract-single-001', PROBATIVE).ok).toBe(false);

    expect(s.recordTargetEvidence('contract-single-001', DECISIVE).ok).toBe(true);
    const view = s.inspectProjection('contract-single-001');
    expect(view?.targetEvidence).toStrictEqual(DECISIVE);

    // C34 pairing: a provenance basis can never claim decisive byte truth.
    const badPairing = s.recordTargetEvidence('contract-single-001', {
      ...PROBATIVE,
      certaintyClass: 'DECISIVE',
    });
    expect(badPairing.ok).toBe(false);

    // Closed vocabularies and unknown fields reject; no locator material.
    expect(
      s.recordTargetEvidence('contract-single-001', {
        ...DECISIVE,
        basis: 'REQUESTED_URL_TRUST',
        certaintyClass: 'PROBATIVE',
        locatorUri: 'http://127.0.0.1:9/file.bin?token=secret',
      } as unknown as typeof DECISIVE).ok,
    ).toBe(false);
    expect(view?.targetEvidence && 'locatorUri' in view.targetEvidence).toBe(false);

    // The recorded basis is never rewritten by a conflicting receipt.
    const conflicting = s.recordTargetEvidence('contract-single-001', PROBATIVE);
    expect(conflicting.ok).toBe(false);
    expect(s.inspectProjection('contract-single-001')?.targetEvidence).toStrictEqual(DECISIVE);

    // Identical receipt converges (idempotent replay), then restart replay
    // re-establishes the identical recorded identity.
    expect(s.recordTargetEvidence('contract-single-001', DECISIVE)).toMatchObject({
      ok: true,
    });
    const reopened = serverWith({ journal });
    expect(reopened.inspectProjection('contract-single-001')?.targetEvidence).toStrictEqual(
      DECISIVE,
    );
  });

  it('no-digest S1 intent permits only provenance-bound probative Target receipts', () => {
    const journal = createInMemorySeamJournal();
    const s = serverWith({ journal });
    submitAndExecute(s);
    expect(s.recordTargetEvidence('contract-single-001', DECISIVE).ok).toBe(false);
    expect(s.recordTargetEvidence('contract-single-001', PROBATIVE).ok).toBe(true);
    expect(s.inspectProjection('contract-single-001')?.targetEvidence).toStrictEqual(PROBATIVE);
    const reopened = serverWith({ journal });
    expect(reopened.inspectProjection('contract-single-001')?.targetEvidence).toStrictEqual(
      PROBATIVE,
    );
  });

  it('unknown aggregates and journal-less compositions reject', () => {
    expect(serverWith({}).recordTargetEvidence('contract-single-001', DECISIVE).ok).toBe(false);
    const noJournal = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    if (!noJournal.ok) throw new Error('server construction failed');
    expect(
      frame(
        noJournal.value,
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ).outcome,
    ).toBe('ACCEPTED');
    expect(noJournal.value.recordTargetEvidence('contract-single-001', DECISIVE).ok).toBe(false);
  });
});
