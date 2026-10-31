import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
): Promise<FixtureArtifact> {
  if (filename.length === 0 || basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error('fixture filename must be one basename');
  }
  const absoluteRoot = resolve(root);
  const finalPath = resolve(absoluteRoot, filename);
  if (!finalPath.startsWith(absoluteRoot + sep)) {
    throw new Error('fixture output escaped its temporary root');
  }
  const partialPath = finalPath + '.partial';
  await writeFile(partialPath, bytes, { flag: 'wx' });
  await rename(partialPath, finalPath);
  const readBack = await readFile(finalPath);
  return {
    path: finalPath,
    bytes: readBack,
    sha256: createHash('sha256').update(readBack).digest('hex'),
  };
}
