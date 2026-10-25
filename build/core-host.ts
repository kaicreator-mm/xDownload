/**
 * T018 Core artifact production entry — the packaged Core host process.
 *
 * Packaging composition ONLY (owned write boundary: production
 * build/packaging/install wiring). Every semantic stays in the consumed
 * packages: `createCoreRuntime` (T015) is the single authoritative
 * composition root, `createLoopbackServerTransport` (T004 F1) is the
 * loopback-only framed transport behind the replaceable ADR-012 ports, and
 * per-frame peer authorization (same-install/same-user + surface scope)
 * remains the seam server's own decision. This entry adds process
 * lifecycle: typed argv parsing, a typed `node:sqlite` prerequisite check
 * (persistence-ledger bounds the shipped runtime to Node builds providing
 * `node:sqlite`), runtime + transport composition, one JSON readiness
 * document on stdout, and clean shutdown.
 *
 * Exit codes (documented in build/README.md):
 *   0 success / clean shutdown      1 usage error
 *   3 runtime prerequisite missing  4 Core composition failed
 *   5 transport bind refused (non-loopback)
 */

import {
  createLoopbackServerTransport,
  createWindowsPipeServerTransport,
  WindowsPipeTransportUnsupportedError,
  makePeerInstallId,
  makePeerUserId,
  NonLoopbackTransportRefusedError,
  type ExpectedPeerScope,
  type SeamServerTransport,
} from '@xdownload/core-seam';
import {
  closeCoreRuntime,
  CoreRuntimeCompositionError,
  createCoreRuntime,
  reopenCoreRuntime,
  type S1DriveHealthEntry,
} from '@xdownload/core-runtime';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const CORE_HOST_EXIT = {
  SUCCESS: 0,
  USAGE: 1,
  PREREQUISITE_MISSING: 3,
  COMPOSITION_FAILED: 4,
  TRANSPORT_REFUSED: 5,
} as const;

export interface CoreHostOptions {
  readonly rootDir: string;
  readonly installId: string;
  readonly userId: string;
  readonly host: string;
  readonly port: number;
  readonly pipeName?: string;
}

export interface CoreHostUsageError {
  readonly kind: 'usage';
  readonly message: string;
}

/**
 * Typed, fail-closed argv parse (no defaults that enlarge the listening
 * scope: host defaults to 127.0.0.1 only; port defaults to an OS-assigned
 * loopback port).
 */
export function parseCoreHostArgv(
  argv: readonly string[],
): { ok: true; options: CoreHostOptions } | { ok: false; error: CoreHostUsageError } {
  let rootDir: string | undefined;
  let installId: string | undefined;
  let userId: string | undefined;
  let host = '127.0.0.1';
  let port = 0;
  let pipeName: string | undefined;
  let explicitHost = false;
  let explicitPort = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string | undefined => {
      const value = argv[index + 1];
      index += 1;
      return value;
    };
    switch (arg) {
      case '--root':
        rootDir = next();
        break;
      case '--install-id':
        installId = next();
        break;
      case '--user-id':
        userId = next();
        break;
      case '--host':
        explicitHost = true;
        host = next() ?? host;
        break;
      case '--pipe-name':
        pipeName = next();
        if (pipeName === undefined) return usage('--pipe-name requires a value');
        break;
      case '--port': {
        explicitPort = true;
        const raw = next();
        const parsed = raw === undefined ? Number.NaN : Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
          return usage('--port must be an integer 0..65535');
        }
        port = parsed;
        break;
      }
      default:
        return usage(`unknown argument '${String(arg)}'`);
    }
  }
  if (rootDir === undefined || rootDir.length === 0) {
    return usage('missing required option --root <dir>');
  }
  if (installId === undefined || installId.length === 0) {
    return usage('missing required option --install-id <id>');
  }
  if (userId === undefined || userId.length === 0) {
    return usage('missing required option --user-id <id>');
  }
  const brandedInstall = makePeerInstallId(installId);
  if (!brandedInstall.ok) {
    return usage('--install-id is not a valid peer identity');
  }
  const brandedUser = makePeerUserId(userId);
  if (!brandedUser.ok) {
    return usage('--user-id is not a valid peer identity');
  }
  if (pipeName !== undefined) {
    if (explicitHost || explicitPort) {
      return usage('--pipe-name cannot be combined with --host or --port');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(installId)) {
      return usage('--pipe-name requires a safe local Core install-id suffix');
    }
    const expected = String.raw`\\\\.\\pipe\\xdownload-core-${installId}`;
    if (pipeName !== expected) {
      return usage('--pipe-name must exactly match the local Core install namespace');
    }
    return { ok: true, options: { rootDir, installId, userId, host, port, pipeName: expected } };
  }
  return { ok: true, options: { rootDir, installId, userId, host, port } };
}

function usage(message: string): { ok: false; error: CoreHostUsageError } {
  return { ok: false, error: { kind: 'usage', message } };
}

export type SqliteLoader = () => Promise<unknown>;

/**
 * Typed `node:sqlite` availability check — a missing runtime prerequisite
 * fails with an actionable typed error instead of silent misbehavior
 * (TEST_MATRIX clean-install-launch; persistence-ledger needs DatabaseSync).
 */
export async function ensureSqliteAvailable(
  loader: SqliteLoader = loadNodeSqlite,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let module: unknown;
  try {
    module = await loader();
  } catch (error) {
    return {
      ok: false,
      message: `node:sqlite is unavailable in this Node.js runtime (${error instanceof Error ? error.message : 'import failed'}); xDownload Core requires a Node.js >= 24 build providing node:sqlite (DatabaseSync)`,
    };
  }
  const hasDatabaseSync =
    typeof module === 'object' &&
    module !== null &&
    'DatabaseSync' in (module as Record<string, unknown>);
  if (!hasDatabaseSync) {
    return {
      ok: false,
      message:
        'node:sqlite exposes no DatabaseSync in this Node.js runtime; xDownload Core requires a Node.js >= 24 build providing node:sqlite (DatabaseSync)',
    };
  }
  return { ok: true };
}

