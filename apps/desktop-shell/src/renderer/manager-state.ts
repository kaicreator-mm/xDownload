/**
 * U05-T03 download-manager renderer state — the pure, DOM-free state machine
 * the renderer page binds to (unit-testable in the Node vitest run; no
 * electron, no DOM, no network).
 *
 * The machine holds ONLY presentation state (which phase the page is in,
 * the last documents the shell answered with, one transient notice, the
 * Core index counters). It has no status truth of its own: every job row is
 * the shell's verbatim Core S1-index projection document, and the machine
 * never derives totals, percentages, ETAs or completion claims from it.
 * U05-T03: no destination/reveal state exists at all — the shell carries no
 * per-download output location.
 */

import type {
  ManagerActionDocument,
  ManagerJobListDocument,
  ManagerJobRowDocument,
  ManagerPreviewDocument,
  ShellRefusal,
} from '../main/shell-contract.ts';

/** The page phases: loading → ready, or the fail-closed bridge-missing. */
export type ManagerPhase = 'loading' | 'ready' | 'bridge-missing';

/** One transient, aria-live notice (never a status truth). */
export interface ManagerNotice {
  readonly kind: 'error' | 'info';
  readonly text: string;
}

export interface ManagerRendererState {
  readonly phase: ManagerPhase;
  /** Current Core connection word; null when the latest snapshot is stale or unavailable. */
  readonly connection: string | null;
  /** Freshness of the last Core-owned index snapshot; stale rows are last-known only. */
  readonly snapshotFreshness: 'unavailable' | 'fresh' | 'stale';
  readonly jobs: readonly ManagerJobRowDocument[];
  /**
   * The Core durable index counters from the last successful list answer
   * (null until the first one arrives — never guessed).
   */
  readonly totalCount: number | null;
  /** True when the Core truncated the index page (visible rows ≠ history). */
  readonly truncated: boolean;
  readonly pendingPreview: ManagerPreviewDocument | null;
  readonly notice: ManagerNotice | null;
  /** True while an action/refresh is in flight (buttons disabled). */
  readonly busy: boolean;
}

export function initialManagerState(): ManagerRendererState {
  return {
    phase: 'loading',
    connection: null,
    snapshotFreshness: 'unavailable',
    jobs: [],
    totalCount: null,
    truncated: false,
    pendingPreview: null,
    notice: null,
    busy: false,
  };
}

