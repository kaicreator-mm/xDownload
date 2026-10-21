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
  type WindowsPipeAccept,
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

  it('serves a rapid burst of connections through both overlapped accept paths', async () => {
    const seam = await startPipeSeam();
    const cycles = 24;
    for (let i = 0; i < cycles; i++) {
      const client = createSeamClient({
        transport: createWindowsPipeClientTransport(),
        target: seam.target as never,
        peer: peer('CLI'),
      });
      const response = await client.submitCommand(
        stampPeer(
          rawCommand({
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: `contract-burst-${String(i)}`,
            payload: rawSingleResourceContract({ contractId: `contract-burst-${String(i)}` }),
            requestId: `req-burst-${String(i)}`,
          }) as never,
          peer('CLI'),
        ),
      );
      expect(response.outcome, JSON.stringify(response.diagnostics)).toBe('ACCEPTED');
      await client.close();
      await until(() => seam.transport.verifiedSessions.size === 0, 8000);
    }
    expect(seam.connectionIds().length).toBe(cycles);
    expect(seam.transport.lastAdmissionFailure).toBeUndefined();
    expect(seam.transport.fatalState).toBeUndefined();
    expect(seam.transport.isActive).toBe(true);
  });

  it('rejects a second start on an occupied pipe name synchronously (real bind collision)', async () => {
    const seam = await startPipeSeam();
    const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    if (!result.ok) {
      throw new Error('server construction failed');
    }
    const colliding = createWindowsPipeServerTransport({ pipeName: seam.target.pipeName });
    running.push(colliding);
    // The FIRST instance claims the name exclusively; the colliding start
    // must fail closed at start() itself — never a silent no-op listener.
    expect(() =>
      colliding.start({ onFrame: () => undefined, onConnectionEnded: () => undefined }),
    ).toThrow(WindowsIpcUnsupportedError);
    expect(colliding.isActive).toBe(false);
    expect(colliding.fatalState).toBeUndefined();
    // The original listener is unaffected.
    expect(seam.transport.isActive).toBe(true);
    expect(seam.transport.fatalState).toBeUndefined();
  });
});

