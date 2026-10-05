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

export async function runPackageBuild(distDir: string): Promise<{
  hashes: Record<string, string>;
}> {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  await bundleArtifacts(distDir);
  writeStaticAssets(distDir);
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
