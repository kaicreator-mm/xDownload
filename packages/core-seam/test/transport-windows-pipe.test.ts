/**
 * #101 S3-WIN-IPC-001 — Windows named-pipe transport tests.
 *
 * `describeWin32` blocks run the REAL OS path (koffi bridge, real pipe, real
 * impersonation) on the Windows Build Host; on other platforms they are
 * skipped (the remote CI lane stays green — the OS verification evidence is
 * Build-Host-local by design). The injected-bridge blocks run everywhere:
 * they prove the admission/refusal logic without a second OS user, which the
 * Build Host cannot provide (recorded as the exact NOT_RUN blocker for the
 * literal cross-user OS negative in the dispatch writeback).
 */

import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  createSeamClient,
  createVerifiedPeerSessionRegistry,
  createWindowsPipeClientTransport,
  createWindowsPipeServerTransport,
  EXPECTED_PEER,
  foreignPeer,
  peer,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  stampPeer,
  WindowsIpcUnsupportedError,
  type PipeIpcBridge,
  type SeamServerTransport,
  type WindowsPeerVerification,
  type WindowsSelfIdentity,
} from './helpers.ts';

const describeWin32 = process.platform === 'win32' ? describe : describe.skip;
const PIPE_ROOT = '\\\\.\\pipe\\xdownload-seam-test-';
let pipeSeq = 0;

const running: SeamServerTransport[] = [];

afterEach(async () => {
  for (const transport of running.splice(0)) {
    await transport.stop();
  }
});

interface StartedPipeSeam {
  readonly target: { readonly pipeName: string };
  readonly transport: ReturnType<typeof createWindowsPipeServerTransport>;
  readonly connectionIds: () => readonly string[];
}

