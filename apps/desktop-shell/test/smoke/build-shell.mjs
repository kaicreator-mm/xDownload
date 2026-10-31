/*
 * T07/T08 non-installed shell smoke — build step.
 *
 * Bundles the shell (main + sandboxed preload), the T08 renderer page and
 * the smoke harness Core into plain output under apps/desktop-shell/dist
 * (gitignored). The sandboxed preload must be CJS; the main bundle is CJS
 * too for uniformity. `electron` stays external (resolved from the app's
 * node_modules at runtime); the harness bundle inlines the workspace TS it
 * needs so it runs anywhere. The renderer page is a browser-target classic
 * script (no Node, no electron — nothing externalizes electron there, so an
 * accidental electron import fails the bundle). Smoke tooling only — never
 * packaged, never shipped.
 */
/* global console */

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
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

await build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome140'],
  sourcemap: false,
  logLevel: 'warning',
  entryPoints: [join(packageRoot, 'src', 'renderer', 'renderer-main.ts')],
  outfile: join(dist, 'renderer', 'renderer.js'),
  external: [],
});

cpSync(join(packageRoot, 'src', 'main', 'assets'), join(dist, 'main', 'assets'), {
  recursive: true,
});

cpSync(join(packageRoot, 'src', 'renderer'), join(dist, 'renderer'), {
  recursive: true,
  filter: (source) =>
    statSync(source).isDirectory() || source.endsWith('.html') || source.endsWith('.css'),
});

console.log('shell smoke bundle ready under dist/');
