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
export function writeNativeHostManifestIfAbsent(manifestPath: string, content: string): boolean {
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
  return /unable to find the specified registry key or value|cannot find.*registry key/i.test(
    output,
  );
}

function registryExitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number') {
    return code;
  }
  if (typeof code === 'string' && /^\d+$/u.test(code)) {
    return Number(code);
  }
  return null;
}

/** Split a registry key path into its parent path and final child name. */
function splitParentChildKey(key: string): { parentKey: string; childName: string } | null {
  const trimmed = key.trim();
  const cut = trimmed.lastIndexOf('\\');
  if (cut <= 0 || cut === trimmed.length - 1) {
    return null;
  }
  return { parentKey: trimmed.slice(0, cut), childName: trimmed.slice(cut + 1) };
}

/**
 * Locale-free absence evidence: does a parent-key enumeration list this
 * child key? reg.exe diagnostics are locale-specific (a zh-CN host prints
 * the key-not-found error in GBK Chinese, which arrives as mojibake under
 * utf8 decoding), so text matching alone cannot classify an exit-1 query.
 * A successful parent enumeration that does not list the child key is
 * positive structural evidence that the child key is absent; any listing
 * line that is not the child keeps the decision fail-closed for callers.
 */
export function parentListingOmitsChild(parentQueryStdout: string, childName: string): boolean {
  const child = childName.trim().toLowerCase();
  if (child === '') {
    return false;
  }
  const suffix = `\\${child}`;
  let sawKeyListing = false;
  for (const line of parentQueryStdout.split(/\r?\n/u)) {
    const candidate = line.trim().toLowerCase();
    if (!candidate.startsWith('hkey')) {
      continue;
    }
    sawKeyListing = true;
    if (candidate.endsWith(suffix)) {
      return false;
    }
  }
  return sawKeyListing;
}

type RegistryQuery = (key: string) => Promise<string>;

async function queryRegistryKey(key: string, valueOnly = false): Promise<string> {
  const args = valueOnly ? ['query', key, '/ve'] : ['query', key];
  const result = await execFileAsync('reg', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.stdout;
}

/**
 * Prove a key absent without relying on localized reg.exe diagnostics.
 * If its immediate parent is also absent, walk upward until an existing
 * ancestor can enumerate the missing path segment. Access/query failures
 * that cannot be resolved structurally remain unknown (false).
 */
export async function parentKeyProvesChildAbsent(
  key: string,
  queryRegistry: RegistryQuery = (parentKey) => queryRegistryKey(parentKey),
): Promise<boolean> {
  const segments = splitParentChildKey(key);
  if (segments === null) {
    return false;
  }
  try {
    const parentListing = await queryRegistry(segments.parentKey);
    return parentListingOmitsChild(parentListing, segments.childName);
  } catch (error) {
    if (isRegistryKeyNotFoundError(error)) {
      return true;
    }
    if (registryExitCode(error) === 1) {
      return parentKeyProvesChildAbsent(segments.parentKey, queryRegistry);
    }
    return false;
  }
}

async function regQuery(key: string): Promise<string | null> {
  try {
    const result = await execFileAsync('reg', ['query', key], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    if (isRegistryKeyNotFoundError(error)) {
      return null;
    }
    // reg.exe exit code 1 covers key-not-found on every locale, but the
    // diagnostic text is localized. Resolve it structurally: a successful
    // parent-key enumeration that omits this child proves the key is
    // absent regardless of the OS language.
    if (registryExitCode(error) === 1 && (await parentKeyProvesChildAbsent(key))) {
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

function rootRegistrySection(
  raw: string,
): { readonly rootKey: string; readonly content: string } | null {
  const lines = raw.split(/\r?\n/u);
  const rootHeaderIndex = lines.findIndex((line) => /^\s*HKEY_[A-Z_]+\\/iu.test(line));
  if (rootHeaderIndex === -1) {
    return null;
  }
  const rootKey = lines[rootHeaderIndex]?.trim() ?? '';
  const childHeaderIndex = lines.findIndex(
    (line, index) => index > rootHeaderIndex && /^\s*HKEY_[A-Z_]+\\/iu.test(line),
  );
  return {
    rootKey,
    content: lines
      .slice(rootHeaderIndex + 1, childHeaderIndex === -1 ? undefined : childHeaderIndex)
      .join('\n'),
  };
}

/**
 * Parse the full-key query plus the separate `reg query <key> /ve` result.
 * The full query establishes key existence; /ve isolates the unnamed default
 * value so a named value such as "(Backup)" cannot impersonate it. The
 * default value's display name is localized, so only its parenthesized label
 * is shape-matched. Unset, unreadable or malformed defaults stay unresolved.
 */
export function parseWindowsRegistrationProbe(
  raw: string | null,
  defaultValueRaw: string | null,
): RegistrationProbe {
  if (raw === null) {
    return { registered: false, manifestPath: null, raw: null };
  }
  const fullKey = rootRegistrySection(raw);
  if (fullKey === null || defaultValueRaw === null) {
    return { registered: true, manifestPath: null, raw };
  }
  const defaultValue = rootRegistrySection(defaultValueRaw);
  if (
    defaultValue === null ||
    defaultValue.rootKey.toLowerCase() !== fullKey.rootKey.toLowerCase()
  ) {
    return { registered: true, manifestPath: null, raw };
  }
  const matches = [
    ...defaultValue.content.matchAll(/^\s*\([^()]*\)\s+REG_SZ\s+([^\r\n]+)\s*$/gim),
  ];
  if (matches.length !== 1) {
    return { registered: true, manifestPath: null, raw };
  }
  const captured = matches[0]?.[1]?.trim() ?? null;
  const manifestPath =
    captured !== null && !/^\([^()]*\)$/u.test(captured) ? captured : null;
  return {
    registered: true,
    manifestPath,
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
  const key = windowsRegistryKey(hostName);
  const raw = await regQuery(key);
  if (raw === null) {
    return parseWindowsRegistrationProbe(null, null);
  }
  // Query the complete key first so a missing default value is never
  // confused with an absent key. /ve then returns only the unnamed default
  // value, avoiding false identity matches against arbitrary named values.
  const defaultValueRaw = await queryRegistryKey(key, true).catch(() => null);
  return parseWindowsRegistrationProbe(raw, defaultValueRaw);
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
      detail:
        'the native-host manifest already exists without this registration; refusing to overwrite it',
    };
  }

  // Recheck after exclusive file creation and immediately before reg add. If
  // another process registered this host in the meantime, preserve our file:
  // it may now be the manifest referenced by that registration.
  const registrationAfterManifestCreate = await probeWindowsRegistration(
    input.hostName ?? NATIVE_HOST_NAME,
  );
  if (registrationAfterManifestCreate.registered) {
    return {
      action: 'already-registered',
      key,
      manifestPath: registrationAfterManifestCreate.manifestPath ?? 'unknown',
      detail: `a registration appeared after manifest creation and was not modified; the newly created manifest was preserved at ${manifestPath}`,
    };
  }

  try {
    await execFileAsync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath], {
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
