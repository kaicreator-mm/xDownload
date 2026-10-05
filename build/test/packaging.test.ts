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
import { afterAll, describe, expect, it } from 'vitest';
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
    [
      'extension/manifest.json',
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: 'background.service-worker.js', type: 'module' },
      }),
    ],
    ['extension/background.service-worker.js', BUNDLE_STUB],
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
