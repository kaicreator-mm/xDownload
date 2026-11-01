// Raw Windows named-pipe client with the impersonation QoS the Core's
// OS-verified admission requires (SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION,
// mirroring win-ipc.ts openNamedPipeClient). Plain Node net.createConnection
// is silently refused by design (verified: EPIPE before any response).
// Synchronous CreateFileW/ReadFile/WriteFile via koffi from the frozen payload.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const KOFFI_DIR = 'C:/xDev/kAiCreator/xDownload/xd-v021-finalval/out/installer/xdownload-v0.2.1-windows-x64/payload/core/node_modules/koffi';
const koffi = require(path.join(KOFFI_DIR, 'index.cjs'));

const kernel32 = koffi.load('kernel32.dll');

const CreateFileW = kernel32.func(
  'void *CreateFileW(const uint16_t *lpFileName, uint32_t dwDesiredAccess, uint32_t dwShareMode, void *lpSecurityAttributes, uint32_t dwCreationDisposition, uint32_t dwFlagsAndAttributes, void *hTemplateFile)',
);
const ReadFile = kernel32.func(
  'bool ReadFile(void *hFile, void *lpBuffer, uint32_t nNumberOfBytesToRead, uint32_t *lpNumberOfBytesRead, void *lpOverlapped)',
);
const WriteFile = kernel32.func(
  'bool WriteFile(void *hFile, void *lpBuffer, uint32_t nNumberOfBytesToWrite, uint32_t *lpNumberOfBytesWritten, void *lpOverlapped)',
);
const CloseHandle = kernel32.func('bool CloseHandle(void *hObject)');
const GetLastError = kernel32.func('uint32_t GetLastError()');

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const OPEN_EXISTING = 3;
const SQOS_IMPERSONATE = 0x00100000 | 0x00020000;
const INVALID = BigInt('0xFFFFFFFFFFFFFFFF');

/** utf16le Buffer, null-terminated (mirrors win-ipc nameBuf). */
function toU16(str) {
  return Buffer.concat([Buffer.from(str, 'utf16le'), Buffer.from([0, 0])]);
}

/**
 * One synchronous framed request: open → write(4BE len + body) → read one
 * length-prefixed response frame → close. Throws on any failure.
 */
export function rawPipeSync(pipeName, envelopeJson, { maxBody = 4 * 1024 * 1024 } = {}) {
  const nameBuf = toU16(pipeName);
  const handle = CreateFileW(nameBuf, GENERIC_READ | GENERIC_WRITE, 0, null, OPEN_EXISTING, SQOS_IMPERSONATE, null);
  if (handle === INVALID) {
    throw new Error(`CreateFileW failed (GetLastError=${GetLastError()})`);
  }
  try {
    const body = Buffer.from(envelopeJson, 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.byteLength, 0);
    const out = Buffer.concat([head, body]);
    const written = Buffer.alloc(4);
    if (!WriteFile(handle, out, out.byteLength, written, null)) {
      throw new Error(`WriteFile failed (GetLastError=${GetLastError()})`);
    }
    // Read exactly one response frame.
    const chunks = [];
    let got = 0;
    let need = 4;
    for (;;) {
      const buf = Buffer.alloc(65536);
      const read = Buffer.alloc(4);
      if (!ReadFile(handle, buf, buf.byteLength, read, null)) {
        const err = GetLastError();
        if (got === 0 && read.readUInt32LE(0) === 0) {
          throw new Error(`pipe closed without response (ReadError=${err})`);
        }
        throw new Error(`ReadFile failed (GetLastError=${err})`);
      }
      const n = read.readUInt32LE(0);
      if (n === 0) {
        throw new Error('pipe closed without complete frame');
      }
      chunks.push(buf.subarray(0, n));
      got += n;
      if (need === 4 && got >= 4) {
        const headBuf = Buffer.concat(chunks);
        const bodyLen = headBuf.readUInt32BE(0);
        if (bodyLen > maxBody) throw new Error(`response frame too large: ${bodyLen}`);
        need = 4 + bodyLen;
      }
      if (got >= need) break;
    }
    const full = Buffer.concat(chunks);
    return JSON.parse(full.subarray(4, 4 + (need - 4)).toString('utf8'));
  } finally {
    CloseHandle(handle);
  }
}
