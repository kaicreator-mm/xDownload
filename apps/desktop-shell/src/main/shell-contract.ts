/**
 * T07/T08/U05-T03 desktop-shell IPC contract — the narrow, typed boundary
 * between the renderer and the main process (frozen L2 §4: preload exposes a
 * narrow, typed allowlist only; no raw filesystem, shell, process, network,
 * arbitrary IPC or Host authority reaches renderer content).
 *
 * Everything crossing the bridge is a plain JSON document from this closed
 * vocabulary. There is no generic pass-through invoke over a caller-chosen
 * channel:
 * each bridge method maps to exactly one allowlisted channel below, and the
 * main process validates sender and payload before answering.
 *
 * U05-T03 increment (declared deviation, same closed-registry discipline):
 * the manager enumeration authority moved to the Core-owned durable S1 job
 * index (LIST_S1_JOB_PROJECTIONS via the reviewed Desktop adapter). The
 * output-location picker, the per-download output-location field and the
 * reveal action — including their IPC/preload channels — are REMOVED: the
 * shell carries no per-download output location at all and renders only
 * "保存位置由 Core 配置管理". Every list row is a verbatim projection of the
 * Core S1 index/projection facts or a typed refusal; the renderer never
 * receives raw errors, stacks, arbitrary paths or filesystem/shell authority.
 */

/** The single contextBridge key exposed to renderer content. */
export const SHELL_BRIDGE_KEY = 'xdownloadShell' as const;

/** The closed set of IPC channels; the preload may name ONLY these. */
export const SHELL_IPC_CHANNELS = {
  status: 'xdownload:shell-status',
  managerRefresh: 'xdownload:manager-refresh',
  managerPreviewAdd: 'xdownload:manager-preview-add',
  managerConfirmAdd: 'xdownload:manager-confirm-add',
  managerDiscardPreview: 'xdownload:manager-discard-preview',
  managerCancelJob: 'xdownload:manager-cancel-job',
  managerRetryJob: 'xdownload:manager-retry-job',
} as const;

/** One seam endpoint the shell main process resolved (fail-closed forms). */
export type ShellSeamEndpoint =
  | {
      readonly kind: 'pipe';
      /** Canonical per-install pipe namespace (verified against installId). */
      readonly pipeName: string;
      readonly source: 'install-config';
    }
  | {
      readonly kind: 'loopback';
      readonly host: string;
      readonly port: number;
      /** Loopback is an explicit dev/smoke override, never a fallback. */
      readonly source: 'explicit-override';
    }
  | { readonly kind: 'unconfigured'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Truthful Core connection state: the desktop adapter's own connection state
 * when an adapter exists (the adapter flips it on real seam traffic), or the
 * shell-level fail-closed states when no adapter was composed.
 */
export type ShellCoreConnection =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'REJECTED_PROJECTION'
  | 'STALE_PROJECTION'
  | 'UNPARSEABLE_PROJECTION'
  | 'UNCONFIGURED'
  | 'REFUSED';

/** The one document the shell bridge serves (no secrets, ids only). */
export interface ShellStatusDocument {
  readonly shell: {
    readonly name: 'xdownload-desktop-shell';
    /** Renderer content is served from packaged local assets only. */
    readonly localAssetsOnly: true;
    readonly electronVersion: string;
  };
  readonly seamEndpoint: ShellSeamEndpoint;
  readonly core: {
    readonly connection: ShellCoreConnection;
    /** Typed refusal detail for REFUSED/UNCONFIGURED states; else null. */
    readonly refusalReason: string | null;
    /** The DESKTOP_UI peer this shell presents on the seam (ids, no secrets). */
    readonly peer: {
      readonly installId: string;
      readonly userId: string;
      readonly surface: 'DESKTOP_UI';
    } | null;
  };
}

/** Typed refusal document: never a thrown raw error, never a stack trace. */
export interface ShellRefusal {
  readonly ok: false;
  readonly code: 'SHELL_IPC_REFUSED';
  readonly detail: string;
}

// ------------------------------------------------------- U05-T03 manager documents

/**
 * One manager job row: a VERBATIM typed projection of one S1 job-index item's
 * Core facts (see `S1ManagerJobRow` in @xdownload/desktop-ui, projected by
 * `projectS1JobRow`). Every field is a Core projection word; the row carries
 * no per-download output location, no progress, no ETA and no artifact path.
 */
export type ManagerJobRowDocument = {
  /** Opaque Core contract/aggregate identity (never a URL or path). */
  readonly lineageId: string;
  /** The seam lane this row was read from (the durable S1 index). */
  readonly lane: 's1';
  /** Verbatim contract status word from the Core projection. */
  readonly contractStatus: string;
  /** Verbatim aggregate revision from the Core projection. */
  readonly revision: number;
  /** Verbatim lineage status word from the Core projection. */
  readonly lineageStatus: string;
  /** The projected terminal result, all dimensions verbatim; else null. */
  readonly terminal: {
    readonly requestFulfillment: string;
    readonly targetResolution: string;
    readonly selectionAcquisition: string;
    readonly coverage: string;
    readonly stopReason: string;
    readonly validationSummary: {
      readonly status: string;
      readonly passedCount: number;
      readonly failedCount: number;
    };
    readonly recordedAt: string;
  } | null;
  /** Retry availability hint derived ONLY from the projected facts above. */
  readonly retry: { readonly available: boolean; readonly reason: string | null };
};

/**
 * The pending add preview: a non-authoritative draft (not yet confirmed).
 * U05-T03: the preview carries no output-location field at all — the shell has
 * no per-download output location; the renderer renders only
 * "保存位置由 Core 配置管理".
 */
export interface ManagerPreviewDocument {
  readonly document: 'xdownload.desktop.manager.preview';
  /** The draft contract id the confirmation will route under. */
  readonly lineageId: string;
  readonly url: string;
  readonly automationMode: string;
  /** Main-process reconciliation stage; UNKNOWN stages replay the same request identity. */
  readonly submissionStage: 'READY' | 'CONTRACT_UNKNOWN' | 'S1_UNKNOWN';
  /** The Core-produced confirmation plan, rendered verbatim. */
  readonly confirmationRequests: readonly {
    readonly level: string;
    readonly description: string;
    readonly proves: string;
  }[];
}

/**
 * The job list document: connection banner + S1 index rows + exact index
 * counters + pending preview. `totalCount`/`truncated` are the Core index's
 * own words — when truncated is true the visible rows are NOT the complete
 * history and the renderer must say so.
 */
export interface ManagerJobListDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.jobs';
  readonly connection: ShellCoreConnection;
  /** The visible S1 index page rows, verbatim Core projections. */
  readonly jobs: readonly ManagerJobRowDocument[];
  /** Total S1 jobs the Core durable index records for this install/user. */
  readonly totalCount: number;
  /** True when the Core index page was truncated (never claim completeness). */
  readonly truncated: boolean;
  /** The pending unconfirmed preview, mirrored so the UI state survives. */
  readonly pendingPreview: ManagerPreviewDocument | null;
}

