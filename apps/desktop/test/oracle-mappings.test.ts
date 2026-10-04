/**
 * T014 suite: applicable presentation-level counterexample oracles.
 *
 * Maps each oracle in TEST_MATRIX `applicable_counterexample_oracles` to the
 * exact presentation behavior. Core/domain-level oracles (C01/C03/C04/C06/
 * C07/C17-C22/C25/C28/C29/C32/C33) are NOT re-proven here — T014 consumes
 * their projected outcomes (non_applicable_oracles_note).
 */

import { describe, expect, it } from 'vitest';
import {
  NO_AMBIGUITY,
  collectionIntent,
  collectionPageRangeScope,
  confirmCollectionTask,
  confirmSingleResourceTask,
  coreProjection,
  coreProjectTerminal,
  desktopAdapter,
  lastRoutedOfType,
  memberIds,
  sectionLines,
  singleResourceIntent,
  startCore,
  terminalResult,
  type CoreHandle,
  surfaceToText,
} from './helpers.ts';
import type { DesktopUiAdapter, InteractionOutcome } from '../src/index.ts';

interface OracleCase {
  readonly id: string;
  readonly scenario: string;
  readonly run: (harness: {
    readonly core: CoreHandle;
    readonly adapter: DesktopUiAdapter;
  }) => Promise<void>;
}

async function closeAll(harness: {
  readonly core: CoreHandle;
  readonly adapter: DesktopUiAdapter;
}): Promise<void> {
  await harness.adapter.close();
  await harness.core.stop();
}

