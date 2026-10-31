/**
 * T08 desktop download-manager service — the shell main process's ONE
 * download authority surface over the existing desktop adapter (frozen T08:
 * queue/result state comes from the Core projection; no local status/retry
 * truth; the renderer holds no authority at all).
 *
 * Discipline:
 * - The session job registry records ONLY which lineages THIS window added
 *   (and each add's user-chosen destination folder). It is presentation
 *   state, not truth: every row's status/progress/terminal/retry facts are
 *   re-read from the Core projection when an answer is built. A disconnected
 *   Core renders truthful "no projection available" rows — never a cached
 *   status claim.
 * - add flows through the adapter's canonical confirmation workflow
   (enterIntent draft → preview → confirmScope). The preview is
   non-authoritative; Core admission is the authority act.
 * - cancel routes as a Core control transition. Core typed refusals (e.g.
   a lineage the v0.2 K durably owns) surface VERBATIM — never masked.
 * - retry routes only the adapter's own eligible retry domain (derived from
   projected failed-member facts); ineligibility is a typed refusal.
 * - destination/reveal are main-process authorities: the renderer never
   receives a filesystem API. Reveal opens the USER-CHOSEN destination
   folder and only when a FRESH Core projection proves the job COMPLETE —
   Core exposes no artifact filesystem path, so none is ever claimed.
 *
 * This module imports no `electron`: the native dialog/reveal authorities
 * are injected by the main entry, so the service is unit-testable against
 * the real seam server.
 */

import type { SeamProjectionView } from '@xdownload/core-seam';
import type { DesktopUiAdapter } from '@xdownload/desktop-ui';
import {
  decodeManagerUrl,
  projectLegacyJobRow,
  SINGLE_RESOURCE_WORKFLOW_FACTS,
  singleResourceUrlIntent,
  type ManagerJobRow,
} from '@xdownload/desktop-ui';
import type {
  ManagerActionDocument,
  ManagerDestinationDocument,
  ManagerJobListDocument,
  ManagerJobRowDocument,
  ManagerPreviewDocument,
  ManagerRevealDocument,
  ShellCoreConnection,
  ShellRefusal,
} from './shell-contract.ts';

/** The adapter handle the manager operates on (or none — fail closed). */
export interface DesktopManagerOptions {
  /**
   * The current adapter, or undefined when the shell has no Core connection
   * (unconfigured/refused endpoint). Re-resolved on every call.
   */
  readonly getAdapter: () => DesktopUiAdapter | undefined;
  /**
   * The shell-level connection word for documents served while no adapter
   * exists (the adapter's own state wins whenever it does).
   */
  readonly getConnectionWhenUnconfigured: () => ShellCoreConnection;
  /** Main-process authority: open the native directory picker. */
  readonly pickDestination: () => Promise<string | null>;
  /** Main-process authority: reveal a folder in the platform file manager. */
  readonly revealFolder: (path: string) => boolean;
}

/** The internal session record of one add (presentation state, not truth). */
interface SessionJob {
  readonly lineageId: string;
  readonly destination: string | null;
}

/** The pending, unconfirmed preview (draft interaction state). */
interface PendingPreview {
  readonly lineageId: string;
  readonly url: string;
  readonly destination: string | null;
}

function refusal(detail: string): ShellRefusal {
  return { ok: false, code: 'SHELL_IPC_REFUSED', detail };
}

/**
 * The one automation mode the desktop add flow uses (ASSISTED: the
 * Core-produced plan asks the single SCOPE_LEVEL confirmation the preview
 * step renders). Mirrors `singleResourceUrlIntent` in @xdownload/desktop-ui.
 */
const MANAGER_AUTOMATION_MODE = 'ASSISTED';

export class DesktopManager {
  private readonly options: DesktopManagerOptions;
  private readonly jobs = new Map<string, SessionJob>();
  private pending: PendingPreview | null = null;

  constructor(options: DesktopManagerOptions) {
    this.options = options;
  }

  // ---- introspection (documents only; no internals leak) ------------------

  /** True while an unconfirmed preview exists (drives renderer UI state). */
  hasPendingPreview(): boolean {
    return this.pending !== null;
  }

  /** Number of lineages this window added this session. */
  trackedJobCount(): number {
    return this.jobs.size;
  }

  // ---- add flow ------------------------------------------------------------

