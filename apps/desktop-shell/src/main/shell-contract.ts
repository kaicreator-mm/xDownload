/**
 * T07 desktop-shell IPC contract — the narrow, typed boundary between the
 * renderer and the main process (frozen L2 §4: preload exposes a narrow,
 * typed allowlist only; no raw filesystem, shell, process, network, arbitrary
 * IPC or Host authority reaches renderer content).
 *
 * Everything crossing the bridge is a plain JSON document from this closed
 * vocabulary. There is no generic pass-through invoke over a caller-chosen
 * channel:
 * each bridge method maps to exactly one allowlisted channel below, and the
 * main process validates sender and payload before answering.
 */

/** The single contextBridge key exposed to renderer content. */
export const SHELL_BRIDGE_KEY = 'xdownloadShell' as const;

/** The closed set of IPC channels; the preload may name ONLY these. */
export const SHELL_IPC_CHANNELS = {
  status: 'xdownload:shell-status',
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

/** Renderer-side typing of the exposed bridge (declared once, consumed by T08). */
export interface XDownloadShellBridge {
  /** Ask the main process for the current shell status document. */
  status(): Promise<ShellStatusDocument | ShellRefusal>;
}

declare global {
  interface Window {
    readonly xdownloadShell: XDownloadShellBridge;
  }
}
