/**
 * T014 suite: batch confirmation.
 *
 * TEST_MATRIX `batch-confirmation`:
 * - one scope-level confirmation and/or one batch/group confirmation resolves
 *   shared ambiguity; per-item prompts appear only for at most
 *   MAX_MATERIAL_ITEM_CONFIRMATIONS material items;
 * - a 50-candidate-style selection renders as one batch/manual surface with
 *   no per-item interrogation burden;
 * - confirmation UI states that confirmation proves selection only and never
 *   implies target quality/membership truth.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_MATERIAL_ITEM_CONFIRMATIONS,
  planConfirmationWorkflow,
} from '@xdownload/discovery-recipe';
import {
  NO_AMBIGUITY,
  collectionIntent,
  desktopAdapter,
  findSection,
  memberIds,
  sectionLines,
  singleResourceIntent,
  startCore,
} from './helpers.ts';

describe('batch confirmation', () => {
  it('a 50-candidate ambiguity renders exactly one BATCH_GROUP surface and zero per-item prompts', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const members = memberIds(50);
    const entered = adapter.enterIntent({
      intent: collectionIntent(),
      workflowFacts: {
        ambiguousMaterialMemberIds: members,
        candidateCount: 50,
        autoEvidenceSufficient: false,
      },
    });
    expect(entered.refusals).toStrictEqual([]);
    const text = JSON.stringify(entered.display);
    expect(text).toContain('BATCH_GROUP (50 member(s))');
    expect(text).not.toContain('MATERIAL_ITEM');
    expect(
      entered.display.sections.filter((s) => s.title.startsWith('Confirmation plan')),
    ).toHaveLength(1);

    // Per-item interrogation is refused while the batch surface resolves it.
    const perItem = adapter.answerMaterialItem(members[0] ?? '', 'CONFIRMED');
    expect(perItem.routed).toStrictEqual([]);
    expect(perItem.refusals[0]).toContain('not part of the Core-produced material-item plan');

    const outcome = await adapter.confirmBatchSelection();
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.refusals).toStrictEqual([]);
    // One batch confirmation routed the contract and ONE snapshot command…
    expect(outcome.routed.map((r) => r.commandType)).toStrictEqual([
      'SUBMIT_CONTRACT',
      'CONFIRM_SNAPSHOT',
    ]);
    // …whose Core-accepted projection binds all 50 members with one claim.
    const snapshot = core.server.inspectProjection(outcome.routed[0]?.aggregateId ?? '')?.snapshot;
    expect(snapshot?.selectedMemberIds).toStrictEqual(members);
    await adapter.close();
    await core.stop();
  });

  it('material-item prompts appear only within the canonical bound and never exceed it', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const members = memberIds(MAX_MATERIAL_ITEM_CONFIRMATIONS);
    const entered = adapter.enterIntent({
      intent: collectionIntent(),
      workflowFacts: {
        ambiguousMaterialMemberIds: members,
        candidateCount: members.length,
        autoEvidenceSufficient: false,
      },
    });
    const text = JSON.stringify(entered.display);
    for (const member of members) {
      expect(text).toContain(`MATERIAL_ITEM (${member})`);
    }
    expect(text).not.toContain('BATCH_GROUP');
    expect(text).not.toContain('MANUAL_SELECTION_UI');

    const confirmed = await adapter.confirmScope();
    expect(confirmed.routed).toStrictEqual([]);
    expect(confirmed.refusals[0]).toContain('has no SCOPE_LEVEL request');
    await adapter.close();
    await core.stop();
  });

  it('one scope-level confirmation resolves unambiguous scope without any item prompts', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    const text = JSON.stringify(entered.display);
    expect(text).toContain('SCOPE_LEVEL');
    expect(text).not.toContain('BATCH_GROUP');
    expect(text).not.toContain('MATERIAL_ITEM');
    expect(text).not.toContain('MANUAL_SELECTION_UI');
    await adapter.close();
    await core.stop();
  });

  it('the confirmation UI states selection-only proof and never implies quality/membership truth', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: collectionIntent(),
      workflowFacts: {
        ambiguousMaterialMemberIds: memberIds(4),
        candidateCount: 4,
        autoEvidenceSufficient: false,
      },
    });
    const planSection = findSection(entered.display, 'Confirmation plan');
    expect(planSection).toBeDefined();
    const lines = sectionLines(entered.display, 'Confirmation plan');
    expect(lines.find((l) => l.startsWith('selection-only proof'))).toContain('SELECTION only');
    expect(lines.find((l) => l.startsWith('selection-only proof'))).toContain(
      'never waives required validation',
    );
    const batchRequest = lines.find((l) => l.startsWith('confirmation request: BATCH_GROUP'));
    expect(batchRequest).toContain('proves SELECTION');
    // No "verified quality/truth" wording anywhere in the confirmation UI.
    expect(JSON.stringify(entered.display).toLowerCase()).not.toContain('verified quality');
    await adapter.close();
    await core.stop();
  });

  it('the rendered plan matches the canonical workflow exactly (no re-derivation)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const members = memberIds(2);
    const entered = adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'ASSISTED' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: members,
        candidateCount: 2,
        autoEvidenceSufficient: false,
      },
    });
    const canonical = planConfirmationWorkflow({
      contract: {
        automationMode: 'ASSISTED',
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE' },
      },
      scopeScopeKey: 'entire_supported_collection:collection/playlist-001',
      ambiguousMaterialMemberIds: members,
      candidateCount: 2,
      autoEvidenceSufficient: false,
    });
    const lines = sectionLines(entered.display, 'Confirmation plan');
    const renderedRequests = lines.filter((l) => l.startsWith('confirmation request'));
    expect(renderedRequests).toHaveLength(canonical.requests.length);
    expect(renderedRequests[0]).toContain('MATERIAL_ITEM');
    expect(renderedRequests[1]).toContain('MATERIAL_ITEM');
    await adapter.close();
    await core.stop();
  });
});
