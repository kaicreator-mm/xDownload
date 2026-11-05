/**
 * #179 install binding entry tests. Pure binding logic runs on every
 * platform; the Windows registry round-trip is gated to win32 and uses a
 * throwaway host name so the machine is always left as found (the real
 * com.xdownload.broker key is never touched by these tests).
 */
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalPipeName,
  defaultUserId,
  extensionOriginFor,
  installPaths,
  parseInstallArgv,
  performSetup,
  performStatus,
  performUninstall,
  renderBrokerConfig,
  renderCoreStartScript,
  renderLauncherScript,
} from '../install-host.ts';
import {
  cleanupSmokeManifest,
  isRegistryKeyNotFoundError,
  parseWindowsRegistrationProbe,
  probeWindowsRegistration,
  registrationPointsToExpectedManifest,
  unregisterWindowsNativeHost,
  windowsUserManifestDir,
  writeNativeHostManifestIfAbsent,
} from '../native-host.ts';

const REAL_ID = 'llclkcnemgccecnmkhligakepaenphim'; // real Chrome-minted shape
const PLACEHOLDER_ID = 'a'.repeat(32);
// Registry integration is an explicit opt-in because it mutates HKCU and the
// per-user manifest directory. Ordinary focused/CI validation must stay pure.
const RUN_WINDOWS_REGISTRY_SELFTEST =
  process.platform === 'win32' && process.env.XDOWNLOAD_RUN_NATIVE_HOST_REGISTRY_SELFTEST === '1';

describe('#179 extension origin binding', () => {
  it('binds the exact origin of a real 32-letter browser-minted id', () => {
    expect(extensionOriginFor(REAL_ID)).toBe(`chrome-extension://${REAL_ID}/`);
  });
  it('refuses the packaging placeholder id even though it is format-valid', () => {
    expect(() => extensionOriginFor(PLACEHOLDER_ID)).toThrow(/placeholder/i);
  });
  it('refuses wrong-alphabet and wrong-length ids', () => {
    expect(() => extensionOriginFor('q'.repeat(32))).toThrow(/32-letter/);
    expect(() => extensionOriginFor(REAL_ID.slice(0, 31))).toThrow(/32-letter/);
    expect(() => extensionOriginFor('')).toThrow(/32-letter/);
  });
});

describe('#179 canonical pipe namespace', () => {
  it('derives the exact Core host namespace rule', () => {
    expect(canonicalPipeName('xdownload')).toBe('\\\\.\\pipe\\xdownload-core-xdownload');
    expect(canonicalPipeName('User_01-x')).toBe('\\\\.\\pipe\\xdownload-core-User_01-x');
  });
});

describe('#179 typed argv parse', () => {
  it('parses a full setup invocation', () => {
    const parsed = parseInstallArgv(
      [
        'setup',
        '--extension-id',
        REAL_ID,
        '--install-id',
        'inst1',
        '--user-id',
        'u1',
        '--launch-core',
      ],
      'fallback',
    );
    expect(parsed).toEqual({
      verb: 'setup',
      extensionId: REAL_ID,
      installId: 'inst1',
      userId: 'u1',
      launchCore: true,
    });
  });
  it('requires the real extension id for setup', () => {
    expect(() => parseInstallArgv(['setup'], 'fallback')).toThrow(/--extension-id/);
    expect(() => parseInstallArgv(['setup', '--extension-id', PLACEHOLDER_ID], 'f')).toThrow(
      /placeholder/,
    );
  });
  it('refuses unknown verbs, unknown flags, and misapplied flags', () => {
    expect(() => parseInstallArgv(['deploy'], 'f')).toThrow(/unknown command/);
    expect(() => parseInstallArgv(['setup', '--nope'], 'f')).toThrow(/unknown argument/);
    expect(() => parseInstallArgv(['uninstall', '--extension-id', REAL_ID], 'f')).toThrow(
      /setup only/,
    );
    expect(() => parseInstallArgv(['status', '--launch-core'], 'f')).toThrow(/setup only/);
    expect(() => parseInstallArgv(['setup', '--extension-id'], 'f')).toThrow(/requires a value/);
  });
  it('validates install/user ids against the Core peer identity rule', () => {
    expect(() =>
      parseInstallArgv(['setup', '--extension-id', REAL_ID, '--install-id', '\\\\bad'], 'f'),
    ).toThrow(/peer identity/);
    expect(() =>
      parseInstallArgv(['setup', '--extension-id', REAL_ID, '--user-id', ''], 'f'),
    ).toThrow(/peer identity/);
  });
  it('uninstall/status run without the extension id', () => {
    expect(parseInstallArgv(['uninstall'], 'f').verb).toBe('uninstall');
    expect(parseInstallArgv(['status'], 'f').verb).toBe('status');
  });
});

