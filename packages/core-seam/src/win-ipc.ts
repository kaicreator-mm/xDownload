/**
 * #101 S3-WIN-IPC-001 — smallest native bridge for Windows named-pipe peer
 * verification (`win32` only; every other platform fails closed upstream).
 *
 * Stock Node APIs cannot inspect the OS token of a connecting pipe client
 * (the libuv pipe handle is not userland-reachable), so this module binds a
 * prebuilt FFI dependency (koffi; platform binaries ship as npm
 * optionalDependencies, no compilation step) to a minimal Win32 surface:
 *
 * - CreateNamedPipeW with an explicit protected DACL (current user + SYSTEM
 *   + logon session) so the Core pipe is never born with the permissive
 *   default descriptor;
 * - ImpersonateNamedPipeClient + GetTokenInformation(TokenUser/TokenStatistics)
 *   to derive the peer user/session from the ACTUAL connecting token (never
 *   from caller-presented envelope claims, PID strings, or the loopback
 *   address);
 * - GetNamedPipeClientProcessId for metadata only;
 * - native CreateFileW with SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION for
 *   the client side (without the QoS the server-side impersonation fails).
 *
 * Every API either succeeds truthfully or reports failure; callers must fail
 * closed. The bridge never widens its own error surface into a fallback
 * channel. Module loads lazily and only on win32 — on any other platform
 * construction throws.
 */

import { createRequire } from 'node:module';
import type { LibraryHandle } from 'koffi';

/** The subset of the koffi module surface this bridge uses (lazy-loaded). */
type KoffiModule = {
  load(path: string): LibraryHandle;
  struct(name: string, def: Record<string, unknown>): unknown;
  as(value: unknown, type: string): unknown;
  sizeof(type: string): number;
  /** Stable native allocation; its address stays valid until `free`. */
  alloc(type: string, count?: number): unknown;
  free(ptr: unknown): void;
  encode(ptr: unknown, type: string, value: unknown): void;
  decode(ptr: unknown, type: string): unknown;
};

export const WINDOWS_PIPE_TRANSPORT_KIND = 'WINDOWS_NAMED_PIPE' as const;

/** Raised when the platform or the native bridge cannot support the transport. */
export class WindowsIpcUnsupportedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WindowsIpcUnsupportedError';
  }
}

export interface WindowsSelfIdentity {
  /** Canonical SID string of the Core process token user. */
  readonly userSid: string;
  /** Authentication (logon) session LUID as `0x%08x%08x`. */
  readonly logonSessionId: string;
  readonly sameUser: (userSid: string) => boolean;
  readonly sameLogonSession: (logonSessionId: string) => boolean;
}

/** Session facts derived from one connecting client token. */
export interface WindowsClientTokenFacts {
  readonly userSid: string;
  readonly userName: string | undefined;
  readonly logonSessionId: string;
  readonly clientPid: number;
}

export type WindowsPeerVerification =
  | { readonly ok: true; readonly facts: WindowsClientTokenFacts }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * True when `RevertToSelf` itself failed after an impersonation attempt:
       * the executing thread may still be in the client's security context, so
       * the caller must fail the whole PROCESS down (fail-stop), never merely
       * deny this connection.
       */
      readonly revertFailed?: true;
    };

/**
 * One queued overlapped accept on a listening pipe instance (P1-01 lifecycle
 * owner: the stable native OVERLAPPED + its event live exactly as long as
 * this object).
 */
export interface WindowsPipeAccept {
  /** The listening instance this accept is queued on. */
  readonly pipeHandle: bigint;
  /** CONNECTED when a client is (or already was) connected; ABORTED on cancel. */
  readonly result: Promise<'CONNECTED' | 'ABORTED'>;
  /**
   * Cancel any pending kernel accept and release the native OVERLAPPED + its
   * event. Idempotent. Safe before the result settles (forces ABORTED) and
   * required after it settles — every path between begin and dispose keeps
   * the allocation alive exactly once.
   */
  readonly dispose: () => void;
}

const TOKEN_QUERY = 0x8;
const TOKEN_USER = 1;
const TOKEN_GROUPS = 2;
const TOKEN_STATISTICS = 10;
const DACL_SECURITY_INFORMATION = 4;
const SE_GROUP_LOGON_ID = 0xc0000000;
const GENERIC_ALL = 0x10000000;
const SET_ACCESS = 2;
const TRUSTEE_IS_SID = 0;
const TRUSTEE_IS_UNKNOWN = 0;
const FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000;
const FILE_FLAG_OVERLAPPED = 0x40000000;
const FILE_FLAG_WRITE_DAC = 0x00040000;
const PIPE_ACCESS_DUPLEX = 3;
// Security boundary: named-pipe IPC must never accept remote clients.
const PIPE_REJECT_REMOTE_CLIENTS = 0x00000008;
const SECURITY_SQOS_PRESENT = 0x00100000;
const SECURITY_IMPERSONATION = 0x00020000;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const OPEN_EXISTING = 3;
const INFINITE = 0xffffffff;
const ERROR_IO_PENDING = 997;
const ERROR_OPERATION_ABORTED = 995;
// A client connected between CreateNamedPipeW and ConnectNamedPipe: the
// connection is fully established, but no completable I/O is parked (the
// kernel answers CancelIoEx with ERROR_NOT_FOUND and never completes the
// overlapped) — see the accept lifecycle in `beginPipeAccept`.
const ERROR_PIPE_CONNECTED = 535;
const INVALID_HANDLE_VALUE = 18446744073709551615n;

