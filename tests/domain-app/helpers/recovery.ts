/**
 * T10 recovery/restart negative fixtures — partial and interrupted states
 * paired with the honest non-completion vocabulary. Every builder here is
 * designed to make a fake success *constructible* (so the oracles can prove
 * the frozen contracts refuse it) while the honest reading of the same bytes
 * stays first-class: partial artifacts carry the partial digest, pending
 * envelopes carry no outcome, and stop reasons name the interruption.
 */

import { get as httpGet } from 'node:http';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './fixtures.ts';
import type { EffectEnvelope, MaterializedEvidence } from './contracts.ts';

/** Absolute temp output root (an authorized-root stand-in on this machine). */
export function tempOutputRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `xd-t10-${label}-`));
}

export function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export interface PartialArtifact {
  /** Absolute path inside the authorized root. */
  readonly artifactPath: string;
  /** The bytes actually durable on disk (a prefix of the declared payload). */
  readonly bytesOnDisk: Uint8Array;
  /** Declared total size of the confirmed intent. */
  readonly declaredBytes: number;
  /** sha256 of the bytes actually on disk — never of the declared whole. */
  readonly sha256OnDisk: string;
  /** Durable file size observed back from the filesystem. */
  readonly durableFileBytes: number;
}

/** Write a real partial artifact (restart fixture): `written` of the whole. */
export function writePartialArtifact(
  root: string,
  name: string,
  fullPayload: Uint8Array,
  written: number,
): PartialArtifact {
  const bytesOnDisk = fullPayload.subarray(0, written);
  const artifactPath = join(root, name);
  writeFileSync(artifactPath, bytesOnDisk);
  return {
    artifactPath,
    bytesOnDisk,
    declaredBytes: fullPayload.byteLength,
    sha256OnDisk: sha256(bytesOnDisk),
    durableFileBytes: statSync(artifactPath).size,
  };
}

/** Honest digest comparison: does the durable bytes digest match the anchor? */
export interface DigestCheck {
  readonly matches: boolean;
  readonly actualSha256: string;
  readonly expectedSha256: string;
}

export function checkDigest(bytes: Uint8Array, anchor: string): DigestCheck {
  const actualSha256 = sha256(bytes);
  return { matches: actualSha256 === anchor, actualSha256, expectedSha256: anchor };
}

/**
 * Declared-versus-durable detector: a restart can only trust evidence whose
 * byte count describes the file that actually exists.
 */
export function declaredVsDurable(artifact: PartialArtifact): {
  readonly declared: number;
  readonly durable: number;
  readonly agrees: boolean;
} {
  return {
    declared: artifact.bytesOnDisk.byteLength,
    durable: artifact.durableFileBytes,
    agrees: artifact.bytesOnDisk.byteLength === artifact.durableFileBytes,
  };
}

/**
 * Materialized evidence built from the bytes actually durable. Honest by
 * construction: the digest and byte count describe what IS on disk, and the
 * stop reason names why the effect stopped (e.g. 'INTERRUPTED', 'COMPLETE').
 */
export function materializeEvidence(
  artifact: PartialArtifact,
  stopReason: string,
): MaterializedEvidence {
  return {
    fileSha256: artifact.sha256OnDisk,
    bytesWritten: artifact.bytesOnDisk.byteLength,
    artifactPath: artifact.artifactPath,
    stopReason,
  };
}

/** A05 pending envelopes: structurally carry no outcome at all. */
export function acceptedEnvelope(externalRef: string): EffectEnvelope {
  return { phase: 'accepted', externalRef };
}

export function runningEnvelope(externalRef: string): EffectEnvelope {
  return { phase: 'running', externalRef };
}

/** Bounded honest stop-reason tokens for interruption evidence. */
export const HONEST_STOP_REASONS = {
  complete: 'COMPLETE',
  interrupted: 'INTERRUPTED',
  truncated: 'TRUNCATED',
  budgetExhausted: 'TRANSFER_BUDGET_EXHAUSTED',
} as const;

export interface InterruptedRead {
  /** The bytes that arrived before the interruption. */
  readonly bytes: Uint8Array;
  readonly completed: boolean;
  readonly interruptedBy: 'premature-eof' | 'client-timeout';
}

/**
 * Read a transfer until it is interrupted: either the origin cuts the
 * connection short (premature EOF against a larger declared Content-Length)
 * or the client gives up (timeout destroy). The bytes that did arrive stay
 * observable — that is exactly the restart state a recovery lane must face.
 */
export function readUntilInterrupted(uri: string, timeoutMs: number): Promise<InterruptedRead> {
  return new Promise((resolveOuter, rejectOuter) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const finish = (result: InterruptedRead): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOuter(result);
    };
    const timer = setTimeout(() => {
      request.destroy();
      finish({ bytes: concatChunks(chunks), completed: false, interruptedBy: 'client-timeout' });
    }, timeoutMs);
    const request = httpGet(uri, (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        finish({ bytes: concatChunks(chunks), completed: true, interruptedBy: 'premature-eof' }),
      );
      response.on('aborted', () =>
        finish({ bytes: concatChunks(chunks), completed: false, interruptedBy: 'premature-eof' }),
      );
      response.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNRESET') {
          finish({ bytes: concatChunks(chunks), completed: false, interruptedBy: 'premature-eof' });
          return;
        }
        clearTimeout(timer);
        rejectOuter(error);
      });
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') {
        finish({ bytes: concatChunks(chunks), completed: false, interruptedBy: 'premature-eof' });
        return;
      }
      if (!settled) {
        clearTimeout(timer);
        rejectOuter(error);
      }
    });
  });
}

function concatChunks(chunks: readonly Buffer[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
