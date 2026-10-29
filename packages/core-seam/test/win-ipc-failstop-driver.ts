/**
 * #101 S3-WIN-IPC-001 — subprocess driver for native fail-stop drills.
 *
 * The bridge's fail-stop contract (`process.exit(70)`) can only be observed
 * in a dedicated process: the three scenarios below each create REAL kernel
 * state (a real listening pipe instance and, where noted, REAL pending
 * overlapped I/O), inject one FFI-layer failure, and must terminate the
 * process instead of ever returning an accept object whose kernel-referenced
 * native memory lifetime is unproven.
 *
 * Exit codes: 70 = the expected fail-stop; 1 = a drill returned unexpectedly
 * (a fail-open defect); 2 = environmental (no bridge / unknown scenario).
 * The parent test in `win-ipc-fault-injection.test.ts` asserts code + stderr.
 */

import { WindowsIpcBridge } from '../src/win-ipc.ts';

const scenario = process.argv[2] ?? '';
const real = WindowsIpcBridge.tryLoad();
if (real === null) {
  process.stderr.write('failstop-driver requires win32 with the koffi bridge\n');
  process.exit(2);
}

const injectable = real as unknown as Record<string, unknown>;
const sd = real.buildProtectedSecurityDescriptor();
const name = `\\\\.\\pipe\\xdownload-failstop-${scenario}-${String(process.pid)}-${String(Date.now())}`;
const server = real.createPipeInstance(name, sd, true);

if (scenario === 'connect-throw') {
  injectable.connectNamedPipe = () => {
    throw new Error('injected ConnectNamedPipe FFI failure');
  };
  real.beginPipeAccept(server);
  process.stderr.write(
    'ERROR: beginPipeAccept returned after an injected ConnectNamedPipe throw\n',
  );
  process.exit(1);
}

if (scenario === 'wait-registration-throw') {
  injectable.waitForSingleObject = {
    async: () => {
      throw new Error('injected WaitForSingleObject.async registration failure');
    },
  };
  // ConnectNamedPipe queues REAL pending kernel I/O (no client yet), then the
  // injected registration throw leaves that I/O with no asynchronous release
  // owner — the process must fail-stop, never return the accept.
  real.beginPipeAccept(server);
  process.stderr.write('ERROR: beginPipeAccept returned after an injected registration throw\n');
  process.exit(1);
}

if (scenario === 'unprovable-terminality') {
  // REAL pending I/O first (wait armed inside beginPipeAccept).
  const accept = real.beginPipeAccept(server);
  void accept;
  // When the client arrives the wait fires normally, but the injected
  // GetOverlappedResult can no longer prove I/O terminality (error=1234 is
  // neither a completion, OPERATION_ABORTED, nor IO_INCOMPLETE). The process
  // must fail-stop rather than free native memory the kernel may reference.
  injectable.getOverlappedResult = () => 0;
  injectable.getLastError = () => 1234;
  const client = real.openNamedPipeClient(name);
  void client;
  // Stay alive (ref'd interval) until the armed wait callback runs; its
  // fail-stop is what must terminate the process.
  setInterval(() => undefined, 60_000);
} else {
  process.stderr.write(`failstop-driver: unknown scenario '${scenario}'\n`);
  process.exit(2);
}
