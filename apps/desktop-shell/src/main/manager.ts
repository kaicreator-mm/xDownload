/**
 * U05-T03 desktop download-manager service — the shell main process's ONE
 * download authority surface over the reviewed T02 Desktop adapter and the
 * T01 Core-owned durable S1 job index (frozen U05 scope: enumeration truth
 * is the Core S1 index; the in-memory session registry is gone; no local
 * status/retry truth; the renderer holds no authority at all).
 *
 * Discipline:
 * - managerRefresh reads accepted S1 jobs ONLY through the adapter's typed
 *   LIST_S1_JOB_PROJECTIONS index query. The response is the Core's own
 *   latest-page projection (max 200 rows) with exact totalCount/truncated
 *   words. A refusal, a disconnect or a malformed index is a typed refusal —
 *   NEVER an empty successful list. When truncated is true the visible rows
 *   are not the complete history and the document says so.
 * - add flows through the adapter's canonical confirmation workflow
 *   (enterIntent draft → preview → confirmScope), then routes the S1
 *   direct-acquisition command through adapter.executeS1Direct() — the real
 *   T01 DESKTOP_UI S1 admission gate plus the T02 adapter; the T02 Mock
 *   Transport tests are adapter-unit evidence only and are never a
 *   substitute for this journey. Acceptance is admission only: the pending
 *   state holds until a Core projection provides terminal truth.
 * - reopen is a fresh index read: every row is keyed by the Core aggregate
 *   id and its facts come from a fresh Core projection (the index replays
 *   the durable journal per query). No contract/scope fact is fabricated
 *   for jobs created by the CLI or another authorized surface — the adapter
 *   holds no echo for them and none is invented.
 * - cancel/retry remain Core control transitions: the manager attaches the
 *   aggregate id and routes the adapter's cancel/retry; Core re-decides
 *   every transition and typed refusals surface VERBATIM — never masked.
 * - U05-T03 removed the destination picker, the per-download destination
 *   field and the reveal action (with their IPC/preload channels): the
 *   shell owns no per-download output location and never guesses a path.
 *
 * This module imports no `electron`: the service is unit-testable against
 * the real seam server end to end.
 */

import type { DesktopUiAdapter } from '@xdownload/desktop-ui';
import {
  decodeManagerUrl,
  projectS1JobRow,
  SINGLE_RESOURCE_WORKFLOW_FACTS,
  singleResourceUrlIntent,
} from '@xdownload/desktop-ui';
import type {
  ManagerActionDocument,
  ManagerCommandDelivery,
  ManagerJobListDocument,
  ManagerJobRowDocument,
  ManagerPreviewDocument,
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
}

/** The pending, unconfirmed preview (draft interaction state). */
interface PendingPreview {
  readonly lineageId: string;
  readonly url: string;
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
  private pending: PendingPreview | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private listInFlight: Promise<ManagerJobListDocument | ShellRefusal> | null = null;

  constructor(options: DesktopManagerOptions) {
    this.options = options;
  }

  // ---- introspection (documents only; no internals leak) ------------------

  /** True while an unconfirmed preview exists (drives renderer UI state). */
  hasPendingPreview(): boolean {
    return this.pending !== null;
  }

  // ---- add flow ------------------------------------------------------------

  /**
   * Build the non-authoritative add preview for one URL. No command routes:
   * the draft lives in the adapter until the user confirms. U05-T03: the
   * preview carries no destination — the shell owns no output location.
   */
  async previewAdd(payload: {
    readonly url: string;
  }): Promise<ManagerPreviewDocument | ShellRefusal> {
    return this.runSerialized(async () => {
      const adapter = this.options.getAdapter();
      if (adapter === undefined) {
        return refusal('no Core connection is configured; downloads cannot be added');
      }
      if (adapter.pendingCommandInfo() !== null) {
        return refusal(
          'a command is awaiting Core acknowledgement; reconcile it before creating another preview',
        );
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
      };
      return {
        document: 'xdownload.desktop.manager.preview',
        lineageId: draft.contractId,
        url: draft.targetRef,
        automationMode: draft.automationMode,
        confirmationRequests: draft.requests.map((request) => ({
          level: request.level,
          description: request.description,
          proves: request.proves,
        })),
      };
    });
  }

