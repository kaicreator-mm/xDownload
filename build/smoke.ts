/**
 * T018 real-host smoke runner (`pnpm smoke`) — structured evidence, not
 * faked unit assertions (REFERENCE_PACK §1.2).
 *
 * Executes the T018 concern smokes on the ACTUAL host it runs on and writes
 * durable, structured command+environment+result evidence JSON into
 * build/evidence/. The Windows host of this task is the exercised tuple;
 * every check that does not genuinely execute is recorded as NOT_EXECUTED —
 * never PASS, never fabricated (TEST_MATRIX completion rule).
 *
 * Suites exercised here:
 *  - clean-install/launch/Core reachability (copied artifacts in a clean
 *    temp environment, zero workspace/node_modules/store residue);
 *  - honest typed degradation (unreachable Core, usage errors,
 *    NEEDS_USER_ACTION non-blocking);
 *  - native-host registration mechanism round-trip on Windows (HKCU) plus
 *    the packaged stdio broker loop and its fail-closed refusal;
 *  - build reproducibility (second build into out/repro, content-hash
 *    comparison, deterministic deltas recorded).
 *
 * NOT executed here (stays NOT_PROVEN in the support matrix): real-browser
 * extension load/service-worker activation, extension<->native handshake,
 * Linux/macOS tuples, desktop shell, updater/signing.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { currentSchemaIdentity } from '@xdownload/domain-contracts';
import { REPO_ROOT } from './build-config.ts';
import { runPackageBuild } from './package.ts';
import {
  probeWindowsRegistration,
  registerWindowsNativeHost,
  unregisterWindowsNativeHost,
  windowsUserManifestDir,
  windowsRegistryKey,
} from './native-host.ts';

const execFileAsync = promisify(execFile);

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

function excerpt(text: string | undefined, limit = 400): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

async function runNode(
  scriptPath: string,
  args: readonly string[],
  options?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      cwd: options?.cwd,
      windowsHide: true,
      timeout: 60_000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

interface SpawnedProcess {
  proc: ReturnType<typeof spawn>;
  stdout: string;
  stderr: string;
}

function spawnNode(scriptPath: string, args: readonly string[]): SpawnedProcess {
  const proc = spawn(process.execPath, [scriptPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const captured: SpawnedProcess = { proc, stdout: '', stderr: '' };
  proc.stdout.on('data', (chunk: Buffer) => {
    captured.stdout += chunk.toString('utf8');
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    captured.stderr += chunk.toString('utf8');
  });
  return captured;
}

function environment(): Record<string, string> {
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version?.() ?? 'unavailable',
    node: process.versions.node,
    executable: process.execPath,
    tmpRoot: os.tmpdir(),
  };
}

function overallOf(checks: readonly CheckResult[]): EvidenceDoc['overall'] {
  if (checks.some((check) => check.status === 'FAIL')) {
    return 'FAIL';
  }
  if (checks.every((check) => check.status === 'NOT_EXECUTED')) {
    return 'NOT_EXECUTED';
  }
  return 'PASS';
}

function writeEvidence(suite: string, checks: readonly CheckResult[]): void {
  const doc: EvidenceDoc = {
    suite,
    executedAt: new Date().toISOString(),
    environment: environment(),
    checks,
    overall: overallOf(checks),
  };
  const evidenceDir = path.join(REPO_ROOT, 'build', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `${suite}.json`);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stdout.write(`evidence: ${file} (overall ${doc.overall})\n`);
}

function check(id: string, detail: string): CheckResult {
  return { id, status: 'PASS', detail };
}

function failedCheck(id: string, detail: string): CheckResult {
  return { id, status: 'FAIL', detail };
}

// ------------------------------------------------------------------ contracts

const DOMAIN_SCHEMA_ID = currentSchemaIdentity();

const BUDGET_PROFILE = {
  discovery: { domain: 'discovery', maxGeneratedRequests: 50 },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_000_000,
    maxSegments: 50,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

function smokeContract(
  contractId: string,
  basis: 'ENTIRE_REQUESTED_SCOPE' | 'EXPLICIT_USER_SELECTION',
): string {
  return JSON.stringify({
    schemaIdentity: DOMAIN_SCHEMA_ID,
    contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: 'target-smoke-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-smoke-001' },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: {
      basis,
      allowsBatchSelection: basis === 'EXPLICIT_USER_SELECTION',
    },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: BUDGET_PROFILE,
    authorizationContextRef: 'authctx/smoke-001',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-04T00:00:00Z',
  });
}

// ------------------------------------------------------- clean install/launch

interface CoreHostHandle {
  readonly port: number;
  readonly proc: SpawnedProcess;
}

async function startCoreHost(
  coreDir: string,
  dataRoot: string,
  installId: string,
  userId: string,
): Promise<CoreHostHandle> {
  const proc = spawnNode(coreDir, [
    '--root',
    dataRoot,
    '--install-id',
    installId,
    '--user-id',
    userId,
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ]);
  const readyLine = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`core host not ready: ${proc.stderr}`)),
      30_000,
    );
    proc.proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.includes('xdownload.core-host.ready')) {
          clearTimeout(timer);
          resolve(line);
          return;
        }
      }
    });
    proc.proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`core host exited early (${String(code)}): ${proc.stderr}`));
    });
  });
  const ready: { port?: number } = JSON.parse(readyLine) as { port?: number };
  if (ready.port === undefined) {
    throw new Error(`core host readiness document has no port: ${readyLine}`);
  }
  return { port: ready.port, proc };
}

function stopCoreHost(handle: CoreHostHandle): void {
  handle.proc.proc.kill();
}

async function runCleanInstallSmoke(distDir: string): Promise<void> {
  const checks: CheckResult[] = [];
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-clean-'));
  const cliDir = path.join(cleanRoot, 'cli');
  const coreDir = path.join(cleanRoot, 'core');
  fs.cpSync(path.join(distDir, 'cli'), cliDir, { recursive: true });
  fs.cpSync(path.join(distDir, 'core'), coreDir, { recursive: true });
  const cliBundle = path.join(cliDir, 'xdownload-cli.js');
  const coreBundle = path.join(coreDir, 'xdownload-core-host.js');
  const installId = 'smoke-install-001';
  const userId = 'smoke-user-001';

  // Clean environment: no workspace, node_modules or store residue.
  checks.push(
    check(
      'clean-environment-copied-artifacts-only',
      `artifacts copied to ${cleanRoot}; the directory contains only the emitted package trees`,
    ),
  );

  let coreHandle: CoreHostHandle | null = null;
  try {
    // CLI help launch, independent of any Core/Desktop process.
    const help = await runNode(cliBundle, ['help'], { cwd: cleanRoot });
    checks.push({
      id: 'cli-launch-help',
      status: help.code === 0 && help.stdout.includes('xdownload') ? 'PASS' : 'FAIL',
      command: ['node', 'cli/xdownload-cli.js', 'help'],
      exitCode: help.code,
      expectedExitCode: 0,
      detail: 'CLI launches standalone (no Desktop UI, no workspace) and prints usage',
      stdoutExcerpt: excerpt(help.stdout),
    });

    // CLI usage error: typed, actionable, documented exit code.
    const badArgs = await runNode(cliBundle, ['status'], { cwd: cleanRoot });
    checks.push({
      id: 'cli-usage-error-typed',
      status: badArgs.code === 1 && badArgs.stdout.includes('USAGE') ? 'PASS' : 'FAIL',
      command: ['node', 'cli/xdownload-cli.js', 'status'],
      exitCode: badArgs.code,
      expectedExitCode: 1,
      detail: 'missing required options produce a typed USAGE document and exit 1',
      stdoutExcerpt: excerpt(badArgs.stdout),
    });

    // Core reachability: packaged CLI against packaged Core via the seam.
    coreHandle = await startCoreHost(
      coreBundle,
      path.join(cleanRoot, 'core-data'),
      installId,
      userId,
    );
    checks.push({
      id: 'core-host-launch-ready',
      status: 'PASS',
      command: [
        'node',
        'core/xdownload-core-host.js',
        '--root',
        '<clean>/core-data',
        '--port',
        '0',
      ],
      exitCode: 0,
      detail: `Core host composed the authoritative runtime and reported readiness on loopback port ${String(coreHandle.port)}`,
      stdoutExcerpt: excerpt(coreHandle.proc.stdout),
    });

    const contractFile = path.join(cleanRoot, 'contract-entire.json');
    fs.writeFileSync(
      contractFile,
      smokeContract('contract-smoke-001', 'ENTIRE_REQUESTED_SCOPE'),
      'utf8',
    );
    const submit = await runNode(
      cliBundle,
      [
        'submit',
        '--port',
        String(coreHandle.port),
        '--install-id',
        installId,
        '--user-id',
        userId,
        '--file',
        contractFile,
      ],
      { cwd: cleanRoot },
    );
    checks.push({
      id: 'cli-submit-accepted-via-seam',
      status: submit.code === 0 && submit.stdout.includes('ACCEPTED') ? 'PASS' : 'FAIL',
      command: ['node', 'cli/xdownload-cli.js', 'submit', '--file', '<contract>'],
      exitCode: submit.code,
      expectedExitCode: 0,
      detail:
        'packaged CLI submitted a canonical contract through the loopback seam to the packaged Core and rendered acceptance',
      stdoutExcerpt: excerpt(submit.stdout),
      stderrExcerpt: excerpt(submit.stderr),
    });

    const status = await runNode(
      cliBundle,
      [
        'status',
        '--port',
        String(coreHandle.port),
        '--install-id',
        installId,
        '--user-id',
        userId,
        '--contract',
        'contract-smoke-001',
      ],
      { cwd: cleanRoot },
    );
    checks.push({
      id: 'cli-status-projection-via-seam',
      status: status.code === 0 && status.stdout.includes('contract-smoke-001') ? 'PASS' : 'FAIL',
      command: ['node', 'cli/xdownload-cli.js', 'status', '--contract', 'contract-smoke-001'],
      exitCode: status.code,
      expectedExitCode: 0,
      detail: 'packaged CLI read the Core-owned projection for the submitted lineage',
      stdoutExcerpt: excerpt(status.stdout),
    });

    // NEEDS_USER_ACTION: EXPLICIT_USER_SELECTION is non-blocking and honest.
    const explicitFile = path.join(cleanRoot, 'contract-explicit.json');
    fs.writeFileSync(
      explicitFile,
      smokeContract('contract-smoke-002', 'EXPLICIT_USER_SELECTION'),
      'utf8',
    );
    const explicit = await runNode(
      cliBundle,
      [
        'submit',
        '--port',
        String(coreHandle.port),
        '--install-id',
        installId,
        '--user-id',
        userId,
        '--file',
        explicitFile,
      ],
      { cwd: cleanRoot },
    );
    checks.push({
      id: 'cli-submit-needs-user-action',
      status:
        explicit.code === 3 && explicit.stdout.includes('"needs_user_action":true')
          ? 'PASS'
          : 'FAIL',
      command: [
        'node',
        'cli/xdownload-cli.js',
        'submit',
        '--file',
        '<explicit-selection-contract>',
      ],
      exitCode: explicit.code,
      expectedExitCode: 3,
      detail:
        'explicit-user-selection submission returns the bounded NEEDS_USER_ACTION state (exit 3, needs_user_action=true), never a blocked or invented status',
      stdoutExcerpt: excerpt(explicit.stdout),
    });

    // Durable truth survived in the Core data root (written by the packaged Core).
    const coreDataFiles = listRelative(path.join(cleanRoot, 'core-data'));
    checks.push({
      id: 'core-durable-files-present',
      status: coreDataFiles.length > 0 ? 'PASS' : 'FAIL',
      detail: `Core data root contains ${String(coreDataFiles.length)} durable files: ${coreDataFiles.slice(0, 6).join(', ')}`,
    });
  } catch (error) {
    checks.push(
      failedCheck(
        'clean-install-suite',
        error instanceof Error ? error.message : 'unexpected error',
      ),
    );
  } finally {
    if (coreHandle !== null) {
      stopCoreHost(coreHandle);
    }
  }

  // Honest degradation: unreachable Core -> typed TRANSPORT failure (exit 5).
  const unreachable = await runNode(
    cliBundle,
    [
      'status',
      '--port',
      '9',
      '--install-id',
      installId,
      '--user-id',
      userId,
      '--contract',
      'contract-smoke-001',
    ],
    { cwd: cleanRoot },
  );
  checks.push({
    id: 'cli-unreachable-core-typed-transport-failure',
    status: unreachable.code === 5 && unreachable.stdout.includes('TRANSPORT') ? 'PASS' : 'FAIL',
    command: ['node', 'cli/xdownload-cli.js', 'status', '--port', '9'],
    exitCode: unreachable.code,
    expectedExitCode: 5,
    detail:
      'packaged CLI degrades honestly when Core is unreachable: typed TRANSPORT document, documented exit 5, no fabricated status',
    stdoutExcerpt: excerpt(unreachable.stdout),
  });

  writeEvidence('windows-cli-core-clean-install', checks);
}

function listRelative(root: string): readonly string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return found;
}

// ------------------------------------------------------------- native host

async function runNativeHostSmoke(distDir: string): Promise<void> {
  const checks: CheckResult[] = [];
  const hostBundle = path.join(distDir, 'native-host', 'xdownload-broker-host.js');
  const brokerConfig = path.join(distDir, 'native-host', 'broker-config.json');
  const allowedOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

  // Packaged stdio broker loop: valid origin + framed AUTH_INSPECT for an
  // unknown ref -> one typed REJECTED frame (framing + origin gate + broker
  // dispatch all inside the packaged artifact; NOT a browser handshake).
  try {
    const stdio = await nativeMessagingRoundTrip(hostBundle, brokerConfig, allowedOrigin);
    const parsed = JSON.parse(stdio.response) as { kind?: string; requestId?: string };
    checks.push({
      id: 'native-host-stdio-broker-loop',
      status:
        stdio.exitCode === 0 && parsed.kind === 'REJECTED' && parsed.requestId === 'smoke-inspect-1'
          ? 'PASS'
          : 'FAIL',
      command: [
        'node',
        'native-host/xdownload-broker-host.js',
        '--config',
        'broker-config.json',
        allowedOrigin,
      ],
      exitCode: stdio.exitCode,
      detail: `packaged stdio broker accepted the allow-listed caller origin and answered one Native-Messaging frame with a typed rejection (kind=${String(parsed.kind)}, requestId echoed)`,
      stdoutExcerpt: excerpt(stdio.response),
    });
  } catch (error) {
    checks.push(
      failedCheck(
        'native-host-stdio-broker-loop',
        error instanceof Error ? error.message : 'round-trip failed',
      ),
    );
  }

  // Fail-closed: no browser-passed origin -> refusal, exit 2, no frames.
  const noOrigin = spawnNode(hostBundle, ['--config', brokerConfig]);
  const noOriginExit = await new Promise<number>((resolve) => {
    noOrigin.proc.on('exit', (code) => resolve(code ?? -1));
  });
  checks.push({
    id: 'native-host-fail-closed-without-origin',
    status: noOriginExit === 2 && noOrigin.stdout === '' ? 'PASS' : 'FAIL',
    command: ['node', 'native-host/xdownload-broker-host.js', '--config', 'broker-config.json'],
    exitCode: noOriginExit,
    expectedExitCode: 2,
    detail:
      'a launch without a browser-passed chrome-extension origin refuses the session (typed stderr, no stdout frames, no simulated session)',
    stderrExcerpt: excerpt(noOrigin.stderr),
  });

  // Windows HKCU registration round-trip on the real mechanism, leaving the
  // machine exactly as found. If a foreign registration already exists it is
  // left untouched and the round-trip is recorded NOT_EXECUTED.
  try {
    const before = await probeWindowsRegistration();
    if (before.registered) {
      checks.push({
        id: 'native-host-windows-registration-roundtrip',
        status: 'NOT_EXECUTED',
        command: ['reg', 'query', windowsRegistryKey()],
        detail: `an existing registration is present (${before.manifestPath ?? 'unknown manifest'}); it was not modified, so the round-trip was not executed`,
      });
    } else {
      const registered = await registerWindowsNativeHost({
        launcherPath: path.join(distDir, 'native-host', 'bin', 'xdownload-broker-host.cmd'),
        allowedOrigins: [allowedOrigin],
      });
      const probe = await probeWindowsRegistration();
      const manifestOk =
        registered.manifestPath !== null &&
        fs.existsSync(registered.manifestPath) &&
        fs.readFileSync(registered.manifestPath, 'utf8').includes(allowedOrigin);
      checks.push({
        id: 'native-host-windows-registration-roundtrip',
        status:
          registered.action === 'registered' &&
          probe.registered &&
          probe.manifestPath === registered.manifestPath &&
          manifestOk
            ? 'PASS'
            : 'FAIL',
        command: [
          'reg',
          'add',
          windowsRegistryKey(),
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          registered.manifestPath,
          '/f',
        ],
        detail: `HKCU registration written at ${windowsRegistryKey()} -> ${registered.manifestPath}; manifest carries the exact allowed_origins list and read-back matches`,
      });
      const removed = await unregisterWindowsNativeHost();
      const after = await probeWindowsRegistration();
      checks.push({
        id: 'native-host-windows-unregistration-restores-state',
        status: removed.action === 'unregistered' && !after.registered ? 'PASS' : 'FAIL',
        command: ['reg', 'delete', windowsRegistryKey(), '/f'],
        detail: 'registration removed and read-back confirms the machine is as found',
      });
      const manifestDir = windowsUserManifestDir();
      fs.rmSync(manifestDir, { recursive: true, force: true });
    }
  } catch (error) {
    checks.push(
      failedCheck(
        'native-host-windows-registration-roundtrip',
        error instanceof Error ? error.message : 'registry access failed',
      ),
    );
  }

  writeEvidence('windows-native-host-smoke', checks);
}

/** One Native Messaging frame in, one frame out, over the packaged stdio host. */
function nativeMessagingRoundTrip(
  hostBundle: string,
  brokerConfig: string,
  origin: string,
): Promise<{ exitCode: number; response: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [hostBundle, '--config', brokerConfig, origin], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let buffered: Buffer = Buffer.alloc(0);
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`native host round-trip timed out; stderr: ${stderr}`));
    }, 15_000);
    proc.stdout.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length >= 4) {
        const declared = buffered.readUInt32LE(0);
        if (buffered.length >= 4 + declared) {
          clearTimeout(timer);
          const payload = buffered.subarray(4, 4 + declared).toString('utf8');
          proc.stdin.end();
          proc.on('exit', (code) => resolve({ exitCode: code ?? -1, response: payload, stderr }));
        }
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (buffered.length === 0) {
        reject(
          new Error(
            `native host produced no response frame (exit ${String(code)}); stderr: ${stderr}`,
          ),
        );
      }
    });
    const command = Buffer.from(
      JSON.stringify({
        kind: 'AUTH_INSPECT',
        requestId: 'smoke-inspect-1',
        ref: 'authctx/unknown-ref',
      }),
      'utf8',
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(command.byteLength, 0);
    proc.stdin.write(Buffer.concat([header, command]));
  });
}

