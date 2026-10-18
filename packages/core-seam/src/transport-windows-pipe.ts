/**
 * #101 S3-WIN-IPC-001 — Windows named-pipe seam transport with OS-verified
 * peer admission (the production-transport replacement ADR-012 reserved).
 *
 * Server admission is a strict two-stage fail-closed gate per connection:
 *
 * 1. OS token verification — the bridge impersonates the actual connecting
 *    pipe client and reads TokenUser/TokenStatistics natively. A connection
 *    whose verified user is not the Core process's own user (or, when
 *    configured, whose logon session differs) is destroyed before a single
 *    frame is read; no response, no registry entry, no fallback channel.
 * 2. Frame authorization — the seam server re-decides the per-frame
 *    `PeerIdentity` authorization exactly as over legacy transports
 *    (envelope claims remain untrusted; the verified session is transport
 *    truth, not a substitute).
 *
 * Verified sessions are published through the narrow `VerifiedPeerSessionPort`
 * exposed on the transport. Loopback TCP never publishes one, so a future S3
 * 1.2 command (see `OS_VERIFIED_PEER_COMMANDS`) is structurally unreachable
 * for unverified transports.
 *
 * Platform discipline: on any non-win32 platform, or when the native bridge
 * cannot load, construction/start fails closed with a typed error — there is
 * no unauthenticated fallback mode (frozen L2 §12).
 */

import net from 'node:net';
import { SEAM_MESSAGE_LIMITS, type SeamMessageLimits } from './bounds.ts';
import { FrameAccumulator, type SeamListenTarget } from './transport.ts';
import type {
  SeamClientConnection,
  SeamClientTransport,
  SeamConnectionHandler,
  SeamServerConnection,
  SeamServerTransport,
} from './transport.ts';
import {
  createVerifiedPeerSessionRegistry,
  type OsVerifiedPeerSession,
  type VerifiedPeerSessionRegistry,
} from './verified-session.ts';
import {
  WindowsIpcBridge,
  WindowsIpcUnsupportedError,
  WINDOWS_PIPE_TRANSPORT_KIND,
  isWindowsIpcPlatform,
  type WindowsIpcBridge as RealBridge,
  type WindowsPeerVerification,
  type WindowsSelfIdentity,
} from './win-ipc.ts';

/** Narrow bridge surface the transport depends on (test-injectable). */
export interface PipeIpcBridge {
  selfIdentity(): WindowsSelfIdentity;
  buildProtectedSecurityDescriptor(): Buffer;
  createPipeInstance(pipeName: string, securityDescriptor: Buffer, firstInstance: boolean): bigint;
  waitForClientConnection(pipeHandle: bigint): Promise<'CONNECTED' | 'ABORTED'>;
  abortPendingConnection(pipeHandle: bigint): void;
  verifyPipeClient(pipeHandle: bigint): WindowsPeerVerification;
  openNamedPipeClient(pipeName: string): bigint;
  openTransportHandle(handle: bigint): { fd: number };
  closePipeHandle(handle: bigint): void;
  securityDescriptorToSddl(sd: Buffer): string | undefined;
}

export interface WindowsPipeServerTransportOptions {
  /**
   * Full pipe namespace path, e.g. `\\.\pipe\xdownload-core-<installId>`.
   * The first instance claims the name exclusively (fail closed on collision).
   */
  readonly pipeName: string;
  readonly limits?: SeamMessageLimits;
  /** Test seam: defaults to the real koffi-backed bridge (win32 only). */
  readonly bridge?: PipeIpcBridge;
  /** Test seam: defaults to process.platform; anything non-win32 refuses. */
  readonly platform?: string;
  /** Admission additionally requires the Core logon session (default: user scope only). */
  readonly requireSameLogonSession?: boolean;
}

