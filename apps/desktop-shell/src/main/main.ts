/**
 * T07 desktop-shell process entry — a thin Electron main process over the
 * existing Core lifecycle/seam and the existing desktop adapter semantics.
 *
 * - `app.enableSandbox()` hardens every renderer process of this app.
 * - One instance lock; a second launch focuses the existing window.
 * - App-level guards deny navigation, window creation and webview attach for
 *   EVERY webContents this app creates (defense in depth on top of the
 *   per-window factory hardening).
 * - The ONE Core connection is the seam CLIENT composed over the existing
 *   desktop adapter (DESKTOP_UI peer) — never a private Core/Kernel.
 * - `--xdownload-smoke=<out.json>` runs the minimal non-installed shell
 *   smoke: hidden window, in-renderer bridge/CSP/isolation probes, a JSON
 *   verdict on stdout and at the given path, then a deterministic exit.
 */

import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoreConnection } from './core-connection.ts';
import { registerShellIpc, unregisterShellIpc } from './ipc.ts';
import { resolveSeamAccess } from './seam-endpoint.ts';
import type { ShellStatusDocument } from './shell-contract.ts';
import { createShellWindow } from './window.ts';

const SMOKE_ARG_PREFIX = '--xdownload-smoke=';

/** Smoke verdict document written to the requested path and stdout. */
interface SmokeVerdict {
  readonly ok: boolean;
  readonly electron: string;
  readonly checks: readonly {
    readonly name: string;
    readonly pass: boolean;
    readonly detail: string;
  }[];
}

function smokeOutputPath(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(SMOKE_ARG_PREFIX));
  return arg === undefined ? undefined : arg.slice(SMOKE_ARG_PREFIX.length);
}

// Process-wide renderer sandbox: every renderer of this app is sandboxed.
app.enableSandbox();