// koffi registers named struct types globally per module instance; declare
// once (redeclaration throws) so multiple bridge instances/starts coexist.
let securityStructsDeclared = false;

function declareSecurityStructs(koffi: KoffiModule): void {
  if (securityStructsDeclared) {
    return;
  }
  const TRUSTEE = koffi.struct('XDOWNLOAD_TRUSTEE_A', {
    pMultipleTrustee: 'void *',
    MultipleTrusteeOperation: 'int32',
    TrusteeForm: 'int32',
    TrusteeType: 'int32',
    ptstrName: 'void *',
  });
  koffi.struct('XDOWNLOAD_EXPLICIT_ACCESS_A', {
    grfAccessPermissions: 'uint32',
    grfAccessMode: 'uint32',
    grfInheritance: 'uint32',
    Trustee: TRUSTEE,
  });
  koffi.struct('XDOWNLOAD_SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void *',
    bInheritHandle: 'int32',
  });
  koffi.struct('XDOWNLOAD_OVERLAPPED', {
    Internal: 'uintptr_t',
    InternalHigh: 'uintptr_t',
    Offset: 'uint32',
    OffsetHigh: 'uint32',
    // uintptr_t, not a pointer type: the event HANDLE is written through
    // koffi.encode as an integer so the same 8 bytes land in the struct on
    // every engine koffi supports.
    hEvent: 'uintptr_t',
  });
  securityStructsDeclared = true;
}

export function isWindowsIpcPlatform(platform: string = process.platform): boolean {
  return platform === 'win32';
}

/**
 * Constructible only on win32 with the FFI dependency resolvable. `null`
 * from `tryLoad()` means "unsupported build" — callers must fail closed with
 * a typed error, never silently degrade to an unverified transport.
 */
export class WindowsIpcBridge {
  private readonly koffi: KoffiModule;
  private readonly kernel32: LibraryHandle;
  private readonly advapi32: LibraryHandle;
  private readonly nodeExports: LibraryHandle;
  private readonly createNamedPipeW: (
    name: unknown,
    openMode: number,
    pipeMode: number,
    maxInst: number,
    outBuf: number,
    inBuf: number,
    timeout: number,
    sa: unknown,
  ) => bigint | null;
  private readonly connectNamedPipe: (handle: bigint, overlapped: unknown) => number;
  private readonly getOverlappedResult: (
    handle: bigint,
    overlapped: unknown,
    bytes: unknown,
    wait: number,
  ) => number;
  private readonly cancelIoEx: (handle: bigint, overlapped: unknown) => number;
  private readonly createEventW: (
    sa: null,
    manualReset: number,
    initialState: number,
    name: null,
  ) => bigint;
  private readonly closeHandle: (handle: bigint) => number;
  private readonly waitForSingleObject: {
    async(handle: bigint, ms: number, cb: (err: unknown, res: unknown) => void): void;
  };
  private readonly getLastError: () => number;
  private readonly readProcessMemory: (
    proc: bigint,
    base: bigint,
    buf: unknown,
    size: bigint,
    read: unknown,
  ) => number;
  private readonly getCurrentProcess: () => bigint;
  private readonly getCurrentThread: () => bigint;
  private readonly openProcessToken: (proc: bigint, access: number, out: unknown) => number;
  private readonly openThreadToken: (
    thread: bigint,
    access: number,
    openAsSelf: number,
    out: unknown,
  ) => number;
  private readonly getTokenInformation: (
    token: bigint,
    infoClass: number,
    info: unknown,
    len: number,
    retLen: unknown,
  ) => number;
  private readonly impersonateNamedPipeClient: (handle: bigint) => number;
  private readonly revertToSelf: () => number;
  private readonly convertSidToStringSidA: (sid: bigint, out: unknown) => number;
  private readonly convertSdToSddlA: (
    sd: unknown,
    revision: number,
    info: number,
    out: unknown,
    len: unknown,
  ) => number;
  private readonly setEntriesInAclA: (
    count: number,
    ea: unknown,
    oldAcl: null,
    out: unknown,
  ) => number;
  private readonly allocateAndInitializeSid: (
    authority: unknown,
    count: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    out: unknown,
  ) => number;
  private readonly freeSid: (sid: bigint) => bigint;
  private readonly initializeSecurityDescriptor: (sd: unknown, revision: number) => number;
  private readonly setSecurityDescriptorDacl: (
    sd: unknown,
    present: number,
    dacl: bigint,
    defaulted: number,
  ) => number;
  private readonly makeSelfRelativeSd: (abs: unknown, rel: unknown, len: unknown) => number;
  private readonly localFree: (mem: bigint) => bigint;
  private readonly getNamedPipeClientProcessId: (handle: bigint, out: unknown) => number;
  private readonly createFileW: (
    name: unknown,
    access: number,
    share: number,
    sa: null,
    disposition: number,
    flags: number,
    template: null,
  ) => bigint;
  private readonly lookupAccountSidA: (
    system: null,
    sid: bigint,
    name: unknown,
    nameLen: unknown,
    domain: unknown,
    domainLen: unknown,
    use: unknown,
  ) => number;
  private readonly uvOpenOsfhandle: (osFd: bigint) => number;
  private readonly uvDefaultLoop: () => bigint;
  private readonly uvFsClose: (loop: bigint, req: unknown, fd: number, cb: null) => number;
  private readonly uvFsReqCleanup: (req: unknown) => void;

