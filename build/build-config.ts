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

import fs from 'node:fs';
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
  /**
   * #179: additional bundles emitted into the same artifact outDir with the
   * main bundle's exact build options (packaging/install write set only).
   * Every extra file must also join the artifact allowlist.
   */
  readonly extraBundles?: readonly { readonly entryPoint: string; readonly outFile: string }[];
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
    // #95: the shipped artifact must carry the reachable installed S2 journey
    // (action popup entrypoint + notification icon) — no more, no less.
    allowlist: [
      'manifest.json',
      'background.service-worker.js',
      'popup.html',
      'popup.js',
      'icon128.png',
    ],
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
      'xdownload-install-host.js',
      'broker-config.json',
      'com.xdownload.broker.template.json',
      'bin/*',
    ],
    // #179: the explicit per-user Windows install binding entry (setup/
    // uninstall/status) ships beside the broker it configures.
    extraBundles: [{ entryPoint: 'build/install-host.ts', outFile: 'xdownload-install-host.js' }],
    withShebang: false,
  },
];

/** Top-level entries dist/ may contain; anything else fails the audit. */
export const DIST_TOP_LEVEL_ALLOWLIST: readonly string[] = [
  ...ARTIFACTS.map((artifact) => artifact.outDir),
  'identity',
  'support-matrix.json',
];

/**
 * #T019 packaged-windows-pipe: the minimal native FFI runtime the packaged
 * Windows named-pipe transport loads at runtime (`createRequire(bundle)`
 * → `require('koffi')`, packages/core-seam win-ipc.ts). The bundles keep
 * koffi external (a prebuilt .node binary cannot be bundled), so the exact
 * runtime file set below is vendored VERBATIM from the installed workspace
 * tree into each node artifact — never the whole node_modules tree, never a
 * second platform, and always with the upstream license. The audit admits
 * exactly these declared paths (everything else under node_modules stays
 * denied) and every vendored byte is covered by the artifact identity hash.
 *
 * Bumping `version` (lockfile bump of koffi) requires re-deriving `files`:
 * the loader chain is index.cjs → src/koffi/index.cjs → src/static.cjs and
 * the win32-x64 prebuilt is resolved by koffi itself as the
 * node_modules sibling `@koromix/koffi-win32-x64`.
 */
/** Node artifacts whose surface can exercise the Windows pipe transport. */
const VENDORED_RUNTIME_ARTIFACTS: readonly ArtifactSpec['id'][] = ['cli', 'core', 'native-host'];

export const VENDORED_NATIVE_RUNTIME = {
  /** The only platform tuple whose native runtime is packaged (selected platform). */
  platform: 'win32',
  arch: 'x64',
  /** Pinned to the lockfile-resolved koffi version; a drift fails the build. */
  version: '3.3.3',
  packages: [
    {
      name: 'koffi',
      files: [
        'package.json',
        'index.cjs',
        'src/koffi/index.cjs',
        'src/koffi/src/static.cjs',
        'LICENSE.txt',
      ],
    },
    {
      name: '@koromix/koffi-win32-x64',
      files: ['package.json', 'index.js', 'win32_x64/koffi.node'],
    },
  ],
  artifacts: VENDORED_RUNTIME_ARTIFACTS,
} as const;

/**
 * The exact dist-relative paths the vendored runtime occupies inside one
 * artifact. The audit admits exactly these — and nothing else under
 * node_modules — so emitted reality and declared content rules cannot drift.
 */
export function vendoredRuntimeDistPaths(artifactId: ArtifactSpec['id']): readonly string[] {
  if (!VENDORED_NATIVE_RUNTIME.artifacts.includes(artifactId)) {
    return [];
  }
  return VENDORED_NATIVE_RUNTIME.packages.flatMap((pkg) =>
    pkg.files.map((file) => `node_modules/${pkg.name}/${file}`),
  );
}

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
  /**
   * T09 determinism repair: the version fact's provenance. The identity
   * carries ONLY repo declarations — never environment probing — so the same
   * source revision composes to byte-identical identities on every host
   * (whatever pnpm/node happen to sit on the composing shell's PATH).
   */
  readonly source: 'declared';
}