describe('pipe transport admission refusals with an injected bridge (portable)', () => {
  function scriptedBridge(verification: WindowsPeerVerification): PipeIpcBridge & {
    readonly refusedHandles: () => number;
    readonly verifyCalls: () => number;
    readonly disposedAccepts: () => number;
  } {
    const self: WindowsSelfIdentity = {
      userSid: 'S-1-5-21-9-9-9-2001',
      logonSessionId: '0x000000000000beef',
      sameUser: (sid) => sid === 'S-1-5-21-9-9-9-2001',
      sameLogonSession: (luid) => luid === '0x000000000000beef',
    };
    const refused: bigint[] = [];
    const disposedAccepts: bigint[] = [];
    let waitCalls = 0;
    let verifyCalls = 0;
    let instance = 0;
    return {
      selfIdentity: () => self,
      buildProtectedSecurityDescriptor: () => Buffer.from([1, 2, 3]),
      securityDescriptorToSddl: () => 'D:(A;;GA;;;test)',
      createPipeInstance: () => BigInt(++instance),
      beginPipeAccept: (pipeHandle: bigint): WindowsPipeAccept => {
        waitCalls += 1;
        const verdict = waitCalls === 1 ? 'CONNECTED' : ('ABORTED' as const);
        return {
          pipeHandle,
          result: Promise.resolve(verdict),
          dispose: () => {
            disposedAccepts.push(pipeHandle);
          },
        };
      },
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
      closeFileDescriptor: () => {
        throw new Error('fd cleanup must never be reached for a refused connection');
      },
      closePipeHandle: (handle: bigint) => {
        refused.push(handle);
      },
      refusedHandles: () => refused.length,
      verifyCalls: () => verifyCalls,
      disposedAccepts: () => disposedAccepts.length,
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
    // Transport publishes a read-only query capability; callers may never
    // spoof Core OS token admission by calling record/forget.
    expect('record' in transport.verifiedSessions).toBe(false);
    expect('forget' in transport.verifiedSessions).toBe(false);
    // Runtime boundary too: the frozen port rejects write attempts.
    expect(() => {
      (transport.verifiedSessions as unknown as { record: unknown }).record = () => undefined;
    }).toThrow(TypeError);
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
      platform: 'win32', // strict same-logon requirement is now the default
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    await until(() => transport.lastAdmissionFailure !== undefined);
    expect(transport.lastAdmissionFailure).toContain('sameLogonSession=false');
    expect(transport.verifiedSessions.size).toBe(0);
  });

  it('forbids opting out of same-logon session admission', () => {
    const bridge = scriptedBridge(crossUserVerification());
    expect(() =>
      createWindowsPipeServerTransport({
        pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
        bridge,
        platform: 'win32',
        requireSameLogonSession: false,
      }),
    ).toThrow(WindowsIpcUnsupportedError);
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

  it('rejects start() itself when the first pipe instance cannot bind (no silent listener)', async () => {
    const bridge = scriptedBridge({ ok: false, reason: 'not reached' });
    const broken = Object.assign(Object.create(Object.getPrototypeOf(bridge)), bridge, {
      createPipeInstance: () => {
        throw new Error('CreateNamedPipeW failed (GetLastError=183)'); // ERROR_ALREADY_EXISTS
      },
    }) as PipeIpcBridge;
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge: broken,
      platform: 'win32',
    });
    running.push(transport);
    // start() is a synchronous fail-closed setup: the bind failure throws
    // before any promise/listener exists (same contract as the descriptor
    // failure test above).
    expect(() =>
      transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined }),
    ).toThrow(WindowsIpcUnsupportedError);
    expect(transport.isActive).toBe(false);
    expect(transport.fatalState).toBeUndefined();
  });

  it('publishes fatalState when instance creation fails after start', async () => {
    const self: WindowsSelfIdentity = {
      userSid: 'S-1-5-21-9-9-9-2001',
      logonSessionId: '0x000000000000beef',
      sameUser: (sid) => sid === 'S-1-5-21-9-9-9-2001',
      sameLogonSession: (luid) => luid === '0x000000000000beef',
    };
    let instance = 0;
    const bridge: PipeIpcBridge = {
      selfIdentity: () => self,
      buildProtectedSecurityDescriptor: () => Buffer.from([1, 2, 3]),
      securityDescriptorToSddl: () => 'D:(A;;GA;;;test)',
      createPipeInstance: () => {
        instance += 1;
        if (instance > 2) {
          throw new Error('CreateNamedPipeW failed (GetLastError=5)');
        }
        return BigInt(instance);
      },
      beginPipeAccept: (pipeHandle: bigint): WindowsPipeAccept => ({
        pipeHandle,
        result: Promise.resolve('CONNECTED'),
        dispose: () => undefined,
      }),
      verifyPipeClient: () => ({
        ok: true,
        facts: {
          userSid: self.userSid,
          userName: undefined,
          logonSessionId: self.logonSessionId,
          clientPid: 4321,
        },
      }),
      openNamedPipeClient: () => {
        throw new Error('not expected');
      },
      openTransportHandle: () => {
        throw new Error('not expected — scripted bridge cannot adopt real fds');
      },
      closeFileDescriptor: () => {
        throw new Error('not expected');
      },
      closePipeHandle: () => undefined,
    };
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge,
      platform: 'win32',
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    // First accept+admit succeeds (refused at adoption — the scripted bridge
    // cannot produce real fds), the loop then fails to create instance #3 and
    // must go DOWN publicly instead of idling silently.
    await until(() => transport.fatalState !== undefined);
    expect(transport.fatalState).toContain('pipe instance creation failed');
    expect(transport.isActive).toBe(false);
    expect(transport.verifiedSessions.size).toBe(0);
    await transport.stop();
  });

  it('escalates a failed RevertToSelf to process-level fail-stop (not connection denial)', async () => {
    const self: WindowsSelfIdentity = {
      userSid: 'S-1-5-21-9-9-9-2001',
      logonSessionId: '0x000000000000beef',
      sameUser: (sid) => sid === 'S-1-5-21-9-9-9-2001',
      sameLogonSession: (luid) => luid === '0x000000000000beef',
    };
    const failStopReasons: string[] = [];
    let instanceCounter = 0;
    const bridge: PipeIpcBridge = {
      selfIdentity: () => self,
      buildProtectedSecurityDescriptor: () => Buffer.from([1, 2, 3]),
      securityDescriptorToSddl: () => 'D:(A;;GA;;;test)',
      createPipeInstance: () => BigInt(++instanceCounter),
      beginPipeAccept: (pipeHandle: bigint): WindowsPipeAccept => ({
        pipeHandle,
        result: Promise.resolve('CONNECTED'),
        dispose: () => undefined,
      }),
      verifyPipeClient: () => ({
        ok: false,
        revertFailed: true,
        reason: 'RevertToSelf failed; thread may remain in client security context',
      }),
      openNamedPipeClient: () => {
        throw new Error('not expected');
      },
      openTransportHandle: () => {
        throw new Error('not expected');
      },
      closeFileDescriptor: () => {
        throw new Error('not expected');
      },
      closePipeHandle: () => undefined,
    };
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge,
      platform: 'win32',
      processFailStop: (reason) => {
        failStopReasons.push(reason);
        throw new Error('process fail-stop sentinel');
      },
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    await until(() => transport.fatalState !== undefined);
    expect(failStopReasons).toHaveLength(1);
    expect(failStopReasons[0]).toContain('RevertToSelf');
    expect(transport.fatalState).toContain('RevertToSelf fail-stop');
    expect(transport.isActive).toBe(false);
    expect(transport.verifiedSessions.size).toBe(0);
    await transport.stop();
  });

  it('disposes the native accept state exactly once per queued instance (stop path)', async () => {
    const bridge = scriptedBridge({ ok: false, reason: 'never verified' });
    // Accept stays pending until its dispose cancels it (mirrors the real
    // bridge: CancelIoEx completes the parked wait as ABORTED).
    const bridgeDisposeCalls: bigint[] = [];
    const resolvers = new Map<bigint, (v: 'CONNECTED' | 'ABORTED') => void>();
    const pendingBridge: PipeIpcBridge = {
      ...bridge,
      beginPipeAccept: (pipeHandle: bigint): WindowsPipeAccept => {
        let resolveResult!: (v: 'CONNECTED' | 'ABORTED') => void;
        const result = new Promise<'CONNECTED' | 'ABORTED'>((resolve) => {
          resolveResult = resolve;
        });
        resolvers.set(pipeHandle, resolveResult);
        return {
          pipeHandle,
          result,
          dispose: () => {
            bridgeDisposeCalls.push(pipeHandle);
            resolvers.get(pipeHandle)?.('ABORTED');
          },
        };
      },
    };
    const transport = createWindowsPipeServerTransport({
      pipeName: `${PIPE_ROOT}injected-${String(++pipeSeq)}`,
      bridge: pendingBridge,
      platform: 'win32',
    });
    running.push(transport);
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    expect(transport.isActive).toBe(true);
    await transport.stop();
    expect(bridgeDisposeCalls.length).toBeGreaterThanOrEqual(1);
    expect(transport.isActive).toBe(false);
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
