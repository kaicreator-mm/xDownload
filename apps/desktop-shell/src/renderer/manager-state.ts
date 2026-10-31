/**
 * T08 download-manager renderer state — the pure, DOM-free state machine the
 * renderer page binds to (unit-testable in the Node vitest run; no electron,
 * no DOM, no network).
 *
 * The machine holds ONLY presentation state (which phase the page is in,
 * the last documents the shell answered with, one transient notice). It has
 * no status truth of its own: every job row is the shell's verbatim Core
 * projection document, and the machine never derives totals, percentages,
 * ETAs or completion claims from it.
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
  /** The shell's Core connection word, verbatim from the last list answer. */
  readonly connection: string | null;
  readonly jobs: readonly ManagerJobRowDocument[];
  readonly pendingPreview: ManagerPreviewDocument | null;
  readonly notice: ManagerNotice | null;
  /** True while an action/refresh is in flight (buttons disabled). */
  readonly busy: boolean;
}

export function initialManagerState(): ManagerRendererState {
  return {
    phase: 'loading',
    connection: null,
    jobs: [],
    pendingPreview: null,
    notice: null,
    busy: false,
  };
}

/** The bridge is absent: the page renders its fail-closed state and stops. */
export function bridgeMissing(state: ManagerRendererState): ManagerRendererState {
  return { ...state, phase: 'bridge-missing', jobs: [], pendingPreview: null };
}

function isRefusal(
  document: ManagerJobListDocument | ShellRefusal | ManagerActionDocument,
): document is ShellRefusal {
  return document.ok === false;
}

/** Apply one refresh answer (the ONLY source of rows and connection). */
export function applyList(
  state: ManagerRendererState,
  answer: ManagerJobListDocument | ShellRefusal,
): ManagerRendererState {
  if (isRefusal(answer)) {
    return {
      ...state,
      phase: 'ready',
      busy: false,
      notice: { kind: 'error', text: `refresh refused: ${answer.detail}` },
    };
  }
  if (answer.document !== 'xdownload.desktop.manager.jobs') {
    return {
      ...state,
      phase: 'ready',
      busy: false,
      notice: { kind: 'error', text: 'refresh refused: unexpected document' },
    };
  }
  return {
    ...state,
    phase: 'ready',
    busy: false,
    connection: answer.connection,
    jobs: [...answer.jobs],
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
  let nextState: ManagerRendererState = {
    ...state,
    busy: false,
    connection: answer.list.connection,
    jobs: [...answer.list.jobs],
    pendingPreview: answer.list.pendingPreview,
    notice: null,
  };
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
 * The truthful status text of one row. Absent projection facts render as
 * "unknown" words — never as 0, a percentage, a total or an ETA.
 */
export function jobStatusText(row: ManagerJobRowDocument): string {
  if (!row.present) {
    return 'no projection available (Core state unknown)';
  }
  if (row.terminal !== null) {
    return `terminal — request fulfillment: ${row.terminal.requestFulfillment} — stop reason: ${row.terminal.stopReason}`;
  }
  return `lineage ${row.lineageStatus ?? 'unknown'} (contract ${row.contractStatus ?? 'unknown'}, revision ${row.revision === null ? 'unknown' : String(row.revision)})`;
}

/**
 * The truthful progress text of one row. The legacy lane projection carries
 * no authoritative byte sample, so NO byte/percent/ETA figure is ever shown
 * here (no fabricated total/ETA).
 */
export function jobProgressText(row: ManagerJobRowDocument): string {
  if (!row.present) {
    return 'unknown';
  }
  if (row.terminal !== null) {
    if (row.terminal.requestFulfillment === 'COMPLETE') {
      return `validated: ${row.terminal.validationSummary.status} (passed ${String(row.terminal.validationSummary.passedCount)}, failed ${String(row.terminal.validationSummary.failedCount)})`;
    }
    return `coverage: ${row.terminal.coverage}`;
  }
  const selected = row.selectedMemberCount;
  return `selected members: ${selected === null ? 'unknown' : String(selected)}`;
}

/** The action availability hints of one row (presentation only). */
export function jobActions(row: ManagerJobRowDocument): {
  readonly cancelEnabled: boolean;
  readonly retryEnabled: boolean;
  readonly revealEnabled: boolean;
} {
  const terminal = row.terminal !== null;
  const complete = terminal && row.terminal?.requestFulfillment === 'COMPLETE';
  return {
    cancelEnabled: row.present && !terminal,
    retryEnabled: row.present && row.retry.available,
    revealEnabled: complete === true && row.destination !== null,
  };
}