  private constructor(koffi: KoffiModule) {
    this.koffi = koffi;
    const F = (lib: LibraryHandle, proto: string) => lib.func(proto);
    this.kernel32 = koffi.load('kernel32.dll');
    this.advapi32 = koffi.load('advapi32.dll');
    // libuv is statically linked into node.exe and exports the few uv_* symbols
    // needed to hand a raw pipe HANDLE back to the Node event loop. The CRT fd
    // table is per-module: uv_open_osfhandle from node.exe guarantees the fd is
    // visible to uv_pipe_open's consumer side (a ucrtbase.dll call would
    // allocate the fd in a foreign table and uv_pipe_open would fail EBADF).
    this.nodeExports = koffi.load('node.exe');
    this.createNamedPipeW = F(
      this.kernel32,
      'void * __stdcall CreateNamedPipeW(void *name, uint32 openMode, uint32 pipeMode, uint32 maxInst, uint32 outBuf, uint32 inBuf, uint32 timeout, void *securityAttrs)',
    );
    this.connectNamedPipe = F(
      this.kernel32,
      'int __stdcall ConnectNamedPipe(void *handle, void *overlapped)',
    );
    this.getOverlappedResult = F(
      this.kernel32,
      'int __stdcall GetOverlappedResult(void *handle, void *overlapped, void *bytes, int wait)',
    );
    this.cancelIoEx = F(this.kernel32, 'int __stdcall CancelIoEx(void *handle, void *overlapped)');
    this.createEventW = F(
      this.kernel32,
      'void * __stdcall CreateEventW(void *attrs, int manualReset, int initialState, void *name)',
    );
    this.closeHandle = F(this.kernel32, 'int __stdcall CloseHandle(void *handle)');
    this.waitForSingleObject = F(
      this.kernel32,
      'uint32 __stdcall WaitForSingleObject(void *handle, uint32 ms)',
    ) as unknown as WindowsIpcBridge['waitForSingleObject'];
    this.getLastError = F(this.kernel32, 'uint32 __stdcall GetLastError()');
    this.readProcessMemory = F(
      this.kernel32,
      'int __stdcall ReadProcessMemory(void *proc, uintptr_t base, void *buf, uintptr_t size, void *readOut)',
    );
    this.getCurrentProcess = F(this.kernel32, 'void * __stdcall GetCurrentProcess()');
    this.getCurrentThread = F(this.kernel32, 'void * __stdcall GetCurrentThread()');
    this.openProcessToken = F(
      this.advapi32,
      'int __stdcall OpenProcessToken(void *proc, uint32 access, void *tokenOut)',
    );
    this.openThreadToken = F(
      this.advapi32,
      'int __stdcall OpenThreadToken(void *thread, uint32 access, int openAsSelf, void *tokenOut)',
    );
    this.getTokenInformation = F(
      this.advapi32,
      'int __stdcall GetTokenInformation(void *token, int infoClass, void *info, uint32 len, void *retLen)',
    );
    this.impersonateNamedPipeClient = F(
      this.advapi32,
      'int __stdcall ImpersonateNamedPipeClient(void *handle)',
    );
    this.revertToSelf = F(this.advapi32, 'int __stdcall RevertToSelf()');
    this.convertSidToStringSidA = F(
      this.advapi32,
      'int __stdcall ConvertSidToStringSidA(void *sid, void *strOut)',
    );
    this.convertSdToSddlA = F(
      this.advapi32,
      'int __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorA(void *sd, uint32 revision, uint32 info, void *strOut, void *lenOut)',
    );
    this.setEntriesInAclA = F(
      this.advapi32,
      'uint32 __stdcall SetEntriesInAclA(uint32 count, void *explicitAccess, void *oldAcl, void *newAclOut)',
    );
    this.allocateAndInitializeSid = F(
      this.advapi32,
      'int __stdcall AllocateAndInitializeSid(void *authority, char subCount, uint32 a, uint32 b, uint32 c, uint32 d, uint32 e, uint32 f, uint32 g, uint32 h, void *sidOut)',
    );
    this.freeSid = F(this.advapi32, 'void * __stdcall FreeSid(void *sid)');
    this.initializeSecurityDescriptor = F(
      this.advapi32,
      'int __stdcall InitializeSecurityDescriptor(void *sd, uint32 revision)',
    );
    this.setSecurityDescriptorDacl = F(
      this.advapi32,
      'int __stdcall SetSecurityDescriptorDacl(void *sd, int daclPresent, void *dacl, int daclDefaulted)',
    );
    this.makeSelfRelativeSd = F(
      this.advapi32,
      'int __stdcall MakeSelfRelativeSD(void *abs, void *selfRel, void *len)',
    );
    this.localFree = F(this.kernel32, 'void * __stdcall LocalFree(void *mem)');
    this.getNamedPipeClientProcessId = F(
      this.kernel32,
      'int __stdcall GetNamedPipeClientProcessId(void *handle, void *pidOut)',
    );
    this.createFileW = F(
      this.kernel32,
      'void * __stdcall CreateFileW(void *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)',
    );
    this.lookupAccountSidA = F(
      this.advapi32,
      'int __stdcall LookupAccountSidA(void *system, void *sid, void *name, void *nameLen, void *domain, void *domainLen, void *use)',
    );
    this.uvOpenOsfhandle = F(this.nodeExports, 'int __cdecl uv_open_osfhandle(void *os_fd)');
    this.uvDefaultLoop = F(this.nodeExports, 'void * __cdecl uv_default_loop()');
    this.uvFsClose = F(
      this.nodeExports,
      'int __cdecl uv_fs_close(void *loop, void *req, int fd, void *cb)',
    );
    this.uvFsReqCleanup = F(this.nodeExports, 'void __cdecl uv_fs_req_cleanup(void *req)');
  }