  /**
   * Build the non-authoritative add preview for one URL. No command routes:
   * the draft lives in the adapter until the user confirms.
   */
  async previewAdd(payload: {
    readonly url: string;
    readonly destination?: string;
  }): Promise<ManagerPreviewDocument | ShellRefusal> {
    const adapter = this.options.getAdapter();
    if (adapter === undefined) {
      return refusal('no Core connection is configured; downloads cannot be added');
    }
    if (this.pending !== null) {
      return refusal('a preview is already pending; confirm or discard it first');
    }
    const decoded = decodeManagerUrl(payload.url);
    if (!decoded.ok) {
      return refusal(`url rejected: ${decoded.diagnostics[0]?.message ?? 'malformed URL'}`);
    }
    const intent = singleResourceUrlIntent(decoded.value);
    if (!intent.ok) {
      return refusal(`intent refused: ${intent.diagnostics[0]?.message ?? 'malformed intent'}`);
    }
    const entered = adapter.enterIntent({
      intent: intent.value,
      workflowFacts: SINGLE_RESOURCE_WORKFLOW_FACTS,
    });
    if (entered.refusals.length > 0) {
      return refusal(`preview refused: ${entered.refusals[0] ?? 'adapter refusal'}`);
    }
    const draft = adapter.currentDraftView();
    if (draft === null) {
      return refusal('preview refused: the adapter did not open a draft');
    }
    this.pending = {
      lineageId: draft.contractId,
      url: draft.targetRef,
      destination: payload.destination ?? null,
    };
    return {
      document: 'xdownload.desktop.manager.preview',
      lineageId: draft.contractId,
      url: draft.targetRef,
      destination: payload.destination ?? null,
      automationMode: draft.automationMode,
      confirmationRequests: draft.requests.map((request) => ({
        level: request.level,
        description: request.description,
        proves: request.proves,
      })),
    };
  }

  /**
   * Confirm the pending preview: route the confirmed contract to the Core.
   * Acceptance is an admission receipt, never final success — the truthful
   * outcome lands in the job projection the list reads.
   */
  async confirmAdd(): Promise<ManagerActionDocument | ShellRefusal> {
    const pending = this.pending;
    if (pending === null) {
      return refusal('no preview is pending; nothing to confirm');
    }
    const adapter = this.options.getAdapter();
    if (adapter === undefined) {
      return refusal('no Core connection is configured; the preview cannot be confirmed');
    }
    const outcome = await adapter.confirmScope();
    const routed = outcome.routed.length > 0;
    if (routed) {
      this.jobs.set(pending.lineageId, {
        lineageId: pending.lineageId,
        destination: pending.destination,
      });
      this.pending = null;
    }
    return this.actionDocument('add', pending.lineageId, routed, outcome);
  }

  /** Discard the pending preview (presentation-only; nothing was routed). */
  async discardPreview(): Promise<ManagerActionDocument | ShellRefusal> {
    const pending = this.pending;
    if (pending === null) {
      return refusal('no preview is pending');
    }
    const adapter = this.options.getAdapter();
    if (adapter !== undefined) {
      adapter.discardDraft();
    }
    this.pending = null;
    return {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action: 'discard-preview',
      lineageId: pending.lineageId,
      routed: false,
      rejections: [],
      refusalDetail: null,
      list: await this.list(),
    };
  }

  // ---- job list ------------------------------------------------------------

  /**
   * Re-read EVERY tracked lineage's Core projection and build the list
   * document. This is the ONLY status source of the manager: rows whose
   * read fails render the truthful absent state (never a cached claim).
   */
  async list(): Promise<ManagerJobListDocument> {
    const adapter = this.options.getAdapter();
    const rows: ManagerJobRowDocument[] = [];
    let connection: ShellCoreConnection = 'CONNECTED';
    if (adapter === undefined) {
      connection = this.options.getConnectionWhenUnconfigured();
      for (const job of this.jobs.values()) {
        rows.push(this.rowDocument(job, null));
      }
    } else {
      for (const job of this.jobs.values()) {
        const outcome = await adapter.attachAggregate(job.lineageId);
        const view = adapter.currentProjectionView();
        // Only a read that Core answered CONNECTED may render. A failed read
        // (disconnected/refused/stale) renders the truthful absent row — the
        // adapter may still hold the last successful projection internally,
        // and presenting it would be a cached status claim.
        const readFresh = view !== null && outcome.display.connection === 'CONNECTED';
        if (!readFresh) {
          connection = outcome.display.connection;
        }
        rows.push(this.rowDocument(job, readFresh ? view : null));
      }
    }
    return {
      ok: true,
      document: 'xdownload.desktop.manager.jobs',
      connection,
      jobs: rows,
      pendingPreview:
        this.pending === null
          ? null
          : {
              document: 'xdownload.desktop.manager.preview',
              lineageId: this.pending.lineageId,
              url: this.pending.url,
              destination: this.pending.destination,
              automationMode: MANAGER_AUTOMATION_MODE,
              confirmationRequests: this.draftRequests(adapter),
            },
    };
  }

