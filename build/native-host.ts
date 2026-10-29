/**
 * T018 native-host registration wiring (owned boundary: platform-specific
 * native-host registration; Frozen L2 invariant 14 — `allowed_origins`
 * remains the platform-enforced boundary; packaging never bypasses or
 * widens it, and there is no unrestricted fallback IPC).
 *
 * Data-driven platform matrix: only the actually selected platform
 * (Windows per this task's Build Host) has a registration adapter; other
 * platforms emit nothing at build time and surface only as NOT_PROVEN in
 * the support matrix.
 *
 * Windows mechanism (Chromium Native Messaging): an HKCU registry key
 *   HKCU\Software\Google\Chrome\NativeMessagingHosts\<host name>
 * whose default value is the absolute path of the host manifest JSON. The
 * host manifest's `path` must be absolute, so the filled manifest is
 * written to the user's configuration directory at registration time; the
 * build emits only a template plus the packaged host bundle and launcher.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { EXTENSION_ORIGIN_PATTERN, NATIVE_HOST_NAME } from './build-config.ts';

const execFileAsync = promisify(execFile);

export interface NativeHostManifest {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly type: 'stdio';
  readonly allowed_origins: readonly string[];
}

/** The template emitted into the package (path filled at registration). */
export function renderHostManifestTemplate(allowedOrigins: readonly string[]): string {
  return `${JSON.stringify(
    {
      name: NATIVE_HOST_NAME,
      description:
        'xDownload local authorization broker (T010). Reachable only via Chromium Native Messaging; allowed_origins is the platform-enforced boundary and is never bypassed by any local IPC fallback.',
      path: '<XDOWNLOAD_NATIVE_HOST_LAUNCHER>',
      type: 'stdio',
      allowed_origins: allowedOrigins,
    },
    null,
    2,
  )}\n`;
}

/** Validate + fill a host manifest for registration (fail closed). */
export function renderFilledHostManifest(input: {
  launcherPath: string;
  allowedOrigins: readonly string[];
}): NativeHostManifest {
  if (!path.isAbsolute(input.launcherPath)) {
    throw new Error('native host manifest path must be absolute');
  }
  if (input.allowedOrigins.length === 0) {
    throw new Error('refusing to register a native host with an empty allowed_origins list');
  }
  for (const origin of input.allowedOrigins) {
    if (!EXTENSION_ORIGIN_PATTERN.test(origin)) {
      throw new Error(
        `allowed_origins entry '${origin}' is not an exact chrome-extension:// origin; refusing to register`,
      );
    }
  }
  return {
    name: NATIVE_HOST_NAME,
    description:
      'xDownload local authorization broker (T010). Reachable only via Chromium Native Messaging; allowed_origins is the platform-enforced boundary and is never bypassed by any local IPC fallback.',
    path: input.launcherPath,
    type: 'stdio',
    allowed_origins: input.allowedOrigins,
  };
}

/** The Windows registry key path for Chromium native messaging hosts. */
export function windowsRegistryKey(hostName: string = NATIVE_HOST_NAME): string {
  return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
}

async function regQuery(key: string): Promise<string | null> {
  try {
    const result = await execFileAsync('reg', ['query', key, '/ve'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

export interface RegistrationProbe {
  readonly registered: boolean;
  /** Registry default value (manifest path) when registered. */
  readonly manifestPath: string | null;
  readonly raw: string | null;
}

/** Read the current Windows registration state for the host. */
export async function probeWindowsRegistration(
  hostName: string = NATIVE_HOST_NAME,
): Promise<RegistrationProbe> {
  const key = windowsRegistryKey(hostName);
  const raw = await regQuery(key);
  if (raw === null) {
    return { registered: false, manifestPath: null, raw: null };
  }
  const match = /REG_SZ\s+(\S+)/.exec(raw);
  return {
    registered: true,
    manifestPath: match === null ? null : (match[1] ?? null),
    raw,
  };
}

export interface WindowsRegistrationResult {
  readonly action: 'registered' | 'already-registered' | 'failed';
  readonly key: string;
  readonly manifestPath: string;
  readonly detail: string;
}

/**
 * Register the native host on Windows for the current user (no elevation):
 * write the filled manifest into the user's config directory, then set the
 * HKCU key. An existing registration is never overwritten (reported as
 * `already-registered` with its recorded path).
 */
export async function registerWindowsNativeHost(input: {
  launcherPath: string;
  allowedOrigins: readonly string[];
  hostName?: string;
}): Promise<WindowsRegistrationResult> {
  const manifest = renderFilledHostManifest(input);
  const key = windowsRegistryKey(input.hostName ?? NATIVE_HOST_NAME);
  const existing = await probeWindowsRegistration(input.hostName ?? NATIVE_HOST_NAME);
  if (existing.registered) {
    return {
      action: 'already-registered',
      key,
      manifestPath: existing.manifestPath ?? 'unknown',
      detail: 'an existing registration is present and was not modified',
    };
  }
  const configDir = windowsUserManifestDir();
  fs.mkdirSync(configDir, { recursive: true });
  const manifestPath = path.join(configDir, `${manifest.name}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  try {
    await execFileAsync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
      windowsHide: true,
    });
    return {
      action: 'registered',
      key,
      manifestPath,
      detail: 'HKCU registration written and manifest generated',
    };
  } catch (error) {
    return {
      action: 'failed',
      key,
      manifestPath,
      detail: error instanceof Error ? error.message : 'reg add failed',
    };
  }
}

export interface UnregistrationResult {
  readonly action: 'unregistered' | 'not-registered' | 'failed';
  readonly key: string;
  readonly detail: string;
}

/**
 * Remove the HKCU registration written by this packaging (used by the
 * registration smoke so the host machine is left as found).
 */
export async function unregisterWindowsNativeHost(
  hostName: string = NATIVE_HOST_NAME,
): Promise<UnregistrationResult> {
  const key = windowsRegistryKey(hostName);
  const existing = await probeWindowsRegistration(hostName);
  if (!existing.registered) {
    return { action: 'not-registered', key, detail: 'no registration present' };
  }
  try {
    await execFileAsync('reg', ['delete', key, '/f'], { windowsHide: true });
    return { action: 'unregistered', key, detail: 'HKCU registration removed' };
  } catch (error) {
    return {
      action: 'failed',
      key,
      detail: error instanceof Error ? error.message : 'reg delete failed',
    };
  }
}

/**
 * The stable user-level location the Windows flow uses for the filled
 * manifest (no elevation; survives OS tmp cleanup). Exported for the
 * registration smoke so it can clean up exactly what it wrote.
 */
export function windowsUserManifestDir(): string {
  return path.join(os.homedir(), '.xdownload', 'native-host');
}
