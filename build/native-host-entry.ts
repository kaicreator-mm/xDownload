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

/**
 * T018 native-host process entry — the packaged stdio broker the browser
 * launches via Native Messaging (packaging composition over the T010
 * package, consumed as-is: `createAuthBroker`, `establishNativeHostSession`
 * and `serveNativeHostSession` own ALL authorization semantics).
 *
 * T09 v0.2 relay lane: the T05 extension cutover sends explicit v0.2 seam
 * frames (`route: 'v0.2'`, closed vocabulary `DOMAIN_APP_SEND` /
 * `READ_JOB_PROJECTION`) over the same Native Messaging boundary. The broker
 * session's command vocabulary is the closed v1 set, so before this lane
 * every v0.2 frame was answered with a typed broker rejection (the
 * extension's truthful `V02_HOST_CARRIER_REJECTED` rendering). This entry now
 * intercepts v0.2 frames at the stdio framing layer and RELAYS them verbatim
 * to the ONE configured Core authority (canonical pipe preferred, explicit
 * loopback TCP per the same config the v1 lanes use), relaying the Core's
 * SeamResponse back verbatim. The host adds NO second opinion: peer/identity
 * binding, schema versioning and the closed v0.2 grammar are re-decided by
 * the Core seam, never here.
 *
 * Fail-closed rules preserved verbatim from the sources:
 * - the caller origin must arrive as the browser-passed
 *   `chrome-extension://<id>/` argv entry and match the configured
 *   `allowed_origins` exactly; anything else refuses session establishment;
 * - `allowed_origins` is read from the packaged broker config; an empty or
 *   missing list rejects every caller (no empty-match fallback);
 * - stdout carries ONLY Native Messaging frames — any other output would
 *   corrupt the platform protocol, so diagnostics go to stderr;
 * - only frames whose decoded payload carries `route === 'v0.2'` take the
 *   relay lane; a v0.2 frame outside the closed two-word vocabulary
 *   (command `DOMAIN_APP_SEND`, query `READ_JOB_PROJECTION`) or without a
 *   bounded `requestId` is answered with a typed rejection and NEVER
 *   forwarded to Core; every other frame is forwarded to the broker session
 *   untouched, so unrecognized routes keep the broker's own typed rejection;
 * - with no Core configured (placeholder/unbound install) every v0.2 frame
 *   is rejected typed (`V02_CORE_UNCONFIGURED`), never simulated.
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
  createInstalledS6Lane,
} from '@xdownload/browser-collection-workflow';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  createLoopbackClientTransport,
  createSeamClient,
  createWindowsPipeClientTransport,
  type CommandEnvelope,
  type QueryEnvelope,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamResponse,
} from '@xdownload/core-seam';

/** The inbound NM frame bound the broker session enforces (mirrored here). */
const MAX_INBOUND_FRAME_BYTES = 64 * 1024 * 1024;

export interface BrokerConfig {
  readonly allowedOrigins: AllowedOrigins;
  /**
   * #95/#151: the ONE Core authority seam target. Absent → both lanes fail
   * closed. The OS-verified Windows pipe can serve installed S2/S5/S6 through the
   * ONE Core authority; explicit TCP-only S2 remains available for legacy
   * test/host tuples (same install/user; no pipe-to-TCP fallback).
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
    if (
      tcpPresent &&
      (host !== '127.0.0.1' ||
        typeof port !== 'number' ||
        !Number.isInteger(port) ||
        port <= 0 ||
        port > 65535)
    ) {
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

// -------------------------------------------------------- T09 v0.2 relay lane

/** The closed v0.2 command vocabulary the relay may carry (T05 grammar). */
export const V02_RELAY_COMMAND_TYPES: readonly string[] = ['DOMAIN_APP_SEND'];
/** The closed v0.2 query vocabulary the relay may carry (T05 grammar). */
export const V02_RELAY_QUERY_TYPES: readonly string[] = ['READ_JOB_PROJECTION'];

/** The relay's own typed rejection vocabulary (wire `REJECTED.reasons[].code`). */
export type V02RelayRejectionCode =
  | 'V02_FRAME_MALFORMED'
  | 'V02_ROUTE_UNSUPPORTED'
  | 'V02_CORE_UNCONFIGURED'
  | 'V02_CORE_UNREACHABLE';

/**
 * The relay's wire diagnostic. Shape-identical to the broker's diagnostic so
 * the extension's existing BROKER_REJECTION classifier consumes it verbatim,
 * but the code vocabulary is host-owned: the broker's closed enum is never
 * widened from outside its package.
 */
export interface V02RelayDiagnostic {
  readonly code: V02RelayRejectionCode;
  readonly path: string;
  readonly message: string;
}

function relayDiagnostic(
  code: V02RelayRejectionCode,
  path: string,
  message: string,
): V02RelayDiagnostic {
  return { code, path, message };
}

export interface V02RelayRejection {
  readonly kind: 'REJECTED';
  readonly requestId: string;
  readonly reasons: readonly V02RelayDiagnostic[];
}

/** Either the Core's verbatim SeamResponse or the relay's typed rejection. */
export type V02RelayAnswer = SeamResponse | V02RelayRejection;

/**
 * Structural v0.2 gate: `true` only for decoded payloads that name the
 * explicit v0.2 route. Everything else stays with the broker session, so an
 * unknown/absent route keeps the broker's own typed rejection (fail closed,
 * single handling authority per frame shape).
 */
export function isV02SeamFrame(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>)['route'] === 'v0.2'
  );
}

function boundedRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

export type V02DecodedRelayFrame =
  | {
      readonly ok: true;
      readonly envelope: Record<string, unknown>;
      readonly requestId: string;
      readonly isQuery: boolean;
    }
  | { readonly ok: false; readonly rejection: V02RelayRejection };

/**
 * Decode one v0.2 frame for relay. The gate is deliberately thin — the host
 * is a carrier, not a second authority: it checks ONLY the facts it needs to
 * route safely (closed vocabulary: one command type, one query type; a
 * bounded `requestId` for the typed answer correlation). Peer identity,
 * schema version, aggregate binding, issuedAt and payload grammar are
 * re-decided by the Core seam on the verbatim envelope.
 */
export function decodeV02RelayFrame(payload: unknown): V02DecodedRelayFrame {
  const record =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  const requestId = record === undefined ? undefined : boundedRequestId(record['requestId']);
  const malformed = (detail: string): V02DecodedRelayFrame => ({
    ok: false,
    rejection: {
      kind: 'REJECTED',
      requestId: requestId ?? '',
      reasons: [relayDiagnostic('V02_FRAME_MALFORMED', 'route', detail)],
    },
  });
  if (record === undefined || requestId === undefined) {
    return malformed('a v0.2 relay frame must be an object with a bounded requestId');
  }
  const kind = record['kind'];
  if (kind === 'command') {
    if (!V02_RELAY_COMMAND_TYPES.includes(String(record['commandType']))) {
      return {
        ok: false,
        rejection: {
          kind: 'REJECTED',
          requestId,
          reasons: [
            relayDiagnostic(
              'V02_ROUTE_UNSUPPORTED',
              'commandType',
              `v0.2 commandType '${String(record['commandType'])}' is outside the relay's closed vocabulary; rejected, never forwarded`,
            ),
          ],
        },
      };
    }
    return { ok: true, envelope: record, requestId, isQuery: false };
  }
  if (kind === 'query') {
    if (!V02_RELAY_QUERY_TYPES.includes(String(record['queryType']))) {
      return {
        ok: false,
        rejection: {
          kind: 'REJECTED',
          requestId,
          reasons: [
            relayDiagnostic(
              'V02_ROUTE_UNSUPPORTED',
              'queryType',
              `v0.2 queryType '${String(record['queryType'])}' is outside the relay's closed vocabulary; rejected, never forwarded`,
            ),
          ],
        },
      };
    }
    return { ok: true, envelope: record, requestId, isQuery: true };
  }
  return malformed(`v0.2 frame kind '${String(kind)}' is neither command nor query`);
}

export interface V02RelayLaneConfig {
  /** The ONE Core authority of this install (absent → every frame rejected). */
  readonly core: BrokerConfig['core'];
}

export interface V02RelayLane {
  /** Relay one structurally valid v0.2 frame; never throws. */
  handle(frame: V02DecodedRelayFrame & { readonly ok: true }): Promise<V02RelayAnswer>;
  /** Release the underlying seam connection (process shutdown only). */
  close(): Promise<void>;
}

/**
 * The ONE Core seam client behind the relay. The canonical Windows pipe is
 * preferred; the explicit loopback TCP target exists for legacy test/host
 * tuples only — the same selection rule and the same config the v1 lanes
 * use, so there is never a second Core.
 */
