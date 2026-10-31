/**
 * T09 installer composer (owned boundary: the packaging/install write set
 * ONLY — `installers/**`, `scripts/install-host/**`, `build/**`).
 *
 * Composes the reproducible, user-installable Windows x64 package from a
 * built and audited `dist/`:
 *
 *   dist/ (pnpm build; audited FAIL-CLOSED again here before any byte is
 *          copied) + scripts/install-host/ user entry scripts
 *     → <out>/<name>/payload/            the verbatim dist payload
 *     → <out>/<name>/{install,uninstall,status,verify}.cmd
 *     → <out>/<name>/SHA256SUMS          deterministic hash manifest
 *     → <out>/<name>/INSTALL.txt         terse factual install/upgrade notes
 *     → <out>/<name>/installer-identity.json
 *     → <out>/xdownload-<version>-windows-x64.zip   deterministic archive
 *
 * Reproducibility: the payload copy, script copies, SHA256SUMS and zip are
 * byte-stable for the same dist bytes (sorted entries, fixed archive
 * timestamps, fixed deflate parameters; no wall-clock bytes enter any file
 * except the identity sidecar's `generatedAt`, which the content hash never
 * covers). A rebuild either reproduces the same installer content hash or
 * the deviation is visible and must be recorded.
 *
 * Fail-closed rules:
 * - the audit (`build/audit.ts`) runs over the dist BEFORE composition; any
 *   violation aborts with exit 1 — execution/evidence-only material can
 *   never enter an installer;
 * - every per-artifact identity recorded by the build must re-verify against
 *   the copied payload (package identity readback);
 * - the composed installer always states the exact selected tuple
 *   (windows-x64); no other platform is claimed anywhere.
 *
 * Usage: node installers/compose-installer.ts [--dist <dir>] [--out <dir>]
 *        [--version <semver>]
 * Exit codes: 0 composed+verified; 2 typed fail-closed refusal.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { auditDist } from '../build/audit.ts';
import {
  canonicalContentHash,
  currentSourceRevision,
  sha256Bytes,
  verifyIdentity,
  type ContentFileEntry,
  type PackageIdentity,
  type ToolchainRef,
} from '../build/identity.ts';
import { REPO_ROOT, captureToolchain } from '../build/build-config.ts';
import esbuild from 'esbuild';

/** The exact tuple this installer claims — never widened, never guessed. */
export const INSTALLER_TUPLE = { os: 'windows', arch: 'x64' } as const;
export const INSTALLER_CONTENT_VERSION = '0.2.1';

const SCRIPTS_SOURCE_DIR = path.join(REPO_ROOT, 'scripts', 'install-host');
const USER_SCRIPTS = ['install.cmd', 'uninstall.cmd', 'status.cmd', 'verify.cmd'] as const;
const VERIFIER_SCRIPT = 'verify-installer.mjs';
const README_FILE = 'INSTALL.txt';
const SUMS_FILE = 'SHA256SUMS';
const IDENTITY_FILE = 'installer-identity.json';

export function installerDirName(version: string): string {
  return `xdownload-v${version}-${INSTALLER_TUPLE.os}-${INSTALLER_TUPLE.arch}`;
}

export function installerZipName(version: string): string {
  return `${installerDirName(version)}.zip`;
}

// ------------------------------------------------------------------ CRC/zip

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS timestamp (1980-01-01 00:00:00) so archives are byte-stable. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * Deterministic STORE-mode zip writer: entries sorted by name, fixed
 * timestamps, no extra fields, no data descriptors. Store mode keeps the
 * archive a transparent container of already-verified bytes (the payload is
 * hashed anyway; compression would only re-order bytes behind a second
 * codec).
 */
