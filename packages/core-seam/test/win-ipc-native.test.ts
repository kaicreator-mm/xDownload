/**
 * #101 S3-WIN-IPC-001 — native bridge lifecycle tests (real Windows OS path).
 *
 * These tests drive the koffi bridge directly to prove the native resource
 * contracts the transport-level tests cannot isolate:
 *
 * - P1-01: the stable OVERLAPPED allocation survives pending kernel I/O,
 *   cancellation, and pre-connected (ERROR_PIPE_CONNECTED) completions, and
 *   is released exactly once per accept;
 * - P1-03: raw HANDLE → CRT fd → libuv ownership — a failed adoption closes
 *   exactly the current owner (fd after consumption, raw HANDLE before);
 * - P1-02: the listening instance is OS-created with
 *   PIPE_REJECT_REMOTE_CLIENTS (remote clients denied by the kernel, not by
 *   userland admission alone);
 * - P2-03: no token/event/native-handle growth across repeated bridges
 *   operations (OS handle-count evidence), plus GC stress over the ACL
 *   builder whose TokenUser buffer must stay rooted (P1-05 closure).
 *
 * Cross-user literal negatives remain NOT_RUN on this host (no second user
 * credential); the injected-bridge portable tests + protected DACL cover the
 * admission decision by construction.
 */

import { createRequire } from 'node:module';
import {
  hasExactExpectedUserAce,
  resolveActualMachineAdministratorSid,
} from './sddl-local-admin-oracle.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WindowsIpcBridge,
  adoptPipeHandle,
  type PipeIpcBridge,
  type WindowsPipeAccept,
} from './helpers.ts';

const describeWin32 = process.platform === 'win32' ? describe : describe.skip;

const req = createRequire(import.meta.url);
type KoffiModule = {
  load(path: string): unknown;
  func(proto: string): (...args: unknown[]) => unknown;
  as(value: unknown, type: string): unknown;
  alloc(type: string, count?: number): unknown;
  free(ptr: unknown): void;
};
interface Kernel32Lib {
  func(proto: string): (...args: unknown[]) => unknown;
}

let pipeSeq = 0;
const PIPE_ROOT = '\\\\.\\pipe\\xdownload-native-test-';

function uniquePipeName(): string {
  return `${PIPE_ROOT}${String(process.pid)}-${String(++pipeSeq)}-${String(Date.now())}`;
}

/** Recording delegating wrapper: observe which owner-cleanup API was used. */
function recordingWrapper(real: WindowsIpcBridge): PipeIpcBridge & {
  readonly fdCloses: number[];
  readonly handleCloses: bigint[];
} {
  const fdCloses: number[] = [];
  const handleCloses: bigint[] = [];
  return {
    selfIdentity: () => real.selfIdentity(),
    buildProtectedSecurityDescriptor: () => real.buildProtectedSecurityDescriptor(),
    createPipeInstance: (name, sd, first) => real.createPipeInstance(name, sd, first),
    beginPipeAccept: (handle) => real.beginPipeAccept(handle),
    verifyPipeClient: (handle) => real.verifyPipeClient(handle),
    openNamedPipeClient: (name) => real.openNamedPipeClient(name),
    openTransportHandle: (handle) => real.openTransportHandle(handle),
    closeFileDescriptor: (fd) => {
      fdCloses.push(fd);
      real.closeFileDescriptor(fd);
    },
    closePipeHandle: (handle) => {
      handleCloses.push(handle);
      real.closePipeHandle(handle);
    },
    securityDescriptorToSddl: (sd) => real.securityDescriptorToSddl(sd),
    fdCloses,
    handleCloses,
  };
}

