import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatToolchainLabel, isNode24 } from '../src/index.js';
import { formatToolchainLabel as coreFormatToolchainLabel } from '@xdownload/toolchain-smoke-core';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const readRepoFile = (relativePath: string): string =>
  readFileSync(`${repoRoot}${relativePath}`, 'utf8');

describe('toolchain smoke (workspace linking)', () => {
  it('re-exports the workspace dependency through the pnpm workspace protocol', () => {
    // Resolving the same function from the workspace-linked package proves
    // the `workspace:*` link between the two smoke packages.
    expect(coreFormatToolchainLabel).toBe(formatToolchainLabel);
  });

  it('formats toolchain labels deterministically', () => {
    expect(formatToolchainLabel({ node: 'v24.21.0', pnpm: '12.8.1' })).toBe(
      'xDownload bootstrap toolchain: node v24.21.0, pnpm 12.8.1',
    );
  });

  it('recognizes only the pinned Node 24 major line', () => {
    expect(isNode24({ node: 'v24.21.0', pnpm: '12.8.1' })).toBe(true);
    expect(isNode24({ node: 'v24.0.0', pnpm: '12.8.1' })).toBe(true);
    expect(isNode24({ node: 'v23.11.0', pnpm: '12.8.1' })).toBe(false);
    expect(isNode24({ node: 'v26.8.1', pnpm: '12.8.1' })).toBe(false);
  });
});

describe('toolchain smoke (repository pin consistency)', () => {
  it('pins exactly one pnpm version across the repository metadata', () => {
    const rootPackageJson = JSON.parse(readRepoFile('package.json')) as {
      packageManager?: string;
    };
    expect(rootPackageJson.packageManager).toBe('pnpm@12.8.1');
  });

  it('keeps the Node pin consistent between .nvmrc and package engines', () => {
    const rootPackageJson = JSON.parse(readRepoFile('package.json')) as {
      engines?: { node?: string };
    };
    const nvmrc = readRepoFile('.nvmrc').trim();
    expect(rootPackageJson.engines?.node).toBe(nvmrc);
    expect(nvmrc).toMatch(/^24\.\d+\.\d+$/);
  });
});
