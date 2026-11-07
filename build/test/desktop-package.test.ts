/**
 * #284/#285 T09-R1 desktop artifact tests — packaging rules, drift gates and
 * the real package build (table-driven positives and negatives adjacent).
 *
 * The desktop artifact packages the frozen T07/T08 shell under
 * resources/app/ with the locked Electron runtime vendored on the selected
 * win32-x64 tuple only. These tests pin the declared content rules (audit
 * allowlist shape, koffi vendoring anchor, Electron version drift gate) and
 * assert the emitted layout over one real `runPackageBuild`, gated the same
 * way the existing vendored-runtime suite gates platform-dependent facts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARTIFACTS,
  CONTENT_VERSION,
  REPO_ROOT,
  VENDORED_ELECTRON_RUNTIME,
  vendoredRuntimeDistPaths,
} from '../build-config.ts';
import { globMatches } from '../audit.ts';
import { assertElectronRuntimeVersionConsistent } from '../package.ts';

const DESKTOP = ARTIFACTS.find((artifact) => artifact.id === 'desktop');

describe('desktop artifact declared content rules', () => {
  it('declares the composed Electron layout', () => {
    expect(DESKTOP).toBeDefined();
    expect(DESKTOP?.outDir).toBe('desktop');
    // main.ts resolves renderer/preload via join(__dirname, '..', …), so the
    // spec documents the nested app-root entry for identity provenance.
    expect(DESKTOP?.outFile).toBe('resources/app/main/main.cjs');
  });

  it('allowlist admits the renamed exe and the resources/app subtree', () => {
    const allowlist = DESKTOP?.allowlist ?? [];
    const admitted = [
      'xdownload.exe',
      'ffmpeg.dll',
      'resources.pak',
      'icudtl.dat',
      'snapshot_blob.bin',
      'v8_context_snapshot.bin',
      'vk_swiftshader_icd.json',
      'version',
      'LICENSE',
      'LICENSES.chromium.html',
      'locales/en-US.pak',
      'resources/app/package.json',
      'resources/app/main/main.cjs',
      'resources/app/preload/preload.cjs',
      'resources/app/renderer/renderer.js',
      'resources/app/renderer/index.html',
      'resources/app/renderer/styles.css',
      'resources/app/node_modules/koffi/index.cjs',
    ];
    for (const relative of admitted) {
      expect(
        allowlist.some((pattern) => globMatches(pattern, relative)),
        `desktop allowlist must admit ${relative}`,
      ).toBe(true);
    }
  });

  it('allowlist never admits the unrenamed exe or the default app asar', () => {
    const allowlist = DESKTOP?.allowlist ?? [];
    // Shipping electron.exe unrenamed or the default app asar (which shadows
    // resources/app) is a packaging regression: no declared pattern may ever
    // cover it.
    for (const forbidden of ['electron.exe', 'resources/default_app.asar', 'locales/deep/x.pak']) {
      expect(
        allowlist.some((pattern) => globMatches(pattern, forbidden)),
        `desktop allowlist must not admit ${forbidden}`,
      ).toBe(false);
    }
  });

  it('anchors the vendored koffi runtime under resources/app/node_modules', () => {
    const desktopPaths = vendoredRuntimeDistPaths('desktop');
    expect(desktopPaths.length).toBeGreaterThan(0);
    for (const relative of desktopPaths) {
      expect(relative.startsWith('resources/app/node_modules/')).toBe(true);
    }
    // The other pipe-capable artifacts keep the artifact-root anchor.
    expect(
      vendoredRuntimeDistPaths('cli').every((relative) => !relative.includes('resources/')),
    ).toBe(true);
    expect(vendoredRuntimeDistPaths('extension')).toEqual([]);
  });
});

describe('vendored Electron runtime drift gate (fail-closed)', () => {
  it('declared pin equals the consuming app devDependency exactly', () => {
    const shellPackage = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'apps', 'desktop-shell', 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, unknown> };
    expect(shellPackage.devDependencies?.['electron']).toBe(VENDORED_ELECTRON_RUNTIME.version);
    expect(VENDORED_ELECTRON_RUNTIME.version).toBe('45.1.0');
    expect(VENDORED_ELECTRON_RUNTIME.executable).toBe('xdownload.exe');
  });

  it('accepts only the exact declared pin', () => {
    expect(() =>
      assertElectronRuntimeVersionConsistent(
        VENDORED_ELECTRON_RUNTIME.version,
        VENDORED_ELECTRON_RUNTIME.version,
      ),
    ).not.toThrow();
  });

  it('refuses a devDependency drift', () => {
    expect(() =>
      assertElectronRuntimeVersionConsistent('45.1.1', VENDORED_ELECTRON_RUNTIME.version),
    ).toThrow(/vendored electron runtime drift/u);
  });

  it('refuses an installed drift', () => {
    expect(() =>
      assertElectronRuntimeVersionConsistent(VENDORED_ELECTRON_RUNTIME.version, '45.0.0'),
    ).toThrow(/vendored electron runtime drift/u);
  });
});

// ------------------------------------------------------- real package build

describe('#284/#285 desktop artifact (real package build)', () => {
  let distRoot: string;

  beforeAll(async () => {
    distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-desktop-artifact-'));
    const { runPackageBuild } = await import('../package.ts');
    await runPackageBuild(distRoot);
  });

  afterAll(() => {
    fs.rmSync(distRoot, { recursive: true, force: true });
  });

  const SELECTED_TUPLE = process.platform === 'win32' && process.arch === 'x64';

  it('emits the shell app bundles under resources/app on every platform', () => {
    const appDir = path.join(distRoot, 'desktop', 'resources', 'app');
    for (const relative of [
      'package.json',
      'main/main.cjs',
      'preload/preload.cjs',
      'renderer/renderer.js',
      'renderer/index.html',
      'renderer/styles.css',
    ]) {
      const full = path.join(appDir, ...relative.split('/'));
      expect(fs.existsSync(full), `desktop/resources/app/${relative} must be emitted`).toBe(true);
      expect(fs.statSync(full).size, `${relative} must not be empty`).toBeGreaterThan(0);
    }
    // The bundled main keeps electron external (resolved by the packaged
    // runtime) and the renderer bundle is electron-free.
    const main = fs.readFileSync(path.join(appDir, 'main', 'main.cjs'), 'utf8');
    expect(main).toContain('require("electron")');
    const renderer = fs.readFileSync(path.join(appDir, 'renderer', 'renderer.js'), 'utf8');
    expect(renderer).not.toContain('require("electron")');
    expect(renderer).not.toContain('from "electron"');
    // The shipped app sidecar is minimal and versioned from the one shared
    // content-version declaration.
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(sidecar['name']).toBe('@xdownload/desktop-shell');
    expect(sidecar['version']).toBe(CONTENT_VERSION);
    expect(sidecar['main']).toBe('main/main.cjs');
  });

  it('binds every emitted artifact identity to the shared content version', () => {
    for (const artifact of ['cli', 'core', 'desktop', 'extension', 'native-host']) {
      const identity = JSON.parse(
        fs.readFileSync(path.join(distRoot, 'identity', `${artifact}.json`), 'utf8'),
      ) as { contentVersion?: unknown };
      expect(identity.contentVersion, artifact).toBe(CONTENT_VERSION);
    }
  });

  it.skipIf(!SELECTED_TUPLE)(
    'vendors the locked Electron runtime verbatim (renamed exe, no default app asar)',
    () => {
      const desktopDir = path.join(distRoot, 'desktop');
      const exe = path.join(desktopDir, 'xdownload.exe');
      expect(fs.existsSync(exe)).toBe(true);
      expect(fs.statSync(exe).size).toBeGreaterThan(0);
      // The unrenamed binary and the default app asar must never ship.
      expect(fs.existsSync(path.join(desktopDir, 'electron.exe'))).toBe(false);
      expect(fs.existsSync(path.join(desktopDir, 'resources', 'default_app.asar'))).toBe(false);
      // Required runtime files ship verbatim, with the executable's shipped
      // name substituted for the dist-tree name (electron.exe → xdownload.exe).
      for (const required of VENDORED_ELECTRON_RUNTIME.requiredDistPaths) {
        const shippedName =
          required === 'electron.exe' ? VENDORED_ELECTRON_RUNTIME.executable : required;
        expect(
          fs.existsSync(path.join(desktopDir, shippedName)),
          `desktop/${shippedName} must be vendored`,
        ).toBe(true);
      }
      expect(fs.readFileSync(path.join(desktopDir, 'version'), 'utf8').trim()).toBe(
        VENDORED_ELECTRON_RUNTIME.version,
      );
      const sourceExe = path.join(
        REPO_ROOT,
        'apps',
        'desktop-shell',
        'node_modules',
        'electron',
        'dist',
        'electron.exe',
      );
      expect(fs.readFileSync(exe).equals(fs.readFileSync(sourceExe))).toBe(true);
    },
  );

  it.skipIf(!SELECTED_TUPLE)('vendors the koffi runtime under resources/app/node_modules', () => {
    for (const relative of vendoredRuntimeDistPaths('desktop')) {
      const full = path.join(distRoot, 'desktop', relative);
      expect(fs.existsSync(full), `desktop/${relative} must be vendored`).toBe(true);
    }
  });

  it('skips electron vendoring honestly on non-selected build hosts', () => {
    // Structural mirror of the build-side rule: the exe exists exactly where
    // the selected tuple vendored it.
    expect(fs.existsSync(path.join(distRoot, 'desktop', 'xdownload.exe'))).toBe(SELECTED_TUPLE);
  });
});