export function buildDeterministicZip(entries: readonly ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of sorted) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    chunks.push(local, entry.bytes);

    const centralEntry = Buffer.alloc(46 + nameBytes.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(DOS_TIME, 12);
    centralEntry.writeUInt16LE(DOS_DATE, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(entry.bytes.length, 20);
    centralEntry.writeUInt32LE(entry.bytes.length, 24);
    centralEntry.writeUInt16LE(nameBytes.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    nameBytes.copy(centralEntry, 46);
    central.push(centralEntry);

    offset += local.length + entry.bytes.length;
  }
  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

// -------------------------------------------------------------- composition

function listFilesRecursive(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

function copyTree(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export interface ComposeOptions {
  readonly distDir: string;
  readonly outDir: string;
  readonly version: string;
}

export interface ComposeResult {
  readonly installerRoot: string;
  readonly zipPath: string;
  readonly identity: PackageIdentity;
  readonly payloadContentHashes: Record<string, string>;
  readonly zipSha256: string;
}

/**
 * Compose the installer. Throws typed Errors (exit 2) on any fail-closed
 * refusal; returns the composed tree facts on success.
 */
export function composeInstaller(options: ComposeOptions): ComposeResult {
  const { distDir, outDir, version } = options;
  if (!fs.existsSync(path.join(distDir, 'identity'))) {
    throw new Error(`dist not found or incomplete at '${distDir}'; run 'pnpm build' first`);
  }
  // Fail-closed audit over the EXACT bytes that are about to ship: no
  // execution/evidence-only file, no credential shape, no manifest mismatch
  // can enter an installer.
  const violations = auditDist({
    distDir,
    evidenceDir: path.join(REPO_ROOT, 'build', 'evidence'),
  });
  if (violations.length > 0) {
    const detail = violations
      .map((violation) => `[${violation.rule}] ${violation.detail}`)
      .join('\n');
    throw new Error(
      `dist failed the package-content audit; refusing to compose an installer:\n${detail}`,
    );
  }

  const installerRoot = path.join(outDir, installerDirName(version));
  fs.rmSync(installerRoot, { recursive: true, force: true });
  const payloadDir = path.join(installerRoot, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  for (const file of listFilesRecursive(distDir)) {
    copyTree(file, path.join(payloadDir, path.relative(distDir, file)));
  }

  // Package identity readback: every artifact identity the build recorded
  // must re-verify against the COPIED payload (byte-identical transport).
  const payloadContentHashes: Record<string, string> = {};
  const identityDir = path.join(distDir, 'identity');
  for (const file of fs.readdirSync(identityDir)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const identity = JSON.parse(
      fs.readFileSync(path.join(identityDir, file), 'utf8'),
    ) as PackageIdentity;
    const artifactPayloadDir = path.join(payloadDir, identity.artifact);
    const check = verifyIdentity(artifactPayloadDir, identity);
    if (!check.ok) {
      throw new Error(
        `payload identity readback failed for '${identity.artifact}': ${check.reason}`,
      );
    }
    payloadContentHashes[identity.artifact] = identity.contentHash;
  }

  // User entry scripts, copied verbatim from scripts/install-host/.
  for (const script of USER_SCRIPTS) {
    const source = path.join(SCRIPTS_SOURCE_DIR, script);
    if (!fs.existsSync(source)) {
      throw new Error(`user install script missing from the repo: scripts/install-host/${script}`);
    }
    copyTree(source, path.join(installerRoot, script));
  }
  const readmeSource = path.join(SCRIPTS_SOURCE_DIR, README_FILE);
  if (!fs.existsSync(readmeSource)) {
    throw new Error(`install instructions missing: scripts/install-host/${README_FILE}`);
  }
  copyTree(readmeSource, path.join(installerRoot, README_FILE));
  const verifierSource = path.join(SCRIPTS_SOURCE_DIR, VERIFIER_SCRIPT);
  if (!fs.existsSync(verifierSource)) {
    throw new Error(`integrity verifier missing: scripts/install-host/${VERIFIER_SCRIPT}`);
  }
  copyTree(verifierSource, path.join(installerRoot, VERIFIER_SCRIPT));

  // Deterministic hash manifest over every installer file except the sums
  // and identity sidecars themselves (they are the manifest's subjects).
  const manifestEntries: ContentFileEntry[] = [];
  const collect = (dir: string): void => {
    for (const file of listFilesRecursive(dir)) {
      const bytes = fs.readFileSync(file);
      manifestEntries.push({
        path: path.relative(installerRoot, file).split(path.sep).join('/'),
        sha256: sha256Bytes(bytes),
        bytes: bytes.byteLength,
      });
    }
  };
  collect(installerRoot);
  const sumsText = [...manifestEntries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join('\n');
  fs.writeFileSync(path.join(installerRoot, SUMS_FILE), `${sumsText}\n`, 'utf8');

  const sourceRevision = currentSourceRevision(REPO_ROOT);
  const toolchain: readonly ToolchainRef[] = captureToolchain(esbuild.version);
  const installerFiles = [...manifestEntries];
  const identity: PackageIdentity = {
    artifact: `installer-${INSTALLER_TUPLE.os}-${INSTALLER_TUPLE.arch}`,
    contentVersion: version,
    sourceRevision,
    toolchain,
    contentHash: canonicalContentHash(installerFiles),
    fileCount: installerFiles.length + 2, // + SHA256SUMS + this identity sidecar
    hostTuple: `${process.platform}-${process.arch}`,
    // Deterministic "generation time": the source revision's commit time.
    // The compose wall clock is intentionally NOT recorded anywhere — the
    // identity sidecar must stay byte-stable so the archive is reproducible,
    // and the honest time fact of a build is the revision it was made from.
    generatedAt: sourceCommitTime(sourceRevision.sha),
  };
  const identityDoc = {
    ...identity,
    tuple: INSTALLER_TUPLE,
    payloadContentHashes,
    sumsFile: SUMS_FILE,
    note: 'contentHash covers exactly the files listed in SHA256SUMS; generatedAt is metadata and never enters the hash',
  };
  fs.writeFileSync(
    path.join(installerRoot, IDENTITY_FILE),
    `${JSON.stringify(identityDoc, null, 2)}\n`,
    'utf8',
  );

  // Deterministic archive of the whole installer directory, wrapped in the
  // installer directory name so extraction yields exactly one folder.
  const wrapPrefix = `${installerDirName(version)}/`;
  const zipEntries: ZipEntry[] = listFilesRecursive(installerRoot).map((file) => ({
    name: `${wrapPrefix}${path.relative(installerRoot, file).split(path.sep).join('/')}`,
    bytes: fs.readFileSync(file),
  }));
  const zipPath = path.join(outDir, installerZipName(version));
  const zipBytes = buildDeterministicZip(zipEntries);
  fs.writeFileSync(zipPath, zipBytes);
  const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');

  return { installerRoot, zipPath, identity, payloadContentHashes, zipSha256 };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  try {
    const distDir = path.resolve(flag('--dist') ?? path.join(REPO_ROOT, 'dist'));
    const outDir = path.resolve(flag('--out') ?? path.join(REPO_ROOT, 'out', 'installer'));
    const version = flag('--version') ?? INSTALLER_CONTENT_VERSION;
    const result = composeInstaller({ distDir, outDir, version });
    process.stdout.write(`installer composed: ${result.installerRoot}\n`);
    for (const [artifact, hash] of Object.entries(result.payloadContentHashes)) {
      process.stdout.write(`payload ${artifact}: sha256-${hash}\n`);
    }
    process.stdout.write(
      `installer content: sha256-${result.identity.contentHash} (${String(result.identity.fileCount)} files)\n`,
    );
    process.stdout.write(`archive ${path.basename(result.zipPath)}: sha256-${result.zipSha256}\n`);
    process.stdout.write(
      `verify any time with: node scripts/install-host/verify-installer.mjs "${result.installerRoot}"\n`,
    );
  } catch (error) {
    process.stderr.write(
      `compose-installer: ${error instanceof Error ? error.message : 'failed'}\n`,
    );
    process.exitCode = 2;
  }
}

/** The exact commit time of a source revision (deterministic per sha). */
function sourceCommitTime(sha: string): string {
  return execFileSync('git', ['show', '-s', '--format=%cI', sha], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  }).trim();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
