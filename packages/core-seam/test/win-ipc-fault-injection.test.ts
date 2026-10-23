/**
 * #101 S3-WIN-IPC-001 — targeted R3 fault-injection drills (real Windows OS).
 *
 * Closes the remaining R2 exact-SHA evidence gaps on the repaired native
 * accept/ownership code paths, on this host at this HEAD:
 *
 * - OVERLAPPED lifetime: NULL CreateEventW result, abnormal (WAIT_FAILED)
 *   wait over REAL pending kernel I/O, the ERROR_IO_INCOMPLETE cancel+drain
 *   guard, and exactly-once release (one event close + one native free);
 * - fail-stop: a ConnectNamedPipe FFI throw, a wait-registration throw, and
 *   an unprovable I/O terminality each terminate the process (exit 70, via
 *   `win-ipc-failstop-driver.ts`) instead of returning an accept whose
 *   kernel-referenced native memory lifetime is unproven;
 * - ownership through the ACTUAL server/client callers: a post-fd adoption
 *   failure (real uv_pipe_open failure on a real file fd) closes exactly the
 *   fd and never CloseHandles the pipe handle (no double-close on a reused
 *   slot); a net.Socket construction failure unwinds only the libuv owner;
 * - peer TokenUser identity under forced GC stress (R2 P1-03 witness) plus
 *   first-accept startup rejection with the pipe name released.
 *
 * Literal cross-user / remote-machine / forced RevertToSelf negatives remain
 * NOT_RUN on this host (unchanged waivers; injected + DACL by construction).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  WindowsIpcBridge,
  createWindowsPipeClientTransport,
  createWindowsPipeServerTransport,
  type PipeIpcBridge,
} from './helpers.ts';

const describeWin32 = process.platform === 'win32' ? describe : describe.skip;

const req = createRequire(import.meta.url);
type KoffiLib = {
  func(proto: string): (...args: unknown[]) => unknown;
};
type KoffiModule = {
  load(path: string): KoffiLib;
  as(value: unknown, type: string): unknown;
};

let pipeSeq = 0;
const PIPE_ROOT = '\\\\.\\pipe\\xdownload-faultinj-test-';

function uniquePipeName(): string {
  return `${PIPE_ROOT}${String(process.pid)}-${String(++pipeSeq)}-${String(Date.now())}`;
}

function loadReal(): WindowsIpcBridge {
  const bridge = WindowsIpcBridge.tryLoad();
  expect(bridge).not.toBeNull();
  return bridge as WindowsIpcBridge;
}

/** The bridge's private FFI fields are runtime-swappable for fault injection. */
type RawFields = Record<string, unknown>;

function rawFields(bridge: WindowsIpcBridge): RawFields {
  return bridge as unknown as RawFields;
}

/** Recording delegating bridge: observe which owner-cleanup API ran. */
function recordingBridge(real: WindowsIpcBridge): PipeIpcBridge & {
  readonly fdCloses: number[];
  readonly handleCloses: bigint[];
  readonly createdInstances: bigint[];
  readonly clientHandles: bigint[];
} {
  const fdCloses: number[] = [];
  const handleCloses: bigint[] = [];
  const createdInstances: bigint[] = [];
  const clientHandles: bigint[] = [];
  return {
    selfIdentity: () => real.selfIdentity(),
    buildProtectedSecurityDescriptor: () => real.buildProtectedSecurityDescriptor(),
    securityDescriptorToSddl: (sd) => real.securityDescriptorToSddl(sd),
    createPipeInstance: (name, sd, first) => {
      const handle = real.createPipeInstance(name, sd, first);
      createdInstances.push(handle);
      return handle;
    },
    beginPipeAccept: (handle) => real.beginPipeAccept(handle),
    verifyPipeClient: (handle) => real.verifyPipeClient(handle),
    openNamedPipeClient: (name) => {
      const handle = real.openNamedPipeClient(name);
      clientHandles.push(handle);
      return handle;
    },
    openTransportHandle: (handle) => real.openTransportHandle(handle),
    closeFileDescriptor: (fd) => {
      fdCloses.push(fd);
      real.closeFileDescriptor(fd);
    },
    closePipeHandle: (handle) => {
      handleCloses.push(handle);
      real.closePipeHandle(handle);
    },
    fdCloses,
    handleCloses,
    createdInstances,
    clientHandles,
  };
}

