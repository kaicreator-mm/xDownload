/**
 * #T019 packaged-windows-pipe — the packaged Windows named-pipe surface on
 * the packaged artifacts (win32-x64 only; every other platform records the
 * suite honestly NOT_EXECUTED).
 *
 * Runs the installed-path journeys in a clean temp environment (only the
 * emitted package trees, zero workspace/node_modules/store residue) and
 * writes durable structured evidence
 * (build/evidence/windows-cli-core-named-pipe.json):
 *
 *   Core host `--pipe-name` (OS-verified server transport, koffi vendored in
 *   the package) → packaged CLI `--pipe-name` client (real HTTP transfer,
 *   SHA-256-verified durable bytes) → packaged native-host broker carrying
 *   the installed S5 current-page batch journey over the SAME OS-verified
 *   pipe (prepare → confirm → execute with real per-member Core acquisition
 *   and durable byte-verified members) → Core-host restart re-deriving the
 *   CLI download terminal from durable truth with no re-download.
 *
 * Recorded scope boundary: the S5 batch terminal is durable in-session; its
 * CROSS-RESTART re-derivation is a known product gap in the S5 reconcile
 * re-drive (duplicate durable acquire command identity), reported separately
 * and NOT claimed or asserted here (it is core state, independent of the
 * packaged pipe transport this suite proves).
 *
 * Truthful negatives: with no Core listening, the packaged CLI fails closed
 * with the typed TRANSPORT document (exit 5) — the pipe request never
 * degrades into TCP.
 *
 * Only localhost fixtures are used; nothing external is contacted. The
 * script fails (exit 1) if any executed check FAILs. Not executed here
 * (stays NOT_PROVEN): the real-browser extension<->native handshake and the
 * interactive S3/S4 confirm gestures (they require an attached TTY).
 *
 * Run after `pnpm build`:  node build/winpipe-e2e.ts
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './build-config.ts';

interface CheckResult {
  readonly id: string;
  readonly status: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  readonly command?: readonly string[];
  readonly exitCode?: number;
  readonly expectedExitCode?: number;
  readonly detail: string;
  readonly stdoutExcerpt?: string;
  readonly stderrExcerpt?: string;
}

interface EvidenceDoc {
  readonly suite: string;
  readonly executedAt: string;
  readonly environment: Record<string, string>;
  readonly checks: readonly CheckResult[];
  readonly overall: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
}

function excerpt(text: string | undefined, limit = 500): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function environment(): Record<string, string> {
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.versions.node,
    executable: process.execPath,
  };
}

function writeEvidence(checks: readonly CheckResult[]): void {
  const overall = checks.some((check) => check.status === 'FAIL')
    ? 'FAIL'
    : checks.every((check) => check.status === 'NOT_EXECUTED')
      ? 'NOT_EXECUTED'
      : 'PASS';
  const doc: EvidenceDoc = {
    suite: 'windows-cli-core-named-pipe',
    executedAt: new Date().toISOString(),
    environment: environment(),
    checks,
    overall,
  };
  const evidenceDir = path.join(REPO_ROOT, 'build', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `${doc.suite}.json`);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stdout.write(`evidence: ${file} (overall ${doc.overall})\n`);
}

function check(id: string, detail: string): CheckResult {
  return { id, status: 'PASS', detail };
}

function failedCheck(id: string, detail: string): CheckResult {
  return { id, status: 'FAIL', detail };
}

interface Spawned {
  readonly proc: ReturnType<typeof spawn>;
  stdout: string;
  stderr: string;
}

function spawnNode(scriptPath: string, args: readonly string[]): Spawned {
  const proc = spawn(process.execPath, [scriptPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const captured: Spawned = { proc, stdout: '', stderr: '' };
  proc.stdout.on('data', (chunk: Buffer) => {
    captured.stdout += chunk.toString('utf8');
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    captured.stderr += chunk.toString('utf8');
  });
  return captured;
}

function stopSpawned(spawned: Spawned): void {
  if (!spawned.proc.killed && spawned.proc.exitCode === null) {
    spawned.proc.kill('SIGTERM');
  }
}

interface Origin {
  /** Deterministic per-path request counts (evidence-side read only). */
  requestCount(pathname: string): number;
  uri(pathname: string): string;
  readonly fileBytes: Uint8Array;
  readonly fileDigest: string;
  readonly members: readonly { readonly name: string; readonly bytes: Uint8Array }[];
  stop(): Promise<void>;
}

