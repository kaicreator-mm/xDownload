/**
 * T018 package-content audit rule tests — table-driven, positive and
 * negative cases adjacent (REFERENCE_PACK §1.1). These run in the ordinary
 * unit gate with fixture trees, so the audit's fail-closed rules stay
 * executable without requiring a prior build; the build itself additionally
 * executes the same audit over real emitted output.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditDist,
  globMatches,
  loadSupportMatrix,
  manifestReferencedFiles,
  scanTextForCredentials,
} from '../audit.ts';
import {
  buildIdentity,
  canonicalContentHash,
  contentManifest,
  verifyIdentity,
} from '../identity.ts';
import { renderFilledHostManifest, renderHostManifestTemplate } from '../native-host.ts';
import { vendoredRuntimeDistPaths } from '../build-config.ts';

const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

describe('glob-lite matcher', () => {
  const cases: readonly { pattern: string; candidate: string; expected: boolean }[] = [
    { pattern: 'bin/*', candidate: 'bin/xdownload.cmd', expected: true },
    { pattern: 'bin/*', candidate: 'bin/sub/x', expected: false },
    { pattern: '**/*.ts', candidate: 'a/b/c.ts', expected: true },
    { pattern: '**/*.ts', candidate: 'cli.js', expected: false },
    { pattern: '**/.agent/**', candidate: 'cli/.agent/execution/T018/x.md', expected: true },
    {
      pattern: '**/toolchain-smoke*/**',
      candidate: 'native-host/toolchain-smoke-core/x.js',
      expected: true,
    },
    { pattern: 'xdownload-cli.js', candidate: 'xdownload-cli.js', expected: true },
    { pattern: '**/test/**', candidate: 'core/test/helpers.js', expected: true },
  ];
  for (const input of cases) {
    it(`matches ${input.pattern} against ${input.candidate} -> ${String(input.expected)}`, () => {
      expect(globMatches(input.pattern, input.candidate)).toBe(input.expected);
    });
  }
});

describe('credential scanner', () => {
  it('flags provider-key shaped material (fails closed)', () => {
    const hits = scanTextForCredentials('const cfg = "sk-abcdefghijklmnopqrstuvwxyz012345";');
    expect(hits.length).toBeGreaterThan(0);
  });
  it('flags private key blocks and json credential fields', () => {
    expect(scanTextForCredentials('-----BEGIN RSA PRIVATE KEY-----').length).toBeGreaterThan(0);
    expect(scanTextForCredentials('{"api_key": "1234567890abcdef"}').length).toBeGreaterThan(0);
  });
  it('accepts ordinary source text without credential shapes', () => {
    expect(
      scanTextForCredentials('const SEAM_MESSAGE_LIMITS = { maxPayloadBytes: 262144 };'),
    ).toEqual([]);
    expect(scanTextForCredentials(`const ORIGIN = '${ORIGIN}';`)).toEqual([]);
  });
});

describe('MV3 manifest reference extraction', () => {
  it('collects the service worker, content scripts and icons (order-insensitive)', () => {
    const referenced = manifestReferencedFiles({
      background: { service_worker: 'background.service-worker.js', type: 'module' },
      content_scripts: [{ js: ['content/observer.js'] }],
      icons: { '16': 'icons/16.png' },
      action: { default_icon: { '32': 'icons/32.png' } },
    });
    expect([...referenced].sort()).toEqual(
      [
        'background.service-worker.js',
        'content/observer.js',
        'icons/16.png',
        'icons/32.png',
      ].sort(),
    );
  });
});

// --------------------------------------------------------------- dist fixture

const BUNDLE_STUB = 'export const bundled = true;\n';
const LAUNCHER_STUB = '#!/bin/sh\nexec node xdownload-cli.js "$@"\n';

interface FixtureOptions {
  readonly mutate?: (root: string) => void;
  readonly matrixTupleStatus?: 'BUILT_AND_SMOKED' | 'NOT_PROVEN';
}