async function startPipeSeam(
  options: {
    bridge?: PipeIpcBridge;
    requireSameLogonSession?: boolean;
  } = {},
): Promise<StartedPipeSeam> {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  const server = result.value;
  const pipeName = `${PIPE_ROOT}${String(process.pid)}-${String(++pipeSeq)}`;
  const transport = createWindowsPipeServerTransport({
    pipeName,
    bridge: options.bridge,
    requireSameLogonSession: options.requireSameLogonSession,
  });
  running.push(transport);
  const seenConnectionIds: string[] = [];
  await transport.start({
    onFrame: (connection, frame) => {
      if (!seenConnectionIds.includes(connection.id)) {
        seenConnectionIds.push(connection.id);
      }
      const response = server.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
  return { target: { pipeName }, transport, connectionIds: () => [...seenConnectionIds] };
}

async function until(condition: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) {
      throw new Error('condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describeWin32('windows pipe transport over the real OS path', () => {
  it('verifies the connecting user natively and serves framed commands (positive)', async () => {
    const seam = await startPipeSeam();
    expect(seam.target.pipeName.startsWith('\\\\.\\pipe\\')).toBe(true);
    const client = createSeamClient({
      transport: createWindowsPipeClientTransport(),
      target: seam.target as never,
      peer: peer('CLI'),
    });
    const response = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        peer('CLI'),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
    const projection = await client.submitQuery(
      rawQuery({ aggregateId: 'contract-single-001' }) as never,
    );
    expect(projection.outcome).toBe('PROJECTION');

    // Exactly one connection, one Core-owned verified same-user session
    // (read BEFORE close: a closed connection forgets its session by design).
    const ids = seam.connectionIds();
    expect(ids.length).toBe(1);
    const session = seam.transport.verifiedSessions.verifiedSessionFor(ids[0]!);
    expect(session).toBeDefined();
    expect(session?.transportKind).toBe('WINDOWS_NAMED_PIPE');
    expect(session?.sameUserAsCore).toBe(true);
    expect(session?.sameLogonSessionAsCore).toBe(true);
    expect(session?.clientPid).toBe(process.pid);
    expect(session?.userSid).toMatch(/^S-1-5-\d+-\d+-\d+-\d+-\d+$/);
    expect(session?.logonSessionId).toMatch(/^0x[0-9a-f]{16}$/);
    // The listener DACL is the explicit protected set: user + SYSTEM, no
    // Everyone/Anonymous/Authenticated-Users ACE.
    const sddl = seam.transport.listenerSecuritySddl;
    expect(sddl).toBeDefined();
    expect(sddl).toContain('(A;;GA;;;SY)');
    expect(sddl).toContain(`(A;;GA;;;${session?.userSid})`);
    expect(sddl).not.toMatch(/\(A;;GA;;;(WD|AN|AU|BU)\)/);
    await client.close();
    // Disconnect forgets the session (one session per live connection).
    await until(() => seam.transport.verifiedSessions.size === 0);
  });

  it('still re-decides the presented envelope identity per frame (spoofed peer rejected)', async () => {
    const seam = await startPipeSeam();
    const client = createSeamClient({
      transport: createWindowsPipeClientTransport(),
      target: seam.target as never,
      peer: foreignPeer('CLI'),
    });
    // The OS-verified connection belongs to the real user, but the envelope
    // claims a foreign install/user: the per-frame gate rejects it truthfully.
    const response = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        foreignPeer('CLI'),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    // OS truth is unchanged by the spoofed envelope claim.
    const ids = seam.connectionIds();
    expect(ids.length).toBe(1);
    expect(seam.transport.verifiedSessions.verifiedSessionFor(ids[0]!)?.sameUserAsCore).toBe(true);
    await client.close();
  });

  it('forgets the session on disconnect and issues a fresh one on reconnect', async () => {
    const seam = await startPipeSeam();
    const first = createSeamClient({
      transport: createWindowsPipeClientTransport(),
      target: seam.target as never,
      peer: peer('CLI'),
    });
    const command = stampPeer(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        requestId: 'req-pipe-reconnect-001',
      }) as never,
      peer('CLI'),
    );
    expect((await first.submitCommand(command)).outcome).toBe('ACCEPTED');
    const firstId = seam.connectionIds()[0]!;
    const firstSession = seam.transport.verifiedSessions.verifiedSessionFor(firstId);
    expect(firstSession).toBeDefined();
    await first.close();
    await until(() => seam.transport.verifiedSessions.size === 0);
    expect(seam.transport.verifiedSessions.verifiedSessionFor(firstId)).toBeUndefined();

    const second = createSeamClient({
      transport: createWindowsPipeClientTransport(),
      target: seam.target as never,
      peer: peer('CLI'),
    });
    expect((await second.submitCommand(command)).outcome).toBe('ACCEPTED');
    const secondId = seam.connectionIds()[1]!;
    expect(secondId).not.toBe(firstId);
    const secondSession = seam.transport.verifiedSessions.verifiedSessionFor(secondId);
    expect(secondSession).toBeDefined();
    expect(secondSession?.sameUserAsCore).toBe(true);
    expect(secondSession?.clientPid).toBe(firstSession?.clientPid);
    expect(secondSession === firstSession).toBe(false);
    // The old connection id never resurfaces.
    expect(seam.transport.verifiedSessions.verifiedSessionFor(firstId)).toBeUndefined();
    await second.close();
  });

  it('refuses a raw pipe client that connects without the impersonation QoS', async () => {
    const seam = await startPipeSeam();
    // libuv's stock client (net.connect) opens the pipe without
    // SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION, so the server-side token
    // is anonymous and verification MUST fail closed.
    const raw = net.connect(seam.target.pipeName, () => {
      void raw;
    });
    await until(() => seam.transport.lastAdmissionFailure !== undefined, 8000);
    expect(seam.transport.lastAdmissionFailure).toContain('ImpersonateNamedPipeClient');
    expect(seam.transport.verifiedSessions.size).toBe(0);
    expect(seam.connectionIds().length).toBe(0);
    raw.destroy();
  });
});

describe('pipe transport admission refusals with an injected bridge (portable)', () => {
  function scriptedBridge(
    verification: WindowsPeerVerification,
  ): PipeIpcBridge & { readonly refusedHandles: () => number; readonly verifyCalls: () => number } {
    const self: WindowsSelfIdentity = {
      userSid: 'S-1-5-21-9-9-9-2001',
      logonSessionId: '0x000000000000beef',
      sameUser: (sid) => sid === 'S-1-5-21-9-9-9-2001',
      sameLogonSession: (luid) => luid === '0x000000000000beef',
    };
    const refused: bigint[] = [];
    let waitCalls = 0;
    let verifyCalls = 0;
    let instance = 0;
    return {
      selfIdentity: () => self,
      buildProtectedSecurityDescriptor: () => Buffer.from([1, 2, 3]),
      securityDescriptorToSddl: () => 'D:(A;;GA;;;test)',
      createPipeInstance: () => BigInt(++instance),
      waitForClientConnection: () => {
        waitCalls += 1;
        return Promise.resolve(waitCalls === 1 ? 'CONNECTED' : ('ABORTED' as const));
      },
      abortPendingConnection: () => undefined,
      verifyPipeClient: () => {
        verifyCalls += 1;
        return verification;
      },
      openNamedPipeClient: () => {
        throw new Error('client side not expected in this scenario');
      },
      openTransportHandle: () => {
        throw new Error('adoption must never be reached for a refused connection');
      },
      closePipeHandle: (handle: bigint) => {
        refused.push(handle);
      },
      refusedHandles: () => refused.length,
      verifyCalls: () => verifyCalls,
    };
  }

  function crossUserVerification(): WindowsPeerVerification {
    return {
      ok: true,
      facts: {
        userSid: 'S-1-5-21-8-8-8-4242',
        userName: 'OTHER\\someone',
        logonSessionId: '0x000000000000beef',
        clientPid: 1234,
      },
    };
  }

  it('destroys a connection whose verified user differs from the Core user', async () => {
    const bridge = scriptedBridge(crossUserVerification());
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge,
      platform: 'win32',
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    await until(() => transport.lastAdmissionFailure !== undefined);
    expect(transport.lastAdmissionFailure).toContain('outside the admitted OS scope');
    expect(transport.verifiedSessions.size).toBe(0);
    // Exactly one OS verification for the one connection; its handle was closed.
    expect(bridge.verifyCalls()).toBe(1);
    expect(bridge.refusedHandles()).toBeGreaterThanOrEqual(1);
  });

  it('destroys a connection outside the required logon session when configured', async () => {
    const bridge = scriptedBridge({
      ok: true,
      facts: {
        userSid: 'S-1-5-21-9-9-9-2001', // same user
        userName: undefined,
        logonSessionId: '0x000000000000f00d', // different session
        clientPid: 1234,
      },
    });
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge,
      platform: 'win32',
      requireSameLogonSession: true,
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    await until(() => transport.lastAdmissionFailure !== undefined);
    expect(transport.lastAdmissionFailure).toContain('sameLogonSession=false');
    expect(transport.verifiedSessions.size).toBe(0);
  });

  it('fails closed at start when the security descriptor cannot be built', async () => {
    const bridge = scriptedBridge({ ok: false, reason: 'not reached' });
    const broken = Object.assign(Object.create(Object.getPrototypeOf(bridge)), bridge, {
      buildProtectedSecurityDescriptor: () => {
        throw new Error('SetEntriesInAclA failed (rc=1337)');
      },
    }) as PipeIpcBridge;
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge: broken,
      platform: 'win32',
    });
    running.push(transport);
    expect(() =>
      transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined }),
    ).toThrow(WindowsIpcUnsupportedError);
  });
});

describe('loopback TCP stays legacy-eligible and structurally unverified', () => {
  it('serves 1.0/1.1 commands over loopback while the shared registry stays empty', async () => {
    const registry = createVerifiedPeerSessionRegistry();
    const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    if (!result.ok) {
      throw new Error('server construction failed');
    }
    const transport = createLoopbackServerTransport({
      host: '127.0.0.1',
      port: 0,
      verifiedSessions: registry,
    });
    running.push(transport);
    const target = await transport.start({
      onFrame: (connection, frame) => {
        const response = result.value.handleFrame(frame);
        connection.send(JSON.stringify(response));
      },
      onConnectionEnded: () => undefined,
    });
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target,
      peer: peer('CLI'),
    });
    const response = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        peer('CLI'),
      ),
    );
    // Legacy command path unchanged.
    expect(response.outcome).toBe('ACCEPTED');
    // The "raw localhost client claiming CLI" negative: loopback never
    // publishes an OS-verified session, so S3 1.2 authority is unreachable.
    expect(registry.size).toBe(0);
    await client.close();
  });
});
