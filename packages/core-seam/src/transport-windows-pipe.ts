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
  type VerifiedPeerSessionPort,
} from './verified-session.ts';
import {
  WindowsIpcBridge,
  WindowsIpcUnsupportedError,
  WINDOWS_PIPE_TRANSPORT_KIND,
  isWindowsIpcPlatform,
  type WindowsIpcBridge as RealBridge,
  type WindowsPeerVerification,
  type WindowsPipeAccept,
  type WindowsSelfIdentity,
} from './win-ipc.ts';

/** Narrow bridge surface the transport depends on (test-injectable). */
export interface PipeIpcBridge {
  selfIdentity(): WindowsSelfIdentity;
  buildProtectedSecurityDescriptor(): Buffer;
  createPipeInstance(pipeName: string, securityDescriptor: Buffer, firstInstance: boolean): bigint;
  /** Queue an overlapped accept; the returned accept owns the native I/O state. */
  beginPipeAccept(pipeHandle: bigint): WindowsPipeAccept;
  verifyPipeClient(pipeHandle: bigint): WindowsPeerVerification;
  openNamedPipeClient(pipeName: string): bigint;
  openTransportHandle(handle: bigint): { fd: number };
  closeFileDescriptor(fd: number): void;
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
  /** Admission always requires the Core logon session; false is rejected at construction. */
  readonly requireSameLogonSession?: boolean;
  /**
   * Process-level fail-stop invoked when the OS cannot restore the Core
   * thread identity after client impersonation (RevertToSelf failure, P1-04):
   * the process must shut down, never continue in an unknown security
   * context. Default: write the reason to stderr and exit(70).
   */
  readonly processFailStop?: (reason: string) => never;
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
  readonly verifiedSessions: VerifiedPeerSessionPort;
  /** SDDL rendering of the listener DACL (observation; undefined before start). */
  readonly listenerSecuritySddl: string | undefined;
  /** Reason the most recent connection was refused admission (observation). */
  readonly lastAdmissionFailure: string | undefined;
  /**
   * Post-start fatal condition (accept loop can no longer run: instance
   * creation/accept failure or a RevertToSelf fail-stop). Undefined while the
   * transport is healthy. A started transport with a fatal state is DOWN and
   * must be restarted by its owner.
   */
  readonly fatalState: string | undefined;
  /** True between a successful start() and stop()/fatal state. */
  readonly isActive: boolean;
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

/**
 * Adopt a verified raw pipe HANDLE into the Node event loop as a socket.
 *
 * Ownership stages (P1-03): raw HANDLE → CRT fd (uv_open_osfhandle; the OS
 * handle is CONSUMED at that instant) → libuv pipe → net.Socket. Every
 * failure closes exactly the current owner via the matching API:
 * - a throw before `openTransportHandle` succeeds leaves the raw HANDLE
 *   unconsumed — the CALLER closes it with `closePipeHandle`;
 * - a throw after the fd exists closes the fd (`closeFileDescriptor`) and
 *   never touches the raw HANDLE again (that would be a double-close).
 */
export function adoptPipeHandle(bridge: PipeIpcBridge, handle: bigint): net.Socket {
  const { fd } = bridge.openTransportHandle(handle);
  try {
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
  } catch (error) {
    // The fd now owns the raw HANDLE: close the fd, not the handle. A failed
    // fd close must not mask the original adoption error.
    let closeFailure: unknown;
    try {
      bridge.closeFileDescriptor(fd);
    } catch (closeError) {
      closeFailure = closeError;
    }
    if (closeFailure !== undefined) {
      throw new WindowsIpcUnsupportedError(
        `pipe handle adoption failed (${String(error)}) and its fd cleanup also failed (${String(closeFailure)})`,
        { cause: error },
      );
    }
    throw error;
  }
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

/**
 * Default P1-04 fail-stop: the process must not continue executing in an
 * unknown thread security context (RevertToSelf failed), so it terminates
 * with a distinctive non-zero code after flushing the reason to stderr.
 */
function defaultProcessFailStop(reason: string): never {
  process.stderr.write(`xdownload core-seam FAIL-STOP: ${reason}\n`);
  process.exit(70);
}

export function createWindowsPipeServerTransport(
  options: WindowsPipeServerTransportOptions,
): WindowsPipeServerTransport {
  const platform = options.platform ?? process.platform;
  if (!isWindowsIpcPlatform(platform)) {
    throw new WindowsPipeTransportUnsupportedError(platform);
  }
  if (options.requireSameLogonSession === false) {
    throw new WindowsIpcUnsupportedError(
      'Windows Core IPC requires same-logon-session admission; opting out is forbidden',
    );
  }
  const bridge = resolveWindowsPipeBridge(options.bridge);
  const limits = options.limits ?? SEAM_MESSAGE_LIMITS;
  const registry = createVerifiedPeerSessionRegistry();
  // Never expose record/forget through the published transport capability.
  const readOnlySessions: VerifiedPeerSessionPort = Object.freeze({
    verifiedSessionFor: (id: string) => registry.verifiedSessionFor(id),
    get size() {
      return registry.size;
    },
  });
  const processFailStop = options.processFailStop ?? defaultProcessFailStop;
  let listenerSddl: string | undefined;
  let admissionFailure: string | undefined;
  let fatal: string | undefined;
  let running = false;
  let nextConnectionId = 0;
  const openSockets = new Set<net.Socket>();
  const pendingAccepts = new Set<WindowsPipeAccept>();
  let loopFinished: Promise<void> = Promise.resolve();

  function refuseAdmission(handle: bigint, reason: string): void {
    admissionFailure = reason;
    bridge.closePipeHandle(handle);
  }

  /**
   * Post-start fatal state: the accept loop cannot continue. Stops the
   * listener, tears down every admitted connection and forgets their
   * sessions — a Core IPC surface that cannot accept is DOWN, not degraded.
   */
  function enterFatalState(reason: string): void {
    if (running) {
      running = false;
      fatal = reason;
      for (const pending of [...pendingAccepts]) {
        pending.dispose();
      }
      for (const socket of [...openSockets]) {
        socket.destroy();
      }
      openSockets.clear();
    }
  }

  /** Verify + admit one connected pipe instance; destroy on any doubt. */
  function admit(handle: bigint, self: WindowsSelfIdentity, handler: SeamConnectionHandler): void {
    const verification = bridge.verifyPipeClient(handle);
    if (!verification.ok) {
      if (verification.revertFailed === true) {
        // P1-04: the thread may still execute in the CLIENT's security
        // context. Denying one connection is not enough — the whole process
        // must fail-stop (also tears the listener/sockets down, then exits).
        enterFatalState(`RevertToSelf fail-stop: ${verification.reason}`);
        processFailStop(verification.reason);
        return; // unreachable when failStop exits; keeps control flow honest
      }
      refuseAdmission(handle, `peer verification failed: ${verification.reason}`);
      return;
    }
    const facts = verification.facts;
    const sameUser = self.sameUser(facts.userSid);
    const sameSession = self.sameLogonSession(facts.logonSessionId);
    if (!sameUser || !sameSession) {
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
      // adoptPipeHandle guarantees the raw HANDLE is unconsumed when it
      // throws — closing it here is the correct and ONLY cleanup.
      refuseAdmission(handle, `handle adoption failed: ${String(error)}`);
      return;
    }
    const connectionId = `winpipe-${String(nextConnectionId)}`;
    nextConnectionId += 1;
    const session: OsVerifiedPeerSession = Object.freeze({
      transportKind: WINDOWS_PIPE_TRANSPORT_KIND,
      connectionId,
      userSid: facts.userSid,
      userName: facts.userName,
      clientPid: facts.clientPid,
      logonSessionId: facts.logonSessionId,
      sameUserAsCore: sameUser,
      sameLogonSessionAsCore: sameSession,
      verifiedAt: new Date().toISOString(),
    });
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

  /**
   * Accept loop over one PRE-CREATED listening instance (`firstHandle` — the
   * first bind failure surfaced as a rejected start, P2-02). Never rejects:
   * post-start failures publish the fatal state instead of throwing past the
   * loop, so `stop()` can always await it.
   *
   * Instance-handle discipline: the loop owns the current instance until
   * `admit()` consumes it (ownership moves to the adopted socket) or an exit
   * path closes it — exactly once, tracked by `ownsHandle`.
   */
  async function acceptLoop(
    self: WindowsSelfIdentity,
    handler: SeamConnectionHandler,
    securityDescriptor: Buffer,
    firstHandle: bigint,
  ): Promise<void> {
    let handle: bigint = firstHandle;
    let ownsHandle = true;
    try {
      while (running) {
        const pending = bridge.beginPipeAccept(handle);
        pendingAccepts.add(pending);
        let result: 'CONNECTED' | 'ABORTED';
        try {
          result = await pending.result;
        } catch (error) {
          pendingAccepts.delete(pending);
          enterFatalState(`pipe accept failed: ${String(error)}`);
          bridge.closePipeHandle(handle);
          ownsHandle = false;
          return;
        }
        pendingAccepts.delete(pending);
        // The accept state is fully drained the moment the result settles —
        // dispose BEFORE consuming the connection so every exit path below
        // (including fatal ones) leaves nothing native behind.
        pending.dispose();
        if (!running || result === 'ABORTED') {
          bridge.closePipeHandle(handle);
          ownsHandle = false;
          return;
        }
        // Admit synchronously; the loop's next iteration immediately queues
        // the next listening instance, keeping the backlog window minimal.
        // admit either consumes the handle (adoption) or closes it (refusal):
        // the loop no longer owns it on ANY exit from this call.
        ownsHandle = false;
        admit(handle, self, handler);
        try {
          handle = bridge.createPipeInstance(options.pipeName, securityDescriptor, false);
        } catch (error) {
          enterFatalState(`pipe instance creation failed: ${String(error)}`);
          return;
        }
        ownsHandle = true;
      }
    } catch (error) {
      enterFatalState(`pipe accept loop failed: ${String(error)}`);
    } finally {
      if (ownsHandle) {
        bridge.closePipeHandle(handle);
      }
    }
  }

  return {
    verifiedSessions: readOnlySessions,
    get listenerSecuritySddl() {
      return listenerSddl;
    },
    get lastAdmissionFailure() {
      return admissionFailure;
    },
    get fatalState() {
      return fatal;
    },
    get isActive() {
      return running;
    },
    start(handler: SeamConnectionHandler): Promise<SeamListenTarget> {
      try {
        if (running) {
          throw new Error('transport already started');
        }
        if (fatal !== undefined) {
          throw new Error(`transport is in fatal state: ${fatal}`);
        }
        const self = bridge.selfIdentity();
        const securityDescriptor = bridge.buildProtectedSecurityDescriptor();
        listenerSddl = bridge.securityDescriptorToSddl(securityDescriptor);
        // The FIRST listening instance is created synchronously so a bind
        // failure (name collision, ACL problem) rejects start() itself
        // instead of surfacing as a silent no-op listener (P2-02).
        const firstHandle = bridge.createPipeInstance(options.pipeName, securityDescriptor, true);
        running = true;
        loopFinished = acceptLoop(self, handler, securityDescriptor, firstHandle);
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
      for (const pending of [...pendingAccepts]) {
        pending.dispose();
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
          // adoptPipeHandle's contract: when it throws, the raw HANDLE was
          // never consumed — closing it here is the exact-owner cleanup.
          try {
            socket = adoptPipeHandle(bridge, handle);
          } catch (adoptionError) {
            bridge.closePipeHandle(handle);
            throw adoptionError;
          }
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