function writeDistFixture(options: FixtureOptions = {}): { distRoot: string; evidenceDir: string } {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdist-'));
  // Evidence lives OUTSIDE the dist tree (as it does in the repo:
  // build/evidence next to, never inside, the emitted packages).
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xevid-'));
  const files: readonly [string, string][] = [
    ['cli/xdownload-cli.js', BUNDLE_STUB],
    ['cli/bin/xdownload', LAUNCHER_STUB],
    ['cli/bin/xdownload.cmd', '@echo off\r\nnode xdownload-cli.js %*\r\n'],
    ['core/xdownload-core-host.js', BUNDLE_STUB],
    // #T019 packaged-windows-pipe: the exact declared vendored-runtime paths
    // are part of an honest dist on the selected tuple, so the fixture
    // carries them (stub bytes; identity hashes are computed below over the
    // completed tree, exactly like the real build hashes after vendoring).
    ...['cli', 'core', 'native-host'].flatMap((artifact): readonly [string, string][] =>
      vendoredRuntimeDistPaths('cli').map((relative) => [
        `${artifact}/${relative}`,
        relative.endsWith('.node') ? 'faux-binary-bytes' : `vendored stub ${relative}\n`,
      ]),
    ),
    [
      'extension/manifest.json',
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: 'background.service-worker.js', type: 'module' },
        action: { default_popup: 'popup.html' },
        icons: { '128': 'icon128.png' },
      }),
    ],
    ['extension/background.service-worker.js', BUNDLE_STUB],
    ['extension/popup.html', '<!doctype html><script src="popup.js"></script>'],
    ['extension/popup.js', 'export const stub = true;' + String.fromCharCode(10)],
    ['native-host/xdownload-broker-host.js', BUNDLE_STUB],
    ['native-host/broker-config.json', JSON.stringify({ allowedOrigins: [ORIGIN] })],
    ['native-host/com.xdownload.broker.template.json', renderHostManifestTemplate([ORIGIN])],
    ['native-host/bin/xdownload-broker-host', LAUNCHER_STUB],
    [
      'native-host/bin/xdownload-broker-host.cmd',
      '@echo off\r\nnode xdownload-broker-host.js %*\r\n',
    ],
  ];
  for (const [relative, content] of files) {
    const full = path.join(distRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  // A minimal valid 1x1 PNG so the icon presence check is byte-real.
  fs.writeFileSync(
    path.join(distRoot, 'extension', 'icon128.png'),
    Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082',
      'hex',
    ),
  );
  const identityDir = path.join(distRoot, 'identity');
  fs.mkdirSync(identityDir, { recursive: true });
  for (const id of ['cli', 'core', 'extension', 'native-host']) {
    const identity = buildIdentity({
      artifact: id,
      artifactDir: path.join(distRoot, id),
      sourceRevision: { sha: '0'.repeat(40), dirty: false },
      toolchain: [{ name: 'node', version: 'test' }],
    });
    fs.writeFileSync(
      path.join(identityDir, `${id}.json`),
      JSON.stringify(identity, null, 2),
      'utf8',
    );
  }
  const evidenceName = 'fixture-suite.json';
  const evidenceFile = path.join(evidenceDir, evidenceName);
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(
    evidenceFile,
    JSON.stringify({ suite: 'fixture', overall: 'PASS', checks: [] }, null, 2),
    'utf8',
  );
  const matrix = {
    matrixVersion: 'fixture',
    tuples: [
      {
        id: 'fixture-tuple',
        status: options.matrixTupleStatus ?? 'NOT_PROVEN',
        claimType:
          options.matrixTupleStatus === 'BUILT_AND_SMOKED'
            ? 'built-and-smoked-on-host'
            : 'not-proven',
        ...(options.matrixTupleStatus === 'BUILT_AND_SMOKED'
          ? { evidence: [evidenceName] }
          : { reason: 'fixture not-proven reason' }),
      },
    ],
  };
  fs.writeFileSync(
    path.join(distRoot, 'support-matrix.json'),
    JSON.stringify(matrix, null, 2),
    'utf8',
  );
  options.mutate?.(distRoot);
  return { distRoot, evidenceDir };
}

