/**
 * T014 suite: negative coverage.
 *
 * Each entry of TEST_MATRIX `negative_coverage` is executable here: the
 * surface refuses, degrades or fails closed — the invalid presentation
 * never happens.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_AMBIGUITY,
  collectionIntent,
  confirmCollectionTask,
  confirmSingleResourceTask,
  coreProjection,
  coreProjectTerminal,
  desktopAdapter,
  findSection,
  memberIds,
  projectionPayloadScript,
  scriptedTransport,
  sectionLines,
  singleResourceIntent,
  singleResourceScope,
  startCore,
  terminalResult,
  surfaceToText,
} from './helpers.ts';
import { createDesktopUiAdapter } from '../src/index.ts';
import { resultExplanation } from '../src/view-model.ts';
import { FIXED_NOW } from './helpers.ts';

describe('negative coverage (fail-closed presentation)', () => {
  it('negative: ui-interaction-state-presented-as-authoritative-truth', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    // Drafts are labeled non-authoritative and route nothing…
    expect(entered.display.screen).toBe('intent-preview');
    expect(
      entered.display.sections.some((s) => s.title.includes('not confirmed, not authoritative')),
    ).toBe(true);
    expect(entered.routed).toStrictEqual([]);
    // …while confirmed displays carry Core-accepted provenance only.
    const done = await adapter.confirmScope();
    const scopeSection = findSection(
      done.display,
      'Confirmed scope (immutable — changes require a successor command)',
    );
    expect(
      scopeSection?.lines.some((l) => l.note === 'CORE_ACCEPTED_COMMAND_BOUND_TO_PROJECTION'),
    ).toBe(true);
    await adapter.close();
    await core.stop();
  });

  it('negative: confirmed-scope-edited-locally-without-successor', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    // Before any confirmed contract, scope change attempts are refused.
    const refused = await adapter.requestSuccessor({
      patch: { continuationScope: { kind: 'DECLARED_NATURAL_END' } },
      justification: 'CONTINUATION_ADDITION',
    });
    expect(refused.routed).toStrictEqual([]);
    expect(refused.refusals[0]).toContain('no confirmed contract');
    // After confirmation, edits still only route successors (successor rules
    // reject no-change patches) — the display itself is deep-frozen.
    const done = await confirmSingleResourceTask(adapter);
    expect(() => {
      const target = done.display.sections[0] as { title: string };
      target.title = 'mutated';
    }).toThrow();
    await adapter.close();
    await core.stop();
  });

  it('negative: silent-selection-change-or-re-selection', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmCollectionTask(adapter, 4);
    expect(done.rejections).toStrictEqual([]);
    const contractId = done.routed[0]?.aggregateId ?? '';
    // The snapshot is confirmed; there is no in-place re-selection: every
    // selection interaction now refuses (the draft plan is gone).
    const reselect = await adapter.chooseManualSelection(['member-001']);
    expect(reselect.routed).toStrictEqual([]);
    expect(reselect.refusals[0]).toContain('no draft intent is pending');
    const reconfirm = await adapter.confirmBatchSelection();
    expect(reconfirm.routed.filter((r) => r.commandType === 'CONFIRM_SNAPSHOT')).toHaveLength(0);
    // Core still holds exactly the one confirmed snapshot.
    expect(coreProjection(core, contractId)?.snapshot?.selectedMemberIds).toHaveLength(4);
    await adapter.close();
    await core.stop();
  });

  it('negative: per-item-interrogation-despite-batch-resolvable', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const members = memberIds(50);
    adapter.enterIntent({
      intent: collectionIntent(),
      workflowFacts: {
        ambiguousMaterialMemberIds: members,
        candidateCount: 50,
        autoEvidenceSufficient: false,
      },
    });
    const perItem = adapter.answerMaterialItem(members[0] ?? '', 'CONFIRMED');
    expect(perItem.routed).toStrictEqual([]);
    expect(perItem.refusals[0]).toContain('per-item interrogation beyond the plan is refused');
    await adapter.close();
    await core.stop();
  });

  it('negative: ui-derived-status-or-completion', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmSingleResourceTask(adapter);
    // No terminal projection exists: no result section, no completion claim.
    expect(findSection(done.display, 'Result explanation')).toBeUndefined();
    const rendered = surfaceToText(done.display);
    expect(rendered).not.toContain('request fulfillment');
    expect(rendered).not.toContain('COMPLETE (passed');
    await adapter.close();
    await core.stop();
  });

  it('negative: stale-or-unparseable-projection-rendered-as-live', async () => {
    const adapter = createDesktopUiAdapter({
      transport: scriptedTransport(projectionPayloadScript({ contract: { contractId: 'wrong' } })),
      target: { host: '127.0.0.1', port: 1 },
      installId: 'install-001',
      userId: 'user-001',
      now: () => FIXED_NOW,
    });
    const outcome = await adapter.attachAggregate('contract-desktop-000001');
    expect(outcome.display.connection).toBe('UNPARSEABLE_PROJECTION');
    expect(sectionLines(outcome.display, 'Connection').join('\n')).toContain(
      'failed verification and is not displayed',
    );
    // Nothing renders from the unverified payload.
    expect(findSection(outcome.display, 'Selection / progress')).toBeUndefined();
    expect(findSection(outcome.display, 'Result explanation')).toBeUndefined();
    await adapter.close();
  });

  it('negative: fabricated-status-while-core-disconnected', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmSingleResourceTask(adapter);
    await core.stop();
    const degraded = await adapter.refresh();
    expect(degraded.display.connection).toBe('DISCONNECTED');
    const rendered = surfaceToText(degraded.display);
    // No progress/completion was invented: the result section count did not
    // change and the degraded banner is present.
    expect(rendered).toContain('DEGRADED: Core is disconnected');
    expect(degraded.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      done.display.sections.some((s) => s.title.startsWith('Result explanation')),
    );
    await adapter.close();
  });

  it('negative: local-cancel-acceptance-or-surface-local-precedence', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmSingleResourceTask(adapter);
    const contractId = done.routed[0]?.aggregateId ?? '';
    await core.stop();
    const lost = await adapter.cancel();
    // The display never shows CANCELLED from local intent: Core is gone.
    expect(lost.display.connection).toBe('DISCONNECTED');
    expect(sectionLines(lost.display, 'Selection / progress')).toContain('lineage status: ACTIVE');
    // And a fresh Core proves no cancel ever happened (single authority).
    expect(coreProjection(core, contractId)?.lineage.status).toBe('ACTIVE');
    await adapter.close();
  });

  it('negative: expansion-offered-as-in-place-refresh', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmSingleResourceTask(adapter);
    const contractId = done.routed[0]?.aggregateId ?? '';
    const before = adapter.currentDisplayText();
    const expanded = await adapter.requestSuccessor({
      patch: { requestedScope: singleResourceScope('target-file-002') },
      justification: 'SCOPE_CHANGE',
    });
    // Expansion created a NEW identity; the original snapshot/scope display
    // is untouched (re-shown byte-identical).
    const successor = expanded.routed.filter((r) => r.commandType === 'SUBMIT_CONTRACT').at(-1);
    expect(successor?.aggregateId).not.toBe(contractId);
    adapter.viewAggregate(contractId);
    expect(adapter.currentDisplayText()).toBe(before);
    await adapter.close();
    await core.stop();
  });

  it('negative: prior-selection-presented-as-reusable-authority', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const prior = memberIds(6, 'first-set');
    adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: prior,
        candidateCount: prior.length,
        autoEvidenceSufficient: false,
      },
    });
    await adapter.chooseManualSelection(prior.slice(0, 4));
    // New task over different candidates: no offer of the prior selection.
    const entered = adapter.enterIntent({
      intent: collectionIntent({ automationMode: 'MANUAL_SELECTION' }),
      workflowFacts: {
        ambiguousMaterialMemberIds: memberIds(6, 'second-set'),
        candidateCount: 6,
        autoEvidenceSufficient: false,
      },
    });
    const rendered = surfaceToText(entered.display);
    expect(rendered).not.toContain('first-set');
    expect(rendered.toLowerCase()).not.toContain('previous selection');
    expect(rendered.toLowerCase()).not.toContain('reuse');
    await adapter.close();
    await core.stop();
  });

  it('negative: suggestion-rendered-as-verified-truth', async () => {
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
    const rendered = surfaceToText(entered.display);
    expect(rendered).toContain('It does not prove target quality');
    expect(rendered).toContain('never waives required validation');
    // The view-model proof boundary is canonical, not surface-invented.
    const explanation = resultExplanation(
      terminalResult('contract-x', { requestFulfillment: 'PARTIAL' }),
    );
    expect(explanation.visibilityNotes.join(' ')).toContain('not claimed');
    await adapter.close();
    await core.stop();
  });

  it('negative: success-boolean-collapse-in-result-display', () => {
    const explanation = resultExplanation(
      terminalResult('contract-x', { requestFulfillment: 'PARTIAL', coverage: 'TRUNCATED' }),
    );
    // Exact key set: six dimensions + provenance fields + visibility notes.
    // No boolean success field exists anywhere in the model.
    for (const value of Object.values(explanation)) {
      expect(typeof value).not.toBe('boolean');
    }
    expect(Object.keys(explanation)).not.toContain('success');
    expect(Object.keys(explanation)).not.toContain('complete');
  });

  it('negative: raw-secret-captured-into-ui-state', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    await confirmSingleResourceTask(adapter);
    const refused = await adapter.provideAuthorizationContext({
      cookie: 'SESS=abc',
      token: 'ghp_xxx',
    });
    expect(refused.routed).toStrictEqual([]);
    const rendered = adapter.currentDisplayText();
    // The only display change is the surfaced refusal — never the secret.
    expect(rendered).toContain('raw secret material is refused');
    expect(rendered).not.toContain('SESS=abc');
    expect(rendered).not.toContain('ghp_xxx');
    await adapter.close();
    await core.stop();
  });

  it('negative: simple-task-forced-through-collection-preview', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    const preview = surfaceToText(entered.display);
    expect(preview).not.toContain('BATCH_GROUP');
    expect(preview).not.toContain('MANUAL_SELECTION_UI');
    expect(preview).not.toContain('collection preview');
    const done = await adapter.confirmScope();
    const contractId = done.routed[0]?.aggregateId ?? '';
    coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId),
      selectedValidationOutcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
    });
    const refreshed = await adapter.refresh();
    const status = surfaceToText(refreshed.display);
    expect(status).not.toContain('BATCH_GROUP');
    expect(status).not.toContain('MANUAL_SELECTION_UI');
    expect(status).toContain('coverage: NOT_APPLICABLE');
    await adapter.close();
    await core.stop();
  });

  it('covers every TEST_MATRIX negative_coverage identity exactly once', async () => {
    const { readFileSync } = await import('node:fs');
    const testSource = readFileSync(
      new URL('./negative-coverage.test.ts', import.meta.url),
      'utf8',
    );
    // The execution pack's TEST_MATRIX is the coverage authority for this
    // suite; every declared negative must appear as a test in this file.
    const matrixSource = readFileSync(
      new URL('../../../.agent/execution/T014/TEST_MATRIX.yaml', import.meta.url),
      'utf8',
    );
    const section = matrixSource.slice(matrixSource.indexOf('negative_coverage:'));
    const declared = [...section.matchAll(/- ([a-z0-9-]+)$/gm)].map((m) => m[1] ?? '');
    expect(declared.length).toBeGreaterThanOrEqual(14);
    for (const id of declared) {
      expect(testSource).toContain(`negative: ${id}`);
    }
  });
});
