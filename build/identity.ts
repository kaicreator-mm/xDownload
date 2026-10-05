/**
 * T018 package identity — durable per-artifact identity binding the exact
 * source revision and pinned toolchain to a content hash (REFERENCE_PACK
 * §2.3; C33: a changed baseline/toolchain cannot silently claim the same
 * package identity).
 *
 * The canonical content hash covers ONLY artifact bytes (sorted relative
 * paths + per-file SHA-256), never generation timestamps, so a rebuild that
 * produces byte-identical artifacts produces the same contentHash and any
 * deviation is detectable and must be recorded, not hidden.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ToolchainRef {
  readonly name: string;
  readonly version: string;
}

export interface SourceRevision {
  /** Exact git HEAD the build was produced from. */
  readonly sha: string;
  /** True when uncommitted changes existed in the working tree. */
  readonly dirty: boolean;
}

export interface ContentFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface PackageIdentity {
  readonly artifact: string;
  readonly contentVersion: string;
  readonly sourceRevision: SourceRevision;
  readonly toolchain: readonly ToolchainRef[];
  readonly contentHash: string;
  readonly fileCount: number;
  readonly hostTuple: string;
  readonly generatedAt: string;
}

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Canonical content hash over a sorted file set (deterministic). */
export function canonicalContentHash(files: readonly ContentFileEntry[]): string {
  const canonical = JSON.stringify({
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
  return sha256Bytes(canonical);
}

export function listFilesRecursive(root: string): readonly string[] {
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

/** Content manifest of one artifact directory (paths relative to it). */
export function contentManifest(artifactDir: string): readonly ContentFileEntry[] {
  return listFilesRecursive(artifactDir).map((full) => {
    const bytes = fs.readFileSync(full);
    return {
      path: path.relative(artifactDir, full).split(path.sep).join('/'),
      sha256: sha256Bytes(bytes),
      bytes: bytes.byteLength,
    };
  });
}

/** Live source revision of the repo the build runs in. */
export function currentSourceRevision(repoRoot: string): SourceRevision {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    cwd: repoRoot,
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return { sha, dirty: status.trim().length > 0 };
}

export function hostTuple(): string {
  return `${process.platform}-${process.arch}`;
}

export function buildIdentity(input: {
  artifact: string;
  artifactDir: string;
  sourceRevision: SourceRevision;
  toolchain: readonly ToolchainRef[];
  contentVersion?: string;
}): PackageIdentity {
  const files = contentManifest(input.artifactDir);
  return {
    artifact: input.artifact,
    contentVersion: input.contentVersion ?? '0.0.0',
    sourceRevision: input.sourceRevision,
    toolchain: input.toolchain,
    contentHash: canonicalContentHash(files),
    fileCount: files.length,
    hostTuple: hostTuple(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Recompute the content hash of an emitted artifact directory and compare it
 * with a recorded identity — the audit's tamper/regeneration check.
 */
export function verifyIdentity(
  artifactDir: string,
  identity: PackageIdentity,
): { ok: true } | { ok: false; reason: string } {
  if (identity.contentHash !== canonicalContentHash(contentManifest(artifactDir))) {
    return { ok: false, reason: `content hash mismatch for artifact '${identity.artifact}'` };
  }
  return { ok: true };
}
