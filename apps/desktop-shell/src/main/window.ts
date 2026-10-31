/**
 * T07 desktop-shell window factory — the hardened renderer process boundary
 * (frozen L2 §4 security requirements, enforced in code):
 *
 * - renderer loads packaged local assets only (`loadFile`, no remote URL);
 * - `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`;
 * - no webview tag, no worker Node integration, no spellcheck dictionary
 *   downloads;
 * - arbitrary navigation is denied (every `will-navigate`), arbitrary window
 *   creation is denied (`setWindowOpenHandler` deny-all), `<webview>` attach
 *   is denied;
 * - every session permission is denied at request AND check time;
 * - renderer network egress (http/https/ws/wss) is cancelled wholesale —
 *   belt-and-braces behind the page's restrictive CSP.
 *
 * Global (app-level) guards for every webContents this app ever creates live
 * in the main entry; this factory adds the per-window enforcement for the
 * shell window. The module imports `electron`, so its invariants are pinned
 * by the static security-invariant tests.
 */

import { BrowserWindow } from 'electron';

export interface ShellWindowOptions {
  /** Absolute path of the local shell page (packaged asset, never remote). */
  readonly assetPath: string;
  /** Absolute path of the bundled sandboxed preload script. */
  readonly preloadPath: string;
  /** The non-installed smoke creates the window hidden. */
  readonly show: boolean;
}

/** Renderer schemes this shell never talks to (network egress denied). */
const BLOCKED_EGRESS_URL_PATTERNS: readonly string[] = [
  'http://*/*',
  'https://*/*',
  'ws://*/*',
  'wss://*/*',
];

export function createShellWindow(options: ShellWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 360,
    show: options.show,
    title: 'xDownload',
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const session = contents.session;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest(
    { urls: [...BLOCKED_EGRESS_URL_PATTERNS] },
    (_details, callback) => {
      callback({ cancel: true });
    },
  );
  void win.loadFile(options.assetPath);
  return win;
}
