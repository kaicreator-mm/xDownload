/**
 * T07 desktop-shell fail-closed decoders.
 *
 * Every value crossing the shell's trust boundaries (renderer IPC payloads,
 * the installed broker config, the dev/smoke loopback override) is decoded
 * through these closed, exact-shape validators: unknown fields, wrong types,
 * oversized values and identity/namespace mismatches are typed refusals —
 * never partial acceptance, never fallback (frozen L2 §4; common contract
 * "fail closed on invalid intent").
 *
 * This module is pure (no `electron` import) so unit tests exercise the
 * exact validators the IPC handlers use.
 */

import { makePeerInstallId, makePeerUserId } from '@xdownload/core-seam';

/** Mirror of the Core host's own peer/pipe-namespace identity rule. */
export const INSTALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

/** Canonical Windows pipe namespace for this install's single Core. */
export function canonicalPipeName(installId: string): string {
  return `\\\\.\\pipe\\xdownload-core-${installId}`;
}

/** Pipe namespaces outside this install's canonical namespace are refused. */
export function isCanonicalPipeName(pipeName: string, installId: string): boolean {
  return pipeName === canonicalPipeName(installId);
}

/** Loopback-only hosts for the explicit dev/smoke override (CLI parity). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `status` bridge method takes NO payload: any argument (even `null`) is
 * refused. This is the payload-validation floor every bridge method applies.
 */
export function decodeUnitPayload(payload: unknown): DecodeResult<undefined> {
  if (payload !== undefined) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: 'this method takes no payload; any argument is refused',
    };
  }
  return { ok: true, value: undefined };
}

// ---------------------------------------------- T08 download-manager payloads

/** Opaque lineage/contract identity grammar (mirrors the domain id rule). */
export const MANAGER_LINEAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

/** Upper bound for one user-supplied download URL (mirrors the UI rule). */
export const MANAGER_MAX_URL_LENGTH = 2048;

/** Upper bound for one user-chosen destination directory string. */
export const MANAGER_MAX_DESTINATION_LENGTH = 1024;

/** Exact payload of `managerPreviewAdd`. */
export interface PreviewAddPayload {
  readonly url: string;
  readonly destination?: string;
}

/** Exact payload of the lineage-addressed methods (cancel/retry/reveal). */
export interface LineageRefPayload {
  readonly lineageId: string;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function boundedCleanString(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !hasControlCharacter(value)
  );
}

/**
 * Exact-shape decode of the `managerPreviewAdd` payload: exactly
 * `{ url, destination? }`; the URL must be a bounded http(s) URL and the
 * optional destination a bounded clean string. Anything else is refused.
 */
export function decodePreviewAddPayload(payload: unknown): DecodeResult<PreviewAddPayload> {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'PAYLOAD_REJECTED', detail: 'payload must be a JSON object' };
  }
  const unknownKeys = Object.keys(payload).filter((key) => key !== 'url' && key !== 'destination');
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: `unknown payload field(s): ${unknownKeys.join(', ')}`,
    };
  }
  const url = payload['url'];
  if (!boundedCleanString(url, MANAGER_MAX_URL_LENGTH)) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: `url must be a non-empty string of at most ${MANAGER_MAX_URL_LENGTH} characters without control characters`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'PAYLOAD_REJECTED', detail: 'url is not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, code: 'PAYLOAD_REJECTED', detail: 'only http(s) URLs are admissible' };
  }
  const destination = payload['destination'];
  if (
    destination !== undefined &&
    !boundedCleanString(destination, MANAGER_MAX_DESTINATION_LENGTH)
  ) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: 'destination must be a bounded string without control characters',
    };
  }
  return {
    ok: true,
    value: destination === undefined ? { url } : { url, destination: destination as string },
  };
}

/**
 * Exact-shape decode of the lineage-addressed payloads: exactly
 * `{ lineageId }` with an opaque bounded identity (never a URL or path).
 */