/** Read the root package.json of a repo tree (typed, fail-closed). */
function readRootPackageJson(root: string): Record<string, unknown> {
  const file = path.join(root, 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot record toolchain identity: root package.json unreadable at ${file}: ${error instanceof Error ? error.message : 'error'}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`cannot record toolchain identity: ${file} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The declared node runtime: `.node-version`, then `.nvmrc`, then the
 * `engines.node` declaration. A declaration file wins because it pins the
 * EXACT version the repo builds and tests under; all three are repo
 * declarations, never a probe of the running runtime.
 */
export function declaredNodeVersion(root: string = REPO_ROOT): string {
  for (const file of ['.node-version', '.nvmrc']) {
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (!/^v?\d+\.\d+\.\d+$/u.test(value)) {
      throw new Error(
        `cannot record toolchain identity: ${file} must pin an exact node version, got '${value}'`,
      );
    }
    return value.replace(/^v/u, '');
  }
  const engines = readRootPackageJson(root)['engines'];
  const nodeRange =
    typeof engines === 'object' && engines !== null
      ? (engines as Record<string, unknown>)['node']
      : undefined;
  if (typeof nodeRange === 'string' && nodeRange.trim() !== '') {
    // No exact-pin declaration file: record the declared compat range
    // verbatim (still a declaration, honestly labeled `source: 'declared'`).
    return nodeRange.trim();
  }
  throw new Error(
    'cannot record toolchain identity: no node version declaration (.node-version, .nvmrc or engines.node)',
  );
}

/**
 * The declared pnpm version: the root `packageManager` field's `pnpm@<semver>`
 * (an integrity suffix, when present, is stripped). Corepack enforces this
 * exact version, so the declaration IS the build's package-manager identity.
 */
export function declaredPnpmVersion(root: string = REPO_ROOT): string {
  const packageManager = readRootPackageJson(root)['packageManager'];
  if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) {
    throw new Error(
      `cannot record toolchain identity: packageManager must declare 'pnpm@<version>', got '${String(packageManager)}'`,
    );
  }
  const version = packageManager.slice('pnpm@'.length).split('+')[0]?.trim() ?? '';
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(
      `cannot record toolchain identity: packageManager pnpm version must be exact semver, got '${version}'`,
    );
  }
  return version;
}

/**
 * The declared esbuild version: the root devDependencies pin, cross-checked
 * against the actually-loaded module (the same fail-closed drift discipline
 * as the vendored koffi runtime — a non-frozen install cannot silently claim
 * the declared identity).
 */
export function declaredEsbuildVersion(loadedVersion: string, root: string = REPO_ROOT): string {
  if (loadedVersion.trim() === '') {
    throw new Error('cannot record toolchain identity: esbuild version unreadable');
  }
  const devDependencies = readRootPackageJson(root)['devDependencies'];
  const declared =
    typeof devDependencies === 'object' && devDependencies !== null
      ? (devDependencies as Record<string, unknown>)['esbuild']
      : undefined;
  if (typeof declared !== 'string' || !/^\d+\.\d+\.\d+$/u.test(declared.trim())) {
    throw new Error(
      `cannot record toolchain identity: devDependencies.esbuild must pin an exact version, got '${String(declared)}'`,
    );
  }
  if (declared.trim() !== loadedVersion) {
    throw new Error(
      `toolchain identity drift: declared esbuild ${declared.trim()} != installed ${loadedVersion}; install from the frozen lockfile or re-derive the declaration before packaging`,
    );
  }
  return declared.trim();
}

/**
 * Capture the exact toolchain identity bound into every package identity
 * (C33: a changed baseline/toolchain cannot silently claim the same package
 * identity). T09 determinism repair: every entry is read from a REPO
 * DECLARATION (`.nvmrc`, `packageManager`, `devDependencies.esbuild`) and
 * labeled `source: 'declared'` — no `npm_config_user_agent` probing, no
 * runtime sampling, no 'unavailable' fallback. A missing declaration is a
 * typed build failure, never a silently degraded identity.
 */
export function captureToolchain(esbuildVersion: string): readonly ToolchainEntry[] {
  return [
    { name: 'node', version: declaredNodeVersion(), source: 'declared' },
    { name: 'pnpm', version: declaredPnpmVersion(), source: 'declared' },
    { name: 'esbuild', version: declaredEsbuildVersion(esbuildVersion), source: 'declared' },
  ];
}
