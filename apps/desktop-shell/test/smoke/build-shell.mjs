/*
 * T07 non-installed shell smoke — build step.
 *
 * Bundles the shell (main + sandboxed preload) and the smoke harness Core
 * into plain CJS under apps/desktop-shell/dist (gitignored). The sandboxed
 * preload must be CJS; the main bundle is CJS too for uniformity. `electron`
 * stays external (resolved from the app's node_modules at runtime); the
 * harness bundle inlines the workspace TS it needs so it runs anywhere.
 * Smoke tooling only — never packaged, never shipped.
 */
/* global console */

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..', '..');
const dist = join(packageRoot, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const nodeBundle = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  logLevel: 'warning',
};

await build({
  ...nodeBundle,
  entryPoints: [join(packageRoot, 'src', 'main', 'main.ts')],
  outfile: join(dist, 'main', 'main.cjs'),
  external: ['electron'],
});

await build({
  ...nodeBundle,
  entryPoints: [join(packageRoot, 'src', 'preload', 'preload.ts')],
  outfile: join(dist, 'preload', 'preload.cjs'),
  external: ['electron'],
});

await build({
  ...nodeBundle,
  entryPoints: [join(here, 'harness-core.ts')],
  outfile: join(dist, 'smoke', 'harness-core.cjs'),
  external: [],
});

cpSync(join(packageRoot, 'src', 'main', 'assets'), join(dist, 'main', 'assets'), {
  recursive: true,
});

console.log('shell smoke bundle ready under dist/');