/** Outcome of one routed manager action (add/cancel/retry). */
export interface ManagerActionDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.action';
  readonly action: 'add' | 'cancel' | 'retry' | 'discard-preview';
  readonly lineageId: string | null;
  /** True only when every command required by this action was Core-acknowledged. */
  readonly routed: boolean;
  /** Per-action command delivery state; UNKNOWN is never rendered as acceptance. */
  readonly deliveryState: 'NOT_ATTEMPTED' | 'ACKNOWLEDGED' | 'REJECTED' | 'UNKNOWN';
  /** Core-typed rejections, verbatim (e.g. a typed v0.2 cancel refusal). */
  readonly rejections: readonly { readonly code: string; readonly message: string }[];
  /** Adapter-level fail-closed refusal detail (nothing was routed). */
  readonly refusalDetail: string | null;
  /** Current main-process preview state, independent of the list-read result. */
  readonly pendingPreview: ManagerPreviewDocument | null;
  /**
   * The fresh list after the action — or a typed refusal when the Core could
   * not serve the durable index at that moment (never a fake empty list).
   */
  readonly list: ManagerJobListDocument | ShellRefusal;
}

/** Renderer-side typing of the exposed bridge (closed method set). */
export interface XDownloadShellBridge {
  /** Ask the main process for the current shell status document. */
  status(): Promise<ShellStatusDocument | ShellRefusal>;
  /**
   * Re-read the Core-owned durable S1 job index and return the list page
   * with exact totalCount/truncated words. A typed refusal (never an empty
   * successful list) answers when the Core cannot serve the index.
   */
  managerRefresh(): Promise<ManagerJobListDocument | ShellRefusal>;
  /** Build the non-authoritative add preview for one URL (no routing). */
  managerPreviewAdd(input: {
    readonly url: string;
  }): Promise<ManagerPreviewDocument | ShellRefusal>;
  /**
   * Confirm the pending preview: submit the confirmed contract, then route
   * the S1 direct-acquisition command through the reviewed Desktop adapter.
   */
  managerConfirmAdd(): Promise<ManagerActionDocument | ShellRefusal>;
  /** Discard the pending preview (presentation-only; nothing was routed). */
  managerDiscardPreview(): Promise<ManagerActionDocument | ShellRefusal>;
  /** Route a Core cancellation for one listed lineage (typed refusal shown). */
  managerCancelJob(input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal>;
  /** Route an eligible Core retry for one listed lineage. */
  managerRetryJob(input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal>;
}

declare global {
  interface Window {
    readonly xdownloadShell: XDownloadShellBridge;
  }
}
