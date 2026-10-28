/**
 * #179 packaged Windows install binding entry (owned boundary: the
 * packaging/install write set ONLY — this entry never touches lane code,
 * `build/native-host-entry.ts`, or any frozen authority).
 *
 * Composes the per-user install binding for the shipped native-host
 * artifact, closing the #100 normal-install gap with an explicit, typed
 * setup command:
 *   - the exact installed Chrome extension origin (the real 32-letter
 *     browser-minted id, user-supplied and format-validated — never a
 *     placeholder, never a wildcard);
 *   - a per-user broker config under a writable safe path carrying the
 *     canonical Windows-pipe Core namespace (the ONE Core authority this
 *     install binds; the S2 transport adapter is the sibling #180 concern
 *     and is never claimed reachable here);
 *   - HKCU Native Messaging registration via the existing T018 helpers
 *     (no elevation; an existing registration is never overwritten);
 *   - one reproducible single-Core start script and launch flag.
 *
 * Defaults remain fail-closed: until an explicit `setup` runs, the shipped
 * placeholder config keeps every lane unavailable exactly as audited in
 * #100. `uninstall` restores the machine state (registration removed,
 * per-user install files removed; the package dist is never mutated). No
 * secrets are written anywhere.
 *
 * Exit codes: 0 success; 2 typed fail-closed refusal (never a silent
 * fallback, never a simulated session).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NATIVE_HOST_NAME, PLACEHOLDER_EXTENSION_ORIGIN } from './build-config.ts';
import {
  probeWindowsRegistration,
  registerWindowsNativeHost,
  unregisterWindowsNativeHost,
} from './native-host.ts';

/** Mirror of the Core host's own peer/pipe-namespace identity rule. */
export const INSTALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
/** The browser mints unpacked extension ids from the 16-letter alphabet. */
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export interface InstallPaths {
  readonly installDir: string;
  readonly configPath: string;
  readonly launcherPath: string;
  readonly coreStartPath: string;
  readonly coreDataRoot: string;
}

/** Stable per-user install state root (writable, outside the package dist). */
export function installPaths(home: string = os.homedir()): InstallPaths {
  const installDir = path.join(home, '.xdownload', 'install');
  return {
    installDir,
    configPath: path.join(installDir, 'broker-config.json'),
    launcherPath: path.join(installDir, 'xdownload-broker-launch.cmd'),
    coreStartPath: path.join(installDir, 'xdownload-core-start.cmd'),
    coreDataRoot: path.join(home, '.xdownload', 'core-data'),
  };
}

/** Canonical Windows pipe namespace for this install's single Core. */
export function canonicalPipeName(installId: string): string {
  return `\\\\.\\pipe\\xdownload-core-${installId}`;
}

/**
 * The exact installed Chrome extension origin. The id must be the real
 * browser-minted 32-letter value (chrome://extensions) — a placeholder or
 * wildcard is refused; packaging never invents an origin (#100 audit).
 */
export function extensionOriginFor(extensionId: string): string {
  if (extensionId === PLACEHOLDER_EXTENSION_ORIGIN.slice('chrome-extension://'.length, -1)) {
    throw new Error(
      'refusing to bind the packaging placeholder extension id; supply the real browser-minted id from chrome://extensions',
    );
  }
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error(
      `extension id '${extensionId}' is not the real 32-letter browser-minted value; refusing to bind a placeholder or wildcard origin`,
    );
  }
  return `chrome-extension://${extensionId}/`;
}

/** Sanitized default user id from the OS account (explicit flag wins). */
export function defaultUserId(): string {
  const raw = os.userInfo().username;
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (!INSTALL_ID_PATTERN.test(sanitized)) {
    throw new Error(
      `OS username '${raw}' does not sanitize to a valid Core peer id; pass --user-id explicitly`,
    );
  }
  return sanitized;
}

export function validateInstallId(installId: string): string {
  if (!INSTALL_ID_PATTERN.test(installId)) {
    throw new Error(
      `install id '${installId}' is not a valid Core peer identity (alphanumeric/_/-, <=64)`,
    );
  }
  return installId;
}

export function renderBrokerConfig(input: {
  readonly origin: string;
  readonly installId: string;
  readonly userId: string;
  readonly pipeName: string;
}): string {
  return `${JSON.stringify(
    {
      hostName: NATIVE_HOST_NAME,
      allowedOrigins: [input.origin],
      core: {
        installId: input.installId,
        userId: input.userId,
        pipeName: input.pipeName,
      },
    },
    null,
    2,
  )}\n`;
}

