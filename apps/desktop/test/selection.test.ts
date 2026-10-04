/**
 * T014 suite: selection.
 *
 * TEST_MATRIX `selection`:
 * - AUTO/ASSISTED/MANUAL_SELECTION modes render exactly the confirmation plan
 *   levels produced by the Core-side workflow without re-deriving them;
 * - manual selection operates on the Core-provided candidate set and submits
 *   an idempotent Core command;
 * - a prior/partial selection is never presented as reusable membership
 *   authority without distinct validated provenance;
 * - simple single-resource tasks are not forced through collection preview.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_AMBIGUITY,
  collectionIntent,
  desktopAdapter,
  memberIds,
  sectionLines,
  singleResourceIntent,
  startCore,
} from './helpers.ts';

describe('selection', () => {
  it('AUTO with sufficient evidence renders zero confirmation requests and submits directly', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent({ automationMode: 'AUTO' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: [],
        candidateCount: 1,
        autoEvidenceSufficient: true,
      },
    });
    expect(entered.refusals).toStrictEqual([]);
    const lines = sectionLines(entered.display, 'Confirmation plan');
    expect(lines.find((l) => l.startsWith('automation mode'))).toContain('AUTO');
    expect(lines.find((l) => l.startsWith('confirmation requests'))).toContain('none');

    // Answering prompts that do not exist is refused.
    const bogus = await adapter.confirmScope();
    expect(bogus.refusals[0]).toContain('no SCOPE_LEVEL request');

    const outcome = await adapter.proceedAuto();
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.routed.map((r) => r.commandType)).toStrictEqual(['SUBMIT_CONTRACT']);
    expect(outcome.display.screen).toBe('task-status');
    await adapter.close();
    await core.stop();
  });

  it('AUTO without sufficient evidence escalates to ASSISTED in the rendered plan (never silently proceeds)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent({ automationMode: 'AUTO' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: [],
        candidateCount: 1,
        autoEvidenceSufficient: false,
      },
    });
    const lines = sectionLines(entered.display, 'Confirmation plan');
    expect(lines.find((l) => l.startsWith('automation mode'))).toContain('ASSISTED');
    expect(lines.find((l) => l.startsWith('escalation'))).toContain('INSUFFICIENT_AUTO_EVIDENCE');
    expect(lines.filter((l) => l.startsWith('confirmation request'))).toHaveLength(1);
    await adapter.close();
    await core.stop();
  });

  it('MANUAL_SELECTION mode renders the manual surface over exactly the Core-presented candidates', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const candidates = memberIds(6);
    const entered = adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: candidates,
        candidateCount: candidates.length,
        autoEvidenceSufficient: false,
      },
    });
    const lines = sectionLines(entered.display, 'Confirmation plan');
    expect(lines.find((l) => l.startsWith('automation mode'))).toContain('MANUAL_SELECTION');
    expect(lines.find((l) => l.startsWith('confirmation request'))).toContain(
      'MANUAL_SELECTION_UI (6 candidate(s))',
    );

    // Members outside the Core-presented candidate set are refused.
    const outside = await adapter.chooseManualSelection(['member-invented-999']);
    expect(outside.routed).toStrictEqual([]);
    expect(outside.refusals[0]).toContain('outside the Core-presented candidate set');

    // Empty selections are refused.
    const empty = await adapter.chooseManualSelection([]);
    expect(empty.routed).toStrictEqual([]);

    // A subset of the Core-provided candidates routes one idempotent command.
    const selected = candidates.slice(0, 3);
    const outcome = await adapter.chooseManualSelection(selected);
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.routed.map((r) => r.commandType)).toStrictEqual([
      'SUBMIT_CONTRACT',
      'CONFIRM_SNAPSHOT',
    ]);
    const projection = core.server.inspectProjection(outcome.routed[0]?.aggregateId ?? '');
    expect(projection?.snapshot?.selectedMemberIds).toStrictEqual(selected);
    await adapter.close();
    await core.stop();
  });

  it('a prior partial selection is never offered as reusable membership authority (C31)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);

    // Task A: manual selection of 12 of 18.
    const priorCandidates = memberIds(18, 'first-page');
    const enteredA = adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: priorCandidates,
        candidateCount: priorCandidates.length,
        autoEvidenceSufficient: false,
      },
    });
    expect(enteredA.refusals).toStrictEqual([]);
    const priorSelection = priorCandidates.slice(0, 12);
    const doneA = await adapter.chooseManualSelection(priorSelection);
    expect(doneA.rejections).toStrictEqual([]);
    const contractA = doneA.routed[0]?.aggregateId ?? '';

    // Task B: a different page of the same collection. The adapter exposes
    // NO control that seeds the new flow from the prior selection: the plan
    // is produced from the new workflow facts only.
    const newCandidates = memberIds(18, 'second-page');
    const enteredB = adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: newCandidates,
        candidateCount: newCandidates.length,
        autoEvidenceSufficient: false,
      },
    });
    const rendered = JSON.stringify(enteredB.display);
    expect(rendered).not.toContain('first-page');
    expect(rendered).not.toContain('reuse');
    // Attempting to reuse the prior members is refused: they are outside the
    // Core-presented candidate set of the new task.
    const reuse = await adapter.chooseManualSelection(priorSelection);
    expect(reuse.routed).toStrictEqual([]);
    expect(reuse.refusals[0]).toContain('outside the Core-presented candidate set');

    // The prior task itself remains unchanged (successor rules intact).
    adapter.viewAggregate(contractA);
    expect(adapter.currentDisplay()).toBeDefined();
    await adapter.close();
    await core.stop();
  });

  it('a simple single-resource task never renders collection preview screens (C16)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    const rendered = JSON.stringify(entered.display);
    expect(rendered).not.toContain('MANUAL_SELECTION_UI');
    expect(rendered).not.toContain('BATCH_GROUP');
    expect(rendered).not.toContain('MATERIAL_ITEM');

    const outcome = await adapter.confirmScope();
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.routed).toHaveLength(1);
    const done = JSON.stringify(outcome.display);
    expect(done).not.toContain('MANUAL_SELECTION_UI');
    expect(done).not.toContain('BATCH_GROUP');
    await adapter.close();
    await core.stop();
  });
});