  // ---- control transitions ---------------------------------------------------

  /** Route a Core cancellation for one tracked lineage. */
  async cancelJob(payload: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> {
    return this.routeControl('cancel', payload.lineageId);
  }

  /** Route an eligible Core retry for one tracked lineage. */
  async retryJob(payload: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> {
    return this.routeControl('retry', payload.lineageId);
  }

  // ---- destination / reveal --------------------------------------------------

  /** Open the native directory picker (main-process authority). */
  async chooseDestination(): Promise<ManagerDestinationDocument | ShellRefusal> {
    const destination = await this.options.pickDestination();
    return {
      ok: true,
      document: 'xdownload.desktop.manager.destination',
      destination,
    };
  }

  /**
   * Reveal a completed job's destination folder. The gate re-reads a FRESH
   * Core projection: only a COMPLETE fulfilled job reveals, and only the
   * user-chosen folder (the Core projection exposes no artifact path, so
   * none is ever claimed or derived).
   */
  async revealJob(payload: {
    readonly lineageId: string;
  }): Promise<ManagerRevealDocument | ShellRefusal> {
    const job = this.jobs.get(payload.lineageId);
    if (job === undefined) {
      return refusal(`unknown lineage '${payload.lineageId}'`);
    }
    if (job.destination === null) {
      return refusal('this job has no destination folder to reveal');
    }
    const adapter = this.options.getAdapter();
    if (adapter === undefined) {
      return refusal('no Core connection is configured; completion cannot be verified');
    }
    await adapter.attachAggregate(job.lineageId);
    const view = adapter.currentProjectionView();
    if (
      view === null ||
      view.terminal === undefined ||
      view.terminal.requestFulfillment !== 'COMPLETE'
    ) {
      return refusal('the Core projection does not show this job as completed');
    }
    if (!this.options.revealFolder(job.destination)) {
      return refusal('the destination folder could not be revealed');
    }
    return {
      ok: true,
      document: 'xdownload.desktop.manager.reveal',
      lineageId: job.lineageId,
      revealed: 'destination-folder',
      destination: job.destination,
    };
  }

  // ---- internals ---------------------------------------------------------------

  private async routeControl(
    action: 'cancel' | 'retry',
    lineageId: string,
  ): Promise<ManagerActionDocument | ShellRefusal> {
    if (!this.jobs.has(lineageId)) {
      return refusal(`unknown lineage '${lineageId}'`);
    }
    const adapter = this.options.getAdapter();
    if (adapter === undefined) {
      return refusal('no Core connection is configured; the action cannot be routed');
    }
    await adapter.attachAggregate(lineageId);
    const outcome = action === 'cancel' ? await adapter.cancel() : await adapter.retryFailed();
    const routed = outcome.routed.length > 0;
    return this.actionDocument(action, lineageId, routed, outcome);
  }

  private async actionDocument(
    action: 'add' | 'cancel' | 'retry',
    lineageId: string | null,
    routed: boolean,
    outcome: {
      readonly rejections: readonly { readonly code: string; readonly message: string }[];
      readonly refusals: readonly string[];
    },
  ): Promise<ManagerActionDocument> {
    const firstRefusal = outcome.refusals[0];
    return {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action,
      lineageId,
      routed,
      rejections: outcome.rejections.map((rejection) => ({
        code: rejection.code,
        message: rejection.message,
      })),
      refusalDetail: routed || firstRefusal === undefined ? null : firstRefusal,
      list: await this.list(),
    };
  }

  private draftRequests(
    adapter: DesktopUiAdapter | undefined,
  ): ManagerPreviewDocument['confirmationRequests'] {
    const draft = adapter?.currentDraftView();
    if (draft === undefined || draft === null) {
      return [];
    }
    return draft.requests.map((request) => ({
      level: request.level,
      description: request.description,
      proves: request.proves,
    }));
  }

  private rowDocument(job: SessionJob, view: SeamProjectionView | null): ManagerJobRowDocument {
    const row: ManagerJobRow = projectLegacyJobRow({
      lineageId: job.lineageId,
      view,
      destination: job.destination,
    });
    return {
      lineageId: row.lineageId,
      lane: row.lane,
      present: row.present,
      contractStatus: row.contractStatus,
      revision: row.revision,
      lineageStatus: row.lineageStatus,
      selectedMemberCount: row.selectedMemberCount,
      failedMemberCount: row.failedMemberCount,
      retriedMemberIds: [...row.retriedMemberIds],
      terminal: row.terminal === null ? null : { ...row.terminal },
      retry: { ...row.retry },
      destination: row.destination,
    };
  }
}
