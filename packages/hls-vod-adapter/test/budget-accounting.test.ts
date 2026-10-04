/**
 * T009 TEST_MATRIX suite `budget-accounting` and counterexample C28:
 * manifest/segment requests debit TransferBudget through canonical budget
 * semantics; DiscoveryBudget exhaustion does not block transfer of a frozen
 * target while Transfer/GlobalSafety remain; exhaustion stops work
 * truthfully without redefining requested scope; retry inherits remaining
 * budget rather than implying replenishment.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTerminalResult,
  makeMemberId,
  unwrapOrThrow,
  validateTerminalResult,
} from '@xdownload/domain-contracts';
import { acquirePlannedSegments, resumeAcquisition } from '../src/acquire.ts';
import { createTransferLedger, type TransferLedger } from '../src/budget.ts';
import { executeHlsVodAcquisition } from '../src/pipeline.ts';
import {
  RECORDED_AT,
  bindingFixture,
  contractId,
  consumedFixture,
  decodeMediaFixture,
  ledgerFixture,
  mediaPlaylistLocatorFixture,
  planFixture,
  recordingFetcher,
  transferProfileFixture,
} from './fixtures.ts';

function pipelineInput(overrides?: {
  readonly ledger?: TransferLedger;
  readonly fetcher?: ReturnType<typeof recordingFetcher>;
}) {
  return {
    contractId: contractId(),
    snapshotId: undefined,
    binding: bindingFixture(),
    master: undefined,
    mediaPlaylist: decodeMediaFixture(),
    mediaPlaylistLocator: mediaPlaylistLocatorFixture(),
    ledger: overrides?.ledger ?? ledgerFixture(),
    fetcher: overrides?.fetcher ?? recordingFetcher(),
    assemblyPort: {
      toolId: 'unused-in-budget-tests',
      assembleAndProbe: () => {
        throw new Error('probe must not run in budget-stop scenarios');
      },
    },
    recordedAt: RECORDED_AT,
  };
}

describe('budget-accounting', () => {
  it('manifest and segment requests debit TransferBudget, never DiscoveryBudget', () => {
    const ledger = ledgerFixture();
    ledger.recordTransfer('MANIFEST_REQUEST', 512);
    expect(ledger.consumed().transfer.bytes).toBe(512);
    expect(ledger.consumed().discovery.generatedRequests).toBe(0);
    ledger.recordTransfer('SEGMENT_REQUEST', 1000);
    ledger.recordTransfer('SEGMENT_REQUEST', 1000);
    expect(ledger.consumed().transfer.segments).toBe(2);
    expect(ledger.consumed().transfer.bytes).toBe(2512);
    expect(ledger.consumed().discovery).toEqual({
      generatedRequests: 0,
      navigationActions: 0,
      modelCalls: 0,
    });
  });

  it('C28: DiscoveryBudget exhaustion does not block transfer while transfer and global safety remain', () => {
    const ledger = ledgerFixture(
      transferProfileFixture(),
      consumedFixture({ discoveryExhaustedAt: 999999 }),
    );
    expect(ledger.remaining().discovery.exhausted).toBe(true);
    expect(ledger.admitTransferWork('SEGMENT_REQUEST').ok).toBe(true);
    const run = acquirePlannedSegments(planFixture(), ledger, recordingFetcher());
    expect(run.stop.kind).toBe('ALL_SEGMENTS_TRANSFERRED');
  });

  it('TransferBudget exhaustion stops work truthfully without redefining requested scope', () => {
    // 3 planned segments; transfer budget allows only 2 segment requests.
    const ledger = ledgerFixture(transferProfileFixture({ maxSegments: 2 }));
    const outcome = executeHlsVodAcquisition(pipelineInput({ ledger }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.kind).toBe('BUDGET_STOPPED');
    expect(outcome.value.terminal.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(outcome.value.terminal.selectionAcquisition).toBe('FAILED');
    expect(outcome.value.terminal.requestFulfillment).toBe('PARTIAL');
    expect(outcome.value.terminal.coverage).toBe('NOT_APPLICABLE');
    expect(outcome.value.chain?.media.status).toBe('NOT_PERFORMED');
    expect(outcome.value.run?.stop.kind).toBe('TRANSFER_BUDGET_EXHAUSTED');
  });

  it('budget-as-scope negative: exhaustion can never be projected as COMPLETE', () => {
    const terminal = buildTerminalResult({
      contractId: contractId(),
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'NOT_APPLICABLE',
      stopReason: 'TRANSFER_BUDGET_EXHAUSTED',
      validationSummary: { status: 'ALL_PASSED', passedCount: 4, failedCount: 0 },
      recordedAt: RECORDED_AT,
    });
    expect(terminal.ok).toBe(true);
    if (!terminal.ok) {
      return;
    }
    const legal = validateTerminalResult(terminal.value, {
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      selectedMemberCount: 1,
      selectedValidationOutcomes: [
        {
          memberId: unwrapOrThrow(makeMemberId('target-hls-vod-1')),
          requiredValidationPassed: true,
        },
      ],
    });
    expect(legal.ok).toBe(false);
    if (!legal.ok) {
      expect(legal.diagnostics[0]?.invariant).toContain('C02');
    }
  });

  it('discovery-budget-spent-as-transfer-budget negative: discovery state never substitutes transfer accounting', () => {
    // Plenty of discovery consumption, zero transfer consumption: segment
    // transfer is admitted on its own domain, and segment debits never touch
    // the discovery counters.
    const ledger = ledgerFixture(
      transferProfileFixture(),
      consumedFixture({ discoveryExhaustedAt: 50 }),
    );
    expect(ledger.admitTransferWork('SEGMENT_REQUEST').ok).toBe(true);
    ledger.recordTransfer('SEGMENT_REQUEST', 777);
    expect(ledger.consumed().transfer.segments).toBe(1);
    expect(ledger.consumed().transfer.bytes).toBe(777);
    expect(ledger.consumed().discovery.generatedRequests).toBe(50);
  });

  it('GlobalSafetyBudget has highest precedence and stops all generated work', () => {
    const ledger = ledgerFixture(
      transferProfileFixture(),
      consumedFixture({ globalSafetyExhaustedAt: 999999 }),
    );
    const admission = ledger.admitTransferWork('SEGMENT_REQUEST');
    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
      expect(admission.diagnostics[0]?.invariant).toContain('C28');
    }
  });

  it('retry inherits remaining budget and never implies replenishment', () => {
    const ledger = ledgerFixture(transferProfileFixture({ maxSegments: 3 }));
    const run = acquirePlannedSegments(
      planFixture(),
      ledger,
      recordingFetcher({ 1: { ok: false, failure: 'FAILED', detail: 'transient' } }),
    );
    // Position 0 transferred, position 1 failed, position 2 refused (budget).
    expect(run.stop.kind).toBe('SEGMENT_FAILURE');
    expect(ledger.remaining().transfer.perLimit['segments']).toBe(1);

    const resumed = resumeAcquisition(run, ledger, recordingFetcher());
    // Retry of the failed position debits the retry budget domain and
    // inherits the remaining segment budget; the previously budget-refused
    // position 2 consumes the last remaining segment slot.
    expect(ledger.consumed().transfer.retryTransferRequests).toBe(1);
    expect(ledger.consumed().transfer.segments).toBe(3);
    expect(resumed.stop.kind).toBe('ALL_SEGMENTS_TRANSFERRED');
    expect(resumed.transferred).toHaveLength(3);
    expect(ledger.remaining().transfer.perLimit['segments']).toBe(0);

    // Further work is refused — remaining is capped at zero, not replenished.
    const again = resumeAcquisition(resumed, ledger, recordingFetcher());
    expect(again.transferred).toHaveLength(3);
    expect(ledger.admitTransferWork('SEGMENT_REQUEST').ok).toBe(false);
  });

  it('createTransferLedger exposes canonical remaining semantics for downstream evidence', () => {
    const ledger = createTransferLedger(transferProfileFixture({ maxBytes: 100 }));
    ledger.recordTransfer('SEGMENT_REQUEST', 40);
    const remaining = ledger.remaining();
    expect(remaining.transfer.perLimit['bytes']).toBe(60);
    expect(remaining.transfer.exhausted).toBe(false);
    ledger.recordTransfer('SEGMENT_REQUEST', 60);
    expect(ledger.remaining().transfer.exhausted).toBe(true);
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(0);
  });
});