  /**
   * Confirm the pending preview: submit the confirmed contract through the
   * adapter's canonical confirmation, then route the S1 direct-acquisition
   * command via the reviewed Desktop adapter (the real Core DESKTOP_UI S1
   * admission). Both routings are admission receipts, never final success —
   * the truthful outcome lands in the Core projection the list reads.
   *
   * R3-01: the adapter's `InteractionOutcome.routed` is CUMULATIVE over its
   * full sent-envelope history, not a per-call delta. Each step therefore
   * snapshots the history length and attributes ONLY newly appended commands
   * whose commandType AND aggregateId bind to the current pending lineage. A
   * rejected second confirmation after a prior successful add must never
   * execute S1 against the previous aggregate, claim the new lineage was
   * routed, or clear the current pending preview.
   */
  async confirmAdd(): Promise<ManagerActionDocument | ShellRefusal> {
    return this.runSerialized(async () => {
      const adapter = this.options.getAdapter();
      if (adapter === undefined) {
        return refusal('no Core connection is configured; the preview cannot be confirmed');
      }
      const pending = this.pending;
      if (pending === null) {
        // After the contract was accepted, an ambiguous S1 response consumes
        // the preview. The visible Add control becomes the exact-envelope
        // reconciliation entry point; no second contract or request identity
        // is created.
        const unresolved = adapter.pendingCommandInfo();
        if (
          unresolved?.status === 'UNKNOWN' &&
          unresolved.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION' &&
          unresolved.aggregateId !== null
        ) {
          const outcome = await adapter.executeS1Direct();
          return this.actionDocument('add', unresolved.aggregateId, outcome, true);
        }
        return refusal('no preview is pending; there is no unresolved S1 command to reconcile');
      }

      const confirmOutcome = await adapter.confirmScope();
      if (confirmOutcome.delivery.status !== 'ACCEPTED') {
        // An unknown contract keeps its preview and exact envelope. A typed
        // rejection is acknowledged but is not acceptance; no S1 command is
        // issued until the contract itself is ACCEPTED.
        return this.actionDocument('add', pending.lineageId, confirmOutcome, false);
      }

      const s1Outcome = await adapter.executeS1Direct();
      this.pending = null;
      return this.actionDocument(
        'add',
        pending.lineageId,
        {
          delivery: s1Outcome.delivery,
          rejections: [...confirmOutcome.rejections, ...s1Outcome.rejections],
          refusals: s1Outcome.refusals,
        },
        true,
      );
    });
  }