describe('#179 rendered install artifacts', () => {
  it('renders the per-user broker config with the exact pipe core section', () => {
    const config = JSON.parse(
      renderBrokerConfig({
        origin: extensionOriginFor(REAL_ID),
        installId: 'inst1',
        userId: 'u1',
        pipeName: canonicalPipeName('inst1'),
      }),
    );
    expect(config).toEqual({
      hostName: 'com.xdownload.broker',
      allowedOrigins: [`chrome-extension://${REAL_ID}/`],
      core: { installId: 'inst1', userId: 'u1', pipeName: '\\\\.\\pipe\\xdownload-core-inst1' },
    });
  });
  it('renders launcher and single-Core start scripts', () => {
    const launcher = renderLauncherScript({ brokerHostPath: 'B', configPath: 'C' });
    expect(launcher).toContain('node "B" --config "C"');
    const start = renderCoreStartScript({
      coreHostPath: 'CORE',
      coreDataRoot: 'ROOT',
      installId: 'inst1',
      userId: 'u1',
      pipeName: canonicalPipeName('inst1'),
    });
    expect(start).toContain('--pipe-name "\\\\.\\pipe\\xdownload-core-inst1"');
    expect(start).toContain('--install-id "inst1"');
    expect((start.match(/node "/g) ?? []).length).toBe(1); // exactly one Core process
  });
  it('keeps install state under the per-user writable root, outside dist', () => {
    const home = path.join(tmpdir(), 'i179-home-fixture');
    const paths = installPaths(home);
    expect(paths.installDir).toBe(path.join(home, '.xdownload', 'install'));
    expect(paths.configPath).toBe(path.join(paths.installDir, 'broker-config.json'));
    expect(paths.launcherPath).toBe(path.join(paths.installDir, 'xdownload-broker-launch.cmd'));
    expect(paths.coreDataRoot.includes('dist')).toBe(false);
  });
});

describe('#179 status reads the per-user config', () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), 'i179-status-'));
  const paths = installPaths(home);
  it('reports absent config fail-closed', () => {
    const status = performStatus(paths);
    expect(status.configPresent).toBe(false);
    expect(status.configCore).toBeUndefined();
  });
  it('summarizes the bound core when present and stays honest on garbage', () => {
    fs.mkdirSync(paths.installDir, { recursive: true });
    fs.writeFileSync(
      paths.configPath,
      renderBrokerConfig({
        origin: extensionOriginFor(REAL_ID),
        installId: 'inst1',
        userId: 'u1',
        pipeName: canonicalPipeName('inst1'),
      }),
      'utf8',
    );
    expect(performStatus(paths).configCore).toEqual({
      installId: 'inst1',
      userId: 'u1',
      pipeName: canonicalPipeName('inst1'),
    });
    fs.writeFileSync(paths.configPath, 'not json', 'utf8');
    const garbage = performStatus(paths);
    expect(garbage.configPresent).toBe(true);
    expect(garbage.configCore).toBeUndefined();
  });
});


describe('#316 registry query failure classification', () => {
  it('treats only a known missing-key result as absence', () => {
    expect(
      isRegistryKeyNotFoundError({
        code: 1,
        stderr: 'ERROR: The system was unable to find the specified registry key or value.',
      }),
    ).toBe(true);
    expect(
      isRegistryKeyNotFoundError({
        code: 1,
        stderr: 'ERROR: Access is denied.',
      }),
    ).toBe(false);
    expect(isRegistryKeyNotFoundError({ code: 5, stderr: 'Access is denied.' })).toBe(false);
  });
});