async function loadNodeSqlite(): Promise<unknown> {
  return import('node:sqlite');
}

export interface StartedCoreHost {
  readonly host: string;
  readonly port: number;
  readonly pipeName?: string;
  readonly shutdown: () => Promise<void>;
}

/**
 * Compose the authoritative Core runtime behind the loopback seam
 * transport. Composition glue only — the runtime, the transport and the
 * per-frame authorization are the consumed packages' own behavior.
 */
export async function startCoreHost(options: CoreHostOptions): Promise<StartedCoreHost> {
  const expectedPeer: ExpectedPeerScope = {
    installId: options.installId,
    userId: options.userId,
    allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
  };
  // Restart is a first-class installed path: an existing durable root is
  // REOPENED from durable truth only (fact log + seam journal replay +
  // ledger recovery + S1 intent reconcile), never re-initialized — a second
  // launch over the same root that clobbered durable truth would destroy
  // exactly the recovery evidence this host exists to protect.
  const existing = existsSync(join(options.rootDir, 'seam-journal.jsonl'));
  // #101 R1/F03: Core-internal S1 drive faults surface live on stderr as
  // structured diagnostics (bounded retries, degraded/exhausted health) —
  // a failed driver never disappears into a silent void.
  const runtimeOptions = {
    rootDir: options.rootDir,
    expectedPeer,
    onS1DriveHealth: (entry: S1DriveHealthEntry): void => {
      process.stderr.write(
        `${JSON.stringify({ document: 'xdownload.core-host.s1-drive-health', ...entry })}\n`,
      );
    },
  };
  // The CLI's explicit --pipe-name can only connect when this SAME installed
  // Core hosts the matching OS-verified listener. Enforce platform before
  // opening SQLite or journal resources; never downgrade pipe to loopback.
  if (options.pipeName !== undefined && process.platform !== 'win32') {
    throw new WindowsPipeTransportUnsupportedError(process.platform);
  }
  // A core-host instance listens on exactly ONE transport, never both.
  const transport: SeamServerTransport = options.pipeName === undefined
    ? createLoopbackServerTransport({ host: options.host, port: options.port })
    : createWindowsPipeServerTransport({ pipeName: options.pipeName });
  const runtime = existing ? reopenCoreRuntime(runtimeOptions) : createCoreRuntime(runtimeOptions);
  let target: { host: string; port: number; pipeName?: string };
  try {
    target = await transport.start({
      onFrame: (connection, frame) => {
        // Core deliberately still refuses S3 1.2: an OS-verified pipe alone
        // is not the Core-issued nonce/journal/selection authority.
        const response = runtime.seam.handleFrame(frame);
        connection.send(JSON.stringify(response));
      },
      onConnectionEnded: () => undefined,
    });
  } catch (error) {
    closeCoreRuntime(runtime);
    throw error;
  }
  return {
    host: target.host,
    port: target.port,
    ...(target.pipeName === undefined ? {} : { pipeName: target.pipeName }),
    shutdown: async () => {
      await transport.stop();
      closeCoreRuntime(runtime);
    },
  };
}

function writeErrorDoc(input: { error: string; message: string }): void {
  process.stdout.write(
    `${JSON.stringify({ document: 'xdownload.core-host.error', error: input.error, message: input.message })}\n`,
  );
}

async function main(): Promise<void> {
  const parsed = parseCoreHostArgv(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(
      `${JSON.stringify({ document: 'xdownload.core-host.usage', message: parsed.error.message })}\n`,
    );
    process.stderr.write(
      `usage: xdownload-core-host --root <dir> --install-id <id> --user-id <id> [--host 127.0.0.1] [--port 0] OR [--pipe-name \\\\.\\pipe\\xdownload-core-<install-id>]\n`,
    );
    process.exitCode = CORE_HOST_EXIT.USAGE;
    return;
  }
  const sqlite = await ensureSqliteAvailable();
  if (!sqlite.ok) {
    writeErrorDoc({ error: 'RUNTIME_PREREQUISITE_MISSING', message: sqlite.message });
    process.exitCode = CORE_HOST_EXIT.PREREQUISITE_MISSING;
    return;
  }
  let host: StartedCoreHost;
  try {
    host = await startCoreHost(parsed.options);
  } catch (error) {
    if (error instanceof NonLoopbackTransportRefusedError || error instanceof WindowsPipeTransportUnsupportedError) {
      writeErrorDoc({ error: 'TRANSPORT_REFUSED', message: error.message });
      process.exitCode = CORE_HOST_EXIT.TRANSPORT_REFUSED;
      return;
    }
    writeErrorDoc({
      error: 'CORE_COMPOSITION_FAILED',
      message:
        error instanceof CoreRuntimeCompositionError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'core runtime composition failed',
    });
    process.exitCode = CORE_HOST_EXIT.COMPOSITION_FAILED;
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      document: 'xdownload.core-host.ready',
      host: host.host,
      port: host.port,
      pid: process.pid,
      installId: parsed.options.installId,
      userId: parsed.options.userId,
    })}\n`,
  );
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void host
      .shutdown()
      .then(() => {
        process.exitCode = CORE_HOST_EXIT.SUCCESS;
      })
      .catch(() => {
        process.exitCode = CORE_HOST_EXIT.COMPOSITION_FAILED;
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Process entry only when executed directly (the smoke and the concern
// tests import the functions instead of spawning a second process).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
