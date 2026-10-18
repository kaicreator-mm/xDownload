/**
 * #101 S3-WIN-IPC-001 — verified peer session port, transport-authorization
 * gate, and the "S3 1.2 stays DISABLED" wire-level proof. Cross-platform:
 * every scenario here is OS-independent by construction.
 */

import { describe, expect, it } from 'vitest';
import {
  assertPeerTransportAuthorization,
  COMMAND_TYPES,
  CORE_SEAM_SCHEMA_VERSION,
  createVerifiedPeerSessionRegistry,
  createWindowsPipeClientTransport,
  createWindowsPipeServerTransport,
  currentSeamSchemaIdentity,
  decodeSeamEnvelope,
  OS_VERIFIED_PEER_COMMANDS,
  requiresOsVerifiedPeer,
  WindowsPipeTransportUnsupportedError,
  type OsVerifiedPeerSession,
} from './helpers.ts';

function session(overrides: Partial<OsVerifiedPeerSession> = {}): OsVerifiedPeerSession {
  return {
    transportKind: 'WINDOWS_NAMED_PIPE',
    connectionId: 'winpipe-0',
    userSid: 'S-1-5-21-1-2-3-1001',
    userName: undefined,
    clientPid: 4242,
    logonSessionId: '0x00000000000dead1',
    sameUserAsCore: true,
    sameLogonSessionAsCore: true,
    verifiedAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('verified peer session registry', () => {
  it('records, reads and forgets one session per connection id', () => {
    const registry = createVerifiedPeerSessionRegistry();
    expect(registry.size).toBe(0);
    expect(registry.verifiedSessionFor('winpipe-0')).toBeUndefined();
    registry.record(session());
    expect(registry.size).toBe(1);
    expect(registry.verifiedSessionFor('winpipe-0')?.userSid).toBe('S-1-5-21-1-2-3-1001');
    registry.forget('winpipe-0');
    expect(registry.verifiedSessionFor('winpipe-0')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('keeps distinct sessions for distinct connections and forgets by id only', () => {
    const registry = createVerifiedPeerSessionRegistry();
    registry.record(session({ connectionId: 'winpipe-1', clientPid: 1 }));
    registry.record(session({ connectionId: 'winpipe-2', clientPid: 2 }));
    expect(registry.size).toBe(2);
    registry.forget('winpipe-1');
    expect(registry.verifiedSessionFor('winpipe-1')).toBeUndefined();
    expect(registry.verifiedSessionFor('winpipe-2')?.clientPid).toBe(2);
  });
});

describe('OS-verified peer transport authorization gate', () => {
  it('leaves the whole closed 1.0/1.1 command vocabulary legacy-eligible', () => {
    for (const commandType of COMMAND_TYPES) {
      expect(requiresOsVerifiedPeer(commandType)).toBe(false);
      expect(assertPeerTransportAuthorization({ commandType, verifiedPeer: undefined }).ok).toBe(
        true,
      );
    }
  });

  it('requires a positively verified same-user session for reserved S3 1.2 commands', () => {
    for (const commandType of OS_VERIFIED_PEER_COMMANDS) {
      expect(requiresOsVerifiedPeer(commandType)).toBe(true);
      // No verified session (legacy loopback or unverified transport): denied.
      const denied = assertPeerTransportAuthorization({ commandType, verifiedPeer: undefined });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.diagnostics[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
      }
      // A cross-user "verification" is still denied.
      const foreign = assertPeerTransportAuthorization({
        commandType,
        verifiedPeer: session({ sameUserAsCore: false }),
      });
      expect(foreign.ok).toBe(false);
      // A positively verified same-user named-pipe session is admitted.
      const admitted = assertPeerTransportAuthorization({ commandType, verifiedPeer: session() });
      expect(admitted.ok).toBe(true);
    }
  });

  it('keeps S3 1.2 DISABLED at the wire: the reserved command name and a 1.2 envelope both reject', () => {
    // The reserved S3 command name is not in the closed vocabulary, so the
    // envelope decoder rejects it before any dispatch — no S3 path exists.
    const envelope = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'command',
      commandType: 'EXECUTE_S3_SELECTED_MEDIA',
      peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
      requestId: 'req-s3-disabled-1',
      aggregateId: 'contract-single-001',
      expectedRevision: 0,
      correlation: {},
      issuedAt: '2026-10-19T00:00:00Z',
      payload: {},
    };
    const decoded = decodeSeamEnvelope(envelope);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND_TYPE')).toBe(true);
    }
    // Even declared as schema 1.2 the S3 command name is unknown to the closed
    // vocabulary — no S3 1.2 wire path exists until the Contract PR adds one
    // through the documented amendment gate.
    const v12 = {
      ...envelope,
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    };
    const decodedV12 = decodeSeamEnvelope(v12);
    expect(decodedV12.ok).toBe(false);
    if (!decodedV12.ok) {
      expect(decodedV12.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND_TYPE')).toBe(true);
    }
    expect(CORE_SEAM_SCHEMA_VERSION).toBe('1.1.0');
  });
});

describe('windows pipe transport platform discipline (fail closed)', () => {
  it('refuses server construction on a non-win32 platform before any OS call', () => {
    expect(() =>
      createWindowsPipeServerTransport({ pipeName: '\\\\.\\pipe\\x', platform: 'linux' }),
    ).toThrow(WindowsPipeTransportUnsupportedError);
  });

  it('refuses client construction on a non-win32 platform before any OS call', () => {
    expect(() => createWindowsPipeClientTransport({ platform: 'linux' })).toThrow(
      WindowsPipeTransportUnsupportedError,
    );
  });
});