// auditDist reads the repo evidence dir by default; the fixture points it at
// its own evidence directory so claim checks are self-contained.
function auditFixture(fixture: {
  distRoot: string;
  evidenceDir: string;
}): ReturnType<typeof auditDist> {
  return auditDist({ distDir: fixture.distRoot, evidenceDir: fixture.evidenceDir });
}

describe('package-content audit over a fixture dist', () => {
  const cleanup: string[] = [];
  function makeFixture(options: FixtureOptions = {}): { distRoot: string; evidenceDir: string } {
    const fixture = writeDistFixture(options);
    cleanup.push(fixture.distRoot, fixture.evidenceDir);
    return fixture;
  }
  afterAll(() => {
    for (const dir of cleanup.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a declared, honest dist', () => {
    expect(auditFixture(makeFixture())).toEqual([]);
  });

  it('admits exactly the declared vendored runtime paths (no node_modules violation)', () => {
    const violations = auditFixture(makeFixture()).filter(
      (violation) => violation.rule === 'node-modules' || violation.rule === 'artifact-allowlist',
    );
    expect(violations).toEqual([]);
  });

  it('passes with a BUILT_AND_SMOKED tuple backed by real PASS evidence', () => {
    expect(auditFixture(makeFixture({ matrixTupleStatus: 'BUILT_AND_SMOKED' }))).toEqual([]);
  });

  const negativeCases: readonly { name: string; mutate: (root: string) => void; rule: string }[] = [
    {
      name: 'agent execution material ships',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'cli', '.agent', 'execution'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'cli', '.agent', 'execution', 'T018.md'),
          'secret plan',
          'utf8',
        );
      },
      rule: 'agent-execution-material',
    },
    {
      name: 'frozen docs ship',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'core', 'docs'), { recursive: true });
        fs.writeFileSync(path.join(root, 'core', 'docs', 'L2.md'), 'frozen', 'utf8');
      },
      rule: 'frozen-docs',
    },
    {
      name: 'a toolchain-smoke package ships',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'native-host', 'toolchain-smoke-core'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'native-host', 'toolchain-smoke-core', 'x.js'),
          '',
          'utf8',
        );
      },
      rule: 'toolchain-smoke-package',
    },
    {
      name: 'a test fixture ships',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'cli', 'test'), { recursive: true });
        fs.writeFileSync(path.join(root, 'cli', 'test', 'fixture.json'), '{}', 'utf8');
      },
      rule: 'test-fixture-or-dev-test',
    },
    {
      name: 'raw TS source ships',
      mutate: (root) => {
        fs.writeFileSync(path.join(root, 'core', 'leaked.ts'), 'export {};', 'utf8');
      },
      rule: 'raw-ts-source',
    },
    {
      name: 'a source map ships',
      mutate: (root) => {
        fs.writeFileSync(path.join(root, 'cli', 'xdownload-cli.js.map'), '{}', 'utf8');
      },
      rule: 'source-map',
    },
    {
      name: 'credential material ships',
      mutate: (root) => {
        fs.writeFileSync(
          path.join(root, 'cli', 'bin', 'xdownload'),
          'K="sk-abcdefghijklmnopqrstuvw0123456789"\n',
          'utf8',
        );
      },
      rule: 'credential-material',
    },
    {
      name: 'an undeclared top-level entry appears',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'surprise'), { recursive: true });
        fs.writeFileSync(path.join(root, 'surprise', 'x.js'), '', 'utf8');
      },
      rule: 'dist-top-level-allowlist',
    },
    {
      name: 'an undeclared node_modules path ships (vendored runtime is exact-path only)',
      mutate: (root) => {
        fs.mkdirSync(path.join(root, 'cli', 'node_modules', 'leftpad'), { recursive: true });
        fs.writeFileSync(path.join(root, 'cli', 'node_modules', 'leftpad', 'index.js'), '', 'utf8');
      },
      rule: 'node-modules',
    },
    {
      name: 'an undeclared file inside the vendored koffi package ships',
      mutate: (root) => {
        fs.writeFileSync(
          path.join(root, 'core', 'node_modules', 'koffi', 'README.md'),
          '# koffi docs',
          'utf8',
        );
      },
      rule: 'markdown',
    },
    {
      name: 'an identity is tampered with',
      mutate: (root) => {
        fs.writeFileSync(
          path.join(root, 'core', 'xdownload-core-host.js'),
          `${BUNDLE_STUB}// tampered\n`,
          'utf8',
        );
      },
      rule: 'package-identity-unproven',
    },
  ];
  for (const input of negativeCases) {
    it(`fails closed when ${input.name}`, () => {
      const fixture = makeFixture({ mutate: input.mutate });
      const violations = auditFixture(fixture);
      expect(violations.some((violation) => violation.rule.startsWith(input.rule))).toBe(true);
    });
  }

  it('fails closed on a manifest-referenced file the build does not emit (PACKAGE_MANIFEST_MISMATCH)', () => {
    const fixture = makeFixture({
      mutate: (dist) => {
        fs.rmSync(path.join(dist, 'extension', 'background.service-worker.js'));
      },
    });
    const violations = auditFixture(fixture);
    expect(violations.some((violation) => violation.rule === 'PACKAGE_MANIFEST_MISMATCH')).toBe(
      true,
    );
  });

  it('fails closed on unreferenced executable payload in the extension package', () => {
    const fixture = makeFixture({
      mutate: (dist) => {
        fs.writeFileSync(path.join(dist, 'extension', 'extra.js'), BUNDLE_STUB, 'utf8');
      },
    });
    const violations = auditFixture(fixture);
    expect(
      violations.some((violation) => violation.rule === 'unreferenced-executable-payload'),
    ).toBe(true);
  });

  it('fails closed when a BUILT_AND_SMOKED claim cites missing evidence', () => {
    const fixture = makeFixture({ matrixTupleStatus: 'BUILT_AND_SMOKED' });
    const violations = auditDist({
      distDir: fixture.distRoot,
      evidenceDir: path.join(fixture.evidenceDir, 'no-such-entry'),
    });
    expect(violations.some((violation) => violation.rule === 'claim-without-evidence')).toBe(true);
  });

  it('fails closed when cited evidence is not an overall PASS', () => {
    const fixture = makeFixture({ matrixTupleStatus: 'BUILT_AND_SMOKED' });
    fs.writeFileSync(
      path.join(fixture.evidenceDir, 'fixture-suite.json'),
      JSON.stringify({ suite: 'fixture', overall: 'FAIL', checks: [] }, null, 2),
      'utf8',
    );
    const violations = auditFixture(fixture);
    expect(violations.some((violation) => violation.rule === 'claim-without-evidence')).toBe(true);
  });

  it('fails closed on an out-of-vocabulary claimType', () => {
    const fixture = makeFixture();
    const matrix = loadSupportMatrix(fixture.distRoot);
    const doctored = {
      ...matrix,
      tuples: [
        {
          ...matrix.tuples[0]!,
          claimType: 'supports-all-windows-browsers',
        },
      ],
    };
    fs.writeFileSync(
      path.join(fixture.distRoot, 'support-matrix.json'),
      JSON.stringify(doctored),
      'utf8',
    );
    const violations = auditFixture(fixture);
    expect(violations.some((violation) => violation.rule === 'unqualified-claim-string')).toBe(
      true,
    );
  });
});