// Global guards for every webContents this app ever creates: no arbitrary
// navigation, no arbitrary window creation, no webview attach.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (navigationEvent) => {
    navigationEvent.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (attachEvent) => {
    attachEvent.preventDefault();
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing !== undefined && !existing.isDestroyed()) {
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.focus();
    }
  });
  app.whenReady().then(() => {
    void ready().catch((error: unknown) => {
      process.stderr.write(
        `desktop-shell failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      );
      app.exit(1);
    });
  });
}

async function ready(): Promise<void> {
  const smoke = smokeOutputPath();
  const assetPath = join(__dirname, 'assets', 'shell.html');
  const preloadPath = join(__dirname, '..', 'preload', 'preload.cjs');
  const connection = new CoreConnection({
    ...resolveSeamAccess({ home: app.getPath('home'), env: process.env }),
    electronVersion: process.versions.electron ?? 'unknown',
  });
  // One truthful seam round-trip before any window is shown.
  await connection.probeOnce();
  const window = createShellWindow({ assetPath, preloadPath, show: smoke === undefined });
  // Registered in the same tick as window creation: the page cannot call the
  // bridge before did-finish-load, and the admitted sender is exactly this
  // window's main frame.
  registerShellIpc({
    getWindow: () => window,
    status: () => connection.statusDocument(),
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
  window.webContents.once('did-finish-load', () => {
    if (smoke !== undefined) {
      void runSmoke(window, connection, smoke);
    }
  });
}

async function runSmoke(
  window: BrowserWindow,
  connection: CoreConnection,
  outputPath: string,
): Promise<void> {
  const verdict = await smokeVerdict(window, connection.statusDocument());
  const text = `${JSON.stringify(verdict, null, 2)}\n`;
  process.stdout.write(text);
  await writeFile(outputPath, text, 'utf8');
  unregisterShellIpc();
  await connection.close();
  app.exit(verdict.ok ? 0 : 1);
}

/**
 * In-renderer probes executed in the page's main world by the TRUSTED smoke
 * driver (main process). This is smoke tooling, not renderer authority: the
 * checks read the exposed bridge shape, the served CSP, the local-only
 * origin, renderer isolation and the navigation/window guards.
 */
async function smokeVerdict(
  window: BrowserWindow,
  connectionStatus: ShellStatusDocument,
): Promise<SmokeVerdict> {
  const electron = process.versions.electron ?? 'unknown';
  const probe = (await window.webContents.executeJavaScript(
    `(() => {
      const bridge = window.xdownloadShell;
      const statusPromise = bridge !== undefined && typeof bridge.status === 'function'
        ? bridge.status()
        : Promise.resolve(null);
      return statusPromise.then((status) => {
        let openBlocked = false;
        try {
          const opened = window.open('https://example.invalid/xdownload-probe');
          openBlocked = opened === null || opened === undefined;
        } catch {
          openBlocked = true;
        }
        const beforeProtocol = location.protocol;
        try {
          location.assign('https://example.invalid/xdownload-probe');
        } catch (error) {
          // A thrown refusal also proves the guard; location is unchanged.
        }
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return {
          bridgePresent: typeof bridge === 'object' && bridge !== null,
          bridgeFrozen: bridge === undefined || bridge === null ? false : Object.isFrozen(bridge),
          bridgeKeys: bridge === undefined || bridge === null ? [] : Object.keys(bridge),
          status,
          csp: meta === null ? null : meta.getAttribute('content'),
          originProtocol: beforeProtocol,
          stillLocalAfterAssign: location.protocol === 'file:',
          openBlocked,
          rendererIsolated: typeof require === 'undefined' && typeof process === 'undefined',
        };
      });
    })()`,
  )) as {
    bridgePresent: boolean;
    bridgeFrozen: boolean;
    bridgeKeys: string[];
    status: unknown;
    csp: string | null;
    originProtocol: string;
    stillLocalAfterAssign: boolean;
    openBlocked: boolean;
    rendererIsolated: boolean;
  };

  const status = probe.status;
  const statusIsDocument =
    typeof status === 'object' &&
    status !== null &&
    'shell' in status &&
    'seamEndpoint' in status &&
    'core' in status;
  const csp = probe.csp ?? '';
  const checks: SmokeVerdict['checks'] = [
    {
      name: 'preload bridge exposes exactly {status}',
      pass:
        probe.bridgePresent &&
        probe.bridgeFrozen &&
        probe.bridgeKeys.length === 1 &&
        probe.bridgeKeys[0] === 'status',
      detail: `keys=${JSON.stringify(probe.bridgeKeys)} frozen=${String(probe.bridgeFrozen)}`,
    },
    {
      name: 'renderer isolated (no require/process in sandboxed page)',
      pass: probe.rendererIsolated,
      detail: 'require and process must be undefined in the sandboxed renderer world',
    },
    {
      name: 'local assets only (file: origin)',
      pass: probe.originProtocol === 'file:' && probe.stillLocalAfterAssign,
      detail: `origin=${probe.originProtocol}; location.assign to a remote URL was refused`,
    },
    {
      name: 'restrictive CSP served (default-src none)',
      pass: csp.includes("default-src 'none'") && csp.includes("script-src 'self'"),
      detail: `csp=${csp}`,
    },
    {
      name: 'window.open denied',
      pass: probe.openBlocked,
      detail: 'setWindowOpenHandler must deny all window creation',
    },
    {
      name: 'status bridge returns the shell status document',
      pass: statusIsDocument,
      detail: statusIsDocument ? 'status document shape verified' : 'bridge.status did not answer',
    },
    {
      name: 'seam endpoint resolved explicitly (no silent fallback)',
      pass:
        connectionStatus.seamEndpoint.kind === 'loopback' ||
        connectionStatus.seamEndpoint.kind === 'pipe',
      detail: `seamEndpoint.kind=${connectionStatus.seamEndpoint.kind}`,
    },
    {
      name: 'core seam reachable (adapter answered, no DISCONNECTED claim)',
      pass:
        connectionStatus.core.connection === 'CONNECTED' ||
        connectionStatus.core.connection === 'REJECTED_PROJECTION',
      detail: `core.connection=${connectionStatus.core.connection}`,
    },
  ];
  return { ok: checks.every((check) => check.pass), electron, checks };
}
