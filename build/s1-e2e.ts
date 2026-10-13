/**
 * #101 first slice — S1 real direct-download E2E on the packaged artifacts.
 *
 * Runs the actual installed-path journey and writes durable structured
 * evidence (build/evidence/windows-s1-direct-download.json):
 *
 *   packaged CLI (`xdownload download`) → loopback seam → packaged Core host
 *   → REAL HTTP transfer from a controlled local origin → durable artifact
 *   bytes (+ SHA-256/size verification) → Core-derived terminal truth.
 *
 * Truthful negatives and recovery are exercised on the same composition:
 * a declared-digest mismatch is a FAILED terminal (never a fabricated
 * success), an unreachable origin fails closed, and a Core-host restart
 * re-derives the identical terminal from durable truth with NO re-download.
 *
 * Only localhost fixtures are used; nothing external is contacted. The
 * script fails (exit 1) if any check FAILs; every executed check is recorded
 * with its real command and output — nothing here is a faked unit assertion.
 *
 * Run after `pnpm build`:  node build/s1-e2e.ts
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT } from './build-config.ts';

interface CheckResult {
  readonly id: string;
  readonly status: 'PASS' | 'FAIL';
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
  readonly overall: 'PASS' | 'FAIL';
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
  const doc: EvidenceDoc = {
    suite: 'windows-s1-direct-download',
    executedAt: new Date().toISOString(),
    environment: environment(),
    checks,
    overall: checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS',
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
  if (!spawned.proc.killed) {
    spawned.proc.kill('SIGTERM');
  }
}

interface Origin {
  readonly uri: string;
  readonly host: string;
  readonly digest: string;
  readonly byteSize: number;
  requestCount(): number;
  /** Hang responses torn down by the client (abort checkpoint evidence). */
  closedHangCount(): number;
  stop(): Promise<void>;
}

