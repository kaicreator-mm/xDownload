/**
 * T07 desktop-shell Core connection tests — behavioral proof that the shell
 * is a seam CLIENT over the existing desktop adapter semantics: the probe is
 * a read-only query, a reachable Core's typed rejection proves the seam
 * answered, and an unreachable Core yields the truthful DISCONNECTED state.
 * No Core runtime/scheduler/ledger is ever composed here (no per-surface
 * K/Core instance) — the harness stands up the real seam server the way the
 * packaged Core host does.
 */

import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackServerTransport,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type SeamListenTarget,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import { CoreConnection } from '../src/main/core-connection.ts';
import type { ResolvedPeerIdentity } from '../src/main/seam-endpoint.ts';

const PEER: ResolvedPeerIdentity = { installId: 'shellsmoke', userId: 'shelluser' };
const EXPECTED_PEER: ExpectedPeerScope = {
  installId: PEER.installId,
  userId: PEER.userId,
  allowedSurfaces: ['DESKTOP_UI'],
};

describe('CoreConnection', () => {
  let transport: SeamServerTransport;
  let target: SeamListenTarget;
  let server: CoreSeamServer;

  beforeEach(async () => {
    transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
    const seam = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(seam.ok).toBe(true);
    if (!seam.ok) {
      throw new Error('harness seam composition refused');
    }
    server = seam.value;
    target = await transport.start({
      onFrame: (connection, frame) => {
        connection.send(JSON.stringify(server.handleFrame(frame)));
      },
      onConnectionEnded: () => undefined,
    });
  });

  afterEach(async () => {
    await transport.stop();
  });

  it('a reachable Core answers the read-only probe (typed rejection, not silence)', async () => {
    const connection = new CoreConnection({
      endpoint: {
        kind: 'loopback',
        host: target.host,
        port: target.port,
        source: 'explicit-override',
      },
      peer: PEER,
      electronVersion: 'test',
    });
    await connection.probeOnce();
    const status = connection.statusDocument();
    // The probe aggregate does not exist: Core answering with its typed
    // rejection is exactly what proves the seam round-trip succeeded.
    expect(status.core.connection).toBe('REJECTED_PROJECTION');
    expect(status.core.peer).toEqual({
      installId: PEER.installId,
      userId: PEER.userId,
      surface: 'DESKTOP_UI',
    });
    expect(status.seamEndpoint.kind).toBe('loopback');
    expect(status.shell.localAssetsOnly).toBe(true);
    await connection.close();
  });

  it('an unreachable Core yields DISCONNECTED (truthful degraded state)', async () => {
    const probe = net.createServer().listen(0, '127.0.0.1');
    const deadPort: number = await new Promise((resolve, reject) => {
      probe.once('listening', () => {
        const address = probe.address();
        if (typeof address === 'object' && address !== null) {
          resolve(address.port);
        } else {
          reject(new Error('no probe address'));
        }
      });
      probe.once('error', reject);
    });
    await new Promise((resolve) => probe.close(resolve));
    const connection = new CoreConnection({
      endpoint: {
        kind: 'loopback',
        host: '127.0.0.1',
        port: deadPort,
        source: 'explicit-override',
      },
      peer: PEER,
      electronVersion: 'test',
    });
    await connection.probeOnce();
    expect(connection.statusDocument().core.connection).toBe('DISCONNECTED');
    await connection.close();
  });

  it('an endpoint without a verified peer identity stays UNCONFIGURED (no adapter)', async () => {
    const connection = new CoreConnection({
      endpoint: {
        kind: 'unconfigured',
        reason: 'no install binding found; run the packaged installer first',
      },
      peer: undefined,
      electronVersion: 'test',
    });
    await connection.probeOnce();
    const status = connection.statusDocument();
    expect(status.core.connection).toBe('UNCONFIGURED');
    expect(status.core.peer).toBeNull();
    expect(status.core.refusalReason).toContain('no install binding');
    await connection.close();
  });
});