  /** Returns null when the platform or the FFI dependency is unavailable. */
  static tryLoad(): WindowsIpcBridge | null {
    if (!isWindowsIpcPlatform()) {
      return null;
    }
    try {
      // Lazy load keeps the dependency optional at module-eval time; a missing
      // binary is a typed fail-closed condition, never a crash. createRequire
      // keeps the resolution working from source AND from ESM bundles (where a
      // bare `require` identifier does not exist); the local indirection keeps
      // bundlers from following the dependency into the native-binary package.
      const loadNativeModule = createRequire(import.meta.url);
      const koffi = loadNativeModule('koffi') as KoffiModule;
      return new WindowsIpcBridge(koffi);
    } catch {
      return null;
    }
  }

  private vp(buffer: Buffer): unknown {
    return this.koffi.as(buffer, 'void *');
  }

  private readAnsiStringAt(address: bigint, max = 512): string {
    const buf = Buffer.alloc(max);
    const read = Buffer.alloc(8);
    if (
      !this.readProcessMemory(this.getCurrentProcess(), address, this.vp(buf), BigInt(max), read)
    ) {
      throw new Error('ReadProcessMemory failed');
    }
    return buf.toString('latin1', 0, buf.indexOf(0));
  }

  private tokenBuffer(token: bigint, infoClass: number, size = 2048): Buffer {
    const buf = Buffer.alloc(size);
    const retLen = Buffer.alloc(4);
    if (!this.getTokenInformation(token, infoClass, this.vp(buf), size, this.vp(retLen))) {
      throw new Error(
        `GetTokenInformation(class=${String(infoClass)}) failed (GetLastError=${String(this.getLastError())})`,
      );
    }
    return buf;
  }

  private sidToString(sidPtr: bigint): string {
    const out = Buffer.alloc(8);
    if (!this.convertSidToStringSidA(sidPtr, this.vp(out))) {
      throw new Error(
        `ConvertSidToStringSidA failed (GetLastError=${String(this.getLastError())})`,
      );
    }
    try {
      return this.readAnsiStringAt(out.readBigUInt64LE(0));
    } finally {
      this.localFree(out.readBigUInt64LE(0));
    }
  }

  private static formatLuid(high: number, low: number): string {
    return `0x${(high >>> 0).toString(16).padStart(8, '0')}${(low >>> 0).toString(16).padStart(8, '0')}`;
  }