function selectRelayTransport(core: NonNullable<BrokerConfig['core']>): {
  transport: SeamClientTransport;
  target: SeamListenTarget;
} {
  if (core.pipeName !== undefined) {
    return {
      transport: createWindowsPipeClientTransport(),
      target: { host: '127.0.0.1', port: 0, pipeName: core.pipeName },
    };
  }
  if (core.host === undefined || core.port === undefined) {
    throw new Error('v0.2 relay requires the canonical pipe or the explicit loopback target');
  }
  return {
    transport: createLoopbackClientTransport(),
    target: { host: core.host, port: core.port },
  };
}

/**
 * Create the v0.2 relay lane. Reconnects are bounded to a single attempt:
 * the seam client's own idempotent re-submission plus the extension's
 * fail-closed retry (same requestId) cover recovery; the host never spins on
 * a dead Core.
 */
export function createV02RelayLane(config: V02RelayLaneConfig): V02RelayLane {
  const client: SeamClient | null =
    config.core === undefined
      ? null
      : (() => {
          const selected = selectRelayTransport(config.core);
          return createSeamClient({
            transport: selected.transport,
            target: selected.target,
            peer: {
              installId: config.core.installId,
              userId: config.core.userId,
              surface: 'BROWSER_EXTENSION',
            },
            maxReconnectAttempts: 0,
          });
        })();
  return {
    async handle(frame): Promise<V02RelayAnswer> {
      if (client === null) {
        return {
          kind: 'REJECTED',
          requestId: frame.requestId,
          reasons: [
            relayDiagnostic(
              'V02_CORE_UNCONFIGURED',
              'route',
              'this install has no Core authority bound; the v0.2 frame is refused, never simulated',
            ),
          ],
        };
      }
      const wireEnvelope = frame.envelope;
      try {
        // The envelope crosses verbatim; the casts are wire-level only — the
        // seam client serializes the object and the Core seam owns every
        // semantic decision (route grammar, peer binding, idempotency).
        const response =
          frame.isQuery === true
            ? await client.submitQuery(wireEnvelope as unknown as QueryEnvelope)
            : await client.submitCommand(wireEnvelope as unknown as CommandEnvelope);
        return response;
      } catch (error) {
        return {
          kind: 'REJECTED',
          requestId: frame.requestId,
          reasons: [
            relayDiagnostic(
              'V02_CORE_UNREACHABLE',
              'route',
              `the Core authority did not answer the v0.2 frame: ${error instanceof Error ? error.message : 'transport failure'}`,
            ),
          ],
        };
      }
    },
    async close(): Promise<void> {
      if (client !== null) {
        await client.close();
      }
    },
  };
}

export interface ServeBrokerHostIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

/**
 * Serve one broker host session over the given stdio with the v0.2 relay
 * lane interception (testable seam: `runBrokerHost` passes the real
 * process streams).
 *
 * Wiring: frames are parsed from the real input; decoded payloads naming
 * `route: 'v0.2'` are handled by the relay lane and answered on the output
 * directly (strictly sequentially, one at a time); every other frame is
 * forwarded byte-verbatim into an internal pass-through that feeds the
 * unmodified broker session, whose responses write to the same output. The
 * per-connection Native Messaging discipline (the shipped extension performs
 * one request/response per port and disconnects) keeps the two writers from
 * interleaving; stdin end drains the in-flight relay work before the broker
 * session sees EOF, so trailing answers are never cut off, and the relay's
 * pooled Core connection is then closed so the event loop drains and the
 * process honors its exit contract (0 on clean stdin close — a leaked ref'd
 * socket here would leave one zombie broker per browser port).
 */