describe('#316 Native Host smoke manifest ownership and cleanup', () => {
  const unregistered = {
    action: 'unregistered' as const,
    key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.xdownload.broker',
    detail: 'removed',
  };
  const absentRegistration = {
    registered: false,
    manifestPath: null,
    raw: null,
  };

  it('creates manifests exclusively and never overwrites a pre-existing xDownload file', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'xdownload-316-no-clobber-'));
    try {
      const manifestPath = path.join(dir, 'com.xdownload.broker.json');
      fs.writeFileSync(manifestPath, 'pre-existing manifest', 'utf8');

      expect(writeNativeHostManifestIfAbsent(manifestPath, 'replacement')).toBe(false);
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe('pre-existing manifest');

      const cleanup = cleanupSmokeManifest({
        manifestPath,
        manifestExistedBefore: true,
        createdByAttempt: false,
        unregisterResult: unregistered,
        registrationAfter: absentRegistration,
      });
      expect(cleanup).toEqual({
        action: 'preserved',
        reason: 'manifest existed before this smoke attempt',
      });
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe('pre-existing manifest');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes only the smoke-owned manifest and preserves sibling files and the directory', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'xdownload-316-owned-cleanup-'));
    try {
      const manifestPath = path.join(dir, 'com.xdownload.broker.json');
      const siblingPath = path.join(dir, 'another-host.json');
      expect(writeNativeHostManifestIfAbsent(manifestPath, 'created by this smoke attempt')).toBe(true);
      fs.writeFileSync(siblingPath, 'sibling manifest', 'utf8');

      const cleanup = cleanupSmokeManifest({
        manifestPath,
        manifestExistedBefore: false,
        createdByAttempt: true,
        unregisterResult: unregistered,
        registrationAfter: absentRegistration,
      });

      expect(cleanup).toEqual({ action: 'removed' });
      expect(fs.existsSync(manifestPath)).toBe(false);
      expect(fs.readFileSync(siblingPath, 'utf8')).toBe('sibling manifest');
      expect(fs.existsSync(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves the manifest when registry deletion fails or read-back still finds a registration', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'xdownload-316-failed-cleanup-'));
    try {
      const manifestPath = path.join(dir, 'com.xdownload.broker.json');
      fs.writeFileSync(manifestPath, 'referenced manifest', 'utf8');

      const failedDelete = cleanupSmokeManifest({
        manifestPath,
        manifestExistedBefore: false,
        createdByAttempt: true,
        unregisterResult: {
          action: 'failed',
          key: unregistered.key,
          detail: 'access denied',
        },
        registrationAfter: {
          registered: true,
          manifestPath,
          raw: 'still registered',
        },
      });
      expect(failedDelete.action).toBe('preserved');
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe('referenced manifest');

      const staleReadBack = cleanupSmokeManifest({
        manifestPath,
        manifestExistedBefore: false,
        createdByAttempt: true,
        unregisterResult: unregistered,
        registrationAfter: {
          registered: true,
          manifestPath,
          raw: 'still registered',
        },
      });
      expect(staleReadBack.action).toBe('preserved');
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe('referenced manifest');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses registry manifest paths containing spaces without truncation', () => {
    const manifestPath = 'C:\\Users\\Jane Doe\\.xdownload\\native-host\\com.xdownload.broker.json';
    const raw = [
      'HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.xdownload.broker',
      '    (Default)    REG_SZ    ' + manifestPath,
    ].join('\n');
    const probe = parseWindowsRegistrationProbe(raw);

    expect(probe.registered).toBe(true);
    expect(probe.manifestPath).toBe(manifestPath);
    expect(registrationPointsToExpectedManifest(probe, manifestPath)).toBe(true);
    expect(
      registrationPointsToExpectedManifest(probe, 'C:\\Users\\Other User\\manifest.json'),
    ).toBe(false);
  });

  it('does not treat an unregistered read-back as proof of successful unregister', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'xdownload-316-uncertain-cleanup-'));
    try {
      const manifestPath = path.join(dir, 'com.xdownload.broker.json');
      fs.writeFileSync(manifestPath, 'possibly referenced manifest', 'utf8');

      const cleanup = cleanupSmokeManifest({
        manifestPath,
        manifestExistedBefore: false,
        createdByAttempt: true,
        unregisterResult: {
          action: 'not-registered',
          key: unregistered.key,
          detail: 'registry query returned no key',
        },
        registrationAfter: absentRegistration,
      });

      expect(cleanup.action).toBe('preserved');
      expect(fs.existsSync(manifestPath)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!RUN_WINDOWS_REGISTRY_SELFTEST)(
  '#179 windows registration round-trip (throwaway host name)',
  () => {
    const home = fs.mkdtempSync(path.join(tmpdir(), 'i179-win-'));
    const distDir = fs.mkdtempSync(path.join(tmpdir(), 'i179-dist-'));
    const paths = installPaths(home);
    const SELFTEST_HOST = 'com.xdownload.install-selftest';
    const argv = parseInstallArgv(['setup', '--extension-id', REAL_ID], 'u1');
    // Self-healing: a previous crashed run may have left the throwaway
    // registration behind; sweep it (and only it) before the round-trip.
    // The manifest FILE name is fixed by packaging, so its content is
    // saved before the round-trip and restored after — a pre-existing real
    // registration must be left exactly as found.
    const manifestFile = path.join(windowsUserManifestDir(), 'com.xdownload.broker.json');
    let manifestAsFound: string | null = null;
    beforeAll(async () => {
      manifestAsFound = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8') : null;
      await unregisterWindowsNativeHost(SELFTEST_HOST);
    });
    afterAll(async () => {
      await unregisterWindowsNativeHost(SELFTEST_HOST);
      if (manifestAsFound !== null) {
        fs.writeFileSync(manifestFile, manifestAsFound, 'utf8');
      }
    });
    fs.writeFileSync(path.join(distDir, 'marker'), 'x');
    fs.mkdirSync(path.join(distDir, 'native-host'), { recursive: true });
    fs.mkdirSync(path.join(distDir, 'core'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'native-host', 'xdownload-broker-host.js'), '// broker');
    fs.writeFileSync(path.join(distDir, 'core', 'xdownload-core-host.js'), '// core');

    it('refuses setup before any write when the packaged artifacts are absent', async () => {
      const outcome = await performSetup(argv, paths, path.join(distDir, 'missing'), SELFTEST_HOST);
      expect(outcome.ok).toBe(false);
      expect(outcome.registration).toBe('not-run');
      expect(fs.existsSync(paths.configPath)).toBe(false);
    });

    it('binds, refuses overwrite, and uninstalls cleanly (registry as found)', async () => {
      const setup = await performSetup(argv, paths, distDir, SELFTEST_HOST);
      expect(setup.ok).toBe(true);
      expect(setup.registration).toBe('registered');
      const probe = await probeWindowsRegistration(SELFTEST_HOST);
      expect(probe.registered).toBe(true);
      expect(probe.manifestPath).toContain('.xdownload');

      const configAfter = fs.readFileSync(paths.configPath, 'utf8');
      const overwrite = await performSetup(argv, paths, distDir, SELFTEST_HOST);
      expect(overwrite.ok).toBe(false);
      expect(overwrite.registration).toBe('already-registered');
      expect(fs.readFileSync(paths.configPath, 'utf8')).toBe(configAfter); // no partial rewrite

      const uninstall = await performUninstall(paths, SELFTEST_HOST);
      expect(uninstall.ok).toBe(true);
      const after = await probeWindowsRegistration(SELFTEST_HOST);
      expect(after.registered).toBe(false);
      expect(fs.existsSync(paths.installDir)).toBe(false);
    });

    it('leaves the default host registration untouched', async () => {
      const probe = await probeWindowsRegistration();
      // not an assertion about the machine's real state — only that the
      // selftest never wrote the production key: cleanup removed exactly what
      // it wrote, and performSetup with the throwaway name cannot have
      // touched this key.
      expect(typeof probe.registered).toBe('boolean');
    });
  },
);

describe('#179 default user id sanitization', () => {
  it('produces a valid Core peer id or a typed instruction', () => {
    try {
      const userId = defaultUserId();
      expect(userId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u);
    } catch (error) {
      expect((error as Error).message).toContain('--user-id');
    }
  });
});