let handleCountFn: (() => number) | undefined;

/** Live OS handle count for the test process (leak evidence). */
function handleCountOf(): number {
  if (handleCountFn === undefined) {
    const koffi = req('koffi') as KoffiModule & { as: KoffiModule['as'] };
    const kernel32 = koffi.load('kernel32.dll');
    const getCurrentProcess = kernel32.func('void * __stdcall GetCurrentProcess()');
    const getProcessHandleCount = kernel32.func(
      'int __stdcall GetProcessHandleCount(void *proc, void *count)',
    );
    handleCountFn = () => {
      const out = Buffer.alloc(4);
      if (!getProcessHandleCount(getCurrentProcess(), koffi.as(out, 'void *'))) {
        throw new Error('GetProcessHandleCount failed');
      }
      return out.readUInt32LE(0);
    };
  }
  return handleCountFn();
}

/** A REAL, valid, non-pipe file handle (overlapped) for adoption drills. */
function createOverlappedFileHandle(tmpPath: string): bigint {
  const koffi = req('koffi') as KoffiModule;
  const kernel32 = koffi.load('kernel32.dll');
  const createFileW = kernel32.func(
    'void * __stdcall CreateFileW(void *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)',
  );
  const nameBuf = Buffer.concat([Buffer.from(tmpPath, 'utf16le'), Buffer.from([0, 0])]);
  const handle = createFileW(
    koffi.as(nameBuf, 'void *'),
    0x80000000 | 0x40000000, // GENERIC_READ | GENERIC_WRITE
    0,
    null,
    3, // OPEN_EXISTING
    0x40000000, // FILE_FLAG_OVERLAPPED
    null,
  ) as bigint;
  if (handle === 18446744073709551615n) {
    throw new Error('CreateFileW fixture failed');
  }
  return handle;
}