describeWin32('native bridge accept lifecycle (real OS path)', () => {
  it('completes a PRE-CONNECTED client deterministically (ERROR_PIPE_CONNECTED path)', async () => {
    const bridge = WindowsIpcBridge.tryLoad();
    expect(bridge).not.toBeNull();
    const real = bridge as WindowsIpcBridge;
    const self = real.selfIdentity();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    // The client connects BEFORE the accept is queued — the kernel reports
    // ERROR_PIPE_CONNECTED and the accept must resolve CONNECTED without any
    // completion ever arriving for the OVERLAPPED (no completable I/O).
    const client = real.openNamedPipeClient(name);
    let accept: WindowsPipeAccept | undefined;
    try {
      accept = real.beginPipeAccept(server);
      await expect(accept.result).resolves.toBe('CONNECTED');
      const verification = real.verifyPipeClient(server);
      expect(verification.ok).toBe(true);
      if (verification.ok) {
        expect(verification.facts.userSid).toBe(self.userSid);
        expect(verification.facts.logonSessionId).toBe(self.logonSessionId);
        expect(verification.facts.clientPid).toBe(process.pid);
      }
    } finally {
      accept?.dispose();
      real.closePipeHandle(client);
      real.closePipeHandle(server);
    }
  });

  it('drains a pending accept when the client arrives afterwards', async () => {
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    let client: bigint | null = null;
    let accept: WindowsPipeAccept | undefined;
    try {
      accept = real.beginPipeAccept(server);
      // Client arrives while the accept is parked in kernel I/O (997 path).
      client = real.openNamedPipeClient(name);
      await expect(accept.result).resolves.toBe('CONNECTED');
      expect(real.verifyPipeClient(server).ok).toBe(true);
    } finally {
      accept?.dispose();
      if (client !== null) {
        real.closePipeHandle(client);
      }
      real.closePipeHandle(server);
    }
  });

  it('aborts a pending accept on dispose and leaves the instance reusable', async () => {
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    let client: bigint | null = null;
    try {
      const first = real.beginPipeAccept(server);
      first.dispose();
      await expect(first.result).resolves.toBe('ABORTED');
      first.dispose(); // idempotent
      // The same instance accepts again after an aborted wait.
      const second: WindowsPipeAccept = real.beginPipeAccept(server);
      client = real.openNamedPipeClient(name);
      await expect(second.result).resolves.toBe('CONNECTED');
      second.dispose();
    } finally {
      if (client !== null) {
        real.closePipeHandle(client);
      }
      real.closePipeHandle(server);
    }
  });

  it('releases accept native state with zero OS handle growth across rapid mixed cycles', async () => {
    const koffi = req('koffi') as KoffiModule;
    const kernel32 = koffi.load('kernel32.dll') as Kernel32Lib;
    const getCurrentProcess = kernel32.func('void * __stdcall GetCurrentProcess()');
    const getProcessHandleCount = kernel32.func(
      'int __stdcall GetProcessHandleCount(void *proc, void *count)',
    );
    const handleCount = (): number => {
      const out = Buffer.alloc(4);
      if (!getProcessHandleCount(getCurrentProcess(), koffi.as(out, 'void *'))) {
        throw new Error('GetProcessHandleCount failed');
      }
      return out.readUInt32LE(0);
    };
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const cycles = 40;
    // Warmup: event-loop and CRT internals allocate lazily on first cycles.
    for (let i = 0; i < 5; i++) {
      const name = uniquePipeName();
      const server = real.createPipeInstance(name, sd, i === 0);
      const client = real.openNamedPipeClient(name);
      real.closePipeHandle(client);
      real.closePipeHandle(server);
    }
    const before = handleCount();
    for (let i = 0; i < cycles; i++) {
      const name = uniquePipeName();
      const server = real.createPipeInstance(name, sd, false);
      let client: bigint;
      let accept: WindowsPipeAccept;
      if (i % 2 === 0) {
        // Pre-connected (ERROR_PIPE_CONNECTED) path.
        client = real.openNamedPipeClient(name);
        accept = real.beginPipeAccept(server);
      } else {
        // Pending → connect (ERROR_IO_PENDING drained) path.
        accept = real.beginPipeAccept(server);
        client = real.openNamedPipeClient(name);
      }
      await expect(accept.result).resolves.toBe('CONNECTED');
      expect(real.verifyPipeClient(server).ok).toBe(true);
      accept.dispose();
      real.closePipeHandle(client);
      real.closePipeHandle(server);
    }
    const growth = handleCount() - before;
    expect(growth).toBeLessThanOrEqual(8);
  });

  it('creates every listening instance with PIPE_REJECT_REMOTE_CLIENTS (kernel-level)', () => {
    const koffi = req('koffi') as KoffiModule;
    const kernel32 = koffi.load('kernel32.dll') as Kernel32Lib;
    const getNamedPipeInfo = kernel32.func(
      'int __stdcall GetNamedPipeInfo(void *h, void *flags, void *outSize, void *inSize, void *maxInst)',
    );
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    try {
      const flags = Buffer.alloc(4);
      const ok = getNamedPipeInfo(server, koffi.as(flags, 'void *'), null, null, null) as number;
      expect(ok).toBe(1);
      // 0x8 = PIPE_REJECT_REMOTE_CLIENTS: the OS refuses non-local clients
      // before any userland admission code runs (P1-02 OS proof).
      expect(flags.readUInt32LE(0) & 0x8).toBe(0x8);
    } finally {
      real.closePipeHandle(server);
    }
  });
});

