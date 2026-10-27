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
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  ARTIFACTS,
  DEFAULT_DIST_DIR,
  REPO_ROOT,
  captureToolchain,
  configuredExtensionOrigins,
  NATIVE_HOST_NAME,
  VENDORED_NATIVE_RUNTIME,
  vendoredRuntimeDistPaths,
  type ArtifactSpec,
} from './build-config.ts';
import { buildIdentity, currentSourceRevision } from './identity.ts';
import { auditDist } from './audit.ts';
import { renderHostManifestTemplate } from './native-host.ts';

const SHEBANG = '#!/usr/bin/env node\n';

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
      ...(artifact.withShebang ? { banner: { js: SHEBANG } } : {}),
    });
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
        const destination = path.join(distDir, artifact.outDir, source.distPrefix, file);
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

export async function runPackageBuild(distDir: string): Promise<{
  hashes: Record<string, string>;
}> {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  await bundleArtifacts(distDir);
  writeStaticAssets(distDir);
  vendorNativeRuntime(distDir);
  const sourceRevision = currentSourceRevision(REPO_ROOT);
  const toolchain = captureToolchain(esbuild.version);
  const hashes: Record<string, string> = {};
  for (const artifact of ARTIFACTS) {
    const identity = buildIdentity({
      artifact: artifact.id,
      artifactDir: path.join(distDir, artifact.outDir),
      sourceRevision,
      toolchain,
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