async function runFailStopScenario(scenario: string): Promise<{ code: number; stderr: string }> {
  const driverPath = fileURLToPath(new URL('./win-ipc-failstop-driver.ts', import.meta.url));
  const child = spawn(process.execPath, ['--experimental-transform-types', driverPath, scenario], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const killer = setTimeout(() => {
    child.kill();
  }, 60_000);
  const code: number = await new Promise((resolve) => {
    child.on('exit', (exitCode) => {
      resolve(exitCode ?? -1);
    });
    child.on('error', (error) => {
      stderr += `spawn error: ${String(error)}`;
      resolve(-1);
    });
  });
  clearTimeout(killer);
  return { code, stderr };
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

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ReleaseCounters {
  frees: number;
  eventCloses: number;
  eventHandle: bigint;
  restore: () => void;
}

/**
 * Count the exactly-once release signals (native koffi free + event close)
 * around one accept drill.
 */
function installReleaseCounters(real: WindowsIpcBridge): ReleaseCounters {
  const raw = rawFields(real);
  const counters: ReleaseCounters = {
    frees: 0,
    eventCloses: 0,
    eventHandle: 0n,
    restore: () => undefined,
  };
  const koffi = raw.koffi as { free: (ptr: unknown) => void };
  const originalFree = koffi.free;
  const originalCreateEvent = raw.createEventW as (...args: unknown[]) => bigint;
  const originalCloseHandle = raw.closeHandle as (...args: unknown[]) => number;
  koffi.free = (ptr: unknown) => {
    counters.frees += 1;
    originalFree(ptr);
  };
  raw.createEventW = (...args: unknown[]) => {
    const handle = originalCreateEvent(...args);
    counters.eventHandle = handle;
    return handle;
  };
  raw.closeHandle = (...args: unknown[]) => {
    if (args[0] === counters.eventHandle) {
      counters.eventCloses += 1;
    }
    return originalCloseHandle(...args);
  };
  counters.restore = () => {
    koffi.free = originalFree;
    raw.createEventW = originalCreateEvent;
    raw.closeHandle = originalCloseHandle;
  };
  return counters;
}

/**
 * Release counters plus a wait swapped for an abnormal WAIT_FAILED
 * completion delivered via microtask (installed BEFORE the accept arms it).
 */
function installAbnormalWaitAndCounters(real: WindowsIpcBridge): ReleaseCounters {
  const counters = installReleaseCounters(real);
  const raw = rawFields(real);
  const originalWait = raw.waitForSingleObject;
  raw.waitForSingleObject = {
    async: (_handle: bigint, _ms: number, cb: (err: unknown, res: unknown) => void) => {
      queueMicrotask(() => cb(new Error('injected WAIT_FAILED'), 4294967295));
    },
  };
  const previousRestore = counters.restore;
  counters.restore = () => {
    raw.waitForSingleObject = originalWait;
    previousRestore();
  };
  return counters;
}

describeWin32('OVERLAPPED lifetime fault injection (real OS path)', () => {
  it('refuses a NULL CreateEventW result before any kernel I/O and keeps the instance usable', async () => {
    const real = loadReal();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    try {
      const raw = rawFields(real);
      const original = raw.createEventW;
      raw.createEventW = () => 0n; // documented CreateEventW failure: NULL, not INVALID_HANDLE_VALUE
      try {
        expect(() => real.beginPipeAccept(server)).toThrow(/CreateEventW failed/);
      } finally {
        raw.createEventW = original;
      }
      // Nothing was ever queued with the NULL event: the same instance must
      // still accept for real (no kernel I/O referenced broken state).
      const client = real.openNamedPipeClient(name);
      const accept = real.beginPipeAccept(server);
      await expect(accept.result).resolves.toBe('CONNECTED');
      accept.dispose();
      real.closePipeHandle(client);
    } finally {
      real.closePipeHandle(server);
    }
  });

  it('frees pre-kernel owned allocations exactly once when koffi alloc/encode throws', async () => {
    const real = loadReal();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    const counters = installReleaseCounters(real);
    const raw = rawFields(real);
    const koffi = raw.koffi as {
      alloc: (...args: unknown[]) => unknown;
      encode: (...args: unknown[]) => void;
    };
    const originalAlloc = koffi.alloc;
    const originalEncode = koffi.encode;
    try {
      // alloc throws before anything is owned: only the event is closed once.
      koffi.alloc = () => {
        throw new Error('injected koffi.alloc failure');
      };
      expect(() => real.beginPipeAccept(server)).toThrow(/injected koffi.alloc failure/);
      expect(counters.frees).toBe(0);
      expect(counters.eventCloses).toBe(1);
      counters.frees = 0;
      counters.eventCloses = 0;
      // encode throws after a successful alloc: free + event close, exactly
      // once each — still before any request reached the kernel.
      koffi.alloc = originalAlloc;
      koffi.encode = () => {
        throw new Error('injected koffi.encode failure');
      };
      expect(() => real.beginPipeAccept(server)).toThrow(/injected koffi.encode failure/);
      expect(counters.frees).toBe(1);
      expect(counters.eventCloses).toBe(1);
    } finally {
      koffi.alloc = originalAlloc;
      koffi.encode = originalEncode;
      counters.restore();
    }
    // No kernel I/O was ever queued in either drill: the instance accepts.
    const client = real.openNamedPipeClient(name);
    const accept = real.beginPipeAccept(server);
    await expect(accept.result).resolves.toBe('CONNECTED');
    accept.dispose();
    real.closePipeHandle(client);
    real.closePipeHandle(server);
  });

  it('rejects start() on a NULL-event first accept, closes the first instance exactly once and releases the name', async () => {
    const real = loadReal();
    const rec = recordingBridge(real);
    const pipeName = uniquePipeName();
    const transport = createWindowsPipeServerTransport({ pipeName, bridge: rec });
    const raw = rawFields(real);
    const original = raw.createEventW;
    raw.createEventW = () => 0n;
    try {
      expect(() =>
        transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined }),
      ).toThrow(/CreateEventW failed/);
    } finally {
      raw.createEventW = original;
    }
    expect(transport.isActive).toBe(false);
    expect(transport.fatalState).toBeUndefined();
    const firstHandle = rec.createdInstances[0];
    expect(firstHandle).toBeDefined();
    expect(rec.handleCloses).toEqual([firstHandle]);
    // The FIRST-instance claim is gone: a fresh transport binds the SAME name
    // (kernel-level proof the failed first accept released its handle).
    const rebound = createWindowsPipeServerTransport({ pipeName, bridge: rec });
    await rebound.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    expect(rebound.isActive).toBe(true);
    await rebound.stop();
  });

  it('drains REAL pending I/O to ABORTED on an abnormal (WAIT_FAILED) wait and releases exactly once', async () => {
    const real = loadReal();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    const counters = installAbnormalWaitAndCounters(real);
    try {
      // Queue REAL pending kernel I/O (no client yet); the injected wait then
      // fails — the code must CancelIoEx the REAL I/O, blocking-drain it, and
      // resolve ABORTED with exactly one release.
      const accept = real.beginPipeAccept(server);
      await expect(accept.result).resolves.toBe('ABORTED');
      accept.dispose(); // idempotent no-op after release
      expect(counters.frees).toBe(1);
      expect(counters.eventCloses).toBe(1);
    } finally {
      counters.restore();
    }
    // The instance is untouched by the abnormal drill and accepts again.
    const client = real.openNamedPipeClient(name);
    const second = real.beginPipeAccept(server);
    await expect(second.result).resolves.toBe('CONNECTED');
    second.dispose();
    real.closePipeHandle(client);
    real.closePipeHandle(server);
  });

  it('guards a spurious ERROR_IO_INCOMPLETE with a real cancel + blocking drain before release', async () => {
    const real = loadReal();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    const counters = installAbnormalWaitAndCounters(real);
    const raw = rawFields(real);
    const originalResult = raw.getOverlappedResult as (...args: unknown[]) => number;
    const originalGle = raw.getLastError as () => number;
    let resultCalls = 0;
    let gleCalls = 0;
    // First read fakes INCOMPLETE (kernel still draining); the blocking retry
    // must go through the REAL binding on the REAL cancelled I/O. The FIRST
    // getLastError call in the flow is ConnectNamedPipe's own (must stay the
    // real 997), the injected 996 applies to the callback's first read.
    raw.getOverlappedResult = (...args: unknown[]) => {
      resultCalls += 1;
      if (resultCalls === 1) {
        return 0;
      }
      return originalResult(...args);
    };
    raw.getLastError = () => {
      gleCalls += 1;
      if (gleCalls === 2) {
        return 996; // ERROR_IO_INCOMPLETE
      }
      return originalGle();
    };
    try {
      const accept = real.beginPipeAccept(server);
      await expect(accept.result).resolves.toBe('ABORTED');
      expect(resultCalls).toBe(2); // incomplete → cancel → blocking real drain
      expect(counters.frees).toBe(1);
      expect(counters.eventCloses).toBe(1);
    } finally {
      raw.getOverlappedResult = originalResult;
      raw.getLastError = originalGle;
      counters.restore();
    }
    const client = real.openNamedPipeClient(name);
    const second = real.beginPipeAccept(server);
    await expect(second.result).resolves.toBe('CONNECTED');
    second.dispose();
    real.closePipeHandle(client);
    real.closePipeHandle(server);
  });

  it('rejects (never falsely resolves) when the abnormal-wait drain claims completion, releasing exactly once', async () => {
    const real = loadReal();
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    const counters = installAbnormalWaitAndCounters(real);
    const raw = rawFields(real);
    const originalResult = raw.getOverlappedResult as (...args: unknown[]) => number;
    const originalGle = raw.getLastError as () => number;
    let resultCalls = 0;
    let gleCalls = 0;
    raw.getOverlappedResult = (..._args: unknown[]) => {
      resultCalls += 1;
      if (resultCalls === 1) {
        return 0;
      }
      return 1; // fake "completed" — the injected wait failure must surface
    };
    raw.getLastError = () => {
      // Call 1 = ConnectNamedPipe's own GLE (real 997); call 2 = the
      // callback's first read after GetOverlappedResult (fake INCOMPLETE).
      gleCalls += 1;
      return gleCalls === 2 ? 996 : 0;
    };
    try {
      const accept = real.beginPipeAccept(server);
      await expect(accept.result).rejects.toThrow(/wait failed after completed I\/O drain/);
      expect(counters.frees).toBe(1);
      expect(counters.eventCloses).toBe(1);
    } finally {
      raw.getOverlappedResult = originalResult;
      raw.getLastError = originalGle;
      counters.restore();
    }
    // The REAL I/O was cancelled by the drill's own CancelIoEx before release:
    // the instance is healthy and accepts again.
    const client = real.openNamedPipeClient(name);
    const second = real.beginPipeAccept(server);
    await expect(second.result).resolves.toBe('CONNECTED');
    second.dispose();
    real.closePipeHandle(client);
    real.closePipeHandle(server);
  });
});