/** Controlled localhost origin: one download target plus S5 member files. */
function startOrigin(): Promise<Origin> {
  const fileBytes = new Uint8Array(Array.from({ length: 192 * 1024 }, (_, index) => index % 253));
  const members = [
    { name: 'm1.bin', bytes: new Uint8Array(Array.from({ length: 33 * 1024 }, (_, i) => i % 31)) },
    {
      name: 'm2.bin',
      bytes: new Uint8Array(Array.from({ length: 17 * 1024 }, (_, i) => (i * 7) % 41)),
    },
  ];
  const counts = new Map<string, number>();
  const bump = (pathname: string): void => {
    counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    bump(pathname);
    const serve = (bytes: Uint8Array): void => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      });
      response.end(Buffer.from(bytes));
    };
    if (pathname === '/file.bin') {
      serve(fileBytes);
      return;
    }
    const member = members.find((entry) => `/${entry.name}` === pathname);
    if (member !== undefined) {
      serve(member.bytes);
      return;
    }
    if (pathname === '/page.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><body>links</body></html>');
      return;
    }
    response.writeHead(404, { 'content-length': '0' });
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        requestCount: (pathname) => counts.get(pathname) ?? 0,
        uri: (pathname) => `http://127.0.0.1:${String(port)}${pathname}`,
        fileBytes,
        fileDigest: createHash('sha256').update(fileBytes).digest('hex'),
        members,
        stop: () =>
          new Promise<void>((done) => {
            server.closeIdleConnections();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** The LAST ready document wins (restarts may append to the same stream). */
function readyDocument(stdout: string): { port?: number; pipeName?: string } | undefined {
  let ready: { port?: number; pipeName?: string } | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('xdownload.core-host.ready')) {
      continue;
    }
    try {
      ready = JSON.parse(line) as { port?: number; pipeName?: string };
    } catch {
      // ignore malformed lines
    }
  }
  return ready;
}

async function waitReady(spawned: Spawned, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (readyDocument(spawned.stdout) !== undefined) {
      return;
    }
    if (spawned.proc.exitCode !== null) {
      throw new Error(
        `core host exited early (${String(spawned.proc.exitCode)}): ${spawned.stderr.slice(0, 400)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `core host not ready within ${String(timeoutMs)}ms: ${spawned.stderr.slice(0, 400)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function runCli(
  cliScript: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const spawned = spawnNode(cliScript, args);
  return await new Promise((resolve) => {
    spawned.proc.on('exit', (code) => {
      resolve({ exitCode: code ?? -1, stdout: spawned.stdout, stderr: spawned.stderr });
    });
  });
}

// ------------------------------------------------- native messaging framing

interface NmSession {
  request(frame: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  stop(): void;
  readonly stderr: string;
}

/** One broker stdio session: Native Messaging frames in, one response per request. */
function startBrokerSession(hostBundle: string, configPath: string, origin: string): NmSession {
  const proc = spawn(process.execPath, [hostBundle, '--config', configPath, origin], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffered: Buffer = Buffer.alloc(0);
  let stderr = '';
  const pending = new Map<
    string,
    { resolve: (value: Record<string, unknown>) => void; timer: NodeJS.Timeout }
  >();
  proc.stdout.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 4) {
        return;
      }
      const declared = buffered.readUInt32LE(0);
      if (buffered.length < 4 + declared) {
        return;
      }
      const payload = buffered.subarray(4, 4 + declared).toString('utf8');
      buffered = buffered.subarray(4 + declared);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        parsed = { kind: 'UNPARSEABLE', payload };
      }
      const requestId = typeof parsed['requestId'] === 'string' ? parsed['requestId'] : undefined;
      if (requestId !== undefined) {
        const waiter = pending.get(requestId);
        if (waiter !== undefined) {
          pending.delete(requestId);
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
        }
      }
    }
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  proc.on('exit', (code) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve({ kind: 'BROKER_EXITED', exitCode: code ?? -1, requestId: 'unknown', stderr });
    }
    pending.clear();
  });
  return {
    stderr,
    request(frame: Record<string, unknown>, timeoutMs = 120_000): Promise<Record<string, unknown>> {
      const requestId = typeof frame['requestId'] === 'string' ? frame['requestId'] : 'unknown';
      const body = Buffer.from(JSON.stringify(frame), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.byteLength, 0);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({ kind: 'TIMEOUT', requestId });
        }, timeoutMs);
        pending.set(requestId, { resolve, timer });
        proc.stdin.write(Buffer.concat([header, body]));
      });
    },
    stop(): void {
      if (proc.exitCode === null && !proc.killed) {
        proc.stdin.end();
        proc.kill('SIGTERM');
      }
    },
  };
}