/** Raised when the pipe transport is constructed on an unsupported platform. */
export class WindowsPipeTransportUnsupportedError extends WindowsIpcUnsupportedError {
  constructor(platform: string) {
    super(
      `Windows named-pipe seam transport requires win32; refusing on '${platform}' (fail closed, no fallback transport)`,
    );
    this.name = 'WindowsPipeTransportUnsupportedError';
  }
}

export interface WindowsPipeServerTransport extends SeamServerTransport {
  /** Core-owned verified sessions, one per admitted connection. */
  readonly verifiedSessions: VerifiedPeerSessionRegistry;
  /** SDDL rendering of the listener DACL (observation; undefined before start). */
  readonly listenerSecuritySddl: string | undefined;
  /** Reason the most recent connection was refused admission (observation). */
  readonly lastAdmissionFailure: string | undefined;
}

interface PipeWrapConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (nonBlocking: number): any;
}

let cachedPipeWrap: PipeWrapConstructor | undefined;

/**
 * Resolve Node's internal pipe handle class once. Engines are pinned
 * (`engines.node` = 24.21.0); on any engine where the internal binding is
 * unavailable this throws and callers fail closed — never a silent fallback.
 */
function resolvePipeWrap(): PipeWrapConstructor {
  if (cachedPipeWrap !== undefined) {
    return cachedPipeWrap;
  }
  const binder = (process as unknown as { binding?: (name: string) => unknown }).binding;
  if (typeof binder !== 'function') {
    throw new WindowsIpcUnsupportedError('process.binding is unavailable on this engine');
  }
  const pipeWrap = binder('pipe_wrap') as { Pipe?: PipeWrapConstructor };
  if (pipeWrap.Pipe === undefined) {
    throw new WindowsIpcUnsupportedError('pipe_wrap.Pipe is unavailable on this engine');
  }
  cachedPipeWrap = pipeWrap.Pipe;
  return cachedPipeWrap;
}

/** Adopt a verified raw pipe HANDLE into the Node event loop as a socket. */
function adoptPipeHandle(bridge: PipeIpcBridge, handle: bigint): net.Socket {
  const { fd } = bridge.openTransportHandle(handle);
  const Pipe = resolvePipeWrap();
  const pipe = new Pipe(1);
  const rc = pipe.open(fd);
  if (rc !== 0) {
    throw new WindowsIpcUnsupportedError(
      `uv_pipe_open failed (${String(rc)}); refusing to serve an unverifiable handle`,
    );
  }
  // net.Socket's constructor officially accepts `{ handle }` for stream
  // adoption (same path child_process/cluster use); the public TS type omits
  // it, hence the narrow cast.
  return new net.Socket({ handle: pipe } as unknown as net.SocketConstructorOpts);
}

export function resolveWindowsPipeBridge(injected: PipeIpcBridge | undefined): PipeIpcBridge {
  if (injected !== undefined) {
    return injected;
  }
  const loaded: RealBridge | null = WindowsIpcBridge.tryLoad();
  if (loaded === null) {
    throw new WindowsIpcUnsupportedError(
      'the Windows IPC native bridge (koffi prebuilt) is unavailable on this build; refusing to start the pipe transport',
    );
  }
  return loaded;
}

