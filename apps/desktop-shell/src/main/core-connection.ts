/**
 * T07 desktop-shell Core connection — the seam client side of the existing
 * Core lifecycle/seam (frozen L2 §4: desktop main uses the existing Core
 * lifecycle/start binding and seam client; the renderer has no direct K,
 * Host, filesystem or network authority).
 *
 * This module composes the EXISTING desktop adapter (`@xdownload/desktop-ui`
 * `DesktopUiAdapter`, the DESKTOP_UI peer) over an existing seam client
 * transport:
 *   - Windows: the canonical per-install named pipe from the install binding
 *     (the ONE Core authority transport of this install).
 *   - Explicit dev/smoke override: the loopback seam transport (CLI parity).
 * It never composes a Core runtime, scheduler or ledger — no per-surface
 * K/Core instance exists (T07 forbidden set). When the Core is unreachable,
 * the adapter's own DISCONNECTED degradation is the truthful status.
 *
 * No `electron` import: the connection is plain Node, so unit tests run it
 * against a real seam server in-process.
 */

import {
  createLoopbackClientTransport,
  createWindowsPipeClientTransport,
  type SeamClientTransport,
  type SeamListenTarget,
} from '@xdownload/core-seam';
import { createDesktopUiAdapter, type DesktopUiAdapter } from '@xdownload/desktop-ui';
import type {
  ShellCoreConnection,
  ShellSeamEndpoint,
  ShellStatusDocument,
} from './shell-contract.ts';
import type { ResolvedPeerIdentity } from './seam-endpoint.ts';

/** Liveness probe aggregate id: a read-only query, never an effect. */
const LIVENESS_PROBE_AGGREGATE_ID = 'probe:desktop-shell-liveness';

export interface CoreConnectionInput {
  readonly endpoint: ShellSeamEndpoint;
  readonly peer: ResolvedPeerIdentity | undefined;
  readonly electronVersion: string;
}

/**
 * One shell-wide Core connection. Construction never throws: every failure
 * becomes a truthful refused/disconnected status document.
 */
export class CoreConnection {
  private readonly endpoint: ShellSeamEndpoint;
  private readonly peer: ResolvedPeerIdentity | undefined;
  private readonly electronVersion: string;
  private adapter: DesktopUiAdapter | undefined;
  private connection: ShellCoreConnection;
  private readonly refusalReason: string | null;

  constructor(input: CoreConnectionInput) {
    this.endpoint = input.endpoint;
    this.peer = input.peer;
    this.electronVersion = input.electronVersion;
    const composed = composeAdapter(input.endpoint, input.peer);
    if (!composed.ok) {
      this.adapter = undefined;
      this.connection = composed.connection;
      this.refusalReason = composed.reason;
      return;
    }
    this.adapter = composed.adapter;
    this.connection = 'CONNECTED';
    this.refusalReason = null;
  }

  /**
   * One read-only seam round-trip so the connection state reflects REAL Core
   * reachability (never an optimistic claim). The probe aggregate does not
   * exist, so a reachable Core answers with a typed rejection — which is
   * exactly what proves the seam answered (REJECTED_PROJECTION). An
   * unreachable Core leaves DISCONNECTED.
   */
  async probeOnce(): Promise<void> {
    const adapter = this.adapter;
    if (adapter === undefined) {
      return;
    }
    try {
      await adapter.attachAggregate(LIVENESS_PROBE_AGGREGATE_ID);
    } catch {
      // The adapter records DISCONNECTED itself; nothing to re-derive here.
    }
    this.connection = adapterStateOf(adapter);
  }

  /** The current truthful status document (ids only; no secrets). */
  statusDocument(): ShellStatusDocument {
    const peer = this.peer;
    return {
      shell: {
        name: 'xdownload-desktop-shell',
        localAssetsOnly: true,
        electronVersion: this.electronVersion,
      },
      seamEndpoint: this.endpoint,
      core: {
        connection: this.connection,
        refusalReason: this.refusalReason,
        peer:
          peer === undefined
            ? null
            : { installId: peer.installId, userId: peer.userId, surface: 'DESKTOP_UI' },
      },
    };
  }

  /** Release the seam client (idempotent for the unconfigured state). */
  async close(): Promise<void> {
    if (this.adapter !== undefined) {
      await this.adapter.close();
      this.adapter = undefined;
    }
  }
}

type ComposedAdapter =
  | { readonly ok: true; readonly adapter: DesktopUiAdapter }
  | { readonly ok: false; readonly connection: ShellCoreConnection; readonly reason: string };

/**
 * Compose the existing desktop adapter over the resolved endpoint's
 * transport, or produce the truthful fail-closed state for
 * unconfigured/refused endpoints.
 */
function composeAdapter(
  endpoint: ShellSeamEndpoint,
  peer: ResolvedPeerIdentity | undefined,
): ComposedAdapter {
  if (peer === undefined || (endpoint.kind !== 'pipe' && endpoint.kind !== 'loopback')) {
    const reason =
      endpoint.kind === 'unconfigured' || endpoint.kind === 'refused'
        ? endpoint.reason
        : 'endpoint has no verified peer identity';
    return {
      ok: false,
      connection: endpoint.kind === 'refused' ? 'REFUSED' : 'UNCONFIGURED',
      reason,
    };
  }
  let transport: SeamClientTransport;
  try {
    transport =
      endpoint.kind === 'pipe'
        ? createWindowsPipeClientTransport()
        : createLoopbackClientTransport();
  } catch (error) {
    return {
      ok: false,
      connection: 'REFUSED',
      reason: `seam transport unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
  const target: SeamListenTarget =
    endpoint.kind === 'pipe'
      ? { host: '127.0.0.1', port: 0, pipeName: endpoint.pipeName }
      : { host: endpoint.host, port: endpoint.port };
  return {
    ok: true,
    adapter: createDesktopUiAdapter({
      transport,
      target,
      installId: peer.installId,
      userId: peer.userId,
    }),
  };
}

/** The adapter's own connection state, mapped verbatim (no new truth). */
function adapterStateOf(adapter: DesktopUiAdapter): ShellCoreConnection {
  return adapter.currentDisplay().connection;
}
