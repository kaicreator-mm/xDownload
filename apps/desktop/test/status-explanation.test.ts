/**
 * T014 suite: status explanation.
 *
 * TEST_MATRIX `status-explanation`:
 * - multi-dimensional terminal results render all six dimensions from the
 *   projection; no single success boolean is displayed;
 * - PARTIAL/UNKNOWN/TRUNCATED/UNSATISFIED states and stop reasons render
 *   truthfully; unsupported/out-of-scope is visible rather than silently
 *   approximated;
 * - accepted/failed/quality claims mirror Core projections; UI-suggestion
 *   provenance is never displayed as independent verified truth;
 * - confirmation never causes failed/incomplete required validation to
 *   display as complete.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmCollectionTask,
  confirmSingleResourceTask,
  coreProjectTerminal,
  desktopAdapter,
  findSection,
  memberIds,
  sectionLines,
  singleResourceIntent,
  startCore,
  terminalResult,
  NO_AMBIGUITY,
  surfaceToText,
} from './helpers.ts';
import { resultExplanation } from '../src/view-model.ts';

describe('status explanation', () => {
  it('renders all six dimensions verbatim from the projection and never a success boolean', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId),
      selectedValidationOutcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
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
    expect(resultLines).toContain('coverage: NOT_APPLICABLE');
    expect(resultLines).toContain('stop reason: NONE');
    expect(resultLines).toContain('validation summary: ALL_PASSED (passed 1, failed 0)');

    // The view model has NO success/completion boolean: exact key set.
    const explanation = resultExplanation(terminalResult(contractId));
    expect(Object.keys(explanation).sort()).toStrictEqual(
      [
        'contractId',
        'coverage',
        'recordedAt',
        'requestFulfillment',
        'selectionAcquisition',
        'snapshotId',
        'stopReason',
        'targetResolution',
        'validationSummary',
        'visibilityNotes',
      ].sort(),
    );
    const explanationText = surfaceToText(refreshed.display);
    expect(explanationText.toLowerCase()).not.toContain('success: true');
    // No rendered line in the result section is a bare boolean claim.
    for (const rendered of explanationText.split('\n')) {
      expect(rendered.endsWith(': true')).toBe(false);
      expect(rendered.endsWith(': false')).toBe(false);
    }
    await adapter.close();
    await core.stop();
  });

  it('renders PARTIAL/TRUNCATED truthfully when a safety cap stops the request (C02); never presents COMPLETE', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
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
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    expect(resultLines).toContain('request fulfillment: PARTIAL');
    expect(resultLines).toContain('coverage: TRUNCATED');
    expect(resultLines).toContain('stop reason: GLOBAL_SAFETY_LIMIT');
    expect(resultLines).not.toContain('request fulfillment: COMPLETE');
    await adapter.close();
    await core.stop();
  });

  it('unsupported/out-of-scope renders visibly instead of being approximated as supported (C15)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'UNSUPPORTED',
        validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 1 },
      }),
      selectedValidationOutcomes: [
        { memberId: 'target-file-001', requiredValidationPassed: false },
      ],
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const refreshed = await adapter.refresh();
    const rendered = surfaceToText(refreshed.display);
    expect(rendered).toContain('stop reason: UNSUPPORTED');
    expect(rendered).toContain('request fulfillment: UNSATISFIED');
    expect(rendered).toContain(
      'visibility: Unsupported/out-of-scope content is visible and was NOT approximated as supported.',
    );
    expect(rendered).not.toContain('request fulfillment: COMPLETE');
    await adapter.close();
    await core.stop();
  });

  it('a user-confirmed selection whose required validation FAILED still renders as not-complete (C27)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    // The user confirmed a batch selection (real confirmation evidence exists)…
    const outcome = await confirmCollectionTask(adapter, 2);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    expect(outcome.rejections).toStrictEqual([]);
    // …but Core projects truncated/missing-track validation: the projection,
    // not the confirmation, decides the display.
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'VERIFIED_SUBSET',
        stopReason: 'VALIDATION_FAILED',
        validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 2 },
      }),
      selectedValidationOutcomes: memberIds(2).map((memberId) => ({
        memberId,
        requiredValidationPassed: false,
      })),
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const refreshed = await adapter.refresh();
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    expect(resultLines).toContain('selection acquisition: FAILED');
    expect(resultLines).toContain('validation summary: FAILED (passed 0, failed 2)');
    expect(resultLines).not.toContain('selection acquisition: COMPLETE');
    await adapter.close();
    await core.stop();
  });

  it('selection COMPLETE over a discovered subset never displays requested-scope completion (C14)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 2);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'UNKNOWN',
        targetResolution: 'RESOLVED',
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
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    expect(resultLines).toContain('selection acquisition: COMPLETE');
    expect(resultLines).toContain('request fulfillment: UNKNOWN');
    expect(resultLines).toContain('coverage: VERIFIED_SUBSET');
    expect(resultLines).toContain(
      'visibility: Coverage is not VERIFIED_COMPLETE; full requested-scope accounting is not claimed.',
    );
    await adapter.close();
    await core.stop();
  });

  it('discovery-budget truncation renders the discovered subset truthfully (C23)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 2);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
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
    expect(rendered).toContain('coverage: TRUNCATED');
    expect(rendered).toContain('stop reason: DISCOVERY_BUDGET_EXHAUSTED');
    expect(rendered).toContain(
      'visibility: Discovery stopped at its budget: undiscovered requested content may exist and is not claimed complete.',
    );
    await adapter.close();
    await core.stop();
  });

  it('quality claims mirror the projection exactly; the surface never upgrades or re-labels them (C09)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'NONE',
        validationSummary: { status: 'PARTIAL', passedCount: 1, failedCount: 1 },
      }),
      selectedValidationOutcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const refreshed = await adapter.refresh();
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    // Exactly what Core claims — no thumbnail→original or ad→main upgrade.
    expect(resultLines).toContain('target resolution: PARTIAL');
    expect(resultLines).toContain('validation summary: PARTIAL (passed 1, failed 1)');
    expect(resultLines.filter((l) => l.startsWith('visibility')).join(' ')).toContain(
      'Required validation has failed or unvalidated members; completion is not claimed.',
    );
    await adapter.close();
    await core.stop();
  });

  it('no result section renders at all while no terminal projection exists (no UI-derived completion)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    expect(outcome.rejections).toStrictEqual([]);
    expect(findSection(outcome.display, 'Result explanation')).toBeUndefined();
    expect(findSection(outcome.display, 'Selection / progress')).toBeDefined();
    await adapter.close();
    await core.stop();
  });

  it('an unconfirmed draft intent never renders any status or result section', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    expect(entered.display.screen).toBe('intent-preview');
    expect(findSection(entered.display, 'Result explanation')).toBeUndefined();
    expect(findSection(entered.display, 'Selection / progress')).toBeUndefined();
    await adapter.close();
    await core.stop();
  });
});