describe('package identity', () => {
  it('canonical hash is independent of discovery order', () => {
    const a = canonicalContentHash([
      { path: 'b.js', sha256: 'x', bytes: 1 },
      { path: 'a.js', sha256: 'y', bytes: 2 },
    ]);
    const b = canonicalContentHash([
      { path: 'a.js', sha256: 'y', bytes: 2 },
      { path: 'b.js', sha256: 'x', bytes: 1 },
    ]);
    expect(a).toBe(b);
  });

  it('verifyIdentity detects any artifact byte change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xid-'));
    fs.writeFileSync(path.join(dir, 'artifact.js'), BUNDLE_STUB, 'utf8');
    const identity = buildIdentity({
      artifact: 'probe',
      artifactDir: dir,
      sourceRevision: { sha: '0'.repeat(40), dirty: false },
      toolchain: [],
    });
    expect(verifyIdentity(dir, identity)).toEqual({ ok: true });
    expect(contentManifest(dir).length).toBe(1);
    fs.writeFileSync(path.join(dir, 'artifact.js'), `${BUNDLE_STUB}// changed`, 'utf8');
    expect(verifyIdentity(dir, identity)).toEqual({
      ok: false,
      reason: "content hash mismatch for artifact 'probe'",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('native host manifest generation', () => {
  it('renders the template with the exact allow list and a placeholder path', () => {
    const parsed = JSON.parse(renderHostManifestTemplate([ORIGIN])) as Record<string, unknown>;
    expect(parsed['name']).toBe('com.xdownload.broker');
    expect(parsed['type']).toBe('stdio');
    expect(parsed['path']).toBe('<XDOWNLOAD_NATIVE_HOST_LAUNCHER>');
    expect(parsed['allowed_origins']).toEqual([ORIGIN]);
  });

  it('refuses to register with a non-absolute launcher path', () => {
    expect(() =>
      renderFilledHostManifest({ launcherPath: 'relative/host.cmd', allowedOrigins: [ORIGIN] }),
    ).toThrow(/absolute/);
  });

  it('refuses an empty allow list and refuses widened origins (fail closed)', () => {
    expect(() =>
      renderFilledHostManifest({ launcherPath: '/abs/host.cmd', allowedOrigins: [] }),
    ).toThrow(/empty allowed_origins/);
    expect(() =>
      renderFilledHostManifest({
        launcherPath: '/abs/host.cmd',
        allowedOrigins: ['chrome-extension://*/*'],
      }),
    ).toThrow(/exact chrome-extension/);
  });
});

// --------------------------------- #T019 packaged-windows-pipe vendored runtime

describe('#T019 packaged Windows named-pipe runtime (real package build)', () => {
  // One real build shared by the section (the same orchestrator `pnpm build`
  // runs; on the selected win32-x64 host it vendors the koffi runtime).
  let distRoot: string;

  beforeAll(async () => {
    distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-winpipe-'));
    const { runPackageBuild } = await import('../package.ts');
    await runPackageBuild(distRoot);
  });

  afterAll(() => {
    fs.rmSync(distRoot, { recursive: true, force: true });
  });

  // The vendored-runtime presence assertions only hold where the build
  // actually vendors (the selected win32-x64 tuple); elsewhere the build
  // skips honestly and the structural mirror below is the assertion.
  const SELECTED_TUPLE = process.platform === 'win32' && process.arch === 'x64';

  it.skipIf(!SELECTED_TUPLE)(
    'vendors exactly the declared runtime file set into every pipe-capable artifact',
    () => {
      for (const artifact of ['cli', 'core', 'native-host']) {
        const declared = vendoredRuntimeDistPaths('cli');
        for (const relative of declared) {
          const full = path.join(distRoot, artifact, relative);
          expect(fs.existsSync(full), `${artifact}/${relative} must be vendored`).toBe(true);
          expect(
            fs.statSync(full).size,
            `${artifact}/${relative} must not be empty`,
          ).toBeGreaterThan(0);
        }
        // Nothing outside the declaration may exist under node_modules.
        const nodeModules = path.join(distRoot, artifact, 'node_modules');
        const walk = (dir: string, prefix: string): readonly string[] =>
          fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const relative = `${prefix}${entry.name}`;
            return entry.isDirectory()
              ? walk(path.join(dir, entry.name), `${relative}/`)
              : [relative];
          });
        const emitted = fs.existsSync(nodeModules) ? walk(nodeModules, '') : [];
        expect(
          new Set(emitted.map((relative) => `node_modules/${relative}`)),
          `${artifact} node_modules must equal the declaration`,
        ).toEqual(new Set(declared));
      }
    },
  );

  it.skipIf(!SELECTED_TUPLE)('ships the koffi upstream license with the vendored runtime', () => {
    const license = fs.readFileSync(
      path.join(distRoot, 'core', 'node_modules', 'koffi', 'LICENSE.txt'),
      'utf8',
    );
    expect(license.toUpperCase()).toContain('MIT');
  });

  it('skips vendoring honestly on non-selected build hosts', () => {
    // Structural mirror of the build-side rule: the declaration, not the
    // host, decides which tuple's runtime is vendored.
    const emitted = fs.existsSync(path.join(distRoot, 'cli', 'node_modules'));
    expect(emitted).toBe(SELECTED_TUPLE);
  });
});

// ------------------------------------------- #95 installed S2 journey reachability

describe('#95 installed S2 journey reachability (real package build)', () => {
  // One real build shared by the section (the same orchestrator `pnpm build`
  // runs; the audit already fails closed inside it).
  let distRoot: string;

  beforeAll(async () => {
    distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-s2-reach-'));
    const { runPackageBuild } = await import('../package.ts');
    await runPackageBuild(distRoot);
  });

  afterAll(() => {
    fs.rmSync(distRoot, { recursive: true, force: true });
  });

  it('ships the reachable production S2 entrypoint (popup decision → connectNative → S2_ACQUIRE)', () => {
    // Static reachability regression for finding #94: the shipped bundle must
    // contain a PRODUCTION connectNative caller driven by the shipped user
    // decision path — not just an exported descriptor.
    const bundle = fs.readFileSync(
      path.join(distRoot, 'extension', 'background.service-worker.js'),
      'utf8',
    );
    expect(bundle).toContain('connectNative');
    expect(bundle).toContain('S2_SELECT_ATTACHMENT');
    expect(bundle).toContain('S2_ACQUIRE');
    expect(bundle).toContain('user-confirm:');
    expect(bundle).toMatch(/credentials:\s*["']include["']/u);
    // The popup surface ships and the manifest binds it.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distRoot, 'extension', 'manifest.json'), 'utf8'),
    ) as { action?: { default_popup?: string }; permissions?: string[] };
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.permissions).toContain('nativeMessaging');
    for (const asset of ['popup.html', 'popup.js', 'icon128.png']) {
      expect(fs.existsSync(path.join(distRoot, 'extension', asset))).toBe(true);
    }
    const popup = fs.readFileSync(path.join(distRoot, 'extension', 'popup.js'), 'utf8');
    expect(popup).toContain('S2_SELECT_ATTACHMENT');
    expect(popup).toContain('expectedSha256');
  });

  it('ships the native-host side of the S2 chain (scoped capability + single Core seam submission)', () => {
    const host = fs.readFileSync(
      path.join(distRoot, 'native-host', 'xdownload-broker-host.js'),
      'utf8',
    );
    expect(host).toContain('S2_ACQUIRE');
    expect(host).toContain('EXECUTE_S2_ACQUISITION');
    expect(host).toContain('BROWSER_EXTENSION');
    expect(host).toContain('user-confirm:');
  });

  it('ships a Core host that owns the delivered-bytes execution (no second authority)', () => {
    const core = fs.readFileSync(path.join(distRoot, 'core', 'xdownload-core-host.js'), 'utf8');
    expect(core).toContain('EXECUTE_S2_ACQUISITION');
    expect(core).toMatch(/peer\.surface\s*!==\s*["']BROWSER_EXTENSION["']/u);
  });

  it('emits no credential-shaped material in the extension or native-host artifacts', () => {
    for (const artifact of [
      'extension/background.service-worker.js',
      'extension/popup.js',
      'native-host/xdownload-broker-host.js',
    ]) {
      const text = fs.readFileSync(path.join(distRoot, artifact), 'utf8');
      expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/u);
      expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
    }
  });
});
