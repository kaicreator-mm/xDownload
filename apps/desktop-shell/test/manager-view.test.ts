/**
 * T08 download-manager renderer state tests — the pure state machine the
 * renderer page binds to, pinned in the Node vitest run:
 *
 * - loading / ready / empty / error / bridge-missing are first-class states;
 * - the ONLY source of rows and connection words is the shell's answer
 *   document (the Core projection the shell serves);
 * - NO fabricated total, percentage or ETA is ever derivable from the
 *   display text of any row (absent facts render as "unknown" words);
 * - the keyboard flow is modeled: form → preview → confirm/discard (Escape).
 */

import { describe, expect, it } from 'vitest';
import type { ManagerJobListDocument, ManagerJobRowDocument } from '../src/main/shell-contract.ts';
import {
  applyAction,
  applyList,
  bridgeMissing,
  initialManagerState,
  jobActions,
  jobProgressText,
  jobStatusText,
  noticeShown,
  previewOpened,
  setBusy,
} from '../src/renderer/manager-state.ts';

function jobListDocument(overrides: Partial<ManagerJobListDocument> = {}): ManagerJobListDocument {
  return {
    ok: true,
    document: 'xdownload.desktop.manager.jobs',
    connection: 'CONNECTED',
    jobs: [],
    pendingPreview: null,
    ...overrides,
  };
}

function presentRow(overrides: Partial<ManagerJobRowDocument> = {}): ManagerJobRowDocument {
  return {
    lineageId: 'contract-desktop-ab12cd34-000001',
    lane: 'legacy',
    present: true,
    contractStatus: 'CONFIRMED',
    revision: 3,
    lineageStatus: 'ACTIVE',
    selectedMemberCount: 1,
    failedMemberCount: 0,
    retriedMemberIds: [],
    terminal: null,
    retry: { available: false, reason: 'NO_FAILED_MEMBERS' },
    destination: null,
    ...overrides,
  };
}

describe('manager renderer states', () => {
  it('starts in loading and renders the fail-closed bridge-missing state', () => {
    const initial = initialManagerState();
    expect(initial.phase).toBe('loading');
    expect(initial.jobs).toEqual([]);
    const missing = bridgeMissing(initial);
    expect(missing.phase).toBe('bridge-missing');
    expect(missing.jobs).toEqual([]);
  });

  it('applyList adopts the shell document verbatim (rows and connection)', () => {
    const row = presentRow();
    const next = applyList(initialManagerState(), jobListDocument({ jobs: [row] }));
    expect(next.phase).toBe('ready');
    expect(next.connection).toBe('CONNECTED');
    expect(next.jobs).toEqual([row]);
  });

  it('a refresh refusal becomes a typed error notice — never a guessed list', () => {
    const next = applyList(initialManagerState(), {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'sender is not the shell window main frame',
    });
    expect(next.phase).toBe('ready');
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('sender is not the shell window main frame');
    expect(next.jobs).toEqual([]);
  });

  it('an unexpected document is refused, not rendered', () => {
    const forged = {
      ok: true,
      document: 'xdownload.desktop.manager.unknown',
    } as unknown as ManagerJobListDocument;
    const next = applyList(initialManagerState(), forged);
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('unexpected document');
  });

  it('busy flags gate the controls without changing any displayed truth', () => {
    const next = setBusy(applyList(initialManagerState(), jobListDocument()), true);
    expect(next.busy).toBe(true);
    expect(next.jobs).toEqual(applyList(initialManagerState(), jobListDocument()).jobs);
  });

  it('notices are transient presentation state', () => {
    const next = noticeShown(initialManagerState(), { kind: 'info', text: 'done' });
    expect(next.notice).toEqual({ kind: 'info', text: 'done' });
  });
});

