/**
 * T018 native-host process entry — the packaged stdio broker the browser
 * launches via Native Messaging (packaging composition over the T010
 * package, consumed as-is: `createAuthBroker`, `establishNativeHostSession`
 * and `serveNativeHostSession` own ALL authorization semantics).
 *
 * Fail-closed rules preserved verbatim from the sources:
 * - the caller origin must arrive as the browser-passed
 *   `chrome-extension://<id>/` argv entry and match the configured
 *   `allowed_origins` exactly; anything else refuses session establishment;
 * - `allowed_origins` is read from the packaged broker config; an empty or
 *   missing list rejects every caller (no empty-match fallback);
 * - stdout carries ONLY Native Messaging frames — any other output would
 *   corrupt the platform protocol, so diagnostics go to stderr.
 *
 * Exit codes: 0 clean (stdin closed); 2 fail-closed session refusal.
 */

import {
  createAuthBroker,
  establishNativeHostSession,
  serveNativeHostSession,
  type AllowedOrigins,
} from '@xdownload/browser-auth-broker';
import {
  createInstalledS2Lane,
  createInstalledS5Lane,
} from '@xdownload/browser-collection-workflow';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export interface BrokerConfig {
  readonly allowedOrigins: AllowedOrigins;
  /**
   * #95/#151: the ONE Core authority seam target. Absent → both lanes fail
   * closed. The loopback TCP section serves the S2 delivered-bytes lane; the
   * canonical Windows pipe namespace serves the OS-verified S5 collection
   * lane (both same install/user; at least one transport required).
   */
  readonly core:
    | {
        readonly host: string;
        readonly port: number;
        readonly installId: string;
        readonly userId: string;
        readonly pipeName?: string;
      }
    | {
        readonly host?: undefined;
        readonly port?: undefined;
        readonly installId: string;
        readonly userId: string;
        readonly pipeName: string;
      }
    | undefined;
}

export function parseBrokerConfig(text: string): BrokerConfig {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('broker config must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const origins = record['allowedOrigins'];
  if (!Array.isArray(origins) || origins.length === 0) {
    // Mirrors the broker's own rule: an empty allow list rejects every
    // caller; a config without one fails closed the same way.
    return { allowedOrigins: [], core: undefined };
  }
  const rawCore = record['core'];
  let core: BrokerConfig['core'];
  if (rawCore === undefined || rawCore === null) {
    core = undefined;
  } else if (typeof rawCore === 'object' && !Array.isArray(rawCore)) {
    const coreRecord = rawCore as Record<string, unknown>;
    const host = coreRecord['host'];
    const port = coreRecord['port'];
    const installId = coreRecord['installId'];
    const userId = coreRecord['userId'];
    const pipeName = coreRecord['pipeName'];
    if (
      typeof installId !== 'string' ||
      installId.length === 0 ||
      typeof userId !== 'string' ||
      userId.length === 0
    ) {
      throw new Error('broker config core section requires installId and userId');
    }
    const tcpPresent = host !== undefined || port !== undefined;
    if (tcpPresent && (host !== '127.0.0.1' || typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535)) {
      throw new Error(
        'broker config core TCP section must be { host: "127.0.0.1", port } (loopback only)',
      );
    }
    if (pipeName !== undefined) {
      // The same exact-namespace rule the Core host enforces: one canonical
      // pipe per install, never an arbitrary namespace.
      if (
        typeof pipeName !== 'string' ||
        pipeName !== String.raw`\\.\pipe\xdownload-core-${installId}`
      ) {
        throw new Error(
          'broker config core pipeName must be the canonical \\\\.\\pipe\\xdownload-core-<installId> namespace of this install',
        );
      }
    }
    if (!tcpPresent && pipeName === undefined) {
      throw new Error(
        'broker config core section requires the loopback TCP target (S2) and/or the canonical Windows pipe namespace (S5)',
      );
    }
    core = {
      ...(tcpPresent ? { host: host as string, port: port as number } : {}),
      installId,
      userId,
      ...(pipeName === undefined ? {} : { pipeName: pipeName as string }),
    } as BrokerConfig['core'];
  } else {
    throw new Error('broker config core section must be an object when present');
  }
  return {
    allowedOrigins: origins.filter((entry): entry is string => typeof entry === 'string'),
    core,
  };
}

export function loadBrokerConfig(configPath: string): BrokerConfig {
  return parseBrokerConfig(fs.readFileSync(configPath, 'utf8'));
}

function configPathFromArgv(argv: readonly string[]): string | undefined {
  const marker = argv.indexOf('--config');
  if (marker >= 0) {
    const value = argv[marker + 1];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Serve one broker session over stdio. Returns the process exit code:
 * 0 when stdin closed cleanly, 2 on any fail-closed refusal (typed line on
 * stderr, never a stdout frame, never a simulated session).
 */
export async function runBrokerHost(argv: readonly string[]): Promise<number> {
  const configPath = configPathFromArgv(argv);
  if (configPath === undefined) {
    process.stderr.write('xdownload-broker-host: missing --config <path> for allowed_origins\n');
    return 2;
  }
  let allowedOrigins: AllowedOrigins;
  let core: BrokerConfig['core'];
  try {
    const loaded = loadBrokerConfig(configPath);
    allowedOrigins = loaded.allowedOrigins;
    core = loaded.core;
  } catch (error) {
    process.stderr.write(
      `xdownload-broker-host: broker config unreadable: ${error instanceof Error ? error.message : 'error'}\n`,
    );
    return 2;
  }
  // Session establishment enforces the exact allow-listed caller origin
  // from the browser-passed argv (T010 semantics, unmodified). The S2 lane
  // is composed only when the loopback TCP Core target is configured; the
  // S5 collection lane only when the canonical OS-verified pipe namespace
  // is configured. Either lane absent → its commands fail closed.
  const broker = createAuthBroker();
  const tcpCore =
    core !== undefined && core.host !== undefined && core.port !== undefined
      ? { host: core.host, port: core.port, installId: core.installId, userId: core.userId }
      : undefined;
  const pipeCore =
    core !== undefined && core.pipeName !== undefined
      ? { pipeName: core.pipeName, installId: core.installId, userId: core.userId }
      : undefined;
  const session = establishNativeHostSession({
    argv,
    allowedOrigins,
    broker,
    ...(tcpCore === undefined
      ? {}
      : {
          s2Lane: createInstalledS2Lane({
            broker,
            core: tcpCore,
          }),
        }),
    ...(pipeCore === undefined
      ? {}
      : {
          s5Lane: createInstalledS5Lane({
            broker,
            core: pipeCore,
          }),
        }),
  });
  if (!session.ok) {
    process.stderr.write(
      `xdownload-broker-host: session refused: ${session.diagnostics[0]?.message ?? 'caller origin is not allow-listed'}\n`,
    );
    return 2;
  }
  serveNativeHostSession(session.value, { input: process.stdin, output: process.stdout });
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await runBrokerHost(process.argv.slice(2));
}
