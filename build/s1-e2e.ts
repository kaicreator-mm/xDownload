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
  stop(): Promise<void>;
}

/** Controlled localhost origin: one deterministic file, counted requests. */
function startOrigin(bytes: Uint8Array): Promise<Origin> {
  const digest = createHash('sha256').update(bytes).digest('hex');
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
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
        stop: () =>
          new Promise<void>((done) => {
            server.closeIdleConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function readyPort(stdout: string): number | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('xdownload.core-host.ready')) {
      continue;
    }
    try {
      const doc = JSON.parse(line) as { port?: number };
      return doc.port;
    } catch {
      return undefined;
    }
  }
  return undefined;
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
    const port = readyPort(core.stdout);
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
      successDoc['StopReason'] === 'NONE';
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