describeWin32('native fail-stop terminates the process on unproven kernel lifetime', () => {
  it('fail-stops when ConnectNamedPipe throws after native allocation', async () => {
    const { code, stderr } = await runFailStopScenario('connect-throw');
    expect(stderr).toContain('FAIL-STOP');
    expect(stderr).toContain('ConnectNamedPipe threw');
    expect(code).toBe(70);
  }, 90_000);

  it('fail-stops when wait registration fails over REAL pending I/O', async () => {
    const { code, stderr } = await runFailStopScenario('wait-registration-throw');
    expect(stderr).toContain('FAIL-STOP');
    expect(stderr).toContain('WaitForSingleObject async registration failed');
    expect(code).toBe(70);
  }, 90_000);

  it('fail-stops when GetOverlappedResult cannot prove I/O terminality', async () => {
    const { code, stderr } = await runFailStopScenario('unprovable-terminality');
    expect(stderr).toContain('FAIL-STOP');
    expect(stderr).toContain('cannot prove I/O terminality');
    expect(code).toBe(70);
  }, 90_000);
});

describeWin32('ownership through the actual transport callers (real OS path)', () => {
  it('server admission: a post-fd adoption failure closes exactly the file fd and never the pipe handle', async () => {
    const real = loadReal();
    const rec = recordingBridge(real);
    const tmpFile = path.join(
      os.tmpdir(),
      `xdownload-adopt-fail-server-${String(process.pid)}.txt`,
    );
    fs.writeFileSync(tmpFile, 'server-post-fd-drill\n');
    const fileHandle = createOverlappedFileHandle(tmpFile);
    // REAL consumption of the FILE handle into a CRT fd (uv_open_osfhandle);
    // uv_pipe_open will genuinely fail on this non-pipe fd.
    const fileFd = real.openTransportHandle(fileHandle).fd;
    (rec as unknown as RawFields).openTransportHandle = () => ({ fd: fileFd });
    const pipeName = uniquePipeName();
    const transport = createWindowsPipeServerTransport({ pipeName, bridge: rec });
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    const clientTransport = createWindowsPipeClientTransport();
    const connection = await clientTransport.connect({ pipeName, host: '127.0.0.1', port: 0 });
    try {
      await until(() => transport.lastAdmissionFailure !== undefined);
      expect(transport.lastAdmissionFailure).toContain('handle adoption failed');
      expect(rec.fdCloses).toEqual([fileFd]);
      // The accepted instance handle was consumed at the fd stage: no code
      // path may CloseHandle it (that is the R2 double-close defect).
      const accepted = rec.createdInstances[0];
      expect(accepted).toBeDefined();
      expect(rec.handleCloses).not.toContain(accepted);
    } finally {
      await transport.stop();
      await connection.close();
      fs.rmSync(tmpFile, { force: true });
    }
    // Injection artifact: the real instance handle was never consumed, so the
    // test releases it; then churn fresh instances through the handle table —
    // every one must be created and closed cleanly (a stale double-close
    // would kill an innocent recycled slot instead).
    real.closePipeHandle(rec.createdInstances[0]!);
    const sd = real.buildProtectedSecurityDescriptor();
    for (let i = 0; i < 30; i++) {
      const instance = real.createPipeInstance(uniquePipeName(), sd, false);
      real.closePipeHandle(instance);
    }
  }, 60_000);

  it('client connect: a post-fd adoption failure closes exactly the file fd and never the pipe handle', async () => {
    const real = loadReal();
    const rec = recordingBridge(real);
    const sd = real.buildProtectedSecurityDescriptor();
    const name = uniquePipeName();
    const server = real.createPipeInstance(name, sd, false);
    const tmpFile = path.join(
      os.tmpdir(),
      `xdownload-adopt-fail-client-${String(process.pid)}.txt`,
    );
    fs.writeFileSync(tmpFile, 'client-post-fd-drill\n');
    const fileHandle = createOverlappedFileHandle(tmpFile);
    const fileFd = real.openTransportHandle(fileHandle).fd;
    (rec as unknown as RawFields).openTransportHandle = () => ({ fd: fileFd });
    try {
      const clientTransport = createWindowsPipeClientTransport({ bridge: rec });
      await expect(
        clientTransport.connect({ pipeName: name, host: '127.0.0.1', port: 0 }),
      ).rejects.toThrow(/uv_pipe_open failed/);
      expect(rec.fdCloses).toEqual([fileFd]);
      const clientHandle = rec.clientHandles[0];
      expect(clientHandle).toBeDefined();
      expect(rec.handleCloses).not.toContain(clientHandle);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
    // Injection artifact cleanup: the raw client handle was never consumed.
    real.closePipeHandle(rec.clientHandles[0]!);
    real.closePipeHandle(server);
  }, 60_000);

  it('net.Socket construction failure unwinds only the libuv owner (no fd/handle close, no leak)', async () => {
    const real = loadReal();
    const rec = recordingBridge(real);
    const sd = real.buildProtectedSecurityDescriptor();
    const netNamespace = net as unknown as { Socket: unknown };
    const originalSocket = netNamespace.Socket;
    // Constructible (non-arrow) function: `new net.Socket(...)` must reach the
    // throwing body, not fail with "not a constructor" before it runs.
    const BrokenSocket = function brokenSocket(): never {
      throw new Error('injected net.Socket construction failure');
    };
    const drillOnce = async (): Promise<void> => {
      const name = uniquePipeName();
      const server = real.createPipeInstance(name, sd, false);
      try {
        const clientTransport = createWindowsPipeClientTransport({ bridge: rec });
        await expect(
          clientTransport.connect({ pipeName: name, host: '127.0.0.1', port: 0 }),
        ).rejects.toThrow(/Socket construction failure/);
      } finally {
        real.closePipeHandle(server);
      }
    };
    netNamespace.Socket = BrokenSocket;
    try {
      await drillOnce();
      expect(rec.fdCloses).toHaveLength(0); // the fd belongs to libuv now
      expect(rec.handleCloses).toHaveLength(0); // raw HANDLE consumed; never CloseHandle'd
      // Repeated drills must not leak the libuv-owned fd+handle pair.
      const before = handleCountOf();
      for (let i = 0; i < 25; i++) {
        await drillOnce();
        await delay(10);
      }
      await delay(200); // let libuv closes flush
      expect(handleCountOf() - before).toBeLessThanOrEqual(8);
    } finally {
      netNamespace.Socket = originalSocket;
    }
  }, 60_000);
});

describeWin32('peer identity and lifecycle stress (real OS path)', () => {
  it('peer TokenUser identity stays exact under forced GC stress (peer buffer rooting)', async () => {
    const real = loadReal();
    const self = real.selfIdentity();
    const sd = real.buildProtectedSecurityDescriptor();
    const gc = (globalThis as { gc?: () => void }).gc;
    const cycles = gc ? 300 : 60;
    const cycleOnce = async (): Promise<void> => {
      const name = uniquePipeName();
      const server = real.createPipeInstance(name, sd, false);
      const client = real.openNamedPipeClient(name);
      const accept = real.beginPipeAccept(server);
      await expect(accept.result).resolves.toBe('CONNECTED');
      const verification = real.verifyPipeClient(server);
      expect(verification.ok).toBe(true);
      if (verification.ok) {
        expect(verification.facts.userSid).toBe(self.userSid);
        expect(verification.facts.logonSessionId).toBe(self.logonSessionId);
        expect(verification.facts.clientPid).toBe(process.pid);
      }
      accept.dispose();
      real.closePipeHandle(client);
      real.closePipeHandle(server);
    };
    for (let i = 0; i < 10; i++) {
      await cycleOnce(); // warmup (lazy CRT/libuv allocations)
    }
    const before = handleCountOf();
    for (let i = 0; i < cycles; i++) {
      await cycleOnce();
      gc?.();
    }
    expect(handleCountOf() - before).toBeLessThanOrEqual(8);
  }, 300_000);

  it('stop() during a REAL pending accept drains the cancel, stays non-fatal and releases the name', async () => {
    const real = loadReal();
    const rec = recordingBridge(real);
    const pipeName = uniquePipeName();
    const transport = createWindowsPipeServerTransport({ pipeName, bridge: rec });
    await transport.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    expect(transport.isActive).toBe(true);
    await transport.stop(); // the queued instance accept is REALLY pending
    expect(transport.isActive).toBe(false);
    expect(transport.fatalState).toBeUndefined();
    // Every queued accept was cancelled and its instance handle closed: the
    // name is immediately rebindable (FIRST-instance claim released).
    const rebound = createWindowsPipeServerTransport({ pipeName, bridge: rec });
    await rebound.start({ onFrame: () => undefined, onConnectionEnded: () => undefined });
    expect(rebound.isActive).toBe(true);
    await rebound.stop();
  }, 30_000);
});