  /**
   * Core process's own token identity, captured once at transport start; the
   * same-user/same-session comparison basis for every incoming connection.
   */
  selfIdentity(): WindowsSelfIdentity {
    const tokOut = Buffer.alloc(8);
    if (!this.openProcessToken(this.getCurrentProcess(), TOKEN_QUERY, this.vp(tokOut))) {
      throw new Error(`OpenProcessToken failed (GetLastError=${String(this.getLastError())})`);
    }
    const token = tokOut.readBigUInt64LE(0);
    try {
      const userBuf = this.tokenBuffer(token, TOKEN_USER);
      const userSid = this.sidToString(userBuf.readBigUInt64LE(0));
      const statsBuf = this.tokenBuffer(token, TOKEN_STATISTICS, 128);
      const logonSessionId = WindowsIpcBridge.formatLuid(
        statsBuf.readInt32LE(12),
        statsBuf.readUInt32LE(8),
      );
      return {
        userSid,
        logonSessionId,
        sameUser: (candidate) => candidate === userSid,
        sameLogonSession: (candidate) => candidate === logonSessionId,
      };
    } finally {
      this.closeHandle(token);
    }
  }

  /**
   * Build a self-relative SECURITY_DESCRIPTOR whose protected DACL grants
   * GENERIC_ALL to SYSTEM, the Core process user, and the Core logon session
   * only — no Everyone/Authenticated Users/Users/Anonymous ACE, so the pipe
   * is deny-by-default for every other identity from birth.
   */
  buildProtectedSecurityDescriptor(): Buffer {
    declareSecurityStructs(this.koffi);
    const EXPLICIT_ACCESS = 'XDOWNLOAD_EXPLICIT_ACCESS_A';
    const tokOut = Buffer.alloc(8);
    if (!this.openProcessToken(this.getCurrentProcess(), TOKEN_QUERY, this.vp(tokOut))) {
      throw new Error(`OpenProcessToken failed (GetLastError=${String(this.getLastError())})`);
    }
    const token = tokOut.readBigUInt64LE(0);
    try {
      return this.buildProtectedSecurityDescriptorFromToken(token, EXPLICIT_ACCESS);
    } finally {
      this.closeHandle(token);
    }
  }

  private buildProtectedSecurityDescriptorFromToken(
    token: bigint,
    explicitAccessType: string,
  ): Buffer {
    // TokenUser contains a SID pointer INTO this native output buffer.
    // Keep the buffer live past the last native ACL call; do not GC it early.
    const userTokenBuffer = this.tokenBuffer(token, TOKEN_USER);
    const userSidPtr = userTokenBuffer.readBigUInt64LE(0);
    const groupsBuf = this.tokenBuffer(token, TOKEN_GROUPS, 4096);
    const groupCount = groupsBuf.readUInt32LE(0);
    let logonSidPtr: bigint | null = null;
    for (let i = 0; i < groupCount; i++) {
      const off = 8 + i * 16;
      if ((groupsBuf.readUInt32LE(off + 8) & SE_GROUP_LOGON_ID) === SE_GROUP_LOGON_ID) {
        logonSidPtr = groupsBuf.readBigUInt64LE(off);
        break;
      }
    }
    const authority = Buffer.from([0, 0, 0, 0, 0, 5]); // SECURITY_NT_AUTHORITY
    const systemOut = Buffer.alloc(8);
    if (
      !this.allocateAndInitializeSid(
        this.vp(authority),
        1,
        18 /* LocalSystem */,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        this.vp(systemOut),
      )
    ) {
      throw new Error(
        `AllocateAndInitializeSid(SYSTEM) failed (GetLastError=${String(this.getLastError())})`,
      );
    }
    const systemSid = systemOut.readBigUInt64LE(0);
    // Every exit below must release the SYSTEM SID and (once created) the
    // native ACL — collected in one finally rather than repeated per branch.
    let aclPtr: bigint | null = null;
    try {
      const ace = (sidPtr: bigint) => ({
        grfAccessPermissions: GENERIC_ALL,
        grfAccessMode: SET_ACCESS,
        grfInheritance: 0,
        Trustee: {
          pMultipleTrustee: null,
          MultipleTrusteeOperation: 0,
          TrusteeForm: TRUSTEE_IS_SID,
          TrusteeType: TRUSTEE_IS_UNKNOWN,
          ptstrName: sidPtr,
        },
      });
      const explicitAccess: unknown[] = [ace(systemSid), ace(userSidPtr)];
      if (logonSidPtr !== null) {
        explicitAccess.push(ace(logonSidPtr));
      }
      // Force both SID backing buffers to stay reachable until the native call
      // has finished; pointers inside them are invalid after GC.
      if (userTokenBuffer.byteLength === 0 || groupsBuf.byteLength === 0) {
        throw new Error('empty token SID backing buffer');
      }
      const newAcl = Buffer.alloc(8);
      const rc = this.setEntriesInAclA(
        explicitAccess.length,
        this.koffi.as(explicitAccess, `${explicitAccessType} *`),
        null,
        this.vp(newAcl),
      );
      if (rc !== 0) {
        throw new Error(`SetEntriesInAclA failed (rc=${String(rc)})`);
      }
      aclPtr = newAcl.readBigUInt64LE(0);
      const absolute = Buffer.alloc(64);
      if (!this.initializeSecurityDescriptor(this.vp(absolute), 1)) {
        throw new Error('InitializeSecurityDescriptor failed');
      }
      if (!this.setSecurityDescriptorDacl(this.vp(absolute), 1, aclPtr, 0)) {
        throw new Error('SetSecurityDescriptorDacl failed');
      }
      const lenBuf = Buffer.alloc(4);
      this.makeSelfRelativeSd(this.vp(absolute), null, this.vp(lenBuf));
      const selfRelative = Buffer.alloc(lenBuf.readUInt32LE(0));
      if (!this.makeSelfRelativeSd(this.vp(absolute), this.vp(selfRelative), this.vp(lenBuf))) {
        throw new Error('MakeSelfRelativeSD failed');
      }
      return selfRelative;
    } finally {
      this.freeSid(systemSid);
      if (aclPtr !== null) {
        this.localFree(aclPtr);
      }
    }
  }