export function decodeLineageRefPayload(payload: unknown): DecodeResult<LineageRefPayload> {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'PAYLOAD_REJECTED', detail: 'payload must be a JSON object' };
  }
  const unknownKeys = Object.keys(payload).filter((key) => key !== 'lineageId');
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: `unknown payload field(s): ${unknownKeys.join(', ')}`,
    };
  }
  const lineageId = payload['lineageId'];
  if (typeof lineageId !== 'string' || !MANAGER_LINEAGE_ID_PATTERN.test(lineageId)) {
    return {
      ok: false,
      code: 'PAYLOAD_REJECTED',
      detail: 'lineageId must be an opaque bounded identity',
    };
  }
  return { ok: true, value: { lineageId } };
}

/** The `core` block of the installed broker-config.json (exact shape). */
export interface InstallCoreBinding {
  readonly installId: string;
  readonly userId: string;
  /** Always the canonical namespace for installId (mismatch refused). */
  readonly pipeName: string;
}

/**
 * Decode the `core` binding of the installed broker config, fail-closed:
 * unknown fields refused, peer ids validated through the seam's own identity
 * rules, and the configured pipe must be exactly the canonical namespace for
 * this install's id (L2 §4: startup verifies the expected install/user
 * identity and configured pipe/seam target).
 */
export function decodeInstallCoreBinding(raw: unknown): DecodeResult<InstallCoreBinding> {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'CONFIG_MALFORMED', detail: 'core block must be a JSON object' };
  }
  const unknownKeys = Object.keys(raw).filter(
    (key) => key !== 'installId' && key !== 'userId' && key !== 'pipeName',
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      code: 'CONFIG_MALFORMED',
      detail: `unknown core config field(s): ${unknownKeys.join(', ')}`,
    };
  }
  const installId = raw['installId'];
  const userId = raw['userId'];
  const pipeName = raw['pipeName'];
  if (typeof installId !== 'string' || typeof userId !== 'string' || typeof pipeName !== 'string') {
    return {
      ok: false,
      code: 'CONFIG_MALFORMED',
      detail: 'core.installId, core.userId and core.pipeName must be strings',
    };
  }
  const install = makePeerInstallId(installId);
  if (!install.ok) {
    return {
      ok: false,
      code: 'CONFIG_MALFORMED',
      detail: `core.installId rejected by the seam identity rule${
        install.diagnostics[0] === undefined ? '' : `: ${install.diagnostics[0].message}`
      }`,
    };
  }
  const user = makePeerUserId(userId);
  if (!user.ok) {
    return {
      ok: false,
      code: 'CONFIG_MALFORMED',
      detail: `core.userId rejected by the seam identity rule${
        user.diagnostics[0] === undefined ? '' : `: ${user.diagnostics[0].message}`
      }`,
    };
  }
  if (!isCanonicalPipeName(pipeName, install.value)) {
    return {
      ok: false,
      code: 'CONFIG_MALFORMED',
      detail: `core.pipeName '${pipeName}' is not this install's canonical Core pipe namespace`,
    };
  }
  return {
    ok: true,
    value: { installId: install.value, userId: user.value, pipeName },
  };
}

/** One explicitly requested loopback seam endpoint (dev/smoke override). */
export interface LoopbackOverride {
  readonly host: string;
  readonly port: number;
}

/**
 * Decode `host:port` for the explicit dev/smoke loopback override.
 * Non-loopback hosts are refused (the local seam admits same-host peers
 * only); there is no default and no fallback — an invalid override is a
 * refusal, never a silent switch to the installed config.
 */
export function decodeLoopbackOverride(raw: string): DecodeResult<LoopbackOverride> {
  const separator = raw.lastIndexOf(':');
  if (separator <= 0 || separator === raw.length - 1) {
    return { ok: false, code: 'OVERRIDE_MALFORMED', detail: 'expected <host>:<port>' };
  }
  const host = raw.slice(0, separator);
  const portText = raw.slice(separator + 1);
  if (!LOOPBACK_HOSTS.has(host)) {
    return {
      ok: false,
      code: 'OVERRIDE_REFUSED',
      detail: `override host '${host}' is not loopback; the local seam admits same-host peers only`,
    };
  }
  if (!/^[0-9]+$/.test(portText)) {
    return { ok: false, code: 'OVERRIDE_MALFORMED', detail: `port '${portText}' is not numeric` };
  }
  const port = Number.parseInt(portText, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return { ok: false, code: 'OVERRIDE_MALFORMED', detail: `port '${portText}' out of range` };
  }
  return { ok: true, value: { host, port } };
}