const CASES: readonly OracleCase[] = [
  {
    id: 'C02',
    scenario: 'requested-150-safety-cap-stops-100',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 3);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      const projected = coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'PARTIAL',
          coverage: 'TRUNCATED',
          stopReason: 'GLOBAL_SAFETY_LIMIT',
          validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
        }),
        selectedValidationOutcomes: memberIds(3).map((memberId) => ({
          memberId,
          requiredValidationPassed: true,
        })),
      });
      expect(projected.outcome).toBe('ACCEPTED');
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('request fulfillment: PARTIAL');
      expect(rendered).toContain('coverage: TRUNCATED');
      expect(rendered).toContain('stop reason: GLOBAL_SAFETY_LIMIT');
      expect(rendered).not.toContain('request fulfillment: COMPLETE');
    },
  },
  {
    id: 'C05',
    scenario: 'user-selects-five-before-confirmation-all-five-succeed',
    run: async ({ core, adapter }) => {
      const candidates = memberIds(8);
      const entered = adapter.enterIntent({
        intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
        workflowFacts: {
          ambiguousMaterialMemberIds: candidates,
          candidateCount: candidates.length,
          autoEvidenceSufficient: false,
        },
      });
      expect(entered.refusals).toStrictEqual([]);
      const selected = candidates.slice(0, 5);
      const done = await adapter.chooseManualSelection(selected);
      expect(done.rejections).toStrictEqual([]);
      const contractId = done.routed[0]?.aggregateId ?? '';
      const projected = coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'COMPLETE',
          stopReason: 'USER_SELECTION_COMPLETE',
          coverage: 'VERIFIED_COMPLETE',
          validationSummary: { status: 'ALL_PASSED', passedCount: 5, failedCount: 0 },
        }),
        selectedValidationOutcomes: selected.map((memberId) => ({
          memberId,
          requiredValidationPassed: true,
        })),
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: selected },
        },
      });
      expect(projected.outcome).toBe('ACCEPTED');
      const refreshed = await adapter.refresh();
      const resultLines = sectionLines(
        refreshed.display,
        'Result explanation (rendered verbatim from the Core projection)',
      );
      expect(resultLines).toContain('request fulfillment: COMPLETE');
      expect(resultLines).toContain('target resolution: RESOLVED');
      expect(resultLines).toContain('selection acquisition: COMPLETE');
      expect(resultLines).toContain('coverage: VERIFIED_COMPLETE');
      // The COMPLETE tuple is scoped to the selected set only.
      const scopeSnapshot = coreProjection(core, contractId)?.snapshot;
      expect(scopeSnapshot?.selectedMemberIds).toStrictEqual(selected);
    },
  },
  {
    id: 'C08',
    scenario: 'page-range-1-3-with-iframe-loadmore-detail-no-continuation',
    run: async ({ core, adapter }) => {
      const entered = adapter.enterIntent({
        intent: collectionIntent({
          requestedScope: collectionPageRangeScope('collection/playlist-001', 1, 3),
        }),
        workflowFacts: NO_AMBIGUITY,
      });
      const confirmed = await adapter.confirmScope();
      expect(confirmed.rejections).toStrictEqual([]);
      const contractId = confirmed.routed[0]?.aggregateId ?? '';
      // Continuation NONE renders…
      expect(
        sectionLines(
          confirmed.display,
          'Confirmed scope (immutable — changes require a successor command)',
        ),
      ).toContain('continuation scope: {"kind":"NONE"}');
      // …and the later load-more routes a successor command (4..6).
      const expansion = await adapter.requestSuccessor({
        patch: { requestedScope: collectionPageRangeScope('collection/playlist-001', 4, 6) },
        justification: 'SCOPE_CHANGE',
      });
      const successor = lastRoutedOfType(expansion, 'SUBMIT_CONTRACT');
      expect(successor?.aggregateId).not.toBe(contractId);
      expect(
        coreProjection(core, successor?.aggregateId ?? '')?.contract.supersedesContractId,
      ).toBe(contractId);
      expect(entered.routed).toStrictEqual([]);
    },
  },
  {
    id: 'C09',
    scenario: 'original-vs-thumbnail-main-video-vs-ad',
    run: async ({ core, adapter }) => {
      const outcome = await confirmSingleResourceTask(adapter);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'PARTIAL',
          targetResolution: 'PARTIAL',
          selectionAcquisition: 'COMPLETE',
          validationSummary: { status: 'PARTIAL', passedCount: 1, failedCount: 1 },
        }),
        selectedValidationOutcomes: [
          { memberId: 'target-file-001', requiredValidationPassed: true },
        ],
      });
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      // Presented exactly as Core claims — no thumbnail→original upgrade.
      expect(rendered).toContain('target resolution: PARTIAL');
      expect(rendered).not.toContain('target resolution: RESOLVED');
    },
  },
  {
    id: 'C10',
    scenario: 'whole-collection-18-auth-acquires-16-two-known-inaccessible',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 3);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      const projected = coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'PARTIAL',
          targetResolution: 'RESOLVED',
          selectionAcquisition: 'COMPLETE',
          coverage: 'VERIFIED_COMPLETE',
          stopReason: 'AUTH_REQUIRED',
          validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
        }),
        selectedValidationOutcomes: memberIds(3).map((memberId) => ({
          memberId,
          requiredValidationPassed: true,
        })),
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: [...memberIds(3), 'requested-inaccessible-1', 'requested-inaccessible-2'],
          },
        },
        knownAuthInaccessibleRequestedCount: 2,
      });
      expect(projected.outcome).toBe('ACCEPTED');
      const refreshed = await adapter.refresh();
      const resultLines = sectionLines(
        refreshed.display,
        'Result explanation (rendered verbatim from the Core projection)',
      );
      expect(resultLines).toContain('request fulfillment: PARTIAL');
      expect(resultLines).toContain('target resolution: RESOLVED');
      expect(resultLines).toContain('selection acquisition: COMPLETE');
      expect(resultLines).toContain('coverage: VERIFIED_COMPLETE');
      expect(resultLines).toContain('stop reason: AUTH_REQUIRED');
      // Requested scope still shown as the whole collection (18-truth).
      const scopeLines = sectionLines(
        refreshed.display,
        'Confirmed scope (immutable — changes require a successor command)',
      );
      expect(scopeLines.join('\n')).toContain('entire_supported_collection');
      // Prompt is surfaced.
      expect(sectionLines(refreshed.display, 'Authorization / action prompt')).toContain(
        'prompt: AUTH_REQUIRED',
      );
    },
  },
  {
    id: 'C11',
    scenario: 'collection-changes-after-preview',
    run: async ({ core, adapter }) => {
      const confirmed = await confirmCollectionTask(adapter, 2);
      const contractId = confirmed.routed[0]?.aggregateId ?? '';
      const before = adapter.currentDisplayText();
      // The collection changed after preview: the changed-collection prompt
      // routes a successor re-enumeration flow for the same collection
      // identity — never an in-place refresh of the confirmed snapshot.
      const reenumerated = await adapter.requestSuccessor({
        patch: {
          requestedScope: collectionPageRangeScope('collection/playlist-001', 1, 2),
        },
        justification: 'MEMBERSHIP_REENUMERATION_REQUIRED',
      });
      expect(reenumerated.rejections).toStrictEqual([]);
      const successor = lastRoutedOfType(reenumerated, 'SUBMIT_CONTRACT');
      expect(successor?.aggregateId).not.toBe(contractId);
      expect(
        coreProjection(core, successor?.aggregateId ?? '')?.contract.supersedesContractId,
      ).toBe(contractId);
      adapter.viewAggregate(contractId);
      expect(adapter.currentDisplayText()).toBe(before);
    },
  },
  {
    id: 'C12',
    scenario: 'retry-failed-items',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 2);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      const recorded = core.server.recordFailedMembers(contractId, ['member-001', 'member-002']);
      await adapter.refresh();
      expect(recorded.ok).toBe(true);
      const retry = await adapter.retryFailed();
      const envelope = adapter
        .sentCommandEnvelopes()
        .filter((e) => e.commandType === 'RETRY_FAILED_MEMBERS')[0];
      expect(envelope?.payload).toStrictEqual({ memberIds: ['member-001', 'member-002'] });
      expect(lastRoutedOfType(retry, 'RETRY_FAILED_MEMBERS')).toBeDefined();
    },
  },
  {
    id: 'C13',
    scenario: 'restart-repair-ui-cli-concurrency',
    run: async ({ core, adapter }) => {
      const outcome = await confirmSingleResourceTask(adapter);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      // Another surface cancels first; this surface's stale cancel rejects.
      const other = desktopAdapter(core);
      await other.attachAggregate(contractId);
      const otherCancel = await other.cancel();
      expect(otherCancel.rejections).toStrictEqual([]);
      const stale = await adapter.cancel();
      expect(stale.rejections.length).toBeGreaterThan(0);
      expect(sectionLines(stale.display, 'Selection / progress')).toContain(
        'lineage status: CANCELLED',
      );
      await other.close();
    },
  },
  {
    id: 'C14',
    scenario: 'discovered-targets-succeed-enumeration-unfinished',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 2);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      const projected = coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'UNKNOWN',
          selectionAcquisition: 'COMPLETE',
          coverage: 'VERIFIED_SUBSET',
          stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
          validationSummary: { status: 'ALL_PASSED', passedCount: 2, failedCount: 0 },
        }),
        selectedValidationOutcomes: memberIds(2).map((memberId) => ({
          memberId,
          requiredValidationPassed: true,
        })),
      });
      expect(projected.outcome).toBe('ACCEPTED');
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('selection acquisition: COMPLETE');
      expect(rendered).toContain('request fulfillment: UNKNOWN');
      expect(rendered).toContain('coverage: VERIFIED_SUBSET');
      expect(rendered).not.toContain('coverage: VERIFIED_COMPLETE');
    },
  },
  {
    id: 'C15',
    scenario: 'unsupported-dash-separate-av-needs-mux',
    run: async ({ core, adapter }) => {
      const outcome = await confirmSingleResourceTask(adapter);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'UNSATISFIED',
          selectionAcquisition: 'FAILED',
          stopReason: 'UNSUPPORTED',
          validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 1 },
        }),
        selectedValidationOutcomes: [
          { memberId: 'target-file-001', requiredValidationPassed: false },
        ],
      });
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('stop reason: UNSUPPORTED');
      expect(rendered).toContain('NOT approximated as supported');
      expect(rendered).not.toContain('request fulfillment: COMPLETE');
    },
  },
  {
    id: 'C16',
    scenario: 'simple-task-forced-through-unnecessary-preview',
    run: async ({ core: _core, adapter }) => {
      const entered = adapter.enterIntent({
        intent: singleResourceIntent(),
        workflowFacts: NO_AMBIGUITY,
      });
      const preview = surfaceToText(entered.display);
      expect(preview).not.toContain('BATCH_GROUP');
      expect(preview).not.toContain('MANUAL_SELECTION_UI');
      expect(preview).not.toContain('MATERIAL_ITEM');
      const done = await adapter.confirmScope();
      const status = surfaceToText(done.display);
      expect(done.routed).toHaveLength(1);
      expect(status).not.toContain('BATCH_GROUP');
      expect(status).not.toContain('MANUAL_SELECTION_UI');
    },
  },
  {
    id: 'C23',
    scenario: 'whole-collection-page3-undiscovered-due-discovery-budget',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 2);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'PARTIAL',
          coverage: 'TRUNCATED',
          stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
          validationSummary: { status: 'ALL_PASSED', passedCount: 2, failedCount: 0 },
        }),
        selectedValidationOutcomes: memberIds(2).map((memberId) => ({
          memberId,
          requiredValidationPassed: true,
        })),
      });
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('coverage: TRUNCATED');
      expect(rendered).toContain('stop reason: DISCOVERY_BUDGET_EXHAUSTED');
      // The discovered subset is truthfully shown.
      expect(rendered).toContain('2 member(s) bound to snapshot');
    },
  },
  {
    id: 'C24',
    scenario: 'auth-failure-yields-no-targets',
    run: async ({ core, adapter }) => {
      const outcome = await confirmSingleResourceTask(adapter);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'UNSATISFIED',
          targetResolution: 'BLOCKED',
          selectionAcquisition: 'NOT_STARTED',
          stopReason: 'AUTH_FAILED',
          validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
        }),
      });
      const refreshed = await adapter.refresh();
      const promptLines = sectionLines(refreshed.display, 'Authorization / action prompt');
      expect(promptLines).toContain('prompt: AUTH_BLOCKED');
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('request fulfillment: UNSATISFIED');
      expect(rendered).toContain('target resolution: BLOCKED');
      expect(rendered).toContain('selection acquisition: NOT_STARTED');
    },
  },
  {
    id: 'C26',
    scenario: 'user-confirms-system-labeled-original-without-enough-information',
    run: async ({ core: _core, adapter }) => {
      const entered = adapter.enterIntent({
        intent: collectionIntent(),
        workflowFacts: {
          ambiguousMaterialMemberIds: memberIds(4),
          candidateCount: 4,
          autoEvidenceSufficient: false,
        },
      });
      const lines = sectionLines(entered.display, 'Confirmation plan');
      // Selection-only proof; quality stays independently unverified.
      const proof = lines.find((l) => l.startsWith('selection-only proof'));
      expect(proof).toContain('SELECTION only');
      expect(proof).toContain('does not prove target quality');
      const request = lines.find((l) => l.startsWith('confirmation request'));
      expect(request).toContain('proves SELECTION');
      expect(surfaceToText(entered.display).toLowerCase()).not.toContain('proves quality');
    },
  },
  {
    id: 'C27',
    scenario: 'confirmed-candidate-transfer-truncated-or-track-missing',
    run: async ({ core, adapter }) => {
      const outcome = await confirmCollectionTask(adapter, 2);
      const contractId = outcome.routed[0]?.aggregateId ?? '';
      // Confirmation evidence exists (the user did confirm), but required
      // validation failed: acquisition can never display COMPLETE.
      coreProjectTerminal(core, contractId, {
        result: terminalResult(contractId, {
          requestFulfillment: 'PARTIAL',
          selectionAcquisition: 'FAILED',
          coverage: 'TRUNCATED',
          stopReason: 'VALIDATION_FAILED',
          validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 2 },
        }),
        selectedValidationOutcomes: memberIds(2).map((memberId) => ({
          memberId,
          requiredValidationPassed: false,
        })),
      });
      const refreshed = await adapter.refresh();
      const rendered = surfaceToText(refreshed.display);
      expect(rendered).toContain('selection acquisition: FAILED');
      expect(rendered).not.toContain('selection acquisition: COMPLETE');
    },
  },
  {
    id: 'C30',
    scenario: 'fifty-item-confirmations-vs-batch-selection',
    run: async ({ core: _core, adapter }) => {
      const members = memberIds(50);
      const entered = adapter.enterIntent({
        intent: collectionIntent(),
        workflowFacts: {
          ambiguousMaterialMemberIds: members,
          candidateCount: 50,
          autoEvidenceSufficient: false,
        },
      });
      const rendered = surfaceToText(entered.display);
      expect(rendered).toContain('BATCH_GROUP (50 member(s))');
      expect(rendered).not.toContain('MATERIAL_ITEM');
      const perItem = adapter.answerMaterialItem(members[0] ?? '', 'CONFIRMED');
      expect(perItem.refusals[0]).toContain('refused');
      const done = await adapter.confirmBatchSelection();
      expect(done.rejections).toStrictEqual([]);
    },
  },
  {
    id: 'C31',
    scenario: 'prior-12-of-18-selection-reused-on-different-page',
    run: async ({ core: _core, adapter }) => {
      const prior = memberIds(18, 'page-one');
      const first = adapter.enterIntent({
        intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
        workflowFacts: {
          ambiguousMaterialMemberIds: prior,
          candidateCount: prior.length,
          autoEvidenceSufficient: false,
        },
      });
      await adapter.chooseManualSelection(prior.slice(0, 12));
      const next = adapter.enterIntent({
        intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
        workflowFacts: {
          ambiguousMaterialMemberIds: memberIds(18, 'page-two'),
          candidateCount: 18,
          autoEvidenceSufficient: false,
        },
      });
      expect(JSON.stringify(next.display)).not.toContain('page-one');
      const reuse = await adapter.chooseManualSelection(prior.slice(0, 12));
      expect(reuse.routed).toStrictEqual([]);
      expect(reuse.refusals[0]).toContain('outside the Core-presented candidate set');
      expect(first.routed).toStrictEqual([]);
    },
  },
  {
    id: 'C34',
    scenario: 'ui-suggestion-used-as-ground-truth',
    run: async ({ core: _core, adapter }) => {
      const entered = adapter.enterIntent({
        intent: collectionIntent(),
        workflowFacts: {
          ambiguousMaterialMemberIds: memberIds(4),
          candidateCount: 4,
          autoEvidenceSufficient: false,
        },
      });
      const rendered = surfaceToText(entered.display);
      // The confirmation UI never renders suggestions/confirmations as
      // independent verified truth: the proof note is explicit.
      expect(rendered).toContain('SELECTION only');
      expect(rendered).toContain('never waives required validation');
      expect(rendered.toLowerCase()).not.toContain('verified truth');
    },
  },
];

describe('presentation-level counterexample oracle mappings', () => {
  for (const testCase of CASES) {
    it(`${testCase.id} — ${testCase.scenario}`, async () => {
      const core = await startCore();
      const adapter = desktopAdapter(core);
      const harness = { core, adapter };
      try {
        await testCase.run(harness);
      } finally {
        await closeAll(harness);
      }
    });
  }

  it('exposes every oracle case exactly once under its TEST_MATRIX identity', () => {
    const ids = CASES.map((c) => c.id).sort();
    expect(ids).toStrictEqual(
      [
        'C02',
        'C05',
        'C08',
        'C09',
        'C10',
        'C11',
        'C12',
        'C13',
        'C14',
        'C15',
        'C16',
        'C23',
        'C24',
        'C26',
        'C27',
        'C30',
        'C31',
        'C34',
      ].sort(),
    );
  });
});

// Type-level guard: InteractionOutcome is the common currency of the table.
export type { InteractionOutcome };