describeWin32('native bridge token/ACL hygiene (real OS path)', () => {
  it('keeps OS handle count flat across repeated token/SD builds (P2-03)', () => {
    const koffi = req('koffi') as KoffiModule;
    const kernel32 = koffi.load('kernel32.dll') as Kernel32Lib;
    const getCurrentProcess = kernel32.func('void * __stdcall GetCurrentProcess()');
    const getProcessHandleCount = kernel32.func(
      'int __stdcall GetProcessHandleCount(void *proc, void *count)',
    );
    const handleCount = (): number => {
      const out = Buffer.alloc(4);
      if (!getProcessHandleCount(getCurrentProcess(), koffi.as(out, 'void *'))) {
        throw new Error('GetProcessHandleCount failed');
      }
      return out.readUInt32LE(0);
    };
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    for (let i = 0; i < 10; i++) {
      void real.selfIdentity();
      void real.buildProtectedSecurityDescriptor();
    }
    const before = handleCount();
    const cycles = 120;
    const gc = (globalThis as { gc?: () => void }).gc;
    for (let i = 0; i < cycles; i++) {
      const self = real.selfIdentity();
      expect(self.userSid).toMatch(/^S-1-5-/);
      const sd = real.buildProtectedSecurityDescriptor();
      expect(real.securityDescriptorToSddl(sd)).toContain('(A;;GA;;;SY)');
      gc?.();
    }
    const growth = handleCount() - before;
    expect(growth).toBeLessThanOrEqual(8);
  });

  it('keeps the ACL DACL correct under GC stress with the TokenUser buffer rooted (P1-05 closure)', () => {
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const self = real.selfIdentity();
    const gc = (globalThis as { gc?: () => void }).gc;
    const cycles = gc ? 300 : 60;
    const actualMachineAdministratorSid = resolveActualMachineAdministratorSid();
    for (let i = 0; i < cycles; i++) {
      const sd = real.buildProtectedSecurityDescriptor();
      const sddl = real.securityDescriptorToSddl(sd);
      expect(sddl).toContain('(A;;GA;;;SY)');
      expect(
        hasExactExpectedUserAce(sddl ?? '', self.userSid, actualMachineAdministratorSid),
      ).toBe(true);
      expect(sddl).not.toMatch(/\(A;;GA;;;(WD|AN|AU|BU)\)/);
      // A freshly built descriptor must produce a usable pipe instance.
      const name = uniquePipeName();
      const server = real.createPipeInstance(name, sd, i === 0);
      real.closePipeHandle(server);
      gc?.();
    }
  });
});

describeWin32('handle→fd→libuv ownership (real OS path, P1-03)', () => {
  it('closes exactly the raw HANDLE when adoption fails before the fd exists', () => {
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    const client = real.openNamedPipeClient(name);
    const rec = recordingWrapper(real);
    const broken: PipeIpcBridge = {
      ...rec,
      openTransportHandle: () => {
        throw new Error('uv_open_osfhandle failed');
      },
    };
    expect(() => adoptPipeHandle(broken, client)).toThrow('uv_open_osfhandle failed');
    // Raw handle unconsumed → adoptPipeHandle is the SOLE cleanup owner and
    // closes it exactly once itself; neither the transport caller nor this
    // test may CloseHandle it again (that would be a double-close).
    expect(rec.fdCloses).toHaveLength(0);
    expect(rec.handleCloses).toEqual([client]);
    real.closePipeHandle(server);
  });

  it('closes exactly the fd when uv_pipe_open fails after consumption', () => {
    const koffi = req('koffi') as KoffiModule;
    const kernel32 = koffi.load('kernel32.dll') as Kernel32Lib;
    const createFileW = kernel32.func(
      'void * __stdcall CreateFileW(void *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)',
    );
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    // A REAL, valid, non-pipe OS handle: uv_open_osfhandle succeeds (the raw
    // handle is consumed into a CRT fd) but uv_pipe_open deterministically
    // rejects it — the adoption failure must close the FD, never CloseHandle
    // the already-consumed raw handle.
    const tmpFile = path.join(os.tmpdir(), `xdownload-adopt-fail-${String(process.pid)}.txt`);
    fs.writeFileSync(tmpFile, 'adopt-failure-fixture\n');
    const nameBuf = Buffer.concat([Buffer.from(tmpFile, 'utf16le'), Buffer.from([0, 0])]);
    const GENERIC_READ = 0x80000000;
    const GENERIC_WRITE = 0x40000000;
    const OPEN_EXISTING = 3;
    const FILE_FLAG_OVERLAPPED = 0x40000000;
    const fileHandle = createFileW(
      koffi.as(nameBuf, 'void *'),
      GENERIC_READ | GENERIC_WRITE,
      0,
      null,
      OPEN_EXISTING,
      FILE_FLAG_OVERLAPPED,
      null,
    ) as bigint;
    expect(fileHandle).not.toBe(18446744073709551615n);
    const rec = recordingWrapper(real);
    try {
      expect(() => adoptPipeHandle(rec, fileHandle)).toThrow();
      expect(rec.fdCloses).toHaveLength(1);
      expect(rec.handleCloses).toHaveLength(0);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('releases the fd exactly once: second close is tolerated EBADF, raw handle is dead', () => {
    const real = WindowsIpcBridge.tryLoad() as WindowsIpcBridge;
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, true);
    const client = real.openNamedPipeClient(name);
    try {
      const { fd } = real.openTransportHandle(client);
      real.closeFileDescriptor(fd);
      // UV_EBADF (nothing left to release) must not throw.
      expect(() => real.closeFileDescriptor(fd)).not.toThrow();
      // The raw HANDLE died with the fd: verification must fail closed
      // (GetNamedPipeClientProcessId on a dead handle), never crash.
      const verification = real.verifyPipeClient(client);
      expect(verification.ok).toBe(false);
    } finally {
      real.closePipeHandle(server);
    }
  });
});
