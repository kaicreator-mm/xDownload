/**
 * T07/T08 desktop-shell IPC contract — the narrow, typed boundary between the
 * renderer and the main process (frozen L2 §4: preload exposes a narrow,
 * typed allowlist only; no raw filesystem, shell, process, network, arbitrary
 * IPC or Host authority reaches renderer content).
 *
 * Everything crossing the bridge is a plain JSON document from this closed
 * vocabulary. There is no generic pass-through invoke over a caller-chosen
 * channel:
 * each bridge method maps to exactly one allowlisted channel below, and the
 * main process validates sender and payload before answering.
 *
 * T08 increment (declared deviation, same closed-registry discipline): the
 * download-manager channels join the allowlist. Every manager document is a
 * projection of Core-owned facts (the seam projection the shell reads) or a
 * typed refusal; the renderer never receives raw errors, stacks, arbitrary
 * paths or filesystem/shell authority. The session job registry holds WHICH
 * lineages this window added (presentation state) — status/retry truth is
 * re-read from the Core projection on every answer.
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
  managerChooseDestination: 'xdownload:manager-choose-destination',
  managerRevealJob: 'xdownload:manager-reveal-job',
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

// ------------------------------------------------------- T08 manager documents

/**
 * One manager job row: a VERBATIM projection of the Core projection of one
 * lineage this window added (see `ManagerJobRow` in @xdownload/desktop-ui).
 * Absent projection facts are `null`, never 0 or a fabricated total.
 */
export type ManagerJobRowDocument = {
  readonly lineageId: string;
  readonly lane: 'legacy';
  readonly present: boolean;
  readonly contractStatus: string | null;
  readonly revision: number | null;
  readonly lineageStatus: string | null;
  readonly selectedMemberCount: number | null;
  readonly failedMemberCount: number | null;
  readonly retriedMemberIds: readonly string[];
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
  readonly retry: { readonly available: boolean; readonly reason: string | null };
  readonly destination: string | null;
};

/** The pending add preview: a non-authoritative draft (not yet confirmed). */
export interface ManagerPreviewDocument {
  readonly document: 'xdownload.desktop.manager.preview';
  /** The draft contract id the confirmation will route under. */
  readonly lineageId: string;
  readonly url: string;
  readonly destination: string | null;
  readonly automationMode: string;
  /** The Core-produced confirmation plan, rendered verbatim. */
  readonly confirmationRequests: readonly {
    readonly level: string;
    readonly description: string;
    readonly proves: string;
  }[];
}

/** The job list document: connection banner + rows + pending preview. */
export interface ManagerJobListDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.jobs';
  readonly connection: ShellCoreConnection;
  readonly jobs: readonly ManagerJobRowDocument[];
  /** The pending unconfirmed preview, mirrored so the UI state survives. */
  readonly pendingPreview: ManagerPreviewDocument | null;
}

/** Outcome of one routed manager action (add/cancel/retry). */
export interface ManagerActionDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.action';
  readonly action: 'add' | 'cancel' | 'retry' | 'discard-preview';
  readonly lineageId: string | null;
  /** True when the command was routed to the Core (admission, not success). */
  readonly routed: boolean;
  /** Core-typed rejections, verbatim (e.g. a typed v0.2 cancel refusal). */
  readonly rejections: readonly { readonly code: string; readonly message: string }[];
  /** Adapter-level fail-closed refusal detail (nothing was routed). */
  readonly refusalDetail: string | null;
  readonly list: ManagerJobListDocument;
}

/** The user's destination choice (main-process native dialog; may be null). */
export interface ManagerDestinationDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.destination';
  /** The chosen directory, or null when the dialog was dismissed. */
  readonly destination: string | null;
}

/** Reveal outcome (the main process owns every filesystem/shell authority). */
export interface ManagerRevealDocument {
  readonly ok: true;
  readonly document: 'xdownload.desktop.manager.reveal';
  readonly lineageId: string;
  /** What was revealed: the user-chosen destination folder for this job. */
  readonly revealed: 'destination-folder';
  readonly destination: string;
}

/** Renderer-side typing of the exposed bridge (closed method set). */
export interface XDownloadShellBridge {
  /** Ask the main process for the current shell status document. */
  status(): Promise<ShellStatusDocument | ShellRefusal>;
  /** Re-read every tracked lineage's Core projection and return the list. */
  managerRefresh(): Promise<ManagerJobListDocument | ShellRefusal>;
  /** Build the non-authoritative add preview for one URL (no routing). */
  managerPreviewAdd(input: {
    readonly url: string;
    readonly destination?: string;
  }): Promise<ManagerPreviewDocument | ShellRefusal>;
  /** Confirm the pending preview: route the confirmed contract to Core. */
  managerConfirmAdd(): Promise<ManagerActionDocument | ShellRefusal>;
  /** Discard the pending preview (presentation-only; nothing was routed). */
  managerDiscardPreview(): Promise<ManagerActionDocument | ShellRefusal>;
  /** Route a Core cancellation for one tracked lineage (typed refusal shown). */
  managerCancelJob(input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal>;
  /** Route an eligible Core retry for one tracked lineage. */
  managerRetryJob(input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal>;
  /** Open the native directory picker (main-process authority). */
  managerChooseDestination(): Promise<ManagerDestinationDocument | ShellRefusal>;
  /** Reveal a completed job's destination folder (main-process authority). */
  managerRevealJob(input: {
    readonly lineageId: string;
  }): Promise<ManagerRevealDocument | ShellRefusal>;
}

declare global {
  interface Window {
    readonly xdownloadShell: XDownloadShellBridge;
  }
}
