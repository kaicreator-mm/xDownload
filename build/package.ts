/**
 * T018 production build/package orchestrator (`pnpm build`).
 *
 * Pipeline (REFERENCE_PACK §3.1):
 *   pinned lockfile install (caller runs `pnpm install --frozen-lockfile`)
 *   → bundle TS-source workspace exports per artifact (esbuild, pinned)
 *   → emit manifest-matching extension layout + native-host assets
 *     (selected platform only; unselected platforms emit nothing)
 *   → emit per-artifact package identities (source revision + toolchain +
 *     content hash)
 *   → copy the support/NOT_PROVEN matrix
 *   → run the package-content audit FAIL-CLOSED (any violation exits 1).
 *
 * Determinism: esbuild emits byte-stable output for identical inputs; no
 * timestamps enter artifact bytes. Identity sidecars carry generatedAt but
 * the canonical contentHash covers artifact bytes only, so a rebuild either
 * reproduces the same contentHash or the deviation is visible and must be
 * recorded (TEST_MATRIX: rebuild determinism).
 */

import { createRequire } from 'node:module';
import esbuild, { type Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  ARTIFACTS,
  CONTENT_VERSION,
  DEFAULT_DIST_DIR,
  REPO_ROOT,
  captureToolchain,
  configuredExtensionOrigins,
  NATIVE_HOST_NAME,
  VENDORED_ELECTRON_RUNTIME,
  VENDORED_NATIVE_RUNTIME,
  vendoredRuntimeDistPaths,
  type ArtifactSpec,
} from './build-config.ts';
import { buildIdentity, currentSourceRevision, sourceCommitTime } from './identity.ts';
import { auditDist } from './audit.ts';
import { renderHostManifestTemplate } from './native-host.ts';
import { browserNodeStubsPlugin } from './browser-node-stubs.ts';

const SHEBANG = '#!/usr/bin/env node\n';

/**
 * #T05-legacy repair (T09): the browser artifact must bundle the node-free
 * reachable surface even though the `@xdownload/core-seam` barrel re-exports
 * node-only modules. Only browser-platform bundles get the fail-closed
 * node-builtin stubs; the node artifacts keep real built-ins.
 */
function esbuildPluginsFor(platform: ArtifactSpec['platform']): Plugin[] | undefined {
  return platform === 'browser' ? [browserNodeStubsPlugin()] : undefined;
}