  /** Discard the pending preview (presentation-only; nothing was routed). */
  async discardPreview(): Promise<ManagerActionDocument | ShellRefusal> {
    return this.runSerialized(async () => {
      const pending = this.pending;
      if (pending === null) {
        return refusal('no preview is pending');
      }
      const adapter = this.options.getAdapter();
      const pendingCommand = adapter?.pendingCommandInfo();
      if (pendingCommand !== null && pendingCommand !== undefined) {
        return refusal(
          'a command is awaiting Core acknowledgement; the preview cannot be discarded until that exact request is reconciled',
        );
      }
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
        delivery: {
          status: 'NOT_ATTEMPTED',
          commandType: null,
          aggregateId: null,
          requestId: null,
        },
        previewConsumed: true,
        rejections: [],
        refusalDetail: null,
        list: await this.listUnlocked(),
      };
    });
  }

  // ---- job list (the Core durable S1 index is the ONLY enumeration) --------

  /**
   * Read the Core-owned durable S1 job index through the adapter and build
   * the list document with the Core's own totalCount/truncated words. A
   * refused, disconnected or malformed index answers with a typed refusal —
   * never an empty successful list (L2 U05 §2/§5).
   */
  list(): Promise<ManagerJobListDocument | ShellRefusal> {
    if (this.listInFlight !== null) {
      return this.listInFlight;
    }
    const inFlight = this.runSerialized(() => this.listUnlocked());
    this.listInFlight = inFlight;
    const clearInFlight = (): void => {
      if (this.listInFlight === inFlight) {
        this.listInFlight = null;
      }
    };
    void inFlight.then(clearInFlight, clearInFlight);
    return inFlight;
  }

  private async listUnlocked(): Promise<ManagerJobListDocument | ShellRefusal> {
    const adapter = this.options.getAdapter();
    if (adapter === undefined) {
      // R3-02: no adapter means NO Core index read occurred — a successful
      // empty list with a fabricated totalCount=0 would claim an authority
      // that does not exist. Fail closed with the shell connection word.
      const connection = this.options.getConnectionWhenUnconfigured();
      return refusal(
        `no Core connection is configured (${connection}); the durable S1 job index cannot be read`,
      );
    }
    const index = await adapter.listS1JobProjections();
    if (!index.ok) {
      switch (index.failure.reason) {
        case 'DISCONNECTED':
          return refusal(
            'the Core is disconnected; the durable S1 job index could not be read (no empty list is rendered)',
          );
        case 'REJECTED':
          return refusal(
            'the Core rejected the S1 job index query (the DESKTOP_UI peer scope was refused)',
          );
        case 'MALFORMED_INDEX':
          return refusal(`the Core returned a malformed S1 job index: ${index.failure.detail}`);
      }
    }
    // The adapter verified every index item before rows are built: each row
    // is a verbatim Core projection keyed by its aggregate id. Reopen is the
    // same fresh read — the index replays the durable journal per query.
    const rows: ManagerJobRowDocument[] = index.items.map((view) => {
      const row = projectS1JobRow(view);
      return {
        lineageId: row.lineageId,
        lane: row.lane,
        contractStatus: row.contractStatus,
        revision: row.revision,
        lineageStatus: row.lineageStatus,
        terminal: row.terminal === null ? null : { ...row.terminal },
        retry: { ...row.retry },
      };
    });
    return {
      ok: true,
      document: 'xdownload.desktop.manager.jobs',
      connection: 'CONNECTED',
      jobs: rows,
      totalCount: index.totalCount,
      truncated: index.truncated,
      pendingPreview: this.pendingDocument(adapter),
      pendingCommand: adapter.pendingCommandInfo(),
    };
  }

  // ---- control transitions ---------------------------------------------------

  /**
   * Route a Core cancellation for one listed lineage. The aggregate id comes
   * from the durable index rows the renderer displays; Core re-decides the
   * transition and typed refusals surface verbatim.
   */
  async cancelJob(payload: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> {
    return this.routeControl('cancel', payload.lineageId);
  }

  /** Route an eligible Core retry for one listed lineage. */
  async retryJob(payload: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> {
    return this.routeControl('retry', payload.lineageId);
  }

  // ---- internals ---------------------------------------------------------------

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async routeControl(
    action: 'cancel' | 'retry',
    lineageId: string,
  ): Promise<ManagerActionDocument | ShellRefusal> {
    return this.runSerialized(async () => {
      const adapter = this.options.getAdapter();
      if (adapter === undefined) {
        return refusal('no Core connection is configured; the action cannot be routed');
      }
      const unresolved = adapter.pendingCommandInfo();
      const expectedCommand = action === 'cancel' ? 'CANCEL_LINEAGE' : 'RETRY_FAILED_MEMBERS';
      if (unresolved !== null) {
        if (
          unresolved.status !== 'UNKNOWN' ||
          unresolved.commandType !== expectedCommand ||
          unresolved.aggregateId !== lineageId
        ) {
          return refusal(
            'another command is awaiting Core acknowledgement; reconcile that exact request before starting this action',
          );
        }
        // Same row + same action is the explicit exact-envelope reconciliation
        // path. Do not attach/rebuild a projection or mint a new requestId.
      } else {
        // Attach the aggregate id first: the adapter re-reads the fresh Core
        // projection (READ_PROJECTION) and refuses stale/fabricated facts.
        await adapter.attachAggregate(lineageId);
      }
      const outcome = action === 'cancel' ? await adapter.cancel() : await adapter.retryFailed();
      return this.actionDocument(action, lineageId, outcome, false);
    });
  }

  private pendingDocument(adapter: DesktopUiAdapter | null): ManagerPreviewDocument | null {
    const pending = this.pending;
    if (pending === null) {
      return null;
    }
    return {
      document: 'xdownload.desktop.manager.preview',
      lineageId: pending.lineageId,
      url: pending.url,
      automationMode: MANAGER_AUTOMATION_MODE,
      confirmationRequests: this.draftRequests(adapter ?? undefined),
    };
  }

  private async actionDocument(
    action: 'add' | 'cancel' | 'retry',
    lineageId: string | null,
    outcome: {
      readonly delivery: ManagerCommandDelivery;
      readonly rejections: readonly { readonly code: string; readonly message: string }[];
      readonly refusals: readonly string[];
    },
    previewConsumed: boolean,
  ): Promise<ManagerActionDocument> {
    const routed = outcome.delivery.status === 'ACCEPTED';
    const firstRefusal = outcome.refusals[0];
    return {
      ok: true,
      document: 'xdownload.desktop.manager.action',
      action,
      lineageId,
      routed,
      delivery: outcome.delivery,
      previewConsumed,
      rejections: outcome.rejections.map((rejection) => ({
        code: rejection.code,
        message: rejection.message,
      })),
      refusalDetail:
        outcome.delivery.status === 'NOT_ATTEMPTED'
          ? (firstRefusal ?? 'the command was not attempted')
          : null,
      list: await this.listUnlocked(),
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
}
