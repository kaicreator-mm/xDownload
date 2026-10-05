/**
 * T018 build/packaging configuration — data, not prose (IMPLEMENTATION_MAP
 * "Suggested bounded decomposition").
 *
 * This file declares the artifact set, the per-artifact content allowlists
 * the package-content audit enforces fail-closed, the global exclusion rules
 * (development Execution Pack material must never ship), and the toolchain
 * identity capture. It is the single source the build orchestrator, the
 * audit and the smoke runner all consume so emitted reality and declared
 * content rules cannot drift apart silently.
 *
 * Toolchain provenance (FAILURE_MATRIX "build-toolchain-undocumented"):
 * - esbuild@0.25.12 (MIT, https://github.com/evanw/esbuild) — the only NEW
 *   build toolchain introduced by T018. It was already the sole admitted
 *   install-script toolchain on the base (`onlyBuiltDependencies`), and the
 *   pnpm 12.8.1 per-package admission record (`allowBuilds`) now records the
 *   explicit approval. Version pinned exactly in the root package.json.
 * - node 24.21.0 (engines-pinned on the base) and pnpm 12.8.1
 *   (packageManager-pinned on the base) are the pre-existing base toolchain;
 *   T018 introduces neither.
 * - esbuild is deliberately pinned at 0.25.x, which is outside vite 8.3.2's
 *   optional peer range, so the vitest toolchain resolution is unchanged
 *   except for the recorded optional-peer link in the lockfile (unit gates
 *   re-baselined green after the add).
 */

import path from 'node:path';

/** Repo root (this file lives in <root>/build/). */
export const REPO_ROOT: string = path.resolve(import.meta.dirname, '..');

/** Default build output directory (git-ignored). */
export const DEFAULT_DIST_DIR = 'dist';

/** Exact extension-origin pattern the broker itself enforces (T010). */
export const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}\/$/;

/**
 * The placeholder origin mirrored verbatim from the consumed extension
 * sources (apps/browser-extension/src/background/service-worker.ts). It is
 * replaced by the real deployment origin only when that origin is actually
 * known; packaging never invents one (TEST_MATRIX negative coverage:
 * unqualified-platform-support-string / credential-shaped material).
 */
export const PLACEHOLDER_EXTENSION_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

/**
 * Allowed_origins configuration for the packaged native-host assets. The
 * environment variable admits an exact origin list at build time; absent it,
 * the placeholder above is used and the support matrix records the
 * extension/native tuple as NOT_PROVEN (the real origin is only knowable
 * once the extension is actually loaded in a real browser).
 */
export function configuredExtensionOrigins(): readonly string[] {
  const raw = process.env['XDOWNLOAD_EXTENSION_ORIGINS'];
  if (raw === undefined || raw.trim() === '') {
    return [PLACEHOLDER_EXTENSION_ORIGIN];
  }
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const origin of origins) {
    if (!EXTENSION_ORIGIN_PATTERN.test(origin)) {
      throw new Error(
        `XDOWNLOAD_EXTENSION_ORIGINS entry '${origin}' is not an exact chrome-extension:// origin; refusing to widen allowed_origins`,
      );
    }
  }
  if (origins.length === 0) {
    throw new Error(
      'XDOWNLOAD_EXTENSION_ORIGINS is empty; an empty allow list rejects every caller',
    );
  }
  return origins;
}

/** The one native messaging host name (must match the consumed T010 asset). */
export const NATIVE_HOST_NAME = 'com.xdownload.broker';

/** A shippable artifact: entry, output and the content rules it must obey. */
export interface ArtifactSpec {
  readonly id: 'cli' | 'core' | 'extension' | 'native-host';
  readonly entryPoint: string;
  readonly outDir: string;
  readonly outFile: string;
  readonly platform: 'node' | 'browser';
  /** Files relative to the artifact outDir the audit admits (glob-lite). */
  readonly allowlist: readonly string[];
  /** True adds the node shebang + exec bit wiring for bin launchers. */
  readonly withShebang: boolean;
}

export const ARTIFACTS: readonly ArtifactSpec[] = [
  {
    id: 'cli',
    entryPoint: 'apps/cli/src/main.ts',
    outDir: 'cli',
    outFile: 'xdownload-cli.js',
    platform: 'node',
    allowlist: ['xdownload-cli.js', 'bin/*'],
    withShebang: true,
  },
  {
    id: 'core',
    entryPoint: 'build/core-host.ts',
    outDir: 'core',
    outFile: 'xdownload-core-host.js',
    platform: 'node',
    allowlist: ['xdownload-core-host.js'],
    withShebang: false,
  },
  {
    id: 'extension',
    entryPoint: 'apps/browser-extension/src/background/service-worker.ts',
    outDir: 'extension',
    outFile: 'background.service-worker.js',
    platform: 'browser',
    allowlist: ['manifest.json', 'background.service-worker.js'],
    withShebang: false,
  },
  {
    id: 'native-host',
    entryPoint: 'build/native-host-entry.ts',
    outDir: 'native-host',
    outFile: 'xdownload-broker-host.js',
    platform: 'node',
    allowlist: [
      'xdownload-broker-host.js',
      'broker-config.json',
      'com.xdownload.broker.template.json',
      'bin/*',
    ],
    withShebang: false,
  },
];

/** Top-level entries dist/ may contain; anything else fails the audit. */
export const DIST_TOP_LEVEL_ALLOWLIST: readonly string[] = [
  ...ARTIFACTS.map((artifact) => artifact.outDir),
  'identity',
  'support-matrix.json',
];

/** Global exclusion rules — development material that must never ship. */
export const GLOBAL_DENYLIST: readonly string[] = [
  '**/.agent/**',
  '**/docs/**',
  '**/node_modules/**',
  '**/test/**',
  '**/toolchain-smoke*/**',
  '**/*.ts',
  '**/*.mts',
  '**/*.cts',
  '**/*.map',
  '**/*.md',
  '**/.env*',
  '**/*.pem',
  '**/*.key',
];

export interface ToolchainEntry {
  readonly name: string;
  readonly version: string;
}

/**
 * Capture the exact toolchain identity bound into every package identity
 * (C33: a changed baseline/toolchain cannot silently claim the same
 * package identity). The esbuild version comes from the loaded module
 * itself so the identity never depends on a human hand-typing it.
 */
export function captureToolchain(esbuildVersion: string): readonly ToolchainEntry[] {
  if (esbuildVersion.trim() === '') {
    throw new Error('cannot record toolchain identity: esbuild version unreadable');
  }
  return [
    { name: 'node', version: process.versions.node },
    { name: 'pnpm', version: pnpmVersion() ?? 'unavailable' },
    { name: 'esbuild', version: esbuildVersion },
  ];
}

function pnpmVersion(): string | null {
  const userAgent = process.env['npm_config_user_agent'];
  if (userAgent === undefined) {
    return null;
  }
  const match = /^pnpm\/(\d+\.\d+\.\d+)/.exec(userAgent);
  return match === null ? null : (match[1] ?? null);
}