export function serveBrokerHostStdio(
  io: ServeBrokerHostIo,
  sessionOptions: {
    readonly argv: readonly string[];
    readonly allowedOrigins: AllowedOrigins;
    readonly core: BrokerConfig['core'];
  },
): { readonly brokerSessionEstablished: boolean } {
  const broker = createAuthBroker();
  const tcpCore =
    sessionOptions.core !== undefined &&
    sessionOptions.core.host !== undefined &&
    sessionOptions.core.port !== undefined
      ? {
          host: sessionOptions.core.host,
          port: sessionOptions.core.port,
          installId: sessionOptions.core.installId,
          userId: sessionOptions.core.userId,
        }
      : undefined;
  const pipeCore =
    sessionOptions.core !== undefined && sessionOptions.core.pipeName !== undefined
      ? {
          pipeName: sessionOptions.core.pipeName,
          installId: sessionOptions.core.installId,
          userId: sessionOptions.core.userId,
        }
      : undefined;
  const s2Core = pipeCore ?? tcpCore;
  const session = establishNativeHostSession({
    argv: sessionOptions.argv,
    allowedOrigins: sessionOptions.allowedOrigins,
    broker,
    ...(s2Core === undefined ? {} : { s2Lane: createInstalledS2Lane({ broker, core: s2Core }) }),
    ...(pipeCore === undefined
      ? {}
      : {
          s5Lane: createInstalledS5Lane({ broker, core: pipeCore }),
          s6Lane: createInstalledS6Lane({ broker, core: pipeCore }),
        }),
  });
  if (!session.ok) {
    process.stderr.write(
      `xdownload-broker-host: session refused: ${session.diagnostics[0]?.message ?? 'caller origin is not allow-listed'}\n`,
    );
    return { brokerSessionEstablished: false };
  }

  const relay = createV02RelayLane({ core: sessionOptions.core });
  const brokerInput = new PassThrough();
  serveNativeHostSession(session.value, { input: brokerInput, output: io.output });

  const encodeNmFrame = (message: unknown): Buffer => {
    const encoded = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(encoded.length, 0);
    return Buffer.concat([header, encoded]);
  };

  let buffer = Buffer.alloc(0);
  // Strictly sequential v0.2 handling: one relay exchange at a time, in
  // arrival order (the lane serializes; the broker session orders its own).
  let relayChain: Promise<void> = Promise.resolve();

  const forwardFrame = (frame: Buffer): void => {
    brokerInput.write(frame);
  };

  const handleV02Frame = (payload: unknown): void => {
    relayChain = relayChain.then(async () => {
      let answer: V02RelayAnswer;
      try {
        const decoded = decodeV02RelayFrame(payload);
        answer =
          decoded.ok === true
            ? await relay.handle(decoded)
            : // The structural gate refused: answer its typed rejection.
              decoded.rejection;
      } catch (error) {
        // The relay lane itself never throws; this guard keeps one
        // unexpected failure from wedging the serialized chain.
        answer = {
          kind: 'REJECTED',
          requestId: '',
          reasons: [
            relayDiagnostic(
              'V02_FRAME_MALFORMED',
              'route',
              `the relay could not process the v0.2 frame: ${error instanceof Error ? error.message : 'error'}`,
            ),
          ],
        };
      }
      io.output.write(encodeNmFrame(answer));
    });
  };

  io.input.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const declared = buffer.readUInt32LE(0);
      if (declared > MAX_INBOUND_FRAME_BYTES) {
        // Same fail-closed framing discipline as the broker session: an
        // oversized frame drops the stream state without any response.
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length - 4 < declared) {
        return;
      }
      const frame = Buffer.from(buffer.subarray(0, 4 + declared));
      buffer = buffer.subarray(4 + declared);
      let payload: unknown;
      let parsable = true;
      try {
        payload = JSON.parse(frame.subarray(4).toString('utf8')) as unknown;
      } catch {
        parsable = false;
      }
      if (parsable && isV02SeamFrame(payload)) {
        handleV02Frame(payload);
      } else {
        forwardFrame(frame);
      }
    }
  });
  io.input.on('end', () => {
    // Drain in-flight relay work, answer trailing frames, then RELEASE the
    // Core connection: the relay's pooled seam socket is ref'd, and without
    // an explicit close it keeps the event loop (this short-lived per-port
    // host process) alive indefinitely after stdin EOF — a zombie holding a
    // Core connection per browser port. stdin EOF means the exit contract
    // ("0 clean (stdin closed)") must actually run.
    void relayChain
      .then(async () => {
        brokerInput.end();
        await relay.close();
      })
      .catch(() => {
        brokerInput.end();
      });
  });
  // Release the relay connection if the input errors out unexpectedly.
  io.input.on('error', () => {
    relay.close().catch(() => undefined);
  });
  return { brokerSessionEstablished: true };
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
  // from the browser-passed argv (T010 semantics, unmodified). The v0.2
  // relay and the S2 lane use the same canonical OS-verified pipe (or the
  // legacy explicit TCP for S2) — ONE Core authority per install.
  const established = serveBrokerHostStdio(
    { input: process.stdin, output: process.stdout },
    { argv, allowedOrigins, core },
  );
  if (!established.brokerSessionEstablished) {
    return 2;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await runBrokerHost(process.argv.slice(2));
}