const CLI_BIN_SH = `#!/bin/sh
exec node "$(dirname "$0")/../xdownload-cli.js" "$@"
`;
const CLI_BIN_CMD = `@echo off
node "%~dp0..\\xdownload-cli.js" %*
`;
const BROKER_BIN_SH = `#!/bin/sh
exec node "$(dirname "$0")/../xdownload-broker-host.js" --config "$(dirname "$0")/../broker-config.json" "$@"
`;
const BROKER_BIN_CMD = `@echo off
node "%~dp0..\\xdownload-broker-host.js" --config "%~dp0..\\broker-config.json" %*
`;

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseOutDir(argv: readonly string[]): string {
  const marker = argv.indexOf('--out');
  if (marker >= 0) {
    const value = argv[marker + 1];
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return DEFAULT_DIST_DIR;
}

async function bundleArtifacts(distDir: string): Promise<void> {
  for (const artifact of ARTIFACTS) {
    // The desktop artifact is composed by bundleDesktopArtifact() below
    // (CJS main/preload + browser renderer under resources/app/): the
    // generic single-ESM-bundle path cannot express its layout.
    if (artifact.id === 'desktop') {
      continue;
    }
    const outfile = path.join(distDir, artifact.outDir, artifact.outFile);
    await esbuild.build({
      entryPoints: [path.join(REPO_ROOT, artifact.entryPoint)],
      outfile,
      bundle: true,
      platform: artifact.platform,
      format: 'esm',
      target: artifact.platform === 'node' ? 'node24' : 'es2023',
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'warning',
      // #101 S3-WIN-IPC-001 / #T019 packaged-windows-pipe: the native FFI
      // bridge (koffi) is a lazy, win32-only runtime dependency that cannot be
      // bundled (prebuilt .node binary). It stays external; the exact runtime
      // file set is vendored next to each bundle by vendorNativeRuntime()
      // below, so the guarded loader resolves `require('koffi')` from the
      // clean dist instead of failing closed there.
      external: ['koffi', '@koromix/*'],
      plugins: esbuildPluginsFor(artifact.platform),
      ...(artifact.withShebang ? { banner: { js: SHEBANG } } : {}),
    });
    // #179: additional same-artifact bundles (packaging/install write set)
    // emitted with the identical build options as the main bundle.
    for (const extra of artifact.extraBundles ?? []) {
      await esbuild.build({
        entryPoints: [path.join(REPO_ROOT, extra.entryPoint)],
        outfile: path.join(distDir, artifact.outDir, extra.outFile),
        bundle: true,
        platform: artifact.platform,
        format: 'esm',
        target: artifact.platform === 'node' ? 'node24' : 'es2023',
        sourcemap: false,
        legalComments: 'none',
        logLevel: 'warning',
        external: ['koffi', '@koromix/*'],
        plugins: esbuildPluginsFor(artifact.platform),
        ...(artifact.withShebang ? { banner: { js: SHEBANG } } : {}),
      });
    }
  }
}

function writeStaticAssets(distDir: string): void {
  // Extension: exactly the manifest the consumed app declares, copied
  // verbatim; the audit fails closed if emitted layout and manifest
  // references ever disagree.
  const manifestSource = path.join(REPO_ROOT, 'apps/browser-extension/manifest.json');
  fs.mkdirSync(path.join(distDir, 'extension'), { recursive: true });
  fs.copyFileSync(manifestSource, path.join(distDir, 'extension', 'manifest.json'));
  // #95 installed S2 journey surfaces: the action popup (explicit user
  // selection + truthful result rendering) and its notification icon, copied
  // verbatim from the consumed app sources.
  for (const popupAsset of ['popup.html', 'popup.js', 'icon128.png']) {
    fs.copyFileSync(
      path.join(REPO_ROOT, 'apps/browser-extension/src/popup', popupAsset),
      path.join(distDir, 'extension', popupAsset),
    );
  }

  // Native host: broker config (allowed_origins) + manifest template + bin
  // launchers. No Linux/macOS registration material is emitted — those
  // platforms are unselected and stay NOT_PROVEN in the matrix.
  const origins = configuredExtensionOrigins();
  writeTextFile(
    path.join(distDir, 'native-host', 'broker-config.json'),
    `${JSON.stringify({ hostName: NATIVE_HOST_NAME, allowedOrigins: origins }, null, 2)}\n`,
  );
  writeTextFile(
    path.join(distDir, 'native-host', 'com.xdownload.broker.template.json'),
    renderHostManifestTemplate(origins),
  );
  writeTextFile(path.join(distDir, 'native-host', 'bin', 'xdownload-broker-host'), BROKER_BIN_SH);
  writeTextFile(
    path.join(distDir, 'native-host', 'bin', 'xdownload-broker-host.cmd'),
    BROKER_BIN_CMD,
  );

  // CLI bin launchers.
  writeTextFile(path.join(distDir, 'cli', 'bin', 'xdownload'), CLI_BIN_SH);
  writeTextFile(path.join(distDir, 'cli', 'bin', 'xdownload.cmd'), CLI_BIN_CMD);
}

interface VendoredSource {
  readonly distPrefix: string;
  readonly dir: string;
}

/**
 * Resolve the vendored-runtime source directories from the installed
 * workspace tree (the same tree the build's own pipe tests load koffi from).
 * Resolution mirrors the runtime's own rules: koffi resolvable from the
 * core-seam dependency context; the win32-x64 prebuilt resolvable from
 * koffi's own package context (the node_modules sibling).
 */
function resolveVendoredSources(): Record<string, VendoredSource> {
  const requireFromCoreSeam = createRequire(path.join(REPO_ROOT, 'packages/core-seam', 'noop.js'));
  const koffiDir = path.dirname(requireFromCoreSeam.resolve('koffi'));
  const koffiPackage = JSON.parse(fs.readFileSync(path.join(koffiDir, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (koffiPackage.version !== VENDORED_NATIVE_RUNTIME.version) {
    throw new Error(
      `vendored native runtime drift: installed koffi ${String(koffiPackage.version)} != declared ${VENDORED_NATIVE_RUNTIME.version}; re-derive VENDORED_NATIVE_RUNTIME (build-config.ts) from the lockfile before packaging`,
    );
  }
  let koromixDir: string;
  try {
    koromixDir = path.dirname(
      createRequire(path.join(koffiDir, 'package.json')).resolve('@koromix/koffi-win32-x64'),
    );
  } catch {
    koromixDir = path.resolve(koffiDir, '..', '@koromix/koffi-win32-x64');
  }
  if (!fs.existsSync(path.join(koromixDir, 'package.json'))) {
    throw new Error(
      `vendored native runtime drift: the ${VENDORED_NATIVE_RUNTIME.platform}-${VENDORED_NATIVE_RUNTIME.arch} prebuilt (@koromix/koffi-win32-x64@${VENDORED_NATIVE_RUNTIME.version}) is not installed; run the pinned install before packaging`,
    );
  }
  const koromixPackage = JSON.parse(
    fs.readFileSync(path.join(koromixDir, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  if (koromixPackage.version !== VENDORED_NATIVE_RUNTIME.version) {
    throw new Error(
      `vendored native runtime drift: installed @koromix/koffi-win32-x64 ${String(koromixPackage.version)} != declared ${VENDORED_NATIVE_RUNTIME.version}; the native module refuses mismatched versions at runtime`,
    );
  }
  return {
    koffi: { distPrefix: 'node_modules/koffi', dir: koffiDir },
    '@koromix/koffi-win32-x64': {
      distPrefix: 'node_modules/@koromix/koffi-win32-x64',
      dir: koromixDir,
    },
  };
}

/**
 * #287 T02-R1 (DAG_AMENDMENT_R2A): the packaged Core composes the one K
 * Domain App at runtime, and the frozen sealed K/S/B/C bytes plus the pinned
 * vendored SDK parser are read from paths relative to the BUNDLE file. The
 * sources are the git-tracked sealed tree of `packages/download-domain-app`
 * (eight files) and the lockfile-pinned `@kaicreator/domain-harness-build`
 * install (the emitted `dist/generated/acorn.js` artifact — the parser self-
 * checks these exact bytes at runtime, so only the installed package's own
 * file may ship). Every copy is byte-verbatim; copies happen before identity
 * hashing, so every vendored byte is covered by the artifact content hash.
 */
const SEALED_DOMAIN_APP_SOURCE_ROOT = path.join(REPO_ROOT, 'packages', 'download-domain-app');
const SEALED_DOMAIN_APP_FROZEN_FILES: readonly {
  readonly source: string;
  readonly target: string;
}[] = [
  {
    source: 'src/business/payloads/dist/kernel-mechanism-v1.mjs',
    target: 'payloads/dist/kernel-mechanism-v1.mjs',
  },
  {
    source: 'src/business/payloads/dist/standard-sdk-v1.mjs',
    target: 'payloads/dist/standard-sdk-v1.mjs',
  },
  {
    source: 'src/business/payloads/dist/workflow-router.mjs',
    target: 'payloads/dist/workflow-router.mjs',
  },
  {
    source: 'src/business/payloads/SHA256SUMS',
    target: 'payloads/SHA256SUMS',
  },
  {
    source: 'src/business/business-download.mjs',
    target: 'business-download.mjs',
  },
  {
    source: 'src/business/capability-acquisition-stub.mjs',
    target: 'capability-acquisition-stub.mjs',
  },
  {
    source: 'src/integrations/s4-hls-vod-business.mjs',
    target: 's4-hls-vod-business.mjs',
  },
  {
    source: 'src/integrations/s4-hls-vod-capability.mjs',
    target: 's4-hls-vod-capability.mjs',
  },
];

/**
 * Resolve the installed `@kaicreator/domain-harness-build` package the frozen
 * composition consumes, fail-closed: the declared dependency of
 * `packages/download-domain-app` and the installed package version must be
 * exactly equal (same drift discipline as the koffi/electron vendoring), and
 * the emitted parser artifact must physically exist — the pin is meaningless
 * without the build.
 */
function resolveVendoredParserPath(): string {
  const domainAppPackage = JSON.parse(
    fs.readFileSync(path.join(SEALED_DOMAIN_APP_SOURCE_ROOT, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, unknown> };
  const declared = domainAppPackage.dependencies?.['@kaicreator/domain-harness-build'];
  const buildPackageDir = path.join(
    SEALED_DOMAIN_APP_SOURCE_ROOT,
    'node_modules',
    '@kaicreator',
    'domain-harness-build',
  );
  const buildPackage = JSON.parse(
    fs.readFileSync(path.join(buildPackageDir, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  if (declared === undefined || buildPackage.version !== declared) {
    throw new Error(
      `sealed Domain App runtime drift: @kaicreator/domain-harness-build installed ${String(buildPackage.version)} != declared ${String(declared)} in packages/download-domain-app; re-install from the lockfile before packaging`,
    );
  }
  const parserPath = path.join(buildPackageDir, 'dist', 'generated', 'acorn.js');
  if (!fs.existsSync(parserPath)) {
    throw new Error(
      `sealed Domain App runtime drift: emitted Acorn bytes not found at ${parserPath}; the vendored SDK build is incomplete — re-install from the lockfile before packaging`,
    );
  }
  return parserPath;
}

function vendorSealedDomainAppRuntime(distDir: string): void {
  const coreDir = path.join(distDir, 'core');
  const vendored: string[] = [];
  for (const file of SEALED_DOMAIN_APP_FROZEN_FILES) {
    const source = path.join(SEALED_DOMAIN_APP_SOURCE_ROOT, file.source);
    if (!fs.existsSync(source)) {
      throw new Error(
        `sealed Domain App runtime source missing: ${path.join('packages', 'download-domain-app', file.source)}; the frozen sealed tree is incomplete — refusing to package a Core whose K composition would boot-fail`,
      );
    }
    const destination = path.join(coreDir, file.target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    vendored.push(`core/${file.target}`);
  }
  const parserTarget = path.join(coreDir, 'generated', 'acorn.js');
  fs.mkdirSync(path.dirname(parserTarget), { recursive: true });
  fs.copyFileSync(resolveVendoredParserPath(), parserTarget);
  vendored.push('core/generated/acorn.js');
  // Fail closed on any declared-but-absent path after the copy pass.
  for (const relative of vendored) {
    if (!fs.existsSync(path.join(distDir, relative))) {
      throw new Error(`sealed Domain App runtime file missing after copy: ${relative}`);
    }
  }
  process.stdout.write(
    `package: vendored sealed Domain App runtime (${String(vendored.length)} frozen files) into core\n`,
  );
}

/**
 * Vendor the minimal Windows native runtime (koffi + its win32-x64 prebuilt,
 * license included) verbatim into every node artifact that can exercise the
 * named-pipe transport. Files are the exact VENDORED_NATIVE_RUNTIME
 * declaration; anything else under node_modules stays audit-denied. Copies
 * happen before identity hashing, so every vendored byte is covered by the
 * artifact content hash. Non-selected build hosts skip the step honestly
 * (the emitted artifact set stays audit-clean; the selected win32-x64 tuple
 * is the only one allowed to claim the packaged pipe).
 */
function vendorNativeRuntime(distDir: string): void {
  if (
    process.platform !== VENDORED_NATIVE_RUNTIME.platform ||
    process.arch !== VENDORED_NATIVE_RUNTIME.arch
  ) {
    process.stdout.write(
      `package: native runtime not vendored (${process.platform}-${process.arch} is not the selected ${VENDORED_NATIVE_RUNTIME.platform}-${VENDORED_NATIVE_RUNTIME.arch} tuple)\n`,
    );
    return;
  }
  const sources = resolveVendoredSources();
  const targetArtifacts: readonly ArtifactSpec[] = ARTIFACTS.filter((artifact) =>
    VENDORED_NATIVE_RUNTIME.artifacts.includes(artifact.id),
  );
  for (const artifact of targetArtifacts) {
    for (const pkg of VENDORED_NATIVE_RUNTIME.packages) {
      const source = sources[pkg.name];
      if (source === undefined) {
        throw new Error(`vendored native runtime source missing for ${pkg.name}`);
      }
      for (const file of pkg.files) {
        // The desktop artifact's runtime resolves require('koffi') from its
        // app dir, so its vendored tree anchors under resources/app/.
        const distPrefix =
          artifact.id === 'desktop' ? `resources/app/${source.distPrefix}` : source.distPrefix;
        const destination = path.join(distDir, artifact.outDir, distPrefix, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(source.dir, file), destination);
      }
    }
  }
  // Fail closed on any declared-but-absent path: a partial vendoring would
  // otherwise ship a dist whose pipe transport fails closed at runtime.
  for (const artifact of targetArtifacts) {
    for (const relative of vendoredRuntimeDistPaths(artifact.id)) {
      if (!fs.existsSync(path.join(distDir, artifact.outDir, relative))) {
        throw new Error(`vendored runtime file missing after copy: ${artifact.outDir}/${relative}`);
      }
    }
  }
  process.stdout.write(
    `package: vendored native runtime koffi@${VENDORED_NATIVE_RUNTIME.version} (${VENDORED_NATIVE_RUNTIME.arch}) into ${targetArtifacts.map((artifact) => artifact.outDir).join(', ')}\n`,
  );
}

/**
 * #284/#285 T09-R1: compose the desktop artifact. The frozen T07/T08 shell
 * sources are bundled with EXACTLY the options apps/desktop-shell/test/
 * smoke/build-shell.mjs (the authoritative smoke reference) uses — CJS
 * main/preload with electron external, browser IIFE renderer with nothing
 * external (an accidental electron import fails the bundle closed) — into
 * the Electron resources/app/ layout the renamed launcher binary expects.
 * main.ts resolves its renderer/preload/assets via `join(__dirname, '..',
 * …)`, so the bundles keep the main/ + preload/ + renderer/ sibling layout
 * under resources/app/ and the app sidecar's "main" points at main/main.cjs.
 * Runtime source semantics are untouched (T07/T08 freeze): this is packaging
 * layout only.
 */
async function bundleDesktopArtifact(distDir: string): Promise<void> {
  const shellRoot = path.join(REPO_ROOT, 'apps', 'desktop-shell');
  const appDir = path.join(distDir, 'desktop', 'resources', 'app');
  const nodeBundle = {
    bundle: true,
    platform: 'node' as const,
    format: 'cjs' as const,
    target: 'node24',
    sourcemap: false,
    legalComments: 'none' as const,
    logLevel: 'warning' as const,
  };
  // koffi stays external exactly like the other node artifacts: the packaged
  // pipe transport lazily createRequire()s it from resources/app/node_modules
  // (vendored by vendorNativeRuntime above).
  await esbuild.build({
    ...nodeBundle,
    entryPoints: [path.join(shellRoot, 'src', 'main', 'main.ts')],
    outfile: path.join(appDir, 'main', 'main.cjs'),
    external: ['electron', 'koffi', '@koromix/*'],
  });
  await esbuild.build({
    ...nodeBundle,
    entryPoints: [path.join(shellRoot, 'src', 'preload', 'preload.ts')],
    outfile: path.join(appDir, 'preload', 'preload.cjs'),
    external: ['electron'],
  });
  await esbuild.build({
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome140'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    entryPoints: [path.join(shellRoot, 'src', 'renderer', 'renderer-main.ts')],
    outfile: path.join(appDir, 'renderer', 'renderer.js'),
    external: [],
  });
  fs.cpSync(path.join(shellRoot, 'src', 'main', 'assets'), path.join(appDir, 'main', 'assets'), {
    recursive: true,
  });
  for (const asset of ['index.html', 'styles.css']) {
    fs.copyFileSync(
      path.join(shellRoot, 'src', 'renderer', asset),
      path.join(appDir, 'renderer', asset),
    );
  }
  // Minimal shipped app sidecar: just enough for Electron's app loader.
  // VERSION tracks the one CONTENT_VERSION declaration (build-config.ts) so
  // the shipped app version byte can never drift from the installer version.
  writeTextFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@xdownload/desktop-shell',
        version: CONTENT_VERSION,
        private: true,
        main: 'main/main.cjs',
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Fail-closed version equality for the vendored Electron runtime, the same
 * drift discipline as koffi (build-config.ts): the declared pin, the
 * consuming app's devDependency declaration and the installed package must
 * all name the exact same version or the build refuses.
 */
export function assertElectronRuntimeVersionConsistent(
  declared: unknown,
  installed: unknown,
): void {
  if (
    declared !== VENDORED_ELECTRON_RUNTIME.version ||
    installed !== VENDORED_ELECTRON_RUNTIME.version
  ) {
    throw new Error(
      `vendored electron runtime drift: apps/desktop-shell devDependencies.electron ${String(declared)} and installed ${String(installed)} must both equal the declared pin ${VENDORED_ELECTRON_RUNTIME.version}; re-derive VENDORED_ELECTRON_RUNTIME (build-config.ts) from the lockfile before packaging`,
    );
  }
}

/**
 * Vendor the locked Electron runtime (node_modules/electron/dist) VERBATIM
 * into dist/desktop/ on the selected win32-x64 tuple: electron.exe ships
 * renamed to xdownload.exe, resources/default_app.asar is dropped (it would
 * shadow resources/app), every other byte is copied untouched and lands in
 * the artifact identity hash. Non-selected hosts skip honestly (mirroring
 * vendorNativeRuntime): their dist carries the app bundles only, and the
 * compose-time P2 gates keep such a dist out of an installer.
 */
function vendorElectronRuntime(distDir: string): void {
  if (
    process.platform !== VENDORED_ELECTRON_RUNTIME.platform ||
    process.arch !== VENDORED_ELECTRON_RUNTIME.arch
  ) {
    process.stdout.write(
      `package: electron runtime not vendored (${process.platform}-${process.arch} is not the selected ${VENDORED_ELECTRON_RUNTIME.platform}-${VENDORED_ELECTRON_RUNTIME.arch} tuple)\n`,
    );
    return;
  }
  const requireFromShell = createRequire(path.join(REPO_ROOT, 'apps', 'desktop-shell', 'noop.js'));
  const electronDir = path.dirname(requireFromShell.resolve('electron/package.json'));
  const electronPackage = JSON.parse(
    fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  const shellPackage = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'apps', 'desktop-shell', 'package.json'), 'utf8'),
  ) as { devDependencies?: Record<string, unknown> };
  assertElectronRuntimeVersionConsistent(
    shellPackage.devDependencies?.['electron'],
    electronPackage.version,
  );
  const electronDist = path.join(electronDir, 'dist');
  if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
    throw new Error(
      'vendored electron runtime: node_modules/electron/dist is missing electron.exe (the postinstall binary download was skipped?); run the pinned install (ELECTRON_MIRROR for this host) before packaging',
    );
  }
  // The dist/version byte fact must equal the pin: a partially-updated
  // node_modules tree cannot silently claim the declared runtime identity.
  const distVersion = fs.readFileSync(path.join(electronDist, 'version'), 'utf8').trim();
  if (distVersion !== VENDORED_ELECTRON_RUNTIME.version) {
    throw new Error(
      `vendored electron runtime drift: electron/dist/version is ${distVersion}, expected ${VENDORED_ELECTRON_RUNTIME.version}; the installed binary tree does not match the declared pin`,
    );
  }
  for (const required of VENDORED_ELECTRON_RUNTIME.requiredDistPaths) {
    if (!fs.existsSync(path.join(electronDist, required))) {
      throw new Error(
        `vendored electron runtime: installed electron dist is missing '${required}'; refusing to ship a partial runtime`,
      );
    }
  }
  const excluded = new Set<string>(VENDORED_ELECTRON_RUNTIME.excludedDistPaths);
  const targetDir = path.join(distDir, 'desktop');
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(electronDist, relative), {
      withFileTypes: true,
    })) {
      const rel = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (excluded.has(rel)) {
        continue;
      }
      const destination =
        rel === 'electron.exe'
          ? path.join(targetDir, VENDORED_ELECTRON_RUNTIME.executable)
          : path.join(targetDir, rel);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(electronDist, rel), destination);
    }
  };
  walk('');
  process.stdout.write(
    `package: vendored electron runtime ${VENDORED_ELECTRON_RUNTIME.version} (${VENDORED_ELECTRON_RUNTIME.platform}-${VENDORED_ELECTRON_RUNTIME.arch}) into desktop/${VENDORED_ELECTRON_RUNTIME.executable}\n`,
  );
}

export async function runPackageBuild(distDir: string): Promise<{
  hashes: Record<string, string>;
}> {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  await bundleArtifacts(distDir);
  writeStaticAssets(distDir);
  vendorNativeRuntime(distDir);
  // #287 T02-R1 (DAG_AMENDMENT_R2A): before the desktop composition so every
  // vendored byte is in place before the artifact identities are hashed.
  vendorSealedDomainAppRuntime(distDir);
  await bundleDesktopArtifact(distDir);
  vendorElectronRuntime(distDir);
  const sourceRevision = currentSourceRevision(REPO_ROOT);
  const toolchain = captureToolchain(esbuild.version);
  // T09 review fix: the shipped identity sidecars must be byte-reproducible,
  // so their mint time is the source revision's own commit time — never the
  // wall clock of the building shell (the sidecars ship inside the installer
  // payload's SHA256SUMS set; a wall-clock byte would make every fresh build
  // hash differently).
  const generatedAt = sourceCommitTime(REPO_ROOT, sourceRevision.sha);
  const hashes: Record<string, string> = {};
  for (const artifact of ARTIFACTS) {
    const identity = buildIdentity({
      artifact: artifact.id,
      artifactDir: path.join(distDir, artifact.outDir),
      contentVersion: CONTENT_VERSION,
      sourceRevision,
      toolchain,
      generatedAt,
    });
    hashes[artifact.id] = identity.contentHash;
    writeTextFile(
      path.join(distDir, 'identity', `${artifact.id}.json`),
      `${JSON.stringify(identity, null, 2)}\n`,
    );
  }
  fs.copyFileSync(
    path.join(REPO_ROOT, 'build', 'support-matrix.json'),
    path.join(distDir, 'support-matrix.json'),
  );
  return { hashes };
}

async function main(): Promise<void> {
  const distDir = path.isAbsolute(process.argv[2] ?? '')
    ? (process.argv[2] ?? DEFAULT_DIST_DIR)
    : path.join(REPO_ROOT, parseOutDir(process.argv.slice(2)));
  const { hashes } = await runPackageBuild(distDir);
  const violations = auditDist({
    distDir,
    evidenceDir: path.join(REPO_ROOT, 'build', 'evidence'),
  });
  for (const [artifact, hash] of Object.entries(hashes)) {
    process.stdout.write(`package ${artifact}: sha256-${hash}\n`);
  }
  if (violations.length > 0) {
    process.stderr.write(
      `package-content audit FAILED (${String(violations.length)} violations):\n`,
    );
    for (const violation of violations) {
      process.stderr.write(`  [${violation.rule}] ${violation.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('package-content audit: PASS\n');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
