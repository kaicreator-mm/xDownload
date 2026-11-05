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

/**
 * Write a manifest only when this exact path does not already exist.
 * The exclusive-create flag closes the exists-then-overwrite race.
 */
export function writeNativeHostManifestIfAbsent(
  manifestPath: string,
  content: string,
): boolean {
  try {
    fs.writeFileSync(manifestPath, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/** Distinguish a genuinely absent registry key from access/query failures. */
export function isRegistryKeyNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: number | string;
    stdout?: string;
    stderr?: string;
  };
  if (candidate.code !== 1 && candidate.code !== '1') {
    return false;
  }
  const output = `${candidate.stdout ?? ''} ${candidate.stderr ?? ''}`;
  return /unable to find the specified registry key or value|cannot find.*registry key/i.test(output);
}

async function regQuery(key: string): Promise<string | null> {
  try {
    const result = await execFileAsync('reg', ['query', key, '/ve'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    if (isRegistryKeyNotFoundError(error)) {
      return null;
    }
    // Access denied, malformed output and all other query failures are not
    // evidence of absence. Propagate them so cleanup cannot unlink a manifest.
    throw error;
  }
}

export interface RegistrationProbe {
  readonly registered: boolean;
  /** Registry default value (manifest path) when registered. */
  readonly manifestPath: string | null;
  readonly raw: string | null;
}

/** Parse a registry query result without truncating profile paths containing spaces. */
export function parseWindowsRegistrationProbe(raw: string | null): RegistrationProbe {
  if (raw === null) {
    return { registered: false, manifestPath: null, raw: null };
  }
  const match = /REG_SZ\s+([^\r\n]+)\s*$/m.exec(raw);
  return {
    registered: true,
    manifestPath: match === null ? null : (match[1]?.trim() ?? null),
    raw,
  };
}

/** True only when the current registry default value names this exact manifest. */
export function registrationPointsToExpectedManifest(
  probe: RegistrationProbe,
  expectedManifestPath: string,
): boolean {
  return probe.registered && probe.manifestPath === expectedManifestPath;
}

/** Read the current Windows registration state for the host. */
export async function probeWindowsRegistration(
  hostName: string = NATIVE_HOST_NAME,
): Promise<RegistrationProbe> {
  const raw = await regQuery(windowsRegistryKey(hostName));
  return parseWindowsRegistrationProbe(raw);
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
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!writeNativeHostManifestIfAbsent(manifestPath, manifestContent)) {
    return {
      action: 'failed',
      key,
      manifestPath,
      detail: 'the native-host manifest already exists without this registration; refusing to overwrite it',
    };
  }
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
    // The manifest is deliberately preserved: a failed reg.exe result may
    // be ambiguous, and deleting it could break a registration that landed.
    return {
      action: 'failed',
      key,
      manifestPath,
      detail: error instanceof Error ? error.message : 'reg add failed; manifest preserved',
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
  expectedManifestPath?: string,
): Promise<UnregistrationResult> {
  const key = windowsRegistryKey(hostName);
  const existing = await probeWindowsRegistration(hostName);
  if (!existing.registered) {
    return { action: 'not-registered', key, detail: 'no registration present' };
  }
  if (
    expectedManifestPath !== undefined &&
    !registrationPointsToExpectedManifest(existing, expectedManifestPath)
  ) {
    return {
      action: 'failed',
      key,
      detail: `current registration does not point to the expected manifest '${expectedManifestPath}'; refusing to delete it`,
    };
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
 * Remove only a manifest that this smoke attempt can prove it owns.
 * The shared manifest directory is intentionally never removed.
 */
export function cleanupSmokeManifest(input: {
  manifestPath: string;
  manifestExistedBefore: boolean;
  createdByAttempt: boolean;
  unregisterResult: UnregistrationResult;
  registrationAfter: RegistrationProbe;
}): { readonly action: 'removed' | 'preserved'; readonly reason?: string } {
  if (input.manifestExistedBefore) {
    return { action: 'preserved', reason: 'manifest existed before this smoke attempt' };
  }
  if (!input.createdByAttempt) {
    return { action: 'preserved', reason: 'this smoke attempt did not create the manifest' };
  }
  if (input.unregisterResult.action !== 'unregistered') {
    return {
      action: 'preserved',
      reason: `registry cleanup did not succeed (${input.unregisterResult.action})`,
    };
  }
  if (input.registrationAfter.registered) {
    return {
      action: 'preserved',
      reason: `registry still references a manifest (${input.registrationAfter.manifestPath ?? 'unresolved path'})`,
    };
  }
  fs.unlinkSync(input.manifestPath);
  return { action: 'removed' };
}

/**
 * The stable user-level location the Windows flow uses for the filled
 * manifest (no elevation; survives OS tmp cleanup). Exported for the
 * registration smoke so it can clean up exactly what it wrote.
 */
export function windowsUserManifestDir(): string {
  return path.join(os.homedir(), '.xdownload', 'native-host');
}
