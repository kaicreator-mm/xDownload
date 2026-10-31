/**
 * T07 static security-invariant tests — source-level pins for the acceptance
 * points the T08 gate reviews (frozen L2 §4):
 *
 *   renderer Node integration disabled; context isolation and sandbox
 *   enabled; restrictive CSP; narrow typed preload; validated IPC
 *   sender/payload; no arbitrary navigation/window or raw filesystem/shell
 *   authority; local assets only; exact Electron pin; no per-surface
 *   K/Core instance; no generic IPC bridge.
 *
 * The files are read as text at test time and asserted with structural
 * markers, so any regression of these invariants fails the unit gate even
 * though Electron itself cannot run under the Node test runner.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHELL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath: string): string {
  return readFileSync(join(SHELL_ROOT, relativePath), 'utf8');
}

function sourceFilesUnder(relativeDir: string): string[] {
  const root = join(SHELL_ROOT, relativeDir);
  const collect = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? collect(full) : [full];
    });
  return collect(root);
}

describe('dependency pinning (no floating dependencies)', () => {
  const manifest = JSON.parse(readSource('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('pins Electron to the exact frozen candidate 45.1.0 (no range)', () => {
    expect(manifest.devDependencies?.['electron']).toBe('45.1.0');
  });

  it('declares only the seam client + existing desktop adapter as runtime deps', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@xdownload/core-seam',
      '@xdownload/desktop-ui',
    ]);
  });
});

describe('renderer process isolation (window factory)', () => {
  const windowSource = readSource('src/main/window.ts');

  it('disables Node integration in the renderer and its workers', () => {
    expect(windowSource).toContain('nodeIntegration: false');
    expect(windowSource).toContain('nodeIntegrationInWorker: false');
  });

  it('enables context isolation and the renderer sandbox', () => {
    expect(windowSource).toContain('contextIsolation: true');
    expect(windowSource).toContain('sandbox: true');
  });

  it('keeps the webview tag and spellcheck off', () => {
    expect(windowSource).toContain('webviewTag: false');
    expect(windowSource).toContain('spellcheck: false');
  });

  it('denies all window creation and all session permissions', () => {
    expect(windowSource).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(windowSource).toContain('callback(false)');
    expect(windowSource).toContain('setPermissionCheckHandler(() => false)');
  });

  it('cancels renderer network egress (http/https/ws/wss) behind the CSP', () => {
    expect(windowSource).toContain('onBeforeRequest');
    expect(windowSource).toContain('cancel: true');
    for (const scheme of ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']) {
      expect(windowSource).toContain(`'${scheme}'`);
    }
  });

  it('loads the local asset with loadFile only (no remote URL loading)', () => {
    expect(windowSource).toContain('win.loadFile(options.assetPath)');
    expect(windowSource).not.toMatch(/loadURL\s*\(/);
  });
});

describe('app-level navigation/window guards (main entry)', () => {
  const mainSource = readSource('src/main/main.ts');

  it('hardens every renderer of the app with the process sandbox', () => {
    expect(mainSource).toContain('app.enableSandbox()');
  });

  it('denies navigation, window creation and webview attach for all webContents', () => {
    expect(mainSource).toContain("app.on('web-contents-created'");
    expect(mainSource).toMatch(/will-navigate[\s\S]{0,120}preventDefault\(\)/);
    expect(mainSource).toMatch(/will-attach-webview[\s\S]{0,80}preventDefault\(\)/);
    expect(mainSource).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
  });

  it('runs as a single instance (no second shell authority)', () => {
    expect(mainSource).toContain('app.requestSingleInstanceLock()');
  });

  it('never loads a remote URL and never opens external software', () => {
    expect(mainSource).not.toMatch(/loadURL\s*\(/);
    expect(mainSource).not.toContain('openExternal');
    expect(mainSource).not.toContain('openPath');
  });
});

describe('narrow typed preload (the only renderer bridge)', () => {
  const preloadSource = readSource('src/preload/preload.ts');

  it('exposes exactly one frozen bridge under the contract key', () => {
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld(SHELL_BRIDGE_KEY');
    expect(preloadSource).toContain('Object.freeze(bridge)');
  });

  it('names only the allowlisted channel and never a dynamic one', () => {
    expect(preloadSource).toContain('ipcRenderer.invoke(SHELL_IPC_CHANNELS.status)');
    expect(preloadSource).not.toMatch(/ipcRenderer\.(on|once|send|sendSync|sendToHost)\s*\(/);
    expect(preloadSource).not.toMatch(/invoke\s*\(\s*[^S]/);
  });

  it('imports no Node builtin and no filesystem/shell authority', () => {
    expect(preloadSource).not.toMatch(/from 'node:/);
    expect(preloadSource).not.toMatch(/require\s*\(/);
    expect(preloadSource).not.toContain('child_process');
  });

  it('is the ONLY file that touches ipcRenderer', () => {
    const offenders = [
      ...sourceFilesUnder('src/main').filter((file) => file.endsWith('.ts')),
      ...sourceFilesUnder('src/preload').filter((file) => !file.endsWith('preload.ts')),
    ].filter((file) => readFileSync(file, 'utf8').includes('ipcRenderer'));
    expect(offenders).toEqual([]);
  });
});

describe('validated IPC sender/payload (closed channel registry)', () => {
  const ipcSource = readSource('src/main/ipc.ts');

  it('registers handlers only from the contract allowlist (one site)', () => {
    expect(ipcSource.match(/ipcMain\.handle\s*\(/g)?.length).toBe(1);
    expect(ipcSource).toContain('ipcMain.handle(SHELL_IPC_CHANNELS.status');
  });

  it('gates every call on the shell window main frame sender', () => {
    expect(ipcSource).toContain('isAdmittedSender(event, options.getWindow())');
    expect(ipcSource).toContain('event.sender !== contents');
    expect(ipcSource).toContain('frame === contents.mainFrame');
  });

  it('gates every call on the exact-shape payload decoder', () => {
    expect(ipcSource).toContain('decodeUnitPayload(payload)');
  });

  it('answers failures with typed refusal documents, never raw errors', () => {
    expect(ipcSource).toContain("code: 'SHELL_IPC_REFUSED'");
    expect(ipcSource).not.toMatch(/throw\s/);
  });
});

describe('local assets only (renderer content)', () => {
  const html = readSource('src/main/assets/shell.html');
  const rendererJs = readSource('src/main/assets/shell.js');

  it('serves a restrictive CSP meta (default-src none)', () => {
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('references only local scripts and no inline handlers', () => {
    expect(html).toContain('<script src="shell.js"></script>');
    expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
    expect(html).not.toMatch(/src=["']https?:\/\//);
  });

  it('the renderer script has no network, evaluation or HTML-injection authority', () => {
    expect(rendererJs).toContain('textContent');
    for (const forbidden of [
      'innerHTML',
      'document.write',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'eval(',
      'import(',
    ]) {
      expect(rendererJs).not.toContain(forbidden);
    }
    expect(rendererJs).not.toMatch(/(^|[^.\w])require\s*\(/);
    expect(rendererJs).not.toMatch(/(^|\n)\s*import\s/);
  });
});

describe('no per-surface K/Core instance and no second scheduler/ledger', () => {
  const sources = sourceFilesUnder('src/main')
    .concat(sourceFilesUnder('src/preload'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(file, 'utf8'));

  it('never imports the Core runtime composition or persistence authority', () => {
    for (const forbidden of [
      '@xdownload/core-runtime',
      'createCoreRuntime',
      'reopenCoreRuntime',
      '@xdownload/core-scheduler',
      '@xdownload/persistence-ledger',
      'CoreScheduler',
    ]) {
      for (const source of sources) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('reaches Core only through the existing desktop adapter semantics', () => {
    const connection = readSource('src/main/core-connection.ts');
    expect(connection).toContain("from '@xdownload/desktop-ui'");
    expect(connection).toContain('createDesktopUiAdapter');
  });

  it('no generic IPC bridge exists anywhere in the shell', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/invoke\s*\(\s*channel/);
      expect(source).not.toMatch(/on\s*\(\s*channel/);
    }
  });
});