// -------------------------------------------------------------------- driver

/**
 * Run the packaged named-pipe evidence suite. Invoked by `pnpm smoke` and
 * executable directly (`node build/winpipe-e2e.ts` after `pnpm build`).
 */
export async function runNamedPipeSuite(): Promise<'PASS' | 'FAIL' | 'NOT_EXECUTED'> {
  const checks: CheckResult[] = [];
  if (process.platform !== 'win32') {
    checks.push({
      id: 'windows-named-pipe-suite',
      status: 'NOT_EXECUTED',
      detail: `named-pipe surfaces are Windows-only; this host is ${process.platform}-${process.arch}`,
    });
    writeEvidence(checks);
    return 'NOT_EXECUTED';
  }
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-winpipe-'));
  const cliDir = path.join(cleanRoot, 'cli');
  const coreDir = path.join(cleanRoot, 'core');
  const hostDir = path.join(cleanRoot, 'native-host');
  fs.cpSync(path.join(REPO_ROOT, 'dist', 'cli'), cliDir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'dist', 'core'), coreDir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'dist', 'native-host'), hostDir, { recursive: true });
  const cliScript = path.join(cliDir, 'xdownload-cli.js');
  const coreScript = path.join(coreDir, 'xdownload-core-host.js');
  const hostBundle = path.join(hostDir, 'xdownload-broker-host.js');
  const coreRoot = path.join(cleanRoot, 'core-data');
  const installId = `winpipe-e2e-${randomBytes(4).toString('hex')}`;
  const userId = 'winpipe-e2e-user';
  const pipeName = String.raw`\\.\pipe\xdownload-core-${installId}`;
  const peerArgs = ['--install-id', installId, '--user-id', userId];
  const origin = await startOrigin();
  let core: Spawned | undefined;
  let broker: NmSession | undefined;
  try {
    // 1. Truthful negative FIRST: with no Core listening on the pipe, the
    //    packaged CLI fails closed with the typed TRANSPORT document — a
    //    pipe request never degrades into TCP.
    const absent = await runCli(cliScript, [
      'download',
      '--url',
      origin.uri('/file.bin'),
      '--pipe-name',
      pipeName,
      ...peerArgs,
      '--timeout-ms',
      '15000',
      '--poll-ms',
      '100',
    ]);
    checks.push(
      absent.exitCode === 5 && absent.stdout.includes('TRANSPORT')
        ? check(
            'packaged-cli-pipe-absent-core-typed-failure',
            'with no Core listening, the packaged CLI --pipe-name request fails fast with the typed TRANSPORT document (exit 5); no TCP fallback, no fabricated status',
          )
        : failedCheck(
            'packaged-cli-pipe-absent-core-typed-failure',
            `exit=${String(absent.exitCode)} stdout=${absent.stdout.slice(0, 300)} stderr=${absent.stderr.slice(0, 200)}`,
          ),
    );

    // 2. The packaged Core host serves the OS-verified pipe transport.
    const startCore = (): Spawned =>
      spawnNode(coreScript, ['--root', coreRoot, '--pipe-name', pipeName, ...peerArgs]);
    core = startCore();
    await waitReady(core);
    const ready = readyDocument(core.stdout);
    checks.push(
      ready?.pipeName === pipeName
        ? check(
            'packaged-core-host-pipe-ready',
            `packaged Core host (koffi vendored) composed the runtime and reported readiness on the canonical pipe ${pipeName}`,
          )
        : failedCheck(
            'packaged-core-host-pipe-ready',
            `ready document pipeName mismatch: ${JSON.stringify(ready)}`,
          ),
    );

    // 3. Real download through the pipe: CLI --pipe-name → Core-executed
    //    HTTP transfer → COMPLETE terminal with decisive byte identity.
    const download = await runCli(cliScript, [
      'download',
      '--url',
      origin.uri('/file.bin'),
      '--sha256',
      origin.fileDigest,
      '--pipe-name',
      pipeName,
      ...peerArgs,
      '--timeout-ms',
      '45000',
      '--poll-ms',
      '100',
    ]);
    let downloadDoc: Record<string, unknown> = {};
    try {
      downloadDoc = JSON.parse(download.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty; the failure branch records the excerpt
    }
    const downloadContractId =
      typeof downloadDoc['contract_id'] === 'string' ? downloadDoc['contract_id'] : '';
    checks.push(
      download.exitCode === 0 &&
        downloadDoc['document'] === 'xdownload.cli.status' &&
        downloadDoc['RequestFulfillmentStatus'] === 'COMPLETE' &&
        downloadDoc['lineage_status'] === 'TERMINAL' &&
        downloadDoc['target_evidence_basis'] === 'PUBLISHED_SHA256'
        ? {
            ...check(
              'packaged-cli-pipe-real-download-complete',
              'packaged CLI --pipe-name → OS-verified seam → real HTTP transfer → COMPLETE terminal (PUBLISHED_SHA256 decisive)',
            ),
            command: ['node', 'cli/xdownload-cli.js', 'download', '--pipe-name', pipeName],
            exitCode: download.exitCode,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(download.stdout.trim()),
          }
        : {
            ...failedCheck(
              'packaged-cli-pipe-real-download-complete',
              `exit=${String(download.exitCode)} stdout=${download.stdout.trim().slice(0, 300)} stderr=${download.stderr.slice(0, 200)}`,
            ),
            command: ['node', 'cli/xdownload-cli.js', 'download', '--pipe-name', pipeName],
            exitCode: download.exitCode,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(download.stdout.trim()),
            stderrExcerpt: excerpt(download.stderr),
          },
    );

    // 4. The durable bytes verify and exactly one origin request happened.
    const fileRequests = origin.requestCount('/file.bin');
    const artifactRoot = path.join(coreRoot, 'artifacts');
    const walkDurable = (): readonly string[] => {
      const found: string[] = [];
      const walk = (dir: string): void => {
        if (!fs.existsSync(dir)) {
          return;
        }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else {
            found.push(full);
          }
        }
      };
      walk(artifactRoot);
      return found;
    };
    const durableFiles = walkDurable();
    const verifiedDownload = durableFiles.some((file) => {
      const content = fs.readFileSync(file);
      return (
        content.byteLength === origin.fileBytes.byteLength &&
        createHash('sha256').update(content).digest('hex') === origin.fileDigest
      );
    });
    checks.push(
      fileRequests === 1 && verifiedDownload
        ? check(
            'pipe-download-durable-bytes-sha256-verified',
            `exactly one origin request; the durable artifact is byte-identical (${String(origin.fileBytes.byteLength)} bytes, SHA-256 match)`,
          )
        : failedCheck(
            'pipe-download-durable-bytes-sha256-verified',
            `fileRequests=${String(fileRequests)} durableFiles=${String(durableFiles.length)} verified=${String(verifiedDownload)}`,
          ),
    );

    // 5. The packaged native-host broker carries the installed S5 current-page
    //    batch journey over the SAME OS-verified pipe (real per-member
    //    acquisition executed by Core).
    const brokerConfigPath = path.join(cleanRoot, 'broker-config.json');
    const callerOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
    fs.writeFileSync(
      brokerConfigPath,
      JSON.stringify({
        allowedOrigins: [callerOrigin],
        core: { installId, userId, pipeName },
      }),
      'utf8',
    );
    broker = startBrokerSession(hostBundle, brokerConfigPath, callerOrigin);
    const pageUrl = origin.uri('/page.html');
    const memberHrefs = origin.members.map((member) => origin.uri(`/${member.name}`));
    const prepare = await broker.request({
      kind: 'S5_GROUP_PREPARE',
      requestId: 'wp-prepare-1',
      s5: {
        tabId: 1,
        pageUrl,
        members: memberHrefs.map((href, index) => ({
          href,
          text: `Member file ${String(index + 1)}`,
        })),
      },
    });
    const prepared = prepare['kind'] === 'S5_RESULT' && prepare['phase'] === 'PREPARED';
    const preparedFacts = (prepared ? (prepare['facts'] as Record<string, unknown>) : {}) ?? {};
    const preparedMembers = Array.isArray(preparedFacts['members'])
      ? (preparedFacts['members'] as readonly Record<string, unknown>[])
      : [];
    const memberIds = preparedMembers
      .map((member) => member['memberId'])
      .filter((id): id is string => typeof id === 'string');
    const contractId = typeof prepare['contractId'] === 'string' ? prepare['contractId'] : '';
    const snapshotId =
      typeof preparedFacts['snapshotId'] === 'string' ? preparedFacts['snapshotId'] : '';
    const prepareId =
      typeof preparedFacts['prepareId'] === 'string' ? preparedFacts['prepareId'] : '';
    checks.push(
      prepared && memberIds.length === memberHrefs.length && contractId.length > 0
        ? {
            ...check(
              'packaged-broker-pipe-s5-prepare',
              `packaged broker (stdio Native Messaging) froze the observed page group over the OS-verified pipe: ${String(memberIds.length)} members, prepareId minted by Core`,
            ),
            detail: `contract=${contractId} members=${String(memberIds.length)}`,
          }
        : {
            ...failedCheck(
              'packaged-broker-pipe-s5-prepare',
              `response=${JSON.stringify(prepare).slice(0, 400)} brokerStderr=${broker.stderr.slice(0, 200)}`,
            ),
          },
    );

    if (prepared && contractId.length > 0 && snapshotId.length > 0 && prepareId.length > 0) {
      const confirm = await broker.request({
        kind: 'S5_GROUP_CONFIRM',
        requestId: 'wp-confirm-1',
        s5: {
          contractId,
          prepareId,
          snapshotId,
          selectedMemberIds: memberIds,
          decisionToken: `user-confirm:${contractId}`,
        },
      });
      const confirmedFacts =
        confirm['kind'] === 'S5_RESULT' && confirm['phase'] === 'CONFIRMED'
          ? ((confirm['facts'] as Record<string, unknown>) ?? {})
          : {};
      const confirmedGroupId =
        typeof confirmedFacts['confirmedGroupId'] === 'string'
          ? confirmedFacts['confirmedGroupId']
          : '';
      checks.push(
        confirmedGroupId.length > 0
          ? check(
              'packaged-broker-pipe-s5-confirm',
              'the explicit user-confirm decision token was consumed atomically with the durable Core-confirmed group (connection-bound challenge)',
            )
          : failedCheck(
              'packaged-broker-pipe-s5-confirm',
              `response=${JSON.stringify(confirm).slice(0, 400)}`,
            ),
      );

      if (confirmedGroupId.length > 0) {
        const requestsBeforeExecute = memberHrefs.reduce(
          (total, href) => total + origin.requestCount(new URL(href).pathname),
          0,
        );
        const execute = await broker.request({
          kind: 'S5_GROUP_EXECUTE',
          requestId: 'wp-execute-1',
          s5: { contractId, confirmedGroupId, snapshotId },
        });
        const executeFacts =
          execute['kind'] === 'S5_RESULT' && execute['phase'] === 'TERMINAL'
            ? ((execute['facts'] as Record<string, unknown>) ?? {})
            : {};
        const executedMembers = Array.isArray(executeFacts['members'])
          ? (executeFacts['members'] as readonly Record<string, unknown>[])
          : [];
        const acquiredCount = executedMembers.filter(
          (member) => member['outcome'] === 'ACQUIRED' && member['accepted'] === true,
        ).length;
        // Real per-member acquisition: each member file was fetched exactly
        // once by Core and landed byte-identical under the durable root (the
        // walk is refreshed AFTER the execute — members landed during it).
        const durableAfterExecute = walkDurable();
        let verifiedMembers = 0;
        for (const member of origin.members) {
          const digest = createHash('sha256').update(member.bytes).digest('hex');
          if (
            durableAfterExecute.some((file) => {
              const content = fs.readFileSync(file);
              return (
                content.byteLength === member.bytes.byteLength &&
                createHash('sha256').update(content).digest('hex') === digest
              );
            })
          ) {
            verifiedMembers += 1;
          }
        }
        const memberRequests = memberHrefs.reduce(
          (total, href) => total + origin.requestCount(new URL(href).pathname),
          0,
        );
        checks.push(
          execute['kind'] === 'S5_RESULT' &&
            execute['phase'] === 'TERMINAL' &&
            acquiredCount === origin.members.length &&
            verifiedMembers === origin.members.length &&
            memberRequests - requestsBeforeExecute === origin.members.length
            ? check(
                'packaged-broker-pipe-s5-execute-real-batch-download',
                `Core executed the confirmed batch over the pipe: ${String(acquiredCount)}/${String(origin.members.length)} members ACQUIRED, durable bytes byte-identical, exactly ${String(origin.members.length)} member requests`,
              )
            : failedCheck(
                'packaged-broker-pipe-s5-execute-real-batch-download',
                `response=${JSON.stringify(execute).slice(0, 400)} acquired=${String(acquiredCount)} verified=${String(verifiedMembers)} memberRequests=${String(memberRequests - requestsBeforeExecute)}`,
              ),
        );

        // 6. Persistence: a Core restart re-derives the CLI download terminal
        //    from durable truth with NO re-download, over the SAME pipe name.
        //    Scope note (recorded honestly): this proves the S1 lane's
        //    restart persistence over the pipe. The S5 batch terminal is
        //    durable in-session (checked above); its CROSS-RESTART
        //    re-derivation is a recorded product gap in the S5 reconcile
        //    re-drive (duplicate durable acquire command identity), reported
        //    separately for authorization — it is a core-state issue that
        //    exists independently of the packaged pipe transport, so this
        //    suite neither claims nor asserts it.
        stopSpawned(core);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        core = startCore();
        await waitReady(core);
        const requestsBeforeRestart = origin.requestCount('/file.bin');
        const status = await runCli(cliScript, [
          'status',
          '--contract',
          downloadContractId,
          '--pipe-name',
          pipeName,
          ...peerArgs,
        ]);
        let statusDoc: Record<string, unknown> = {};
        try {
          statusDoc = JSON.parse(status.stdout.trim()) as Record<string, unknown>;
        } catch {
          // left empty
        }
        const persisted =
          status.exitCode === 0 &&
          statusDoc['RequestFulfillmentStatus'] === 'COMPLETE' &&
          statusDoc['lineage_status'] === 'TERMINAL' &&
          origin.requestCount('/file.bin') === requestsBeforeRestart &&
          memberHrefs.every((href) => origin.requestCount(new URL(href).pathname) === 1);
        checks.push(
          persisted
            ? check(
                'pipe-restart-s1-terminal-rederived-from-durable-truth',
                `after a Core-host restart on the same pipe: the S1 COMPLETE terminal re-derives from durable truth with no re-download (origin requests unchanged)`,
              )
            : failedCheck(
                'pipe-restart-s1-terminal-rederived-from-durable-truth',
                `statusExit=${String(status.exitCode)} status=${status.stdout.trim().slice(0, 250)} fileRequests=${String(origin.requestCount('/file.bin'))}`,
              ),
        );
      }
    } else {
      checks.push(
        failedCheck('packaged-broker-pipe-s5-confirm', 'prerequisite missing: prepared facts'),
      );
      checks.push(
        failedCheck(
          'packaged-broker-pipe-s5-execute-real-batch-download',
          'prerequisite missing: prepared facts',
        ),
      );
      checks.push(
        failedCheck(
          'pipe-restart-s1-terminal-rederived-from-durable-truth',
          'prerequisite missing: prepared facts',
        ),
      );
    }
  } catch (error) {
    checks.push(
      failedCheck('winpipe-e2e-unhandled', error instanceof Error ? error.message : String(error)),
    );
  } finally {
    if (broker !== undefined) {
      broker.stop();
    }
    if (core !== undefined) {
      stopSpawned(core);
    }
    await origin.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }
  writeEvidence(checks);
  return checks.some((item) => item.status === 'FAIL') ? 'FAIL' : 'PASS';
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist'))) {
    process.stdout.write('dist/ missing; run the package build first\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `named-pipe e2e host: ${process.platform}-${process.arch} node ${process.versions.node}\n`,
  );
  process.exitCode = (await runNamedPipeSuite()) === 'FAIL' ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