export function renderLauncherScript(input: {
  readonly brokerHostPath: string;
  readonly configPath: string;
}): string {
  return `@echo off\nnode "${input.brokerHostPath}" --config "${input.configPath}" %*\n`;
}

export function renderCoreStartScript(input: {
  readonly coreHostPath: string;
  readonly coreDataRoot: string;
  readonly installId: string;
  readonly userId: string;
  readonly pipeName: string;
}): string {
  return `@echo off\nrem ONE Core authority for this install (single transport: the canonical pipe).\nnode "${input.coreHostPath}" --root "${input.coreDataRoot}" --install-id "${input.installId}" --user-id "${input.userId}" --pipe-name "${input.pipeName}"\n`;
}

export interface InstallArgv {
  readonly verb: 'setup' | 'uninstall' | 'status';
  readonly extensionId?: string;
  readonly installId: string;
  readonly userId: string;
  readonly launchCore: boolean;
}

function consumeValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return [value, index + 1];
}

/** Typed fail-closed argv parse (unknown verbs/flags never fall through). */
export function parseInstallArgv(argv: readonly string[], fallbackUserId: string): InstallArgv {
  if (argv.length === 0) {
    throw new Error('usage: xdownload-install-host <setup|uninstall|status> [options]');
  }
  const verb = argv[0];
  if (verb !== 'setup' && verb !== 'uninstall' && verb !== 'status') {
    throw new Error(`unknown command '${String(verb)}'; expected setup|uninstall|status`);
  }
  let extensionId: string | undefined;
  let installId = 'xdownload';
  let userId = fallbackUserId;
  let launchCore = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--extension-id': {
        if (verb !== 'setup') throw new Error('--extension-id applies to setup only');
        [extensionId, index] = consumeValue(argv, index, arg);
        break;
      }
      case '--install-id': {
        [installId, index] = consumeValue(argv, index, arg);
        break;
      }
      case '--user-id': {
        [userId, index] = consumeValue(argv, index, arg);
        break;
      }
      case '--launch-core': {
        if (verb !== 'setup') throw new Error('--launch-core applies to setup only');
        launchCore = true;
        break;
      }
      default:
        throw new Error(`unknown argument '${String(arg)}'`);
    }
  }
  validateInstallId(installId);
  validateInstallId(userId);
  if (verb === 'setup') {
    if (extensionId === undefined) {
      throw new Error(
        'setup requires --extension-id <the real 32-letter browser-minted id from chrome://extensions>',
      );
    }
    extensionOriginFor(extensionId);
    return { verb, extensionId, installId, userId, launchCore };
  }
  return { verb, installId, userId, launchCore };
}

export interface SetupOutcome {
  readonly ok: boolean;
  readonly detail: string;
  readonly registration: 'registered' | 'already-registered' | 'failed' | 'not-run';
  readonly configPath?: string;
  readonly coreStartPath?: string;
  readonly corePid?: number;
}

/**
 * Bind this install. Order is fail-closed: the registration probe runs
 * BEFORE any file write, so an existing registration (this or any other
 * install) is never overwritten and no partial state is left behind.
 */