describe('preview dialog state (keyboard flow model)', () => {
  const preview = {
    document: 'xdownload.desktop.manager.preview' as const,
    lineageId: 'contract-desktop-ab12cd34-000002',
    url: 'https://example.com/a.mp4',
    destination: null,
    automationMode: 'ASSISTED',
    confirmationRequests: [
      {
        level: 'SCOPE_LEVEL',
        description: 'SCOPE_LEVEL (single_resource:)',
        proves: 'the download target',
      },
    ],
  };

  it('previewOpened shows the dialog draft and a refusal becomes an error', () => {
    const opened = previewOpened(initialManagerState(), preview);
    expect(opened.pendingPreview).toEqual(preview);
    expect(opened.notice).toBeNull();
    const refused = previewOpened(initialManagerState(), {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'url rejected: only http(s) download URLs are admissible',
    });
    expect(refused.pendingPreview).toBeNull();
    expect(refused.notice?.kind).toBe('error');
    expect(refused.notice?.text).toContain('only http(s) download URLs are admissible');
  });

  it('confirm routes the action and closes the dialog from the fresh list', () => {
    const opened = previewOpened(initialManagerState(), preview);
    const confirmed = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: preview.lineageId,
      routed: true,
      rejections: [],
      refusalDetail: null,
      list: jobListDocument({ pendingPreview: null, jobs: [presentRow()] }),
    });
    expect(confirmed.pendingPreview).toBeNull();
    expect(confirmed.jobs.length).toBe(1);
    expect(confirmed.notice?.kind).toBe('info');
    expect(confirmed.notice?.text).toContain('admission');
  });

  it('a Core-typed rejection surfaces VERBATIM (code and message)', () => {
    const opened = previewOpened(initialManagerState(), preview);
    const rejected = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'cancel',
      lineageId: preview.lineageId,
      routed: true,
      rejections: [
        {
          code: 'LINEAGE_OWNER_CONFLICT',
          message: 'this lineage is durably owned by the new v0.2 Domain App',
        },
      ],
      refusalDetail: null,
      list: jobListDocument(),
    });
    expect(rejected.notice?.kind).toBe('error');
    expect(rejected.notice?.text).toContain('LINEAGE_OWNER_CONFLICT');
    expect(rejected.notice?.text).toContain('durably owned by the new v0.2 Domain App');
  });

  it('a not-routed action surfaces the refusal detail', () => {
    const answered = applyAction(initialManagerState(), {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'retry',
      lineageId: 'contract-desktop-ab12cd34-000001',
      routed: false,
      rejections: [],
      refusalDetail: 'retry unavailable: NO_FAILED_MEMBERS',
      list: jobListDocument(),
    });
    expect(answered.notice?.kind).toBe('error');
    expect(answered.notice?.text).toContain('retry unavailable: NO_FAILED_MEMBERS');
  });
});

describe('truthful display derivation (no fabricated total/ETA)', () => {
  it('an absent projection renders "unknown" words, never zeros or figures', () => {
    const absent = presentRow({
      present: false,
      contractStatus: null,
      revision: null,
      lineageStatus: null,
      selectedMemberCount: null,
      failedMemberCount: null,
    });
    expect(jobStatusText(absent)).toBe('no projection available (Core state unknown)');
    expect(jobProgressText(absent)).toBe('unknown');
  });

  it('a running row renders the projected status words only', () => {
    const running = presentRow();
    const status = jobStatusText(running);
    const progress = jobProgressText(running);
    expect(status).toContain('ACTIVE');
    expect(status).toContain('CONFIRMED');
    expect(progress).toContain('selected members: 1');
    for (const fabricated of ['%', 'ETA', 'total bytes', 'estimated']) {
      expect(status.includes(fabricated), fabricated).toBe(false);
      expect(progress.includes(fabricated), fabricated).toBe(false);
    }
  });

  it('a terminal row renders the six dimensions verbatim — no success boolean', () => {
    const done = presentRow({
      lineageStatus: 'CLOSED',
      terminal: {
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'ACQUIRED',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_END',
        validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
        recordedAt: '2026-10-31T09:00:00Z',
      },
    });
    const status = jobStatusText(done);
    expect(status).toContain('COMPLETE');
    expect(status).toContain('NATURAL_END');
    expect(jobProgressText(done)).toContain('ALL_PASSED');
  });

  it('action availability follows the projected facts only', () => {
    const running = presentRow();
    const runningActions = jobActions(running);
    expect(runningActions.cancelEnabled).toBe(true);
    expect(runningActions.retryEnabled).toBe(false);
    expect(runningActions.revealEnabled).toBe(false);

    const failed = presentRow({
      failedMemberCount: 1,
      retry: { available: true, reason: null },
    });
    expect(jobActions(failed).retryEnabled).toBe(true);

    const complete = presentRow({
      lineageStatus: 'CLOSED',
      destination: 'C:/downloads',
      terminal: {
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'ACQUIRED',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_END',
        validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
        recordedAt: '2026-10-31T09:00:00Z',
      },
    });
    const completeActions = jobActions(complete);
    expect(completeActions.cancelEnabled).toBe(false);
    expect(completeActions.revealEnabled).toBe(true);

    const completeNoDestination = presentRow({
      lineageStatus: 'CLOSED',
      terminal: {
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'ACQUIRED',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_END',
        validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
        recordedAt: '2026-10-31T09:00:00Z',
      },
    });
    expect(jobActions(completeNoDestination).revealEnabled).toBe(false);
  });
});