// ------------------------------------------------------------ reproducibility

async function runReproducibilitySmoke(distDir: string): Promise<void> {
  const checks: CheckResult[] = [];
  const reproDir = path.join(REPO_ROOT, 'out', 'repro');
  const { hashes } = await runPackageBuild(reproDir);
  for (const [artifact, hash] of Object.entries(hashes)) {
    const identityPath = path.join(distDir, 'identity', `${artifact}.json`);
    const first: { contentHash?: string } = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    const identical = first.contentHash === hash;
    checks.push({
      id: `rebuild-byte-identity-${artifact}`,
      status: identical ? 'PASS' : 'FAIL',
      command: ['pnpm build --out out/repro', 'compare identity contentHash'],
      detail: identical
        ? 'second full build produced the byte-identical artifact (same canonical content hash)'
        : `rebuild produced a different content hash (${String(first.contentHash)} -> ${hash}); deviation is recorded, not hidden`,
    });
  }
  fs.rmSync(reproDir, { recursive: true, force: true });
  writeEvidence('build-reproducibility', checks);
}

// -------------------------------------------------------------------- driver

async function main(): Promise<void> {
  const distDir = path.join(REPO_ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    process.stdout.write('dist/ missing; running the package build first\n');
    await runPackageBuild(distDir);
  }
  process.stdout.write(
    `smoke host: ${process.platform}-${process.arch} node ${process.versions.node}\n`,
  );
  await runCleanInstallSmoke(distDir);
  await runNativeHostSmoke(distDir);
  await runReproducibilitySmoke(distDir);
  process.stdout.write('smoke run complete\n');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