  /** Best-effort SDDL rendering of one security descriptor (audit/observation). */
  securityDescriptorToSddl(sd: Buffer): string | undefined {
    const out = Buffer.alloc(8);
    const len = Buffer.alloc(4);
    if (
      !this.convertSdToSddlA(this.vp(sd), 1, DACL_SECURITY_INFORMATION, this.vp(out), this.vp(len))
    ) {
      return undefined;
    }
    try {
      return this.readAnsiStringAt(out.readBigUInt64LE(0));
    } finally {
      this.localFree(out.readBigUInt64LE(0));
    }
  }

  /**
   * Create ONE listening pipe instance with the protected descriptor from
   * birth. `firstInstance` claims the pipe name exclusively.
   */
  createPipeInstance(pipeName: string, securityDescriptor: Buffer, firstInstance: boolean): bigint {
    declareSecurityStructs(this.koffi);
    const nameBuf = Buffer.concat([Buffer.from(pipeName, 'utf16le'), Buffer.from([0, 0])]);
    const attrs = {
      nLength: this.koffi.sizeof('XDOWNLOAD_SECURITY_ATTRIBUTES'),
      lpSecurityDescriptor: this.vp(securityDescriptor),
      bInheritHandle: 0,
    };
    const openMode =
      PIPE_ACCESS_DUPLEX |
      FILE_FLAG_OVERLAPPED |
      FILE_FLAG_WRITE_DAC |
      (firstInstance ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0);
    const handle = this.createNamedPipeW(
      this.vp(nameBuf),
      openMode,
      PIPE_REJECT_REMOTE_CLIENTS /* byte mode, remote clients rejected */,
      255,
      65536,
      65536,
      0,
      this.koffi.as(attrs, 'XDOWNLOAD_SECURITY_ATTRIBUTES *'),
    );
    if (handle === null || handle === INVALID_HANDLE_VALUE) {
      throw new Error(`CreateNamedPipeW failed (GetLastError=${String(this.getLastError())})`);
    }
    return handle;
  }