export function createWindowsPipeServerTransport(
  options: WindowsPipeServerTransportOptions,
): WindowsPipeServerTransport {
  const platform = options.platform ?? process.platform;
  if (!isWindowsIpcPlatform(platform)) {
    throw new WindowsPipeTransportUnsupportedError(platform);
  }
  const bridge = resolveWindowsPipeBridge(options.bridge);
  const limits = options.limits ?? SEAM_MESSAGE_LIMITS;
  const registry = createVerifiedPeerSessionRegistry();
  let listenerSddl: string | undefined;
  let admissionFailure: string | undefined;
  let running = false;
  let nextConnectionId = 0;
  const openSockets = new Set<net.Socket>();
  const pendingInstances = new Set<bigint>();
  let loopFinished: Promise<void> = Promise.resolve();

  function refuseAdmission(handle: bigint, reason: string): void {
    admissionFailure = reason;
    bridge.closePipeHandle(handle);
  }

  /** Verify + admit one connected pipe instance; destroy on any doubt. */
  function admit(handle: bigint, self: WindowsSelfIdentity, handler: SeamConnectionHandler): void {
    const verification = bridge.verifyPipeClient(handle);
    if (!verification.ok) {
      refuseAdmission(handle, `peer verification failed: ${verification.reason}`);
      return;
    }
    const facts = verification.facts;
    const sameUser = self.sameUser(facts.userSid);
    const sameSession = self.sameLogonSession(facts.logonSessionId);
    if (!sameUser || (options.requireSameLogonSession === true && !sameSession)) {
      refuseAdmission(
        handle,
        `verified peer is outside the admitted OS scope (sameUser=${String(sameUser)}, sameLogonSession=${String(sameSession)})`,
      );
      return;
    }
    let socket: net.Socket;
    try {
      socket = adoptPipeHandle(bridge, handle);
    } catch (error) {
      refuseAdmission(handle, `handle adoption failed: ${String(error)}`);
      return;
    }
    const connectionId = `winpipe-${String(nextConnectionId)}`;
    nextConnectionId += 1;
    const session: OsVerifiedPeerSession = {
      transportKind: WINDOWS_PIPE_TRANSPORT_KIND,
      connectionId,
      userSid: facts.userSid,
      userName: facts.userName,
      clientPid: facts.clientPid,
      logonSessionId: facts.logonSessionId,
      sameUserAsCore: sameUser,
      sameLogonSessionAsCore: sameSession,
      verifiedAt: new Date().toISOString(),
    };
    registry.record(session);
    openSockets.add(socket);
    const accumulator = new FrameAccumulator(limits.maxFrameBytes);
    const connection: SeamServerConnection = {
      id: connectionId,
      remoteAddress: `named-pipe:${facts.userSid}`,
      send(frame) {
        if (!socket.destroyed) {
          const bodyBytes = Buffer.byteLength(frame, 'utf8');
          const out = Buffer.alloc(4 + bodyBytes);
          out.writeUInt32BE(bodyBytes, 0);
          out.write(frame, 4, 'utf8');
          socket.write(out);
        }
      },
      close() {
        socket.destroy();
      },
    };
    socket.on('data', (chunk: Buffer) => {
      let frames: string[];
      try {
        frames = accumulator.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        handler.onFrame(connection, frame);
      }
    });
    socket.on('error', () => {
      socket.destroy();
    });
    socket.on('close', () => {
      openSockets.delete(socket);
      registry.forget(connectionId);
      handler.onConnectionEnded(connection);
    });
  }

  async function acceptLoop(
    self: WindowsSelfIdentity,
    handler: SeamConnectionHandler,
    securityDescriptor: Buffer,
  ): Promise<void> {
    let firstInstance = true;
    while (running) {
      let handle: bigint;
      try {
        handle = bridge.createPipeInstance(options.pipeName, securityDescriptor, firstInstance);
      } catch (error) {
        if (running) {
          admissionFailure = `pipe instance creation failed: ${String(error)}`;
          running = false;
        }
        return;
      }
      firstInstance = false;
      pendingInstances.add(handle);
      let result: 'CONNECTED' | 'ABORTED';
      try {
        result = await bridge.waitForClientConnection(handle);
      } catch (error) {
        pendingInstances.delete(handle);
        if (running) {
          admissionFailure = `pipe accept failed: ${String(error)}`;
          running = false;
        }
        bridge.closePipeHandle(handle);
        return;
      }
      pendingInstances.delete(handle);
      if (!running || result === 'ABORTED') {
        bridge.closePipeHandle(handle);
        return;
      }
      // Admit synchronously; the loop's next iteration immediately queues the
      // next listening instance, keeping the backlog window minimal.
      admit(handle, self, handler);
    }
  }

  return {
    verifiedSessions: registry,
    get listenerSecuritySddl() {
      return listenerSddl;
    },
    get lastAdmissionFailure() {
      return admissionFailure;
    },
    start(handler: SeamConnectionHandler): Promise<SeamListenTarget> {
      try {
        const self = bridge.selfIdentity();
        const securityDescriptor = bridge.buildProtectedSecurityDescriptor();
        listenerSddl = bridge.securityDescriptorToSddl(securityDescriptor);
        running = true;
        loopFinished = acceptLoop(self, handler, securityDescriptor);
      } catch (error) {
        // Any start failure is a fail-closed condition: typed, no fallback.
        running = false;
        throw error instanceof WindowsIpcUnsupportedError
          ? error
          : new WindowsIpcUnsupportedError(
              `windows pipe transport failed to start: ${String(error)}`,
            );
      }
      return Promise.resolve({
        host: WINDOWS_PIPE_TRANSPORT_KIND,
        port: 0,
        pipeName: options.pipeName,
      });
    },
    async stop(): Promise<void> {
      running = false;
      for (const handle of [...pendingInstances]) {
        bridge.abortPendingConnection(handle);
      }
      for (const socket of [...openSockets]) {
        socket.destroy();
      }
      openSockets.clear();
      await loopFinished;
    },
  };
}