/** Controlled localhost origin: one deterministic file, counted requests. */
function startOrigin(bytes: Uint8Array): Promise<Origin> {
  const digest = createHash('sha256').update(bytes).digest('hex');
  let requests = 0;
  let closedHang = 0;
  const hanging: http.ServerResponse[] = [];
  const server = http.createServer((request, response) => {
    requests += 1;
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/redirect-away.bin') {
      // A redirect outside the origin's own host: never admissible under the
      // CLI's declared delivery graph (the locator host only).
      response.writeHead(302, { location: 'http://127.0.0.1:9/file.bin' });
      response.end();
      return;
    }
    if (url.pathname === '/page.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': '32',
      });
      response.end('<html><body>login</body></html>');
      return;
    }
    if (url.pathname === '/hang.bin') {
      // A stalled origin: headers promise 100 bytes that never arrive.
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': '100',
      });
      response.on('close', () => {
        closedHang += 1;
      });
      hanging.push(response);
      return;
    }
    if (url.pathname !== '/file.bin') {
      response.writeHead(404, { 'content-length': '0' });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      etag: '"s1e2e"',
      'accept-ranges': 'bytes',
    });
    response.end(Buffer.from(bytes));
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        uri: `http://127.0.0.1:${String(port)}/file.bin`,
        host: `127.0.0.1:${String(port)}`,
        digest,
        byteSize: bytes.byteLength,
        requestCount: () => requests,
        closedHangCount: () => closedHang,
        stop: () =>
          new Promise<void>((done) => {
            for (const response of hanging.splice(0)) {
              response.destroy();
            }
            server.closeIdleConnections();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function readyPort(stdout: string): number | undefined {
  // The host may report readiness more than once across restarts on the
  // same captured stream; the LAST ready document is the live listener.
  let port: number | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('xdownload.core-host.ready')) {
      continue;
    }
    try {
      const doc = JSON.parse(line) as { port?: number };
      if (typeof doc.port === 'number') {
        port = doc.port;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return port;
}

/**
 * Durable journal observation (evidence-side read, like the artifact walks):
 * the aggregate id of the last durably accepted SUBMIT_CONTRACT / the last
 * aggregate with a durably accepted EXECUTE_S1_DIRECT_ACQUISITION. Lets the
 * harness correlate a still-running download to its contract id and cancel
 * it mid-wait at the exact post-execute revision.
 */
function contractIdsFromJournal(coreRoot: string): {
  readonly submitted: string | undefined;
  readonly executed: string | undefined;
} {
  const file = path.join(coreRoot, 'seam-journal.jsonl');
  let submitted: string | undefined;
  let executed: string | undefined;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { submitted: undefined, executed: undefined };
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const entry = JSON.parse(line) as {
        kind?: string;
        envelope?: { commandType?: string; aggregateId?: string };
      };
      if (entry.kind !== 'COMMAND' || entry.envelope === undefined) {
        continue;
      }
      if (entry.envelope.commandType === 'SUBMIT_CONTRACT') {
        submitted = entry.envelope.aggregateId;
      }
      if (entry.envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION') {
        executed = entry.envelope.aggregateId;
      }
    } catch {
      // A torn/partial trailing line is skipped; append is line-atomic.
    }
  }
  return { submitted, executed };
}

/** Poll until the probe returns a value; bounded, then undefined. */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 15000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main(): Promise<void> {
  const checks: CheckResult[] = [];
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-s1e2e-'));
  const bytes = new Uint8Array(Array.from({ length: 256 * 1024 }, (_, index) => index % 251));
  let origin: Origin | undefined;
  let core: Spawned | undefined;
  let exitCode = 0;
  try {
    // Clean installed layout: only the emitted package trees.
    fs.cpSync(path.join(REPO_ROOT, 'dist', 'cli'), path.join(cleanRoot, 'cli'), {
      recursive: true,
    });
    fs.cpSync(path.join(REPO_ROOT, 'dist', 'core'), path.join(cleanRoot, 'core'), {
      recursive: true,
    });
    origin = await startOrigin(bytes);
    const coreRoot = path.join(cleanRoot, 'core-data');
    const peerArgs = ['--install-id', 's1e2e-install', '--user-id', 's1e2e-user'];
    core = spawnNode(path.join(cleanRoot, 'core', 'xdownload-core-host.js'), [
      '--root',
      coreRoot,
      ...peerArgs,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // The LIVE seam port: every restart rebinds a new loopback port, so this
    // is reassigned after each restart and read at CLI-invocation time.
    let port = readyPort(core.stdout);
    checks.push(
      port === undefined
        ? failedCheck(
            'packaged-core-host-ready',
            `core host did not report readiness: ${core.stderr || core.stdout}`,
          )
        : check(
            'packaged-core-host-ready',
            `packaged Core host composed the authoritative runtime on loopback port ${String(port)}`,
          ),
    );
    if (port === undefined) {
      writeEvidence(checks);
      process.exitCode = 1;
      return;
    }

    const cliScript = path.join(cleanRoot, 'cli', 'xdownload-cli.js');
    const cli = (extra: readonly string[]): readonly string[] => [
      ...extra,
      '--port',
      String(port),
      ...peerArgs,
    ];
    const cliArgs = (extra: readonly string[]): readonly string[] => [
      ...extra,
      '--timeout-ms',
      '45000',
      '--poll-ms',
      '100',
    ];
    const runCliProcess = (
      extra: readonly string[],
    ): { spawned: ReturnType<typeof spawnNode>; argv: readonly string[] } => {
      const argv = cli(extra);
      return { spawned: spawnNode(cliScript, argv), argv };
    };

    // 1. The real download: known SHA, one HTTP transfer, COMPLETE terminal.
    const ok = runCliProcess(cliArgs(['download', '--url', origin.uri, '--sha256', origin.digest]));
    const okRun = ok.spawned;
    await new Promise((resolve) => okRun.proc.on('exit', resolve));
    let successDoc: Record<string, unknown> = {};
    try {
      successDoc = JSON.parse(okRun.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty; assertions below fail with excerpts
    }
    const complete =
      okRun.proc.exitCode === 0 &&
      successDoc['document'] === 'xdownload.cli.status' &&
      successDoc['RequestFulfillmentStatus'] === 'COMPLETE' &&
      successDoc['SelectionAcquisitionStatus'] === 'COMPLETE' &&
      successDoc['StopReason'] === 'NONE' &&
      // #101 P2-2: the known-digest record is durably decisive byte identity.
      successDoc['target_evidence_basis'] === 'PUBLISHED_SHA256' &&
      successDoc['target_evidence_certainty'] === 'DECISIVE';
    checks.push(
      complete
        ? {
            ...check(
              'packaged-cli-download-complete',
              'packaged CLI download → one Core-accepted work item → real HTTP transfer → COMPLETE terminal from the Core projection (submission ACK was not success)',
            ),
            command: ['node', cliScript, ...ok.argv],
            exitCode: okRun.proc.exitCode ?? -1,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(okRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'packaged-cli-download-complete',
              `exit=${String(okRun.proc.exitCode)} stdout=${okRun.stdout.trim().slice(0, 200)} stderr=${okRun.stderr.slice(0, 200)}`,
            ),
            command: ['node', cliScript, ...ok.argv],
            exitCode: okRun.proc.exitCode ?? -1,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(okRun.stdout.trim()),
            stderrExcerpt: excerpt(okRun.stderr),
          },
    );

    // 2. Durable bytes: exactly one origin request; artifact on disk verifies.
    const oneRequest = origin.requestCount() === 1;
    const artifactRoot = path.join(coreRoot, 'artifacts');
    const artifactFiles: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) {
        return;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          artifactFiles.push(full);
        }
      }
    };
    walk(artifactRoot);
    const verified = artifactFiles.find((file) => {
      const content = fs.readFileSync(file);
      return (
        content.byteLength === bytes.byteLength &&
        createHash('sha256').update(content).digest('hex') === origin!.digest
      );
    });
    checks.push(
      oneRequest && verified !== undefined
        ? check(
            'durable-bytes-sha256-verified',
            `exactly one origin request; durable artifact ${path.basename(verified)} is byte-identical (${String(bytes.byteLength)} bytes, SHA-256 match)`,
          )
        : failedCheck(
            'durable-bytes-sha256-verified',
            `originRequests=${String(origin.requestCount())} artifactFiles=${String(artifactFiles.length)} verified=${verified === undefined ? 'no' : 'yes'}`,
          ),
    );

    const contractId =
      typeof successDoc['contract_id'] === 'string' ? successDoc['contract_id'] : '';

    // 3. Truthful negative: a wrong declared digest is a FAILED terminal.
    const bad = runCliProcess(
      cliArgs(['download', '--url', origin.uri, '--sha256', '0'.repeat(64)]),
    );
    const badRun = bad.spawned;
    await new Promise((resolve) => badRun.proc.on('exit', resolve));
    let badDoc: Record<string, unknown> = {};
    try {
      badDoc = JSON.parse(badRun.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty
    }
    const truthfulFailure =
      badRun.proc.exitCode === 4 &&
      badDoc['document'] === 'xdownload.cli.status' &&
      badDoc['RequestFulfillmentStatus'] !== 'COMPLETE' &&
      badDoc['lineage_status'] === 'TERMINAL';
    checks.push(
      truthfulFailure
        ? {
            ...check(
              'digest-mismatch-truthful-failure',
              'wrong declared digest → Core-derived non-COMPLETE terminal, CLI exit 4 — never a fabricated success',
            ),
            command: ['node', cliScript, ...bad.argv],
            exitCode: badRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(badRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'digest-mismatch-truthful-failure',
              `exit=${String(badRun.proc.exitCode)} stdout=${badRun.stdout.trim().slice(0, 200)}`,
            ),
            command: ['node', cliScript, ...bad.argv],
            exitCode: badRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(badRun.stdout.trim()),
          },
    );

    // 4. Truthful negative: unreachable origin fails closed (no success, no hang).
    const dead = runCliProcess(
      cliArgs(['download', '--url', 'http://127.0.0.1:1/file.bin', '--sha256', origin.digest]),
    );
    const deadRun = dead.spawned;
    await new Promise((resolve) => deadRun.proc.on('exit', resolve));
    checks.push(
      deadRun.proc.exitCode === 4
        ? {
            ...check(
              'unreachable-origin-truthful-failure',
              'connection-refused origin → Core-derived non-COMPLETE terminal, CLI exit 4',
            ),
            command: ['node', cliScript, ...dead.argv],
            exitCode: deadRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(deadRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'unreachable-origin-truthful-failure',
              `exit=${String(deadRun.proc.exitCode)} stdout=${deadRun.stdout.trim().slice(0, 200)}`,
            ),
            command: ['node', cliScript, ...dead.argv],
            exitCode: deadRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(deadRun.stdout.trim()),
          },
    );

    // 5. Core-host restart: the completed terminal re-derives from durable
    //    truth with NO re-download (origin request count unchanged).
    if (core !== undefined && contractId.length > 0) {
      const requestsBeforeRestart = origin.requestCount();
      stopSpawned(core);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      core = spawnNode(path.join(cleanRoot, 'core', 'xdownload-core-host.js'), [
        '--root',
        coreRoot,
        ...peerArgs,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const restartedPort = readyPort(core.stdout);
      if (restartedPort === undefined) {
        checks.push(
          failedCheck(
            'core-restart-terminal-rederived',
            `restarted core host did not report readiness: ${core.stderr || core.stdout}`,
          ),
        );
      } else {
        port = restartedPort;
        const statusArgv = [
          'status',
          '--contract',
          contractId,
          '--port',
          String(restartedPort),
          ...peerArgs,
        ];
        const statusRun = spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), statusArgv);
        await new Promise((resolve) => statusRun.proc.on('exit', resolve));
        let statusDoc: Record<string, unknown> = {};
        try {
          statusDoc = JSON.parse(statusRun.stdout.trim()) as Record<string, unknown>;
        } catch {
          // left empty
        }
        const rederived =
          statusRun.proc.exitCode === 0 &&
          statusDoc['document'] === 'xdownload.cli.status' &&
          statusDoc['RequestFulfillmentStatus'] === 'COMPLETE' &&
          statusDoc['lineage_status'] === 'TERMINAL' &&
          origin!.requestCount() === requestsBeforeRestart;
        checks.push(
          rederived
            ? {
                ...check(
                  'core-restart-terminal-rederived',
                  `after a Core-host restart the identical COMPLETE terminal re-derives from durable truth with no re-download (origin requests stayed ${String(requestsBeforeRestart)})`,
                ),
                command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...statusArgv],
                exitCode: statusRun.proc.exitCode ?? -1,
                expectedExitCode: 0,
                stdoutExcerpt: excerpt(statusRun.stdout.trim()),
              }
            : {
                ...failedCheck(
                  'core-restart-terminal-rederived',
                  `exit=${String(statusRun.proc.exitCode)} stdout=${statusRun.stdout.trim().slice(0, 300)} originRequests=${String(origin.requestCount())}`,
                ),
                command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...statusArgv],
                exitCode: statusRun.proc.exitCode ?? -1,
                expectedExitCode: 0,
                stdoutExcerpt: excerpt(statusRun.stdout.trim()),
              },
        );
      }
    } else {
      checks.push(
        failedCheck(
          'core-restart-terminal-rederived',
          'prerequisite missing: core handle or contract id from the success run',
        ),
      );
    }
    // 6. The ordinary download needs NO digest (#101 R1/F01): the CLI runs
    //    with --url only; the harness computes the digest independently for
    //    VERIFICATION only (never handed to the CLI or the Core).
    const requestsBeforeFree = origin.requestCount();
    const free = runCliProcess(cliArgs(['download', '--url', origin.uri]));
    const freeRun = free.spawned;
    await new Promise((resolve) => freeRun.proc.on('exit', resolve));
    let freeDoc: Record<string, unknown> = {};
    try {
      freeDoc = JSON.parse(freeRun.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty; assertions below fail with excerpts
    }
    const freeComplete =
      freeRun.proc.exitCode === 0 &&
      freeDoc['document'] === 'xdownload.cli.status' &&
      freeDoc['RequestFulfillmentStatus'] === 'COMPLETE' &&
      freeDoc['SelectionAcquisitionStatus'] === 'COMPLETE' &&
      // #101 P2-2: the ordinary no-digest record stays distinguishable — its
      // Target claim rests on the probative requested-locator provenance
      // basis (C34), durably recorded and readable on the projection.
      freeDoc['target_evidence_basis'] === 'REQUESTED_LOCATOR_PROVENANCE' &&
      freeDoc['target_evidence_certainty'] === 'PROBATIVE';
    checks.push(
      freeComplete
        ? {
            ...check(
              'packaged-cli-download-no-digest-complete',
              'ordinary download (--url only, no --sha256, no manual digest) → Core provenance-basis validation → COMPLETE terminal',
            ),
            command: ['node', cliScript, ...free.argv],
            exitCode: freeRun.proc.exitCode ?? -1,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(freeRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'packaged-cli-download-no-digest-complete',
              `exit=${String(freeRun.proc.exitCode)} stdout=${freeRun.stdout.trim().slice(0, 200)} stderr=${freeRun.stderr.slice(0, 200)}`,
            ),
            command: ['node', cliScript, ...free.argv],
            exitCode: freeRun.proc.exitCode ?? -1,
            expectedExitCode: 0,
            stdoutExcerpt: excerpt(freeRun.stdout.trim()),
            stderrExcerpt: excerpt(freeRun.stderr),
          },
    );

    // 7. The no-digest durable bytes verify against the independently
    //    computed harness digest (corruption detection), exactly one request.
    const freeContractId = typeof freeDoc['contract_id'] === 'string' ? freeDoc['contract_id'] : '';
    const oneNewRequest = origin.requestCount() === requestsBeforeFree + 1;
    const freeVerified = artifactFiles.some((file) => {
      const content = fs.readFileSync(file);
      return (
        content.byteLength === bytes.byteLength &&
        createHash('sha256').update(content).digest('hex') === origin!.digest
      );
    });
    checks.push(
      freeComplete && oneNewRequest && freeVerified
        ? check(
            'no-digest-durable-bytes-independently-verified',
            'no-digest download left byte-identical durable artifact (harness-computed SHA-256 match) with exactly one origin request',
          )
        : failedCheck(
            'no-digest-durable-bytes-independently-verified',
            `complete=${String(freeComplete)} newRequests=${String(origin.requestCount() - requestsBeforeFree)} verified=${String(freeVerified)}`,
          ),
    );

    // 8. Restart AFTER the no-digest download: identical COMPLETE terminal
    //    re-derives from durable truth with no re-download.
    if (freeContractId.length > 0) {
      const requestsBeforeRestart2 = origin.requestCount();
      stopSpawned(core!);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      core = spawnNode(path.join(cleanRoot, 'core', 'xdownload-core-host.js'), [
        '--root',
        coreRoot,
        ...peerArgs,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const port2 = readyPort(core.stdout);
      if (port2 !== undefined) {
        port = port2;
      }
      const statusArgv2 = [
        'status',
        '--contract',
        freeContractId,
        '--port',
        String(port2 ?? 0),
        ...peerArgs,
      ];
      const statusRun2 =
        port2 === undefined
          ? undefined
          : spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), statusArgv2);
      if (statusRun2 !== undefined) {
        await new Promise((resolve) => statusRun2.proc.on('exit', resolve));
      }
      let statusDocInner: Record<string, unknown> = {};
      try {
        statusDocInner = JSON.parse(statusRun2?.stdout.trim() ?? '{}') as Record<string, unknown>;
      } catch {
        // left empty
      }
      const rederivedNoDigest =
        port2 !== undefined &&
        statusRun2?.proc.exitCode === 0 &&
        statusDocInner['RequestFulfillmentStatus'] === 'COMPLETE' &&
        statusDocInner['lineage_status'] === 'TERMINAL' &&
        origin.requestCount() === requestsBeforeRestart2;
      checks.push(
        rederivedNoDigest
          ? {
              ...check(
                'no-digest-restart-terminal-rederived',
                `after a Core-host restart the no-digest COMPLETE terminal re-derives from durable truth with no re-download (origin requests stayed ${String(requestsBeforeRestart2)})`,
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...statusArgv2],
              exitCode: statusRun2?.proc.exitCode ?? -1,
              expectedExitCode: 0,
              stdoutExcerpt: excerpt(statusRun2?.stdout.trim()),
            }
          : {
              ...failedCheck(
                'no-digest-restart-terminal-rederived',
                `port=${String(port2)} exit=${String(statusRun2?.proc.exitCode)} stdout=${statusRun2?.stdout.trim().slice(0, 300)} originRequests=${String(origin.requestCount())}`,
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...statusArgv2],
              exitCode: statusRun2?.proc.exitCode ?? -1,
              expectedExitCode: 0,
              stdoutExcerpt: excerpt(statusRun2?.stdout.trim()),
            },
      );
    } else {
      checks.push(
        failedCheck('no-digest-restart-terminal-rederived', 'prerequisite missing: contract id'),
      );
    }

    // 9. C34/C29: without a digest, a redirect to an UNDECLARED host cannot
    //    silently pass — truthful FAILED terminal.
    const redirectUri = `${origin.uri.replace(/\/file\.bin$/, '')}/redirect-away.bin`;
    const away = runCliProcess(cliArgs(['download', '--url', redirectUri]));
    const awayRun = away.spawned;
    await new Promise((resolve) => awayRun.proc.on('exit', resolve));
    let awayDoc: Record<string, unknown> = {};
    try {
      awayDoc = JSON.parse(awayRun.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty
    }
    const awayFailed =
      awayRun.proc.exitCode === 4 &&
      awayDoc['RequestFulfillmentStatus'] !== 'COMPLETE' &&
      awayDoc['lineage_status'] === 'TERMINAL';
    checks.push(
      awayFailed
        ? {
            ...check(
              'no-digest-undeclared-redirect-fails-closed',
              'no-digest download redirected outside the declared delivery graph → truthful FAILED terminal (C29 cannot silently pass)',
            ),
            command: ['node', cliScript, ...away.argv],
            exitCode: awayRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(awayRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'no-digest-undeclared-redirect-fails-closed',
              `exit=${String(awayRun.proc.exitCode)} stdout=${awayRun.stdout.trim().slice(0, 300)}`,
            ),
            command: ['node', cliScript, ...away.argv],
            exitCode: awayRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(awayRun.stdout.trim()),
          },
    );

    // 10. Format truth holds without a digest: a login-HTML masquerade is a
    //     FAILED terminal, never a download.
    const htmlUri = `${origin.uri.replace(/\/file\.bin$/, '')}/page.html`;
    const page = runCliProcess(cliArgs(['download', '--url', htmlUri]));
    const pageRun = page.spawned;
    await new Promise((resolve) => pageRun.proc.on('exit', resolve));
    checks.push(
      pageRun.proc.exitCode === 4
        ? {
            ...check(
              'no-digest-html-masquerade-fails-closed',
              'no-digest download of a text/html masquerade → truthful FAILED terminal (Format validation)',
            ),
            command: ['node', cliScript, ...page.argv],
            exitCode: pageRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(pageRun.stdout.trim()),
          }
        : {
            ...failedCheck(
              'no-digest-html-masquerade-fails-closed',
              `exit=${String(pageRun.proc.exitCode)} stdout=${pageRun.stdout.trim().slice(0, 300)}`,
            ),
            command: ['node', cliScript, ...page.argv],
            exitCode: pageRun.proc.exitCode ?? -1,
            expectedExitCode: 4,
            stdoutExcerpt: excerpt(pageRun.stdout.trim()),
          },
    );

    // 11. Cancellation of a stalled download: the bounded wait elapses
    //     truthfully (exit 6), the user cancels, the projection shows
    //     CANCELLED with no fabricated terminal, and retry cannot invent a
    //     failed-member authority domain.
    const hangUri = `${origin.uri.replace(/\/file\.bin$/, '')}/hang.bin`;
    const hang = runCliProcess(
      cliArgs(['download', '--url', hangUri, '--timeout-ms', '6000', '--poll-ms', '100']),
    );
    const hangRun = hang.spawned;
    await new Promise((resolve) => hangRun.proc.on('exit', resolve));
    let hangDoc: Record<string, unknown> = {};
    try {
      hangDoc = JSON.parse(hangRun.stdout.trim()) as Record<string, unknown>;
    } catch {
      // left empty
    }
    const hangContractId = typeof hangDoc['contract_id'] === 'string' ? hangDoc['contract_id'] : '';
    if (hangRun.proc.exitCode === 6 && hangContractId.length > 0) {
      const cancelArgv = [
        'cancel',
        '--contract',
        hangContractId,
        '--expected-revision',
        '2',
        '--port',
        String(port),
        ...peerArgs,
      ];
      const cancelRun = spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), cancelArgv);
      await new Promise((resolve) => cancelRun.proc.on('exit', resolve));
      const statusArgv3 = [
        'status',
        '--contract',
        hangContractId,
        '--port',
        String(port),
        ...peerArgs,
      ];
      const statusRun3 = spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), statusArgv3);
      await new Promise((resolve) => statusRun3.proc.on('exit', resolve));
      let statusDoc3: Record<string, unknown> = {};
      try {
        statusDoc3 = JSON.parse(statusRun3.stdout.trim()) as Record<string, unknown>;
      } catch {
        // left empty
      }
      const cancelled =
        cancelRun.proc.exitCode === 0 &&
        // #101 P2-1: the durably committed cancel connects to the canonical
        // stores and the in-flight transfer's abort checkpoint — the hung
        // socket is torn down and the lineage closes with the truthful
        // USER_CANCELLED projector terminal (never a fabricated COMPLETE,
        // never a lingering connection).
        statusDoc3['lineage_status'] === 'TERMINAL' &&
        statusDoc3['StopReason'] === 'USER_CANCELLED' &&
        statusDoc3['RequestFulfillmentStatus'] !== 'COMPLETE' &&
        origin.closedHangCount() === 1;
      checks.push(
        cancelled
          ? {
              ...check(
                'stalled-download-cancellation-truthful',
                'stalled download: bounded wait elapsed (exit 6); user cancel accepted; the hung transfer aborted (origin socket torn down) and the lineage closed with the truthful USER_CANCELLED terminal',
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...cancelArgv],
              exitCode: cancelRun.proc.exitCode ?? -1,
              expectedExitCode: 0,
              stdoutExcerpt: excerpt(statusRun3.stdout.trim()),
            }
          : {
              ...failedCheck(
                'stalled-download-cancellation-truthful',
                `cancelExit=${String(cancelRun.proc.exitCode)} statusExit=${String(statusRun3.proc.exitCode)} status=${statusRun3.stdout.trim().slice(0, 300)} closedHang=${String(origin.closedHangCount())}`,
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...cancelArgv],
              exitCode: cancelRun.proc.exitCode ?? -1,
              expectedExitCode: 0,
              stdoutExcerpt: excerpt(statusRun3.stdout.trim()),
            },
      );

      // 12. Retry cannot invent a failed-member authority domain on a
      //     cancelled-then-closed lineage (C12), and a terminal-failed
      //     lineage is LATE for retry (immutable terminal truth).
      //     Revisions on the cancelled contract: submit(1) → execute(2) →
      //     cancel(3) → closure(4).
      const retryArgv = [
        'retry',
        '--contract',
        hangContractId,
        '--expected-revision',
        '4',
        '--members',
        's1member-unknown',
        '--port',
        String(port),
        ...peerArgs,
      ];
      const retryRun = spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), retryArgv);
      await new Promise((resolve) => retryRun.proc.on('exit', resolve));
      const retryCancelledOk = retryRun.proc.exitCode === 2;
      const badRetryArgv = [
        'retry',
        '--contract',
        contractId,
        '--expected-revision',
        // submit(1) → execute(2) → executed terminal(3): the exact current
        // revision of the terminal-failed download contract.
        '3',
        '--members',
        's1member-unknown',
        '--port',
        String(port),
        ...peerArgs,
      ];
      const badRetryRun = spawnNode(path.join(cleanRoot, 'cli', 'xdownload-cli.js'), badRetryArgv);
      await new Promise((resolve) => badRetryRun.proc.on('exit', resolve));
      const badRetryText = `${badRetryRun.stdout}${badRetryRun.stderr}`;
      const retryTruthful =
        retryCancelledOk &&
        badRetryRun.proc.exitCode === 2 &&
        badRetryText.includes('LATE_COMMAND');
      checks.push(
        retryTruthful
          ? {
              ...check(
                'retry-vocabulary-truthful',
                'retry on the cancelled-then-closed lineage rejects with terminal truth immutable (revision 4); retry after a terminal-failed download is LATE_COMMAND — neither can mutate terminal truth',
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...badRetryArgv],
              exitCode: badRetryRun.proc.exitCode ?? -1,
              expectedExitCode: 2,
              stdoutExcerpt: excerpt(badRetryText),
            }
          : {
              ...failedCheck(
                'retry-vocabulary-truthful',
                `cancelledRetryExit=${String(retryRun.proc.exitCode)} lateRetryExit=${String(badRetryRun.proc.exitCode)} out=${badRetryText.slice(0, 300)}`,
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...badRetryArgv],
              exitCode: badRetryRun.proc.exitCode ?? -1,
              expectedExitCode: 2,
              stdoutExcerpt: excerpt(badRetryText),
            },
      );
    } else {
      checks.push(
        failedCheck(
          'stalled-download-cancellation-truthful',
          `prerequisite: hang download exit=${String(hangRun.proc.exitCode)} stdout=${hangRun.stdout.trim().slice(0, 200)}`,
        ),
      );
      checks.push(failedCheck('retry-vocabulary-truthful', 'prerequisite missing: hang contract'));
    }

    // 13. Cancel DURING the live bounded wait (#101 P2-1): the truthful
    //     USER_CANCELLED closure ends the wait with exit 4 before its bound —
    //     the hung transfer aborts (no lingering socket), no fabricated
    //     COMPLETED, and the closure terminal is immutable afterwards.
    {
      const requestsBefore = origin.requestCount();
      const hangsBefore = origin.closedHangCount();
      const midWait = runCliProcess([
        'download',
        '--url',
        hangUri,
        '--timeout-ms',
        '30000',
        '--poll-ms',
        '100',
      ]);
      const originRef13 = origin;
      const contractId13 = await waitFor(() => {
        if (originRef13.requestCount() < requestsBefore + 1) {
          return undefined;
        }
        const journaled = contractIdsFromJournal(coreRoot);
        return journaled.submitted !== undefined && journaled.submitted === journaled.executed
          ? journaled.submitted
          : undefined;
      });
      if (contractId13 === undefined) {
        stopSpawned(midWait.spawned);
        checks.push(
          failedCheck(
            'cancel-mid-wait-ends-truthfully',
            'prerequisite: the hang download never registered/executed its contract',
          ),
        );
      } else {
        const cancelArgv13 = [
          'cancel',
          '--contract',
          contractId13,
          '--expected-revision',
          '2',
          '--port',
          String(port),
          ...peerArgs,
        ];
        const cancelRun13 = spawnNode(
          path.join(cleanRoot, 'cli', 'xdownload-cli.js'),
          cancelArgv13,
        );
        await new Promise((resolve) => cancelRun13.proc.on('exit', resolve));
        const exited = await Promise.race([
          new Promise<number | null>((resolve) => midWait.spawned.proc.on('exit', resolve)),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20000)),
        ]);
        let doc13: Record<string, unknown> = {};
        try {
          doc13 = JSON.parse(midWait.spawned.stdout.trim()) as Record<string, unknown>;
        } catch {
          // left empty; assertions below fail with excerpts
        }
        const truthful =
          cancelRun13.proc.exitCode === 0 &&
          typeof exited === 'number' &&
          exited === 4 &&
          doc13['document'] === 'xdownload.cli.status' &&
          doc13['lineage_status'] === 'TERMINAL' &&
          doc13['StopReason'] === 'USER_CANCELLED' &&
          doc13['RequestFulfillmentStatus'] !== 'COMPLETE' &&
          origin.closedHangCount() === hangsBefore + 1;
        checks.push(
          truthful
            ? {
                ...check(
                  'cancel-mid-wait-ends-truthfully',
                  'cancel issued while the CLI wait was live: the hung transfer aborted (origin socket torn down), the truthful USER_CANCELLED closure ended the wait with exit 4 before its bound — no fabricated COMPLETED escape',
                ),
                command: ['node', cliScript, ...midWait.argv],
                exitCode: typeof exited === 'number' ? exited : -1,
                expectedExitCode: 4,
                stdoutExcerpt: excerpt(midWait.spawned.stdout.trim()),
              }
            : {
                ...failedCheck(
                  'cancel-mid-wait-ends-truthfully',
                  `cancelExit=${String(cancelRun13.proc.exitCode)} waitExit=${String(exited)} stdout=${midWait.spawned.stdout.trim().slice(0, 300)} closedHang=${String(origin.closedHangCount())}`,
                ),
                command: ['node', cliScript, ...midWait.argv],
                exitCode: typeof exited === 'number' ? exited : -1,
                expectedExitCode: 4,
                stdoutExcerpt: excerpt(midWait.spawned.stdout.trim()),
              },
        );
      }
    }

    // 14. Stale terminal: a cancel after an already-terminal acquisition is
    //     recorded as LATE and never rewrites terminal truth.
    if (contractId.length > 0) {
      const lateCancelArgv = [
        'cancel',
        '--contract',
        contractId,
        '--expected-revision',
        '3',
        '--port',
        String(port),
        ...peerArgs,
      ];
      const lateCancelRun = spawnNode(
        path.join(cleanRoot, 'cli', 'xdownload-cli.js'),
        lateCancelArgv,
      );
      await new Promise((resolve) => lateCancelRun.proc.on('exit', resolve));
      const lateText = `${lateCancelRun.stdout}${lateCancelRun.stderr}`;
      checks.push(
        lateCancelRun.proc.exitCode === 2 && lateText.includes('LATE_COMMAND')
          ? {
              ...check(
                'cancel-after-terminal-is-late',
                'cancel of an already-terminal completed download is LATE_COMMAND — terminal truth immutable, no retroactive rewrite',
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...lateCancelArgv],
              exitCode: lateCancelRun.proc.exitCode ?? -1,
              expectedExitCode: 2,
              stdoutExcerpt: excerpt(lateText),
            }
          : {
              ...failedCheck(
                'cancel-after-terminal-is-late',
                `exit=${String(lateCancelRun.proc.exitCode)} out=${lateText.slice(0, 300)}`,
              ),
              command: ['node', path.join(cleanRoot, 'cli', 'xdownload-cli.js'), ...lateCancelArgv],
              exitCode: lateCancelRun.proc.exitCode ?? -1,
              expectedExitCode: 2,
              stdoutExcerpt: excerpt(lateText),
            },
      );
    }

    // 15. Kill-reopen (#101 P2-1/P2-2 regression): a hard core-host kill
    //     during a hung transfer re-derives truth from durable state only on
    //     restart — no re-download, a fail-closed non-COMPLETE terminal for
    //     the interrupted attempt, and a live CLI wait ends with exit 4.
    {
      const requestsBefore15 = origin.requestCount();
      const killWait = runCliProcess([
        'download',
        '--url',
        hangUri,
        '--timeout-ms',
        '45000',
        '--poll-ms',
        '100',
      ]);
      const originRef15 = origin;
      const contractId15 = await waitFor(() => {
        if (originRef15.requestCount() < requestsBefore15 + 1) {
          return undefined;
        }
        const journaled = contractIdsFromJournal(coreRoot);
        return journaled.submitted !== undefined && journaled.submitted === journaled.executed
          ? journaled.submitted
          : undefined;
      });
      if (contractId15 === undefined || core === undefined) {
        stopSpawned(killWait.spawned);
        checks.push(
          failedCheck(
            'kill-reopen-no-redownload-truthful',
            'prerequisite: the hang download never registered/executed its contract',
          ),
        );
      } else {
        // Hard process death mid-transfer (crash is a first-class installed
        // path): the socket dies with the process, no graceful shutdown. The
        // restart pins the SAME loopback port and polls readiness with
        // retries (a SIGKILLed listener may need a moment to rebind).
        const waitPort = port;
        core.proc.kill('SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let port15: number | undefined;
        for (let attempt = 0; attempt < 3 && port15 === undefined; attempt += 1) {
          core = spawnNode(path.join(cleanRoot, 'core', 'xdownload-core-host.js'), [
            '--root',
            coreRoot,
            '--port',
            String(waitPort),
            ...peerArgs,
          ]);
          for (let waited = 0; waited < 40 && port15 === undefined; waited += 1) {
            port15 = readyPort(core.stdout);
            if (port15 === undefined) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
        }
        if (port15 !== undefined) {
          port = port15;
        }
        // The interrupted attempt's wait cannot survive the restart window
        // (the CLI wait treats an unreachable seam as a transport rejection),
        // so the reopened truth is read through a fresh status call: the
        // reconcile must re-derive the fail-closed UNKNOWN/NOT_STARTED
        // terminal from durable truth with NO re-execution.
        stopSpawned(killWait.spawned);
        let status15: Record<string, unknown> = {};
        let status15Exit = -1;
        if (port15 !== undefined) {
          const statusArgv15 = [
            'status',
            '--contract',
            contractId15,
            '--port',
            String(port15),
            ...peerArgs,
          ];
          const statusRun15 = spawnNode(
            path.join(cleanRoot, 'cli', 'xdownload-cli.js'),
            statusArgv15,
          );
          await new Promise((resolve) => statusRun15.proc.on('exit', resolve));
          status15Exit = statusRun15.proc.exitCode ?? -1;
          try {
            status15 = JSON.parse(statusRun15.stdout.trim()) as Record<string, unknown>;
          } catch {
            // left empty; assertions below fail with excerpts
          }
        }
        const truthful15 =
          port15 !== undefined &&
          status15Exit === 0 &&
          status15['document'] === 'xdownload.cli.status' &&
          status15['RequestFulfillmentStatus'] === 'UNKNOWN' &&
          status15['SelectionAcquisitionStatus'] === 'NOT_STARTED' &&
          status15['lineage_status'] === 'TERMINAL' &&
          // Restart reconcile re-derives from durable truth: the interrupted
          // attempt is NEVER re-executed (no new origin request).
          origin.requestCount() === requestsBefore15 + 1;
        checks.push(
          truthful15
            ? {
                ...check(
                  'kill-reopen-no-redownload-truthful',
                  `hard core-host kill during a hung transfer: the reopen re-derived the fail-closed UNKNOWN/NOT_STARTED terminal from durable truth with no re-download (origin requests stayed ${String(requestsBefore15 + 1)})`,
                ),
                command: [
                  'node',
                  path.join(cleanRoot, 'cli', 'xdownload-cli.js'),
                  'status',
                  '--contract',
                  contractId15,
                ],
                exitCode: status15Exit,
                expectedExitCode: 0,
                stdoutExcerpt: excerpt(JSON.stringify(status15)),
              }
            : {
                ...failedCheck(
                  'kill-reopen-no-redownload-truthful',
                  `port=${String(port15)} statusExit=${String(status15Exit)} stdout=${JSON.stringify(status15).slice(0, 300)} originRequests=${String(origin.requestCount())}`,
                ),
                command: [
                  'node',
                  path.join(cleanRoot, 'cli', 'xdownload-cli.js'),
                  'status',
                  '--contract',
                  contractId15,
                ],
                exitCode: status15Exit,
                expectedExitCode: 0,
                stdoutExcerpt: excerpt(JSON.stringify(status15)),
              },
        );
      }
    }
  } catch (error) {
    checks.push(
      failedCheck('s1-e2e-unhandled', error instanceof Error ? error.message : String(error)),
    );
  } finally {
    if (core !== undefined) {
      stopSpawned(core);
    }
    if (origin !== undefined) {
      await origin.stop();
    }
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }
  exitCode = checks.some((item) => item.status === 'FAIL') ? 1 : 0;
  writeEvidence(checks);
  process.exitCode = exitCode;
}

await main();
