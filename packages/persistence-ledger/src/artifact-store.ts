/**
 * T005 filesystem artifact store — downloaded bytes live here, never in the
 * database (frozen L2 §6.2 data-ownership: artifact bytes → filesystem store).
 *
 * Byte lifecycle mirrors the durable ledger states with three directories:
 * staging/ (staged) → materialized/ (materialized) → final/ (finalized).
 * A digest (SHA-256) is computed at staging, verified at finalization, and
 * re-verified before any acceptance — missing, unmaterialized or
 * digest-mismatched bytes can never become success (frozen L2 invariants
 * 9/10/18; ADR-004).
 */

import { createHash, type Hash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeSync as fsWriteSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { PersistenceError } from './errors.ts';

export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function assertArtifactId(artifactId: string): string {
  if (typeof artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `artifact id must match ${String(ARTIFACT_ID_PATTERN)}`,
      { path: 'artifactId' },
    );
  }
  // Path-safety backstop: ids may contain '/' segments but never escape the
  // store root, and never contain '..' segments.
  if (artifactId.includes('..') || artifactId.split('/').includes('..')) {
    throw new PersistenceError('MALFORMED_LEDGER_ROW', 'artifact id contains a path traversal', {
      path: 'artifactId',
    });
  }
  return artifactId;
}

