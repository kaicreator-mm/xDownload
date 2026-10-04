/**
 * T014 suite: auth/action prompts.
 *
 * TEST_MATRIX `auth-action-prompts`:
 * - auth-required/blocked/action-required Core statuses surface as user
 *   prompts with the underlying partial truth shown;
 * - the UI collects no raw reusable secrets into ordinary state;
 *   authorization context stays opaque.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmCollectionTask,
  confirmSingleResourceTask,
  coreProjectTerminal,
  desktopAdapter,
  findSection,
  lastRoutedOfType,
  memberIds,
  sectionLines,
  singleResourceIntent,
  startCore,
  NO_AMBIGUITY,
  surfaceToText,
  terminalResult,
} from './helpers.ts';

describe('auth and action prompts', () => {
  it('an AUTH_REQUIRED stop surfaces a Core-sourced prompt with the partial truth shown (C10)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    // 16-of-18-style: whole-collection authorization acquires a subset; two
    // requested members are known auth-inaccessible.
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

    const promptSection = findSection(refreshed.display, 'Authorization / action prompt');
    expect(promptSection).toBeDefined();
    const promptLines = sectionLines(refreshed.display, 'Authorization / action prompt');
    expect(promptLines).toContain('prompt: AUTH_REQUIRED');
    expect(promptLines.find((l) => l.startsWith('authorization context'))).toContain(
      'authctx/local-001 (opaque reference',
    );

    // The underlying partial truth is shown alongside the prompt.
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    expect(resultLines).toContain('request fulfillment: PARTIAL');
    expect(resultLines).toContain('stop reason: AUTH_REQUIRED');

    // The requested scope is still displayed as requested (16-of-18 truth).
    const scopeLines = sectionLines(
      refreshed.display,
      'Confirmed scope (immutable — changes require a successor command)',
    );
    expect(scopeLines.join('\n')).toContain('entire_supported_collection');
    await adapter.close();
    await core.stop();
  });

  it('an AUTH_FAILED stop surfaces an auth-blocked prompt with the UNSATISFIED tuple (C24)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const projected = coreProjectTerminal(core, contractId, {
      result: terminalResult(contractId, {
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'BLOCKED',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'AUTH_FAILED',
        validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
      }),
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const refreshed = await adapter.refresh();
    const promptLines = sectionLines(refreshed.display, 'Authorization / action prompt');
    expect(promptLines).toContain('prompt: AUTH_BLOCKED');
    const resultLines = sectionLines(
      refreshed.display,
      'Result explanation (rendered verbatim from the Core projection)',
    );
    // The UNSATISFIED/BLOCKED/NOT_STARTED tuple renders, not a generic error.
    expect(resultLines).toContain('request fulfillment: UNSATISFIED');
    expect(resultLines).toContain('target resolution: BLOCKED');
    expect(resultLines).toContain('selection acquisition: NOT_STARTED');
    await adapter.close();
    await core.stop();
  });

  it('providing a new opaque authorization context routes an authorization successor command', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const confirmed = await confirmSingleResourceTask(adapter);
    const originalId = confirmed.routed[0]?.aggregateId ?? '';

    const outcome = await adapter.provideAuthorizationContext('authctx/local-002');
    expect(outcome.rejections).toStrictEqual([]);
    expect(outcome.refusals).toStrictEqual([]);
    const successor = lastRoutedOfType(outcome, 'SUBMIT_CONTRACT');
    expect(successor).toBeDefined();
    expect(successor?.aggregateId).not.toBe(originalId);
    // Core accepted the successor as a distinct aggregate bound to the old one.
    const projection = core.server.inspectProjection(successor?.aggregateId ?? '');
    expect(projection?.contract.supersedesContractId).toBe(originalId);
    await adapter.close();
    await core.stop();
  });

  it('the UI collects no raw reusable secrets: non-reference input is refused and never stored', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const confirmed = await confirmSingleResourceTask(adapter);
    const before = adapter.currentDisplayText();

    const secret = { cookie: 'SESS=abc', token: 'ghp_xxx', password: 'hunter2' };
    const refused = await adapter.provideAuthorizationContext(secret);
    expect(refused.routed).toStrictEqual([]);
    expect(refused.refusals[0]).toContain('raw secret material is refused');
    // Nothing about the secret appears anywhere in the display state…
    const rendered = JSON.stringify(refused.display) + adapter.currentDisplayText();
    expect(rendered).not.toContain('SESS=abc');
    expect(rendered).not.toContain('ghp_xxx');
    expect(rendered).not.toContain('hunter2');
    // …and the only change is the surfaced fail-closed refusal itself.
    expect(surfaceToText(refused.display)).toContain('raw secret material is refused');
    expect(refused.display.sections.some((s) => JSON.stringify(s).includes('SESS'))).toBe(false);
    expect(before).not.toContain('raw secret material is refused');
    expect(confirmed.routed).toHaveLength(1);
    await adapter.close();
    await core.stop();
  });

  it('authorization context stays opaque: only references render, never secret-shaped fields', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const entered = adapter.enterIntent({
      intent: singleResourceIntent(),
      workflowFacts: NO_AMBIGUITY,
    });
    const previewText = surfaceToText(entered.display);
    expect(previewText).toContain('authctx/local-001');
    expect(previewText).toContain('opaque reference');
    const done = await adapter.confirmScope();
    // The confirmed screen shows scope facts without any secret material.
    expect(surfaceToText(done.display)).not.toContain('cookie');
    expect(surfaceToText(done.display)).not.toContain('token');
    await adapter.close();
    await core.stop();
  });
});
