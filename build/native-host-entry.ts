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
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export interface BrokerConfig {
  readonly allowedOrigins: AllowedOrigins;
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
    return { allowedOrigins: [] };
  }
  return { allowedOrigins: origins.filter((entry): entry is string => typeof entry === 'string') };
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
  try {
    allowedOrigins = loadBrokerConfig(configPath).allowedOrigins;
  } catch (error) {
    process.stderr.write(
      `xdownload-broker-host: broker config unreadable: ${error instanceof Error ? error.message : 'error'}\n`,
    );
    return 2;
  }
  // Session establishment enforces the exact allow-listed caller origin
  // from the browser-passed argv (T010 semantics, unmodified).
  const session = establishNativeHostSession({
    argv,
    allowedOrigins,
    broker: createAuthBroker(),
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