export async function performSetup(
  argv: InstallArgv,
  paths: InstallPaths,
  distDir: string,
  hostName: string = NATIVE_HOST_NAME,
): Promise<SetupOutcome> {
  const existing = await probeWindowsRegistration(hostName);
  if (existing.registered) {
    return {
      ok: false,
      registration: 'already-registered',
      detail: `an existing Native Messaging registration is present (${existing.manifestPath ?? 'unknown path'}); run 'uninstall' first — this setup never overwrites a registration`,
    };
  }
  const origin = extensionOriginFor(argv.extensionId as string);
  const pipeName = canonicalPipeName(argv.installId);
  const brokerHostPath = path.join(distDir, 'native-host', 'xdownload-broker-host.js');
  const coreHostPath = path.join(distDir, 'core', 'xdownload-core-host.js');
  if (!fs.existsSync(brokerHostPath) || !fs.existsSync(coreHostPath)) {
    return {
      ok: false,
      registration: 'not-run',
      detail: `packaged artifacts not found under ${distDir}; run this command from the installed package`,
    };
  }
  fs.mkdirSync(paths.installDir, { recursive: true });
  fs.writeFileSync(
    paths.configPath,
    renderBrokerConfig({ origin, installId: argv.installId, userId: argv.userId, pipeName }),
    'utf8',
  );
  fs.writeFileSync(
    paths.launcherPath,
    renderLauncherScript({ brokerHostPath, configPath: paths.configPath }),
    'utf8',
  );
  fs.writeFileSync(
    paths.coreStartPath,
    renderCoreStartScript({
      coreHostPath,
      coreDataRoot: paths.coreDataRoot,
      installId: argv.installId,
      userId: argv.userId,
      pipeName,
    }),
    'utf8',
  );
  const registration = await registerWindowsNativeHost({
    launcherPath: paths.launcherPath,
    allowedOrigins: [origin],
    hostName,
  });
  if (registration.action !== 'registered') {
    return {
      ok: false,
      registration: registration.action === 'already-registered' ? 'already-registered' : 'failed',
      detail: `registration reported '${registration.action}': ${registration.detail}`,
      configPath: paths.configPath,
    };
  }
  let corePid: number | undefined;
  if (argv.launchCore) {
    fs.mkdirSync(paths.coreDataRoot, { recursive: true });
    const child = spawn('cmd.exe', ['/c', paths.coreStartPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    corePid = child.pid;
  }
  return {
    ok: true,
    registration: 'registered',
    detail:
      `install bound: origin=${origin} pipe=${pipeName} config=${paths.configPath}` +
      (corePid === undefined
        ? `; start the single Core with: ${paths.coreStartPath}`
        : `; single Core launched (pid ${String(corePid)})`),
    configPath: paths.configPath,
    coreStartPath: paths.coreStartPath,
    corePid,
  };
}

export interface UninstallOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** Restore machine state: registration removed, per-user install files removed. */
export async function performUninstall(
  paths: InstallPaths,
  hostName: string = NATIVE_HOST_NAME,
): Promise<UninstallOutcome> {
  const unregistered = await unregisterWindowsNativeHost(hostName);
  let filesRemoved = false;
  if (fs.existsSync(paths.installDir)) {
    fs.rmSync(paths.installDir, { recursive: true, force: true });
    filesRemoved = true;
  }
  return {
    ok: unregistered.action !== 'failed',
    detail: `registration='${unregistered.action}' (${unregistered.detail}); install files ${filesRemoved ? 'removed' : 'were absent'} (${paths.installDir}); the package dist was never modified`,
  };
}

export interface StatusOutcome {
  readonly registered: boolean;
  readonly manifestPath: string | null;
  readonly configPresent: boolean;
  readonly configCore?: {
    readonly installId: string;
    readonly userId: string;
    readonly pipeName: string;
  };
}

function configSummary(paths: InstallPaths): Omit<StatusOutcome, 'registered' | 'manifestPath'> {
  const configPresent = fs.existsSync(paths.configPath);
  let configCore: StatusOutcome['configCore'];
  if (configPresent) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.configPath, 'utf8')) as {
        core?: { installId?: string; userId?: string; pipeName?: string };
      };
      if (
        parsed.core?.installId !== undefined &&
        parsed.core.userId !== undefined &&
        parsed.core.pipeName !== undefined
      ) {
        configCore = {
          installId: parsed.core.installId,
          userId: parsed.core.userId,
          pipeName: parsed.core.pipeName,
        };
      }
    } catch {
      /* unreadable config reported as present-without-core */
    }
  }
  return { configPresent, ...(configCore === undefined ? {} : { configCore }) };
}

export function performStatus(paths: InstallPaths): StatusOutcome {
  return { registered: false, manifestPath: null, ...configSummary(paths) };
}

async function realStatus(paths: InstallPaths): Promise<StatusOutcome> {
  const probe = await probeWindowsRegistration();
  return {
    ...configSummary(paths),
    registered: probe.registered,
    manifestPath: probe.manifestPath,
  };
}

const INVOKED_DIRECTLY =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (INVOKED_DIRECTLY) {
  const distDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    const parsed = parseInstallArgv(process.argv.slice(2), defaultUserId());
    const paths = installPaths();
    if (parsed.verb === 'setup') {
      const outcome = await performSetup(parsed, paths, distDir);
      process.stdout.write(`${outcome.detail}\n`);
      process.exitCode = outcome.ok ? 0 : 2;
    } else if (parsed.verb === 'uninstall') {
      const outcome = await performUninstall(paths);
      process.stdout.write(`${outcome.detail}\n`);
      process.exitCode = outcome.ok ? 0 : 2;
    } else {
      const outcome = await realStatus(paths);
      process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
      process.exitCode = 0;
    }
  } catch (error) {
    process.stderr.write(
      `xdownload-install-host: ${error instanceof Error ? error.message : 'failed'}\n`,
    );
    process.exitCode = 2;
  }
}