/** The bridge is absent: the page renders its fail-closed state and stops. */
export function bridgeMissing(state: ManagerRendererState): ManagerRendererState {
  return { ...state, phase: 'bridge-missing', jobs: [], pendingPreview: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRefusal(document: unknown): document is ShellRefusal {
  return isRecord(document) && document.ok === false;
}

function isManagerJobRowDocument(value: unknown): value is ManagerJobRowDocument {
  if (!isRecord(value)) return false;
  if (
    typeof value.lineageId !== 'string' ||
    value.lineageId.length === 0 ||
    value.lane !== 's1' ||
    typeof value.contractStatus !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.lineageStatus !== 'string' ||
    !isRecord(value.retry) ||
    typeof value.retry.available !== 'boolean' ||
    !(value.retry.reason === null || typeof value.retry.reason === 'string')
  ) {
    return false;
  }
  if (value.terminal === null) return true;
  if (!isRecord(value.terminal) || !isRecord(value.terminal.validationSummary)) return false;
  const terminal = value.terminal;
  const summary = terminal.validationSummary;
  return (
    typeof terminal.requestFulfillment === 'string' &&
    typeof terminal.targetResolution === 'string' &&
    typeof terminal.selectionAcquisition === 'string' &&
    typeof terminal.coverage === 'string' &&
    typeof terminal.stopReason === 'string' &&
    typeof terminal.recordedAt === 'string' &&
    typeof summary.status === 'string' &&
    Number.isSafeInteger(summary.passedCount) &&
    (summary.passedCount as number) >= 0 &&
    Number.isSafeInteger(summary.failedCount) &&
    (summary.failedCount as number) >= 0
  );
}

function isManagerPreviewDocument(value: unknown): value is ManagerPreviewDocument {
  if (
    !isRecord(value) ||
    value.document !== 'xdownload.desktop.manager.preview' ||
    typeof value.lineageId !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.automationMode !== 'string' ||
    !Array.isArray(value.confirmationRequests)
  ) {
    return false;
  }
  return value.confirmationRequests.every(
    (request) =>
      isRecord(request) &&
      typeof request.level === 'string' &&
      typeof request.description === 'string' &&
      typeof request.proves === 'string',
  );
}

/** Validate the complete renderer-facing list envelope before it can become fresh. */
function isManagerJobListDocument(value: unknown): value is ManagerJobListDocument {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    value.document !== 'xdownload.desktop.manager.jobs' ||
    typeof value.connection !== 'string' ||
    ![
      'CONNECTED',
      'DISCONNECTED',
      'REJECTED_PROJECTION',
      'STALE_PROJECTION',
      'UNPARSEABLE_PROJECTION',
      'UNCONFIGURED',
      'REFUSED',
    ].includes(value.connection) ||
    !Array.isArray(value.jobs) ||
    !value.jobs.every(isManagerJobRowDocument) ||
    !Number.isSafeInteger(value.totalCount) ||
    (value.totalCount as number) < 0 ||
    typeof value.truncated !== 'boolean' ||
    !(value.pendingPreview === null || isManagerPreviewDocument(value.pendingPreview))
  ) {
    return false;
  }
  return true;
}

/** Apply one refresh answer (the ONLY source of rows, counters, connection). */
export function applyList(
  state: ManagerRendererState,
  answer: ManagerJobListDocument | ShellRefusal,
): ManagerRendererState {
  if (isRefusal(answer)) {
    // Preserve the last-known snapshot, but never present it as current after
    // a failed Core index read. A first-load refusal remains unavailable.
    return {
      ...state,
      phase: 'ready',
      busy: false,
      connection: null,
      snapshotFreshness: state.snapshotFreshness === 'unavailable' ? 'unavailable' : 'stale',
      notice: { kind: 'error', text: `refresh refused: ${answer.detail}` },
    };
  }
  if (!isManagerJobListDocument(answer)) {
    return {
      ...state,
      phase: 'ready',
      busy: false,
      connection: null,
      snapshotFreshness: state.snapshotFreshness === 'unavailable' ? 'unavailable' : 'stale',
      notice: { kind: 'error', text: 'refresh refused: malformed job list document' },
    };
  }
  return {
    ...state,
    phase: 'ready',
    busy: false,
    connection: answer.connection,
    snapshotFreshness: 'fresh',
    jobs: [...answer.jobs],
    totalCount: answer.totalCount,
    truncated: answer.truncated,
    pendingPreview: answer.pendingPreview,
  };
}

/** A preview document arrived (from managerPreviewAdd or a mirrored list). */
export function previewOpened(
  state: ManagerRendererState,
  preview: ManagerPreviewDocument | ShellRefusal,
): ManagerRendererState {
  if (!('document' in preview)) {
    return {
      ...state,
      busy: false,
      notice: { kind: 'error', text: `preview refused: ${preview.detail}` },
    };
  }
  if (preview.document !== 'xdownload.desktop.manager.preview') {
    return {
      ...state,
      busy: false,
      notice: { kind: 'error', text: 'preview refused: unexpected document' },
    };
  }
  return { ...state, busy: false, pendingPreview: preview, notice: null };
}

/** Apply one action answer (add/cancel/retry/discard), notice verbatim. */
export function applyAction(
  state: ManagerRendererState,
  answer: ManagerActionDocument | ShellRefusal,
): ManagerRendererState {
  if (isRefusal(answer)) {
    return {
      ...state,
      busy: false,
      notice: { kind: 'error', text: `action refused: ${answer.detail}` },
    };
  }
  // The embedded fresh list may itself be a typed refusal (the Core could
  // not serve the index at that moment): the previous truthful rows stay,
  // and the refusal is announced — never replaced by a fake empty list.
  const list = answer.list;
  const listRefused = isRefusal(list);
  let nextState: ManagerRendererState = { ...state, busy: false, notice: null };
  if (listRefused || !isManagerJobListDocument(list)) {
    nextState = {
      ...nextState,
      connection: null,
      snapshotFreshness: state.snapshotFreshness === 'unavailable' ? 'unavailable' : 'stale',
    };
  } else {
    nextState = {
      ...nextState,
      connection: list.connection,
      snapshotFreshness: 'fresh',
      jobs: [...list.jobs],
      totalCount: list.totalCount,
      truncated: list.truncated,
      pendingPreview: list.pendingPreview,
    };
  }
  if (answer.action !== 'discard-preview') {
    if (answer.rejections.length > 0) {
      const first = answer.rejections[0];
      nextState = {
        ...nextState,
        notice: {
          kind: 'error',
          text: `the Core refused the ${answer.action} (${String(first?.code)}): ${String(first?.message)}`,
        },
      };
    } else if (!answer.routed) {
      nextState = {
        ...nextState,
        notice: {
          kind: 'error',
          text: `the ${answer.action} was not routed: ${answer.refusalDetail ?? 'refused'}`,
        },
      };
    } else if (listRefused) {
      nextState = {
        ...nextState,
        notice: {
          kind: 'error',
          text: `the ${answer.action} was accepted by the Core, but the fresh job list was refused: ${list.detail}`,
        },
      };
    } else if (!isManagerJobListDocument(list)) {
      nextState = {
        ...nextState,
        notice: {
          kind: 'error',
          text: `the ${answer.action} was accepted by the Core, but the fresh job list was malformed`,
        },
      };
    } else {
      nextState = {
        ...nextState,
        notice: {
          kind: 'info',
          text: `the ${answer.action} was accepted by the Core (admission — the job list below shows the Core's projection)`,
        },
      };
    }
  }
  return nextState;
}

/** Set/clear the in-flight flag (buttons disable while busy). */
export function setBusy(state: ManagerRendererState, busy: boolean): ManagerRendererState {
  return { ...state, busy };
}

export function noticeShown(
  state: ManagerRendererState,
  notice: ManagerNotice,
): ManagerRendererState {
  return { ...state, notice };
}

// ---- display derivation (verbatim-only text; nothing fabricated) ----------

/**
 * The truthful status text of one S1 row. The row is a verified Core
 * projection (the index validated it before the shell served it): its words
 * are rendered verbatim — never a guessed or cached status.
 */
export function jobStatusText(row: ManagerJobRowDocument): string {
  if (row.terminal !== null) {
    return `terminal — request fulfillment: ${row.terminal.requestFulfillment} — stop reason: ${row.terminal.stopReason}`;
  }
  return `lineage ${row.lineageStatus} (contract ${row.contractStatus}, revision ${String(row.revision)})`;
}

/**
 * The truthful progress text of one S1 row. The U05 S1 lane projection
 * carries NO authoritative byte sample, member count, ETA or completion
 * percentage, so none is ever shown: a non-terminal row states exactly that
 * it awaits terminal truth from the Core.
 */
export function jobProgressText(row: ManagerJobRowDocument): string {
  if (row.terminal !== null) {
    if (row.terminal.requestFulfillment === 'COMPLETE') {
      return `validated: ${row.terminal.validationSummary.status} (passed ${String(row.terminal.validationSummary.passedCount)}, failed ${String(row.terminal.validationSummary.failedCount)})`;
    }
    return `coverage: ${row.terminal.coverage}`;
  }
  return 'awaiting terminal truth from the Core (no authoritative byte progress)';
}

/** The action availability hints of one S1 row (presentation only). */
export function jobActions(row: ManagerJobRowDocument): {
  readonly cancelEnabled: boolean;
  readonly retryEnabled: boolean;
} {
  return {
    cancelEnabled: row.terminal === null,
    retryEnabled: row.retry.available,
  };
}

/**
 * The visible truncation notice text. Words only from the Core index
 * counters: when truncated, the visible page is explicitly NOT the complete
 * history; when not truncated, the count is the complete enumeration.
 */
export function truncationNoticeText(state: {
  readonly truncated: boolean;
  readonly totalCount: number | null;
  readonly visibleCount: number;
}): string | null {
  if (!state.truncated) {
    return null;
  }
  const total = state.totalCount === null ? 'unknown' : String(state.totalCount);
  return `列表已截断：仅显示最近 ${String(state.visibleCount)} 条任务，Core 共记录 ${total} 条；此处不是完整历史`;
}
