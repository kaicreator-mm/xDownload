/**
 * U05-T03 download-manager renderer state tests — the pure state machine the
 * renderer page binds to, pinned in the Node vitest run:
 *
 * - loading / ready / empty / error / bridge-missing are first-class states;
 * - the ONLY source of rows, connection words and index counters is the
 *   shell's answer document (the Core S1-index projection the shell serves);
 * - a refused refresh never clears the previous truthful rows (never an
 *   empty fake list) and surfaces a typed error notice;
 * - the visible truncation state is derived ONLY from the Core index
 *   counters and never claims the visible page is the complete history;
 * - NO fabricated total, percentage, ETA or destination is ever derivable
 *   from the display text of any row;
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
  truncationNoticeText,
} from '../src/renderer/manager-state.ts';

function jobListDocument(overrides: Partial<ManagerJobListDocument> = {}): ManagerJobListDocument {
  return {
    ok: true,
    document: 'xdownload.desktop.manager.jobs',
    connection: 'CONNECTED',
    jobs: [],
    totalCount: 0,
    truncated: false,
    pendingPreview: null,
    pendingCommand: null,
    ...overrides,
  };
}

function presentRow(overrides: Partial<ManagerJobRowDocument> = {}): ManagerJobRowDocument {
  return {
    lineageId: 'contract-desktop-ab12cd34-000001',
    lane: 's1',
    contractStatus: 'CONFIRMED',
    revision: 3,
    lineageStatus: 'ACTIVE',
    terminal: null,
    retry: { available: false, reason: 'NO_FAILED_MEMBERS' },
    ...overrides,
  };
}

describe('manager renderer states', () => {
  it('starts in loading and renders the fail-closed bridge-missing state', () => {
    const initial = initialManagerState();
    expect(initial.phase).toBe('loading');
    expect(initial.jobs).toEqual([]);
    expect(initial.totalCount).toBeNull();
    expect(initial.truncated).toBe(false);
    expect(initial.snapshotFreshness).toBe('unavailable');
    const missing = bridgeMissing(initial);
    expect(missing.phase).toBe('bridge-missing');
    expect(missing.jobs).toEqual([]);
  });

  it('applyList adopts the shell document verbatim (rows, counters, connection)', () => {
    const row = presentRow();
    const next = applyList(
      initialManagerState(),
      jobListDocument({ jobs: [row], totalCount: 7, truncated: true }),
    );
    expect(next.phase).toBe('ready');
    expect(next.connection).toBe('CONNECTED');
    expect(next.snapshotFreshness).toBe('fresh');
    expect(next.jobs).toEqual([row]);
    expect(next.totalCount).toBe(7);
    expect(next.truncated).toBe(true);
  });

  it('a refresh refusal keeps the previous rows and becomes a typed error notice', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const next = applyList(seeded, {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'the Core is disconnected; the durable S1 job index could not be read',
    });
    expect(next.phase).toBe('ready');
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('the Core is disconnected');
    // The refusal must NOT wipe the last truthful list (no empty fake list).
    expect(next.jobs).toEqual([presentRow()]);
  });

  it('a first-load refusal remains unavailable and never invents an empty successful index', () => {
    const next = applyList(initialManagerState(), {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'no Core connection is configured',
    });
    expect(next.snapshotFreshness).toBe('unavailable');
    expect(next.connection).toBeNull();
    expect(next.jobs).toEqual([]);
    expect(next.totalCount).toBeNull();
  });

  it('a successful index read recovers a stale snapshot with new Core facts', () => {
    const seeded = applyList(
      initialManagerState(),
      jobListDocument({ jobs: [presentRow()], totalCount: 1 }),
    );
    const stale = applyList(seeded, {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'the Core is disconnected',
    });
    const recoveredRow = presentRow({ revision: 4 });
    const recovered = applyList(stale, jobListDocument({ jobs: [recoveredRow], totalCount: 1 }));
    expect(recovered.snapshotFreshness).toBe('fresh');
    expect(recovered.connection).toBe('CONNECTED');
    expect(recovered.jobs).toEqual([recoveredRow]);
  });

  it('a malformed list envelope cannot replace a previously successful snapshot', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const malformed = { ...jobListDocument(), jobs: null } as unknown as ManagerJobListDocument;
    const next = applyList(seeded, malformed);
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.notice?.text).toContain('malformed job list');
  });

  it.each([
    { jobs: [{}] },
    { jobs: [{ ...presentRow(), retry: null }] },
    { jobs: [{ ...presentRow(), terminal: { requestFulfillment: 'COMPLETE' } }] },
    { pendingPreview: {} },
  ])('rejects malformed nested list facts and recovers from a later valid read: %j', (bad) => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const malformed = { ...jobListDocument(), ...bad } as unknown as ManagerJobListDocument;
    const stale = applyList(seeded, malformed);
    expect(stale.snapshotFreshness).toBe('stale');
    expect(stale.connection).toBeNull();
    expect(stale.jobs).toEqual([presentRow()]);
    const recovered = applyList(stale, jobListDocument());
    expect(recovered.snapshotFreshness).toBe('fresh');
    expect(recovered.jobs).toEqual([]);
  });

  it('a successful list envelope cannot claim freshness while Core is disconnected', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const contradictory = {
      ...jobListDocument(),
      connection: 'DISCONNECTED',
    } as unknown as ManagerJobListDocument;
    const next = applyList(seeded, contradictory);
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.connection).toBeNull();
    expect(next.jobs).toEqual([presentRow()]);
  });

  it('an unexpected document makes a previously successful snapshot stale', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const forged = {
      ok: true,
      document: 'xdownload.desktop.manager.unknown',
    } as unknown as ManagerJobListDocument;
    const next = applyList(seeded, forged);
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('malformed job list document');
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

describe('visible truncation state (Core index counters only)', () => {
  it('renders a truncation notice that never claims completeness', () => {
    const text = truncationNoticeText({ truncated: true, totalCount: 231, visibleCount: 200 });
    expect(text).toContain('截断');
    expect(text).toContain('200');
    expect(text).toContain('231');
    expect(text).toContain('不是完整历史');
  });

  it('renders no notice when the Core index is complete', () => {
    expect(truncationNoticeText({ truncated: false, totalCount: 42, visibleCount: 42 })).toBeNull();
  });

  it('applyAction carries the list counters through', () => {
    const next = applyAction(initialManagerState(), {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'cancel',
      lineageId: 'contract-desktop-ab12cd34-000001',
      routed: true,
      delivery: {
        status: 'ACCEPTED',
        commandType: 'CANCEL_LINEAGE',
        aggregateId: 'contract-desktop-ab12cd34-000001',
        requestId: 'request-cancel-accepted',
      },
      previewConsumed: false,
      rejections: [],
      refusalDetail: null,
      list: jobListDocument({ totalCount: 300, truncated: true }),
    });
    expect(next.totalCount).toBe(300);
    expect(next.truncated).toBe(true);
  });

  it('an unknown Add contract keeps the preview and binds reconciliation to the same requestId', () => {
    const preview = {
      document: 'xdownload.desktop.manager.preview' as const,
      lineageId: 'contract-desktop-ab12cd34-000009',
      url: 'https://example.com/unknown-submit.mp4',
      automationMode: 'ASSISTED',
      confirmationRequests: [],
    };
    const unknown = {
      status: 'UNKNOWN' as const,
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: preview.lineageId,
      requestId: 'request-submit-unknown',
    };
    const opened = previewOpened(initialManagerState(), preview);
    const next = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: preview.lineageId,
      routed: false,
      delivery: unknown,
      previewConsumed: false,
      rejections: [],
      refusalDetail: null,
      list: jobListDocument({ pendingPreview: preview, pendingCommand: unknown }),
    });
    expect(next.pendingPreview).toEqual(preview);
    expect(next.pendingCommand).toEqual(unknown);
    expect(next.notice?.text).toContain('request-submit-unknown');
    expect(next.notice?.text).toContain('提交状态不确定');
  });

  it('an unknown S1 command consumes the accepted preview and keeps only its exact reconciliation identity', () => {
    const preview = {
      document: 'xdownload.desktop.manager.preview' as const,
      lineageId: 'contract-desktop-ab12cd34-000010',
      url: 'https://example.com/unknown-s1.mp4',
      automationMode: 'ASSISTED',
      confirmationRequests: [],
    };
    const unknown = {
      status: 'UNKNOWN' as const,
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      aggregateId: preview.lineageId,
      requestId: 'request-s1-unknown',
    };
    const opened = previewOpened(initialManagerState(), preview);
    const next = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: preview.lineageId,
      routed: false,
      delivery: unknown,
      previewConsumed: true,
      rejections: [],
      refusalDetail: null,
      list: jobListDocument({ pendingPreview: null, pendingCommand: unknown }),
    });
    expect(next.pendingPreview).toBeNull();
    expect(next.pendingCommand).toEqual(unknown);
    expect(next.notice?.text).toContain('request-s1-unknown');
  });

  it('a refused Core action also invalidates the last-known connection snapshot', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const next = applyAction(seeded, {
      ok: false,
      code: 'SHELL_IPC_REFUSED',
      detail: 'no Core connection is configured; the action cannot be routed',
    });
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.notice?.text).toContain('action refused');
  });

  it('an embedded malformed list cannot restore freshness or replace cached rows', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const next = applyAction(seeded, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'cancel',
      lineageId: presentRow().lineageId,
      routed: true,
      delivery: {
        status: 'ACCEPTED',
        commandType: 'CANCEL_LINEAGE',
        aggregateId: presentRow().lineageId,
        requestId: 'request-cancel-accepted',
      },
      previewConsumed: false,
      rejections: [],
      refusalDetail: null,
      list: {
        ...jobListDocument(),
        document: 'xdownload.desktop.manager.unknown',
      } as unknown as ManagerJobListDocument,
    });
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('malformed');
  });

  it('an accepted add with a refused index clears the consumed confirmation preview', () => {
    const preview = {
      document: 'xdownload.desktop.manager.preview' as const,
      lineageId: 'contract-desktop-ab12cd34-000002',
      url: 'https://example.com/a.mp4',
      automationMode: 'ASSISTED',
      confirmationRequests: [
        {
          level: 'SCOPE_LEVEL',
          description: 'SCOPE_LEVEL (single_resource:)',
          proves: 'the download target',
        },
      ],
    };
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const withPreview = previewOpened(seeded, preview);
    const next = applyAction(withPreview, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: preview.lineageId,
      routed: true,
      delivery: {
        status: 'ACCEPTED',
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: preview.lineageId,
        requestId: 'request-add-accepted',
      },
      previewConsumed: true,
      rejections: [],
      refusalDetail: null,
      list: {
        ok: false,
        code: 'SHELL_IPC_REFUSED',
        detail: 'the Core is disconnected; the durable S1 job index could not be read',
      },
    });

    expect(next.snapshotFreshness).toBe('stale');
    expect(next.connection).toBeNull();
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.pendingPreview).toBeNull();
    expect(next.notice?.text).toContain('fresh job list was refused');
  });

  it('an embedded list refusal keeps the previous rows and announces the refusal', () => {
    const seeded = applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()] }));
    const next = applyAction(seeded, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: 'contract-desktop-ab12cd34-000002',
      routed: true,
      delivery: {
        status: 'ACCEPTED',
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: 'contract-desktop-ab12cd34-000002',
        requestId: 'request-add-accepted',
      },
      previewConsumed: true,
      rejections: [],
      refusalDetail: null,
      list: {
        ok: false,
        code: 'SHELL_IPC_REFUSED',
        detail: 'the Core is disconnected; the durable S1 job index could not be read',
      },
    });
    expect(next.jobs).toEqual([presentRow()]);
    expect(next.connection).toBeNull();
    expect(next.snapshotFreshness).toBe('stale');
    expect(next.notice?.kind).toBe('error');
    expect(next.notice?.text).toContain('accepted by the Core');
    expect(next.notice?.text).toContain('disconnected');
  });
});

describe('preview dialog state (keyboard flow model)', () => {
  const preview = {
    document: 'xdownload.desktop.manager.preview' as const,
    lineageId: 'contract-desktop-ab12cd34-000002',
    url: 'https://example.com/a.mp4',
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

  it('discard closes the local preview even when the follow-up index read is refused', () => {
    const opened = previewOpened(
      applyList(initialManagerState(), jobListDocument({ jobs: [presentRow()], totalCount: 1 })),
      preview,
    );
    const discarded = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'discard-preview',
      lineageId: preview.lineageId,
      routed: false,
      delivery: {
        status: 'NOT_ATTEMPTED',
        commandType: null,
        aggregateId: null,
        requestId: null,
      },
      previewConsumed: true,
      rejections: [],
      refusalDetail: null,
      list: {
        ok: false,
        code: 'SHELL_IPC_REFUSED',
        detail: 'the Core is disconnected; the durable S1 job index could not be read',
      },
    });
    expect(discarded.pendingPreview).toBeNull();
    expect(discarded.snapshotFreshness).toBe('stale');
    expect(discarded.connection).toBeNull();
    expect(discarded.jobs).toEqual([presentRow()]);
    expect(discarded.totalCount).toBe(1);
  });

  it('confirm routes the action and closes the dialog from the fresh list', () => {
    const opened = previewOpened(initialManagerState(), preview);
    const confirmed = applyAction(opened, {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'add',
      lineageId: preview.lineageId,
      routed: true,
      delivery: {
        status: 'ACCEPTED',
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: preview.lineageId,
        requestId: 'request-add-accepted',
      },
      previewConsumed: true,
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
      routed: false,
      delivery: {
        status: 'REJECTED',
        commandType: 'CANCEL_LINEAGE',
        aggregateId: preview.lineageId,
        requestId: 'request-cancel-rejected',
      },
      previewConsumed: false,
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
      delivery: {
        status: 'NOT_ATTEMPTED',
        commandType: null,
        aggregateId: null,
        requestId: null,
      },
      previewConsumed: false,
      rejections: [],
      refusalDetail: 'retry unavailable: NO_FAILED_MEMBERS',
      list: jobListDocument(),
    });
    expect(answered.notice?.kind).toBe('error');
    expect(answered.notice?.text).toContain('retry unavailable: NO_FAILED_MEMBERS');
  });
});

describe('truthful display derivation (no fabricated total/ETA)', () => {
  it('a running S1 row renders the projected status words only', () => {
    const running = presentRow();
    const status = jobStatusText(running);
    const progress = jobProgressText(running);
    expect(status).toContain('ACTIVE');
    expect(status).toContain('CONFIRMED');
    expect(progress).toContain('awaiting terminal truth');
    for (const fabricated of ['%', 'ETA', 'total bytes', 'estimated', 'selected members']) {
      expect(status.includes(fabricated), fabricated).toBe(false);
      expect(progress.includes(fabricated), fabricated).toBe(false);
    }
  });

  it('a terminal row renders the dimensions verbatim — no success boolean', () => {
    const done = presentRow({
      lineageStatus: 'TERMINAL',
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

  it('action availability follows the projected facts only (no reveal)', () => {
    const running = presentRow();
    const runningActions = jobActions(running);
    expect(runningActions.cancelEnabled).toBe(true);
    expect(runningActions.retryEnabled).toBe(false);
    expect('revealEnabled' in runningActions).toBe(false);

    const failed = presentRow({
      retry: { available: true, reason: null },
    });
    expect(jobActions(failed).retryEnabled).toBe(true);

    const cancelled = presentRow({
      lineageStatus: 'CANCELLED',
      retry: { available: true, reason: null },
    });
    expect(jobActions(cancelled)).toStrictEqual({
      cancelEnabled: false,
      retryEnabled: true,
    });

    const terminalWithoutDetail = presentRow({
      lineageStatus: 'TERMINAL',
      retry: { available: true, reason: null },
    });
    expect(jobActions(terminalWithoutDetail)).toStrictEqual({
      cancelEnabled: false,
      retryEnabled: false,
    });

    const unknownStatus = presentRow({
      lineageStatus: 'UNKNOWN_CORE_STATUS',
      retry: { available: true, reason: null },
    });
    expect(jobActions(unknownStatus)).toStrictEqual({
      cancelEnabled: false,
      retryEnabled: false,
    });

    const terminalPresent = presentRow({
      lineageStatus: 'ACTIVE',
      retry: { available: true, reason: null },
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
    expect(jobActions(terminalPresent)).toStrictEqual({
      cancelEnabled: false,
      retryEnabled: false,
    });

    const complete = presentRow({
      lineageStatus: 'TERMINAL',
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
    expect(completeActions.retryEnabled).toBe(false);
  });
});