  /**
   * Begin an overlapped accept on one listening pipe instance.
   *
   * The OVERLAPPED is one stable native allocation (`koffi.alloc`) whose
   * address — not a per-call marshalling — is handed to the kernel: Win32
   * requires it to stay valid and unmodified until the I/O completes, and
   * `GetOverlappedResult`/`CancelIoEx` must observe the SAME memory the
   * original call used. It is released (event closed, allocation freed) only
   * AFTER the completion has been drained, or — for the pre-connected
   * `ERROR_PIPE_CONNECTED` path — immediately, because the kernel parked no
   * completable I/O there (CancelIoEx → ERROR_NOT_FOUND) and will never touch
   * the memory again.
   */
  beginPipeAccept(pipeHandle: bigint): WindowsPipeAccept {
    declareSecurityStructs(this.koffi);
    const OVERLAPPED_TYPE = 'XDOWNLOAD_OVERLAPPED';
    const event = this.createEventW(null, 1, 0, null);
    if (event === INVALID_HANDLE_VALUE) {
      throw new Error(`CreateEventW failed (GetLastError=${String(this.getLastError())})`);
    }
    let overlapped: unknown;
    try {
      overlapped = this.koffi.alloc(OVERLAPPED_TYPE, 1);
    } catch (error) {
      this.closeHandle(event);
      throw error;
    }
    this.koffi.encode(overlapped, OVERLAPPED_TYPE, {
      Internal: 0n,
      InternalHigh: 0n,
      Offset: 0,
      OffsetHigh: 0,
      hEvent: event,
    });
    let released = false;
    let waitArmed = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      // Belt-and-braces: no-op (ERROR_NOT_FOUND) unless an I/O is still
      // parked; never safe to free native memory a kernel I/O references.
      this.cancelIoEx(pipeHandle, overlapped);
      this.closeHandle(event);
      this.koffi.free(overlapped);
    };
    let resolveResult!: (value: 'CONNECTED' | 'ABORTED') => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<'CONNECTED' | 'ABORTED'>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const fail = (message: string): void => {
      release();
      rejectResult(new Error(message));
    };
    const rc = this.connectNamedPipe(pipeHandle, overlapped);
    if (rc === 0) {
      const err = this.getLastError();
      if (err === ERROR_PIPE_CONNECTED) {
        // The client connected before the call: the connection is real and
        // usable, and no completion will ever arrive for this OVERLAPPED.
        resolveResult('CONNECTED');
        release();
      } else if (err === ERROR_OPERATION_ABORTED) {
        resolveResult('ABORTED');
        release();
      } else if (err !== ERROR_IO_PENDING && err !== 0) {
        fail(`ConnectNamedPipe failed (GetLastError=${String(err)})`);
      } else {
        waitArmed = true;
        this.waitForSingleObject.async(event, INFINITE, () => {
          try {
            const bytes = Buffer.alloc(4);
            const ok = this.getOverlappedResult(pipeHandle, overlapped, this.vp(bytes), 0);
            if (ok) {
              resolveResult('CONNECTED');
            } else {
              const gle = this.getLastError();
              if (gle === ERROR_OPERATION_ABORTED) {
                resolveResult('ABORTED');
              } else {
                rejectResult(new Error(`GetOverlappedResult failed (GetLastError=${String(gle)})`));
              }
            }
          } catch (error) {
            rejectResult(error instanceof Error ? error : new Error(String(error)));
          } finally {
            // Drain happened above; the kernel no longer references the
            // memory — this is the ONLY release point while a wait is armed.
            release();
          }
        });
      }
    } else {
      // Nonzero return: the connect call succeeded without queueing I/O.
      resolveResult('CONNECTED');
      release();
    }
    return {
      pipeHandle,
      result,
      dispose: (): void => {
        if (released) {
          return;
        }
        // Force any pending kernel I/O to complete (the armed wait's callback
        // then drains and releases). While a wait is armed this function must
        // NOT close the event or free the allocation: the callback registered
        // on those very objects is the sole release owner.
        this.cancelIoEx(pipeHandle, overlapped);
        if (!waitArmed) {
          release();
        }
      },
    };
  }

  /**
   * Derive the peer identity from the ACTUAL connecting token: impersonate
   * the pipe client, read TokenUser + TokenStatistics under the impersonated
   * context, then revert. Any failure yields `ok:false` — callers destroy the
   * connection (fail closed). Same-user/same-session comparison against the
   * Core identity is the transport's admission decision, made from `facts`.
   */
  verifyPipeClient(pipeHandle: bigint): WindowsPeerVerification {
    const pidBuf = Buffer.alloc(4);
    if (!this.getNamedPipeClientProcessId(pipeHandle, this.vp(pidBuf))) {
      return {
        ok: false,
        reason: `GetNamedPipeClientProcessId failed (GetLastError=${String(this.getLastError())})`,
      };
    }
    const clientPid = pidBuf.readUInt32LE(0);
    if (!this.impersonateNamedPipeClient(pipeHandle)) {
      const gle = this.getLastError();
      // Best-effort revert (the impersonation failed, the thread context is
      // still ours in practice); a FAILED revert here is still a process-level
      // fail-stop condition — see the revertFailed contract below.
      if (!this.revertToSelf()) {
        return {
          ok: false,
          revertFailed: true,
          reason: `RevertToSelf failed after a failed ImpersonateNamedPipeClient (GetLastError=${String(gle)}); thread security context is no longer trustworthy`,
        };
      }
      return {
        ok: false,
        reason: `ImpersonateNamedPipeClient failed (GetLastError=${String(gle)}); client likely connected without SECURITY_IMPERSONATION QoS`,
      };
    }
    let verification: WindowsPeerVerification;
    let token: bigint | null = null;
    try {
      const tokOut = Buffer.alloc(8);
      if (!this.openThreadToken(this.getCurrentThread(), TOKEN_QUERY, 0, this.vp(tokOut))) {
        verification = {
          ok: false,
          reason: `OpenThreadToken failed (GetLastError=${String(this.getLastError())})`,
        };
      } else {
        token = tokOut.readBigUInt64LE(0);
        const userSid = this.sidToString(this.tokenBuffer(token, TOKEN_USER).readBigUInt64LE(0));
        const statsBuf = this.tokenBuffer(token, TOKEN_STATISTICS, 128);
        const logonSessionId = WindowsIpcBridge.formatLuid(
          statsBuf.readInt32LE(12),
          statsBuf.readUInt32LE(8),
        );
        verification = {
          ok: true,
          facts: {
            userSid,
            userName: this.resolveAccountName(userSid) ?? undefined,
            logonSessionId,
            clientPid,
          },
        };
      }
    } catch (error) {
      verification = { ok: false, reason: `token inspection failed: ${String(error)}` };
    } finally {
      if (token !== null) {
        this.closeHandle(token);
      }
      // Never leave the thread impersonating the client. A FAILED revert means
      // this thread's security context is unknown — the caller MUST treat the
      // whole process as compromised (fail-stop), not merely deny one
      // connection (Microsoft securitybaseapi/RevertToSelf guidance).
      if (!this.revertToSelf()) {
        verification = {
          ok: false,
          revertFailed: true,
          reason:
            'RevertToSelf failed after client token inspection; the executing thread may remain in the connecting client security context',
        };
      }
    }
    return verification;
  }

  private resolveAccountName(userSid: string): string | undefined {
    // Best-effort friendly name; a failure is metadata loss, not a
    // verification failure (the SID is the identity).
    try {
      const ConvertStringSidToSidA = this.advapi32.func(
        'int __stdcall ConvertStringSidToSidA(void *str, void *sidOut)',
      );
      const sidOut = Buffer.alloc(8);
      const strBuf = Buffer.concat([Buffer.from(userSid, 'latin1'), Buffer.from([0])]);
      if (!ConvertStringSidToSidA(this.vp(strBuf), this.vp(sidOut))) {
        return undefined;
      }
      const sidPtr = sidOut.readBigUInt64LE(0);
      try {
        const name = Buffer.alloc(256);
        const domain = Buffer.alloc(256);
        const nameLen = Buffer.alloc(4);
        const domainLen = Buffer.alloc(4);
        const use = Buffer.alloc(4);
        nameLen.writeUInt32LE(256, 0);
        domainLen.writeUInt32LE(256, 0);
        const ok = this.lookupAccountSidA(
          null,
          sidPtr,
          this.vp(name),
          this.vp(nameLen),
          this.vp(domain),
          this.vp(domainLen),
          this.vp(use),
        );
        if (!ok) {
          return undefined;
        }
        const nameStr = name.toString('latin1', 0, name.indexOf(0));
        const domainStr = domain.toString('latin1', 0, domain.indexOf(0));
        return domainStr.length > 0 ? `${domainStr}\\${nameStr}` : nameStr;
      } finally {
        this.localFree(sidPtr);
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Open the client end with the impersonation QoS the server-side
   * verification requires (SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION).
   * Returns the raw HANDLE for `openTransportHandle`.
   */
  openNamedPipeClient(pipeName: string): bigint {
    const nameBuf = Buffer.concat([Buffer.from(pipeName, 'utf16le'), Buffer.from([0, 0])]);
    const handle = this.createFileW(
      this.vp(nameBuf),
      GENERIC_READ | GENERIC_WRITE,
      0,
      null,
      OPEN_EXISTING,
      FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IMPERSONATION,
      null,
    );
    if (handle === INVALID_HANDLE_VALUE) {
      throw new Error(
        `CreateFileW(pipe client) failed (GetLastError=${String(this.getLastError())})`,
      );
    }
    return handle;
  }

  /**
   * Hand a verified raw pipe HANDLE to the Node event loop: libuv's own
   * `_open_osfhandle` (exported by node.exe — same CRT fd table as the
   * consumer side) followed by Node's `pipe_wrap` open.
   *
   * Ownership: on SUCCESS the returned CRT fd owns the raw HANDLE (CloseHandle
   * on it becomes a double-close); on FAILURE (throw) the raw HANDLE is still
   * unowned and `closePipeHandle` is the correct cleanup.
   */
  openTransportHandle(handle: bigint): { fd: number } {
    const fd = this.uvOpenOsfhandle(handle);
    if (fd === -1) {
      throw new Error('uv_open_osfhandle failed');
    }
    return { fd };
  }

  /**
   * Close a CRT fd previously produced by `openTransportHandle` (the
   * HANDLE→fd ownership transfer was already consumed). Uses node.exe's own
   * `uv_fs_close` — the ONLY close in this module that shares the fd table
   * with `uv_open_osfhandle` (node.exe does not export `_close`). Runs
   * synchronously (cb=null) so the caller can reason about the fd state right
   * after; `UV_EBADF` is tolerated as "nothing left to release".
   */
  closeFileDescriptor(fd: number): void {
    const req = this.koffi.alloc('uint8', 2048);
    try {
      const rc = this.uvFsClose(this.uvDefaultLoop(), req, fd, null);
      if (rc !== 0 && rc !== -4083 /* UV_EBADF */) {
        throw new Error(`uv_fs_close failed (rc=${String(rc)})`);
      }
    } finally {
      this.uvFsReqCleanup(req);
      this.koffi.free(req);
    }
  }

  closePipeHandle(handle: bigint): void {
    this.closeHandle(handle);
  }
}
