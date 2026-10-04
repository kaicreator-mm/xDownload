/**
 * T014 suite: immutable confirmed scope.
 *
 * TEST_MATRIX `immutable-confirmed-scope`:
 * - confirmed requested_scope, continuation scope and coverage target render
 *   immutable and cannot be edited through UI interaction state;
 * - load-more/refresh/continue/expansion interactions route successor-identity
 *   commands; the original confirmed display never mutates in place;
 * - budget or authorization-context changes never alter the displayed
 *   requested scope.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_AMBIGUITY,
  collectionIntent,
  collectionPageRangeScope,
  confirmCollectionTask,
  confirmSingleResourceTask,
  desktopAdapter,
  lastRoutedOfType,
  sectionLines,
  singleResourceIntent,
  singleResourceScope,
  startCore,
} from './helpers.ts';

describe('immutable confirmed scope', () => {
  it('renders confirmed requested scope, continuation scope and coverage target as immutable Core-accepted display', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.refusals).toStrictEqual([]);

    const scopeLines = sectionLines(
      outcome.display,
      'Confirmed scope (immutable — changes require a successor command)',
    );
    expect(scopeLines.join('\n')).toContain(
      'requested scope: {"kind":"single_resource","targetId":"target-file-001"}',
    );
    expect(scopeLines.join('\n')).toContain('continuation scope: {"kind":"NONE"}');
    expect(scopeLines.join('\n')).toContain('(CORE_ACCEPTED_COMMAND_BOUND_TO_PROJECTION)');
    expect(scopeLines.join('\n')).toContain(
      'immutability: display is read-only; expansion routes a successor identity',
    );
    await adapter.close();
    await core.stop();
  });

  it('the rendered display tree is frozen: no in-place mutation of confirmed scope is possible', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    expect(outcome.display.sections.length).toBeGreaterThan(0);
    expect(Object.isFrozen(outcome.display)).toBe(true);
    const scopeSection = outcome.display.sections.find((s) =>
      s.title.startsWith('Confirmed scope'),
    );
    expect(scopeSection).toBeDefined();
    expect(Object.isFrozen(scopeSection)).toBe(true);
    expect(() => {
      const mutable = scopeSection as { title: string };
      mutable.title = 'edited scope';
    }).toThrow();
    await adapter.close();
    await core.stop();
  });

  it('load-more/continue routes a successor-identity command; the original confirmed display never mutates', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);

    const intent = collectionIntent({
      requestedScope: collectionPageRangeScope('collection/playlist-001', 1, 3),
    });
    const entered = adapter.enterIntent({ intent, workflowFacts: NO_AMBIGUITY });
    expect(entered.refusals).toStrictEqual([]);
    const confirmed = await adapter.confirmScope();
    expect(confirmed.rejections).toStrictEqual([]);

    const originalText = adapter.currentDisplayText();
    const originalContractId = confirmed.routed[0]?.aggregateId ?? '';
    expect(originalContractId).toMatch(/^contract-desktop-/);

    const expansion = await adapter.requestSuccessor({
      patch: {
        requestedScope: collectionPageRangeScope('collection/playlist-001', 4, 6),
      },
      justification: 'SCOPE_CHANGE',
    });
    expect(expansion.rejections).toStrictEqual([]);
    expect(expansion.refusals).toStrictEqual([]);

    // The expansion routed a NEW successor identity, never the original one.
    const successorRoute = lastRoutedOfType(expansion, 'SUBMIT_CONTRACT');
    expect(successorRoute).toBeDefined();
    expect(successorRoute?.aggregateId).not.toBe(originalContractId);

    // The original confirmed display is byte-identical when re-shown.
    const viewOriginal = adapter.viewAggregate(originalContractId);
    expect(viewOriginal.refusals).toStrictEqual([]);
    expect(adapter.currentDisplayText()).toBe(originalText);

    await adapter.close();
    await core.stop();
  });

  it('an authorization-context change routes a successor command and never alters the displayed requested scope', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const confirmed = await confirmSingleResourceTask(adapter);
    const originalContractId = confirmed.routed[0]?.aggregateId ?? '';
    const before = sectionLines(
      confirmed.display,
      'Confirmed scope (immutable — changes require a successor command)',
    ).filter((l) => l.startsWith('requested scope'));

    const outcome = await adapter.provideAuthorizationContext('authctx/local-002');
    expect(outcome.refusals).toStrictEqual([]);
    expect(outcome.rejections).toStrictEqual([]);
    const successorRoute = lastRoutedOfType(outcome, 'SUBMIT_CONTRACT');
    expect(successorRoute).toBeDefined();
    expect(successorRoute?.aggregateId).not.toBe(originalContractId);

    // The successor shows the SAME requested scope (only auth changed)…
    const successorLines = sectionLines(
      outcome.display,
      'Confirmed scope (immutable — changes require a successor command)',
    ).filter((l) => l.startsWith('requested scope'));
    expect(successorLines).toStrictEqual(before);

    // …and the original display is unchanged when re-shown.
    adapter.viewAggregate(originalContractId);
    expect(
      sectionLines(reDisplay(adapter), 'Confirmed scope').filter((l) =>
        l.startsWith('requested scope'),
      ),
    ).toStrictEqual(before);
    await adapter.close();
    await core.stop();
  });

  it('scope edits are not representable in place: expansion patches can only route successors', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const confirmed = await confirmSingleResourceTask(adapter);
    const originalContractId = confirmed.routed[0]?.aggregateId ?? '';
    const before = adapter.currentDisplayText();

    // A genuine scope change routes a successor with a new identity.
    const expanded = await adapter.requestSuccessor({
      patch: {
        requestedScope: singleResourceScope('target-file-002'),
      },
      justification: 'SCOPE_CHANGE',
    });
    const successorRoute = lastRoutedOfType(expanded, 'SUBMIT_CONTRACT');
    expect(successorRoute).toBeDefined();
    expect(successorRoute?.aggregateId).not.toBe(originalContractId);
    // Original display still intact.
    adapter.viewAggregate(originalContractId);
    expect(adapter.currentDisplayText()).toBe(before);

    // A no-change successor attempt is rejected by the canonical transition
    // rules and surfaced — there is no in-place path at all.
    const noChange = await adapter.requestSuccessor({
      patch: {},
      justification: 'SCOPE_CHANGE',
    });
    expect(noChange.routed).toStrictEqual([]);
    expect(noChange.rejections.length).toBeGreaterThan(0);
    await adapter.close();
    await core.stop();
  });

  it('interaction state (drafts) never merges into the confirmed display', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent({
        targetRef: 'target-draft-999',
        requestedScope: singleResourceScope('target-draft-999'),
      }),
      workflowFacts: NO_AMBIGUITY,
    });
    expect(entered.display.screen).toBe('intent-preview');
    expect(entered.routed).toStrictEqual([]);
    // The draft never produced a confirmed-scope section…
    expect(entered.display.sections.some((s) => s.title.startsWith('Confirmed scope'))).toBe(false);
    // …and confirming through the seam replaces the draft screen entirely.
    const done = await adapter.confirmScope();
    expect(done.display.screen).toBe('task-status');
    expect(done.display.sections.some((s) => s.title.startsWith('Intent (DRAFT'))).toBe(false);
    await adapter.close();
    await core.stop();
  });

  it('batch selection freezes the coverage target display; later interactions never mutate it', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 5);
    expect(outcome.rejections).toStrictEqual([]);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const coverageBefore = sectionLines(
      outcome.display,
      'Confirmed scope (immutable — changes require a successor command)',
    ).find((l) => l.startsWith('coverage target'));
    expect(coverageBefore).toBeDefined();
    expect(coverageBefore).toContain('snapshot snapshot-desktop-');

    // A cancel routed afterwards changes lineage state, not scope display.
    await adapter.cancel();
    adapter.viewAggregate(contractId);
    const coverageAfter = sectionLines(
      reDisplay(adapter),
      'Confirmed scope (immutable — changes require a successor command)',
    ).find((l) => l.startsWith('coverage target'));
    expect(coverageAfter).toBe(coverageBefore);
    await adapter.close();
    await core.stop();
  });
});

/** Re-render the current display from the adapter (display trees are rebuilt, never mutated). */
function reDisplay(adapter: ReturnType<typeof desktopAdapter>) {
  return adapter.currentDisplay();
}