export function sha256Hex(bytes: Uint8Array): string {
  const hash: Hash = createHash('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

/**
 * Deterministic, reversible, collision-free filename encoding for artifact
 * ids. Identities may contain ':'/'/' (canonical id pattern) but filesystem
 * entries must be portable across host OSes; '%XX' escapes keep identity
 * intact without OS-specific filename restrictions.
 */
export function fileSafeName(artifactId: string): string {
  return artifactId.replace(/[^A-Za-z0-9._-]/g, (character) => {
    const code = character.charCodeAt(0);
    return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

export type FilesystemArtifactPhase = 'ABSENT' | 'STAGED' | 'MATERIALIZED' | 'FINALIZED';

export interface FilesystemArtifactObservation {
  readonly phase: FilesystemArtifactPhase;
  /** Digest of the bytes actually present at the observed phase, when any. */
  readonly observedDigest: string | undefined;
  readonly observedByteSize: number | undefined;
}

export class FilesystemArtifactStore {
  readonly rootDir: string;
  private readonly stagingDir: string;
  private readonly materializedDir: string;
  private readonly finalDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.stagingDir = join(rootDir, 'staging');
    this.materializedDir = join(rootDir, 'materialized');
    this.finalDir = join(rootDir, 'final');
    for (const dir of [this.stagingDir, this.materializedDir, this.finalDir]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private stagingPath(artifactId: string): string {
    return join(this.stagingDir, `${fileSafeName(artifactId)}.part`);
  }

  private materializedPath(artifactId: string): string {
    return join(this.materializedDir, `${fileSafeName(artifactId)}.bin`);
  }

  private finalPath(artifactId: string): string {
    return join(this.finalDir, `${fileSafeName(artifactId)}.bin`);
  }

  /** Write staged bytes (fsync'd); returns the computed digest binding. */
  stageBytes(artifactId: string, bytes: Uint8Array): { digest: string; byteSize: number } {
    assertArtifactId(artifactId);
    const target = this.stagingPath(artifactId);
    if (existsSync(target)) {
      throw new PersistenceError(
        'ARTIFACT_STATE_INVALID',
        `staged bytes for '${artifactId}' already exist; never silently re-staged`,
        { path: 'staging' },
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    const fd = openSync(target, 'w');
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return { digest: sha256Hex(bytes), byteSize: bytes.length };
  }

  /** Promote staged bytes to the materialized location (atomic rename). */
  materialize(artifactId: string): void {
    assertArtifactId(artifactId);
    const source = this.stagingPath(artifactId);
    if (!existsSync(source)) {
      throw new PersistenceError(
        'ARTIFACT_STATE_INVALID',
        `materialize requires staged bytes for '${artifactId}'`,
        { path: 'staging' },
      );
    }
    renameSyncSafe(source, this.materializedPath(artifactId));
  }

  /**
   * Finalize materialized bytes: the recorded digest must match the bytes
   * actually on disk, otherwise this is a typed rejection and the bytes are
   * left untouched for truthful classification (never overwritten, never
   * normalized into success).
   */
  finalize(artifactId: string, expectedDigest: string): { digest: string; byteSize: number } {
    assertArtifactId(artifactId);
    const source = this.materializedPath(artifactId);
    if (!existsSync(source)) {
      throw new PersistenceError(
        'ARTIFACT_STATE_INVALID',
        `finalize requires materialized bytes for '${artifactId}'`,
        { path: 'materialized' },
      );
    }
    const bytes = readFileSync(source);
    const digest = sha256Hex(bytes);
    if (digest !== expectedDigest) {
      throw new PersistenceError(
        'PROVENANCE_DIGEST_MISMATCH',
        `finalized bytes for '${artifactId}' do not match the recorded digest; corrupt bytes are never normalized`,
        { path: 'materialized', invariant: 'digest-binding' },
      );
    }
    renameSyncSafe(source, this.finalPath(artifactId));
    return { digest, byteSize: bytes.length };
  }

  readFinalBytes(artifactId: string): Uint8Array | undefined {
    assertArtifactId(artifactId);
    const target = this.finalPath(artifactId);
    if (!existsSync(target)) {
      return undefined;
    }
    return readFileSync(target);
  }

  /** Truthful filesystem observation for recovery classification. */
  observe(artifactId: string): FilesystemArtifactObservation {
    assertArtifactId(artifactId);
    const staged = this.stagingPath(artifactId);
    const materialized = this.materializedPath(artifactId);
    const finalized = this.finalPath(artifactId);
    if (existsSync(finalized)) {
      const bytes = readFileSync(finalized);
      return {
        phase: 'FINALIZED',
        observedDigest: sha256Hex(bytes),
        observedByteSize: bytes.length,
      };
    }
    if (existsSync(materialized)) {
      const bytes = readFileSync(materialized);
      return {
        phase: 'MATERIALIZED',
        observedDigest: sha256Hex(bytes),
        observedByteSize: bytes.length,
      };
    }
    if (existsSync(staged)) {
      const bytes = readFileSync(staged);
      return {
        phase: 'STAGED',
        observedDigest: sha256Hex(bytes),
        observedByteSize: bytes.length,
      };
    }
    return { phase: 'ABSENT', observedDigest: undefined, observedByteSize: undefined };
  }

  /**
   * Orphan bytes that exist in the store without any durable artifact
   * record. Recovery surfaces them truthfully; they are never projected as
   * accepted Product artifacts.
   */
  listObservedArtifactIds(): readonly string[] {
    const ids = new Set<string>();
    const scan = (dir: string, strip: (name: string) => string | undefined): void => {
      if (!existsSync(dir)) {
        return;
      }
      for (const entry of readdirSync(dir)) {
        const id = strip(entry);
        if (id !== undefined) {
          ids.add(id);
        }
      }
    };
    scan(this.stagingDir, (name) =>
      name.endsWith('.part')
        ? assertArtifactId(fromFileSafeName(name.slice(0, -'.part'.length)))
        : undefined,
    );
    for (const dir of [this.materializedDir, this.finalDir]) {
      scan(dir, (name) =>
        name.endsWith('.bin')
          ? assertArtifactId(fromFileSafeName(name.slice(0, -'.bin'.length)))
          : undefined,
      );
    }
    return [...ids].sort();
  }
}

function writeSync(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += fsWriteSync(fd, bytes, offset);
  }
}

function fromFileSafeName(name: string): string {
  return name.replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function renameSyncSafe(source: string, target: string): void {
  if (existsSync(target)) {
    throw new PersistenceError('ARTIFACT_STATE_INVALID', `target bytes already exist: ${target}`, {
      path: target,
    });
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  // Best-effort directory durability; the claimed tuple remains
  // process-death/reopen regardless of directory-fsync semantics per OS.
  try {
    const fd = openSync(dirname(target), 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is not portable; process-death claims do not depend on it.
  }
}

export function artifactByteSize(path: string): number {
  return statSync(path).size;
}
