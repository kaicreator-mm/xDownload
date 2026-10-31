import { access, link, mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface FixtureArtifact {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/**
 * Test-only real temporary-filesystem fixture. It does not replace or certify
 * the production Host path-containment/materialization implementation.
 */
export async function withTemporaryArtifactRoot<T>(
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'xdownload-v021-t11-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function materializeFixtureAtomically(
  root: string,
  filename: string,
  bytes: Uint8Array,
  options: { readonly injectedFailure?: 'PERMISSION_DENIED' | 'DISK_FULL' } = {},
): Promise<FixtureArtifact> {
  if (filename.length === 0 || basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error('fixture filename must be one basename');
  }
  const absoluteRoot = resolve(root);
  const finalPath = resolve(absoluteRoot, filename);
  if (!finalPath.startsWith(absoluteRoot + sep)) {
    throw new Error('fixture output escaped its temporary root');
  }
  try {
    await access(finalPath);
    throw new Error('fixture artifact collision');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error;
    if (error instanceof Error && error.message === 'fixture artifact collision') throw error;
  }

  const partialPath = finalPath + '.partial';
  let partialCreated = false;
  let finalCreated = false;
  try {
    if (options.injectedFailure === 'PERMISSION_DENIED') {
      throw new Error('INJECTED_FAILURE_FAKE: simulated EACCES before creating a partial artifact');
    }
    const staged = options.injectedFailure === 'DISK_FULL'
      ? bytes.subarray(0, Math.floor(bytes.byteLength / 2))
      : bytes;
    const handle = await open(partialPath, 'wx', 0o600);
    partialCreated = true;
    try {
      await handle.writeFile(staged);
    } finally {
      await handle.close();
    }
    if (options.injectedFailure === 'DISK_FULL') {
      throw new Error('INJECTED_FAILURE_FAKE: simulated ENOSPC after a partial write');
    }
    // Hard-link creation is atomic and fails if the final path already exists;
    // unlike POSIX rename(), it cannot silently replace a concurrent artifact.
    await link(partialPath, finalPath);
    finalCreated = true;
    await unlink(partialPath);
    partialCreated = false;
    const readBack = await readFile(finalPath);
    return {
      path: finalPath,
      bytes: readBack,
      sha256: createHash('sha256').update(readBack).digest('hex'),
    };
  } catch (error) {
    if (finalCreated) await rm(finalPath, { force: true });
    throw error;
  } finally {
    if (partialCreated) {
      await rm(partialPath, { force: true });
    }
  }
}
