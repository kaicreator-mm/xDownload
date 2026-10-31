/**
 * T07 desktop-shell seam endpoint resolution — the existing Core lifecycle
 * binding, reused verbatim (frozen L2 §4: desktop main reuses the existing
 * install/Core lifecycle boundary and seam client; it never instantiates a
 * private Core/Kernel and never invents a second IPC route).
 *
 * Resolution order (fail-closed, no fallback between kinds):
 *   1. `XDOWNLOAD_SEAM_LOOPBACK=<host:port>` — an EXPLICIT dev/smoke-only
 *      override to a loopback seam target (CLI parity; loopback is an
 *      existing approved surface transport). The peer identity must come
 *      from the paired `XDOWNLOAD_SHELL_INSTALL_ID`/`XDOWNLOAD_SHELL_USER_ID`
 *      variables, validated by the seam identity rules. Missing/invalid
 *      override or identity → refusal, never a fallback.
 *   2. The per-user install binding written by `build/install-host.ts`
 *      (`~/.xdownload/install/broker-config.json`) → the canonical
 *      `\\.\pipe\xdownload-core-<installId>` seam target and the same
 *      install/user identity. Missing → unconfigured (the truthful degraded
 *      state; T09 owns installation). Malformed/mismatched → refusal.
 *
 * This module is pure (no `electron` import) so unit tests exercise the
 * exact resolution the main entry performs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePeerInstallId, makePeerUserId } from '@xdownload/core-seam';
import type { ShellSeamEndpoint } from './shell-contract.ts';
import { decodeInstallCoreBinding, decodeLoopbackOverride } from './validators.ts';

/** Environment variable carrying the explicit dev/smoke loopback override. */
export const SEAM_LOOPBACK_OVERRIDE_ENV = 'XDOWNLOAD_SEAM_LOOPBACK' as const;
/** Peer identity variables paired with the loopback override (dev/smoke). */
export const SHELL_INSTALL_ID_ENV = 'XDOWNLOAD_SHELL_INSTALL_ID' as const;
export const SHELL_USER_ID_ENV = 'XDOWNLOAD_SHELL_USER_ID' as const;

/** The install binding paths owned by `build/install-host.ts` (mirrored). */
export interface InstallBindingPaths {
  readonly installDir: string;
  readonly configPath: string;
  readonly coreStartPath: string;
}

/** Stable per-user install state root (same layout as `installPaths()`). */
export function installBindingPaths(home: string): InstallBindingPaths {
  const installDir = join(home, '.xdownload', 'install');
  return {
    installDir,
    configPath: join(installDir, 'broker-config.json'),
    coreStartPath: join(installDir, 'xdownload-core-start.cmd'),
  };
}

export interface ResolveSeamEndpointInput {
  readonly home: string;
  /** Environment (override variables read from here; injectable in tests). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly paths?: InstallBindingPaths;
}

/** The install/user identity the shell presents as its DESKTOP_UI peer. */
export interface ResolvedPeerIdentity {
  readonly installId: string;
  readonly userId: string;
}

/** Endpoint + peer identity, resolved together and never invented. */
export interface SeamAccess {
  readonly endpoint: ShellSeamEndpoint;
  /** Present exactly when the endpoint carries a verified identity. */
  readonly peer: ResolvedPeerIdentity | undefined;
}

function readInstallCoreBinding(
  paths: InstallBindingPaths,
):
  | { readonly ok: true; readonly installId: string; readonly userId: string }
  | { readonly ok: false; readonly endpoint: ShellSeamEndpoint } {
  if (!existsSync(paths.configPath)) {
    return {
      ok: false,
      endpoint: {
        kind: 'unconfigured',
        reason:
          'no install binding found; run the packaged installer first (T09 owns installation)',
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.configPath, 'utf8')) as unknown;
  } catch {
    return {
      ok: false,
      endpoint: { kind: 'refused', reason: 'install config is not parseable JSON' },
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      endpoint: { kind: 'refused', reason: 'install config is not a JSON object' },
    };
  }
  const binding = decodeInstallCoreBinding((parsed as Record<string, unknown>)['core']);
  if (!binding.ok) {
    return {
      ok: false,
      endpoint: { kind: 'refused', reason: `install config core block: ${binding.detail}` },
    };
  }
  return { ok: true, installId: binding.value.installId, userId: binding.value.userId };
}

/**
 * Resolve the ONE seam endpoint (and its verified peer identity) this shell
 * talks to. The result is always truthful: an unconfigured/refused endpoint
 * is a status the renderer sees, never a reason to fall back to another
 * transport or to start a private Core authority.
 */
export function resolveSeamAccess(input: ResolveSeamEndpointInput): SeamAccess {
  const override = input.env[SEAM_LOOPBACK_OVERRIDE_ENV];
  if (override !== undefined) {
    const decoded = decodeLoopbackOverride(override);
    if (!decoded.ok) {
      return {
        endpoint: { kind: 'refused', reason: `${SEAM_LOOPBACK_OVERRIDE_ENV}: ${decoded.detail}` },
        peer: undefined,
      };
    }
    const installId = input.env[SHELL_INSTALL_ID_ENV];
    const userId = input.env[SHELL_USER_ID_ENV];
    const install = typeof installId === 'string' ? makePeerInstallId(installId) : undefined;
    const user = typeof userId === 'string' ? makePeerUserId(userId) : undefined;
    if (install === undefined || !install.ok || user === undefined || !user.ok) {
      return {
        endpoint: {
          kind: 'refused',
          reason: `${SEAM_LOOPBACK_OVERRIDE_ENV} requires valid ${SHELL_INSTALL_ID_ENV} and ${SHELL_USER_ID_ENV}`,
        },
        peer: undefined,
      };
    }
    return {
      endpoint: {
        kind: 'loopback',
        host: decoded.value.host,
        port: decoded.value.port,
        source: 'explicit-override',
      },
      peer: { installId: install.value, userId: user.value },
    };
  }
  const binding = readInstallCoreBinding(input.paths ?? installBindingPaths(input.home));
  if (!binding.ok) {
    return { endpoint: binding.endpoint, peer: undefined };
  }
  return {
    endpoint: {
      kind: 'pipe',
      pipeName: `\\\\.\\pipe\\xdownload-core-${binding.installId}`,
      source: 'install-config',
    },
    peer: { installId: binding.installId, userId: binding.userId },
  };
}
