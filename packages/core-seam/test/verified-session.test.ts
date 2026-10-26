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
  createCoreSeamServer,
  EXPECTED_PEER,
  rawCommand,
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
      // Same Windows SID is not sufficient for protected S3 authority:
      // an unrelated interactive logon must not confirm this Core session.
      const otherLogon = assertPeerTransportAuthorization({
        commandType,
        verifiedPeer: session({ sameLogonSessionAsCore: false }),
      });
      expect(otherLogon.ok).toBe(false);
      if (!otherLogon.ok) {
        expect(otherLogon.diagnostics[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
      }
      // A positively verified same-user named-pipe session is admitted.
      const admitted = assertPeerTransportAuthorization({ commandType, verifiedPeer: session() });
      expect(admitted.ok).toBe(true);
    }
  });

  it('keeps S3 DISABLED on 1.1 and refuses malformed S3 syntax on 1.2', () => {
    // S3 syntax recognition is now 1.2-only, but the installed Core still
    // advertises 1.1 and refuses all S3 even with a forged claimed CLI peer.
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
      expect(decoded.diagnostics.some((d) => d.code === 'UNSUPPORTED_ENVELOPE_VERSION')).toBe(true);
    }
    // At schema 1.2 the command name is recognized but an empty EXECUTE
    // payload cannot furnish the mandatory closed snapshot/member tuple.
    const v12 = {
      ...envelope,
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    };
    const decodedV12 = decodeSeamEnvelope(v12);
    expect(decodedV12.ok).toBe(false);
    if (!decodedV12.ok) {
      expect(decodedV12.diagnostics.some((d) => d.code === 'ENVELOPE_MALFORMED')).toBe(true);
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

describe('#148 live transport-to-seam session carrier (no private effects)', () => {
  function s3Wire(): string {
    return JSON.stringify({
      ...rawCommand({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-single-001',
        requestId: 'req-s3-live-1',
        payload: { snapshotId: 'snapshot-001', memberId: 'member-001' },
      }),
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    });
  }

  it('denies no session, unknown ID, wrong registry binding and revoked ID before journal', () => {
    const seam = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const registry = createVerifiedPeerSessionRegistry();
    const reject = (id?: string) => seam.value.handleFrame(s3Wire(), registry, id);
    expect(reject().outcome).toBe('REJECTED');
    expect(reject('winpipe-0').diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    registry.record(session({ connectionId: 'winpipe-1' }));
    // A different valid ID must never authenticate this frame.
    expect(reject('winpipe-0').diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    registry.record(session({ connectionId: 'winpipe-0', sameUserAsCore: false }));
    expect(reject('winpipe-0').diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    registry.record(session({ connectionId: 'winpipe-0' }));
    const admittedButNoHandler = reject('winpipe-0');
    expect(admittedButNoHandler.outcome).toBe('REJECTED');
    expect(admittedButNoHandler.diagnostics?.[0]?.path).toBe('commandType');
    registry.forget('winpipe-0');
    expect(reject('winpipe-0').diagnostics?.[0]?.path).toBe('peer');
    // No event was journaled or persisted simply by admitting a live peer.
    expect(seam.value.inspectProjection('contract-single-001')).toBeUndefined();
  });

  it('refuses mismatched/throwing registry records without consulting effects or replay', () => {
    const seam = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const impostor = {
      size: 1,
      verifiedSessionFor: () => session({ connectionId: 'other-pipe' }),
    };
    const mismatched = seam.value.handleFrame(s3Wire(), impostor, 'winpipe-0');
    expect(mismatched.diagnostics?.[0]?.path).toBe('peer');
    const broken = {
      size: 1,
      verifiedSessionFor: (): OsVerifiedPeerSession => {
        throw new Error('transport registry unavailable');
      },
    };
    expect(seam.value.handleFrame(s3Wire(), broken, 'winpipe-0').outcome).toBe('REJECTED');
    expect(seam.value.inspectProjection('contract-single-001')).toBeUndefined();
  });
});
