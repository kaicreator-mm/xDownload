/**
 * TEST_MATRIX suite `peer-authorization`:
 * - same-install/same-user authorized peer can submit commands and read
 *   projections;
 * - peers failing identity or authorization verification reject fail-closed
 *   from all authority-affecting commands;
 * - no anonymous/unrestricted fallback transport path coexists with the
 *   authorized one (Native Messaging allowed_origins stays separate, L2
 *   §6.4/§12 invariant 14);
 * - authorization decisions apply per command/query, never inherited.
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackServerTransport,
  NonLoopbackTransportRefusedError,
  EXPECTED_PEER,
  foreignPeer,
  peer,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
} from './helpers.ts';

function server() {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

describe('authorized same-install/same-user peer', () => {
  it('can submit an authority-affecting command', () => {
    const s = server();
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
  });

  it('can read projections', () => {
    const s = server();
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    expect(response.outcome).toBe('PROJECTION');
    expect(response.projection).toBeDefined();
  });

  it('every surface kind in the allowed set is admissible', () => {
    for (const surface of ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'] as const) {
      const s = server();
      const response = s.handleFrame(
        JSON.stringify(
          rawCommand({
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: `contract-${surface.toLowerCase()}-001`,
            payload: rawSingleResourceContract({
              contractId: `contract-${surface.toLowerCase()}-001`,
              requestedTarget: `target-${surface.toLowerCase()}-001`,
            }),
            asPeer: peer(surface),
          }),
        ),
      );
      expect(response.outcome).toBe('ACCEPTED');
    }
  });
});

describe('identity/authorization failures reject fail-closed', () => {
  it('a foreign install/user identity is rejected from authority-affecting commands with PEER_IDENTITY_REJECTED', () => {
    const s = server();
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          asPeer: foreignPeer(),
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(s.inspectProjection('contract-single-001')).toBeUndefined();
    expect(s.acceptedCommandCount).toBe(0);
  });

  it('a missing peer block rejects (no anonymous path)', () => {
    const s = server();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
    });
    delete raw['peer'];
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
  });

  it('a malformed peer identity rejects', () => {
    const s = server();
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' });
    raw['peer'] = { installId: '', userId: 'user-001', surface: 'CLI' };
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
  });

  it('a surface outside the allowed set is rejected with PEER_UNAUTHORIZED', () => {
    const result = createCoreSeamServer({
      expectedPeer: { ...EXPECTED_PEER, allowedSurfaces: ['CLI'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.value.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          asPeer: peer('BROWSER_EXTENSION'),
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_UNAUTHORIZED');
  });

  it('unauthorized peers cannot even read projections', () => {
    const s = server();
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001', asPeer: foreignPeer() })),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.projection).toBeUndefined();
  });
});

describe('authorization applies per command, never once per lifetime', () => {
  it('an admitted peer cannot smuggle a later frame under a different identity', () => {
    const s = server();
    const first = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    expect(first.outcome).toBe('ACCEPTED');
    // Same server, same "connection"-level admission history — but this frame
    // presents a different peer identity: rejected.
    const second = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CONFIRM_SNAPSHOT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          expectedRevision: 1,
          asPeer: foreignPeer(),
        }),
      ),
    );
    expect(second.outcome).toBe('REJECTED');
    expect(second.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
  });
});

describe('no anonymous/unrestricted fallback transport path exists', () => {
  it('the F1 transport refuses any non-loopback bind at construction', () => {
    expect(() => createLoopbackServerTransport({ host: '0.0.0.0', port: 0 })).toThrow(
      NonLoopbackTransportRefusedError,
    );
    expect(() => createLoopbackServerTransport({ host: '192.168.1.10', port: 0 })).toThrow(
      NonLoopbackTransportRefusedError,
    );
  });

  it('the seam port itself has no peerless entry point: every frame requires an authorized peer block', () => {
    const s = server();
    for (const kind of ['command', 'query'] as const) {
      const raw =
        kind === 'command'
          ? rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' })
          : rawQuery({ aggregateId: 'c-1' });
      delete raw['peer'];
      const response = s.handleFrame(JSON.stringify(raw));
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    }
  });
});