export interface WindowsPipeClientTransportOptions {
  /** Test seam: defaults to the real koffi-backed bridge (win32 only). */
  readonly bridge?: PipeIpcBridge;
  /** Test seam: defaults to process.platform; anything non-win32 refuses. */
  readonly platform?: string;
}

/** Framed client transport over the OS-verified named pipe (SQOS impersonation). */
export function createWindowsPipeClientTransport(
  options: WindowsPipeClientTransportOptions = {},
): SeamClientTransport {
  const platform = options.platform ?? process.platform;
  if (!isWindowsIpcPlatform(platform)) {
    throw new WindowsPipeTransportUnsupportedError(platform);
  }
  const bridge = resolveWindowsPipeBridge(options.bridge);
  return {
    connect(target: SeamListenTarget): Promise<SeamClientConnection> {
      return new Promise((resolve, reject) => {
        if (target.pipeName === undefined) {
          reject(new Error('windows pipe client requires a pipeName listen target'));
          return;
        }
        let socket: net.Socket;
        try {
          const handle = bridge.openNamedPipeClient(target.pipeName);
          socket = adoptPipeHandle(bridge, handle);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const frameHandlers: Array<(frame: string) => void> = [];
        const endHandlers: Array<() => void> = [];
        const accumulator = new FrameAccumulator();
        const connection: SeamClientConnection = {
          onFrame(handler) {
            frameHandlers.push(handler);
          },
          onEnded(handler) {
            endHandlers.push(handler);
          },
          send(frame) {
            if (!socket.destroyed) {
              const bodyBytes = Buffer.byteLength(frame, 'utf8');
              const out = Buffer.alloc(4 + bodyBytes);
              out.writeUInt32BE(bodyBytes, 0);
              out.write(frame, 4, 'utf8');
              socket.write(out);
            }
          },
          close() {
            return new Promise((resolveClose) => {
              if (socket.destroyed) {
                resolveClose();
                return;
              }
              socket.once('close', () => resolveClose());
              socket.end();
            });
          },
        };
        socket.on('data', (chunk: Buffer) => {
          let frames: string[];
          try {
            frames = accumulator.push(chunk);
          } catch {
            socket.destroy();
            return;
          }
          for (const frame of frames) {
            for (const handler of frameHandlers) {
              handler(frame);
            }
          }
        });
        socket.on('error', () => {
          socket.destroy();
        });
        socket.on('close', () => {
          for (const handler of endHandlers) {
            handler();
          }
        });
        resolve(connection);
      });
    },
  };
}
