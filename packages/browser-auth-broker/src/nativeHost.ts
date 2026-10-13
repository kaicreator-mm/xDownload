/**
 * T010 Native Messaging host session (frozen L2 invariant 14, ADR-005).
 *
 * The host reachable via Chromium Native Messaging. Session establishment
 * requires an allow-listed `chrome-extension://` caller origin from the
 * launch arguments — a host started by anything else fails closed. All
 * inbound frames are size/schema bounded before dispatch; broker responses
 * carry only opaque refs and binding state.
 *
 * Recorded F1 choice: the native host runtime is Node.js `24.21.0` (the
 * repository runtime via fnm; no new runtime dependency). The real-browser
 * tuple (Chromium 144/Linux per frozen L2 Research Demo #8) is NOT exercised
 * or claimed by builder tests — T010 concern Validation owns that proof.
 */

import type { AuthBroker } from './broker.ts';
import type { CapabilityBinding, IssueRequest } from './capability.ts';
import { assertOriginAllowed, resolveCallerOrigin, type AllowedOrigins } from './allowedOrigins.ts';
import { decodeFrame, type DecodedFrame } from './nativeFrame.ts';
import {
  brokerDiagnostic,
  brokerFail,
  brokerOk,
  type BrokerDiagnostic,
  type BrokerResult,
} from './result.ts';

export interface NativeHostSessionOptions {
  readonly argv: readonly string[];
  readonly allowedOrigins: AllowedOrigins;
  readonly broker: AuthBroker;
  readonly maxInboundFrameBytes?: number;
  /**
   * #95 installed S2 lane. When present, `S2_ACQUIRE` commands execute the
   * browser-delivered acquisition journey (scoped capability + single Core
   * authority seam submission). Absent → the command fails closed with a
   * typed rejection; the broker-only behavior of existing deployments is
   * unchanged.
   */
  readonly s2Lane?: S2LaneHandler;
}

export type BrokerCommand =
  | {
      readonly kind: 'AUTH_ISSUE';
      readonly requestId: string;
      readonly binding: unknown;
      readonly ttlMs: unknown;
      readonly issueDecisionToken: unknown;
    }
  | {
      readonly kind: 'AUTH_USE';
      readonly requestId: string;
      readonly ref: unknown;
      readonly binding: unknown;
    }
  | { readonly kind: 'AUTH_REVOKE'; readonly requestId: string; readonly ref: unknown }
  | { readonly kind: 'AUTH_INSPECT'; readonly requestId: string; readonly ref: unknown }
  | {
      readonly kind: 'S2_ACQUIRE';
      readonly requestId: string;
      readonly command: unknown;
    };

/**
 * Structurally decoded `S2_ACQUIRE` command (closed top-level shape only —
 * semantic decode, authorization and Core submission live in the injected
 * installed-lane implementation, never in the broker session).
 */
export interface S2AcquireCommandShape {
  readonly kind: 'S2_ACQUIRE';
  readonly requestId: string;
  readonly payload: Record<string, unknown>;
}

/** Async installed-S2 lane handler (#95). See `s2-installed-lane.ts`. */
export interface S2LaneHandler {
  handle(command: S2AcquireCommandShape): Promise<BrokerResponse>;
}

/**
 * Structural diagnostic of the installed S2 lane: broker and seam diagnostic
 * vocabularies both carry (code, path, message) truthfully; the lane never
 * normalizes one into the other's closed code set.
 */
export interface S2LaneDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

export type BrokerResponse =
  | {
      readonly kind: 'ISSUED';
      readonly requestId: string;
      readonly ref: string;
      readonly expiresAtMs: number;
    }
  | { readonly kind: 'USE_GRANTED'; readonly requestId: string; readonly ref: string }
  | {
      readonly kind: 'USE_DENIED';
      readonly requestId: string;
      readonly outcome: 'AUTH_REQUIRED' | 'AUTH_FAILED';
      readonly reasons: readonly BrokerDiagnostic[];
    }
  | { readonly kind: 'REVOKED'; readonly requestId: string }
  | {
      readonly kind: 'STATUS';
      readonly requestId: string;
      readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'REJECTED';
      readonly requestId: string;
      readonly reasons: readonly BrokerDiagnostic[];
    }
  | {
      /** #95 installed S2 lane: the truthful Core terminal projection. */
      readonly kind: 'S2_RESULT';
      readonly requestId: string;
      readonly contractId: string;
      readonly terminal: unknown;
      readonly authorizationContextRef: string;
    }
  | {
      /** #95 installed S2 lane: typed stage-labelled rejection (fail closed). */
      readonly kind: 'S2_REJECTED';
      readonly requestId: string;
      readonly stage: string;
      readonly reasons: readonly S2LaneDiagnostic[];
    };

const COMMAND_KEYS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  AUTH_ISSUE: ['kind', 'requestId', 'binding', 'ttlMs', 'issueDecisionToken'],
  AUTH_USE: ['kind', 'requestId', 'ref', 'binding'],
  AUTH_REVOKE: ['kind', 'requestId', 'ref'],
  AUTH_INSPECT: ['kind', 'requestId', 'ref'],
  S2_ACQUIRE: ['kind', 'requestId', 's2'],
};

const S2_PAYLOAD_KEYS: readonly string[] = [
  'handoff',
  'decisionToken',
  'ttlMs',
  'delivery',
  'browserResponse',
  'bytes',
];

/** Decode an inbound broker command with unknown-field rejection (fail closed). */
export function decodeBrokerCommand(payload: unknown): BrokerResult<BrokerCommand> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_MALFORMED',
        'command',
        'broker command must be a JSON object',
      ),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const kind = record['kind'];
  if (typeof kind !== 'string' || !(kind in COMMAND_KEYS_BY_KIND)) {
    return brokerFail([
      brokerDiagnostic(
        'UNKNOWN_FIELD',
        'command.kind',
        'unknown broker command kind; fail closed',
        'L2-inv11',
      ),
    ]);
  }
  const known = COMMAND_KEYS_BY_KIND[kind];
  if (known === undefined) {
    return brokerFail([
      brokerDiagnostic(
        'UNKNOWN_FIELD',
        'command.kind',
        'unknown broker command kind; fail closed',
        'L2-inv11',
      ),
    ]);
  }
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    return brokerFail(
      unknown.map((key) =>
        brokerDiagnostic(
          'UNKNOWN_FIELD',
          `command.${key}`,
          'unknown field in broker command; fail closed',
          'L2-inv11',
        ),
      ),
    );
  }
  const requestId = record['requestId'];
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    return brokerFail([
      brokerDiagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'command.requestId',
        'requestId must be 1..128 chars',
      ),
    ]);
  }
  if (kind === 'AUTH_ISSUE') {
    return brokerOk({
      kind: 'AUTH_ISSUE',
      requestId,
      binding: record['binding'],
      ttlMs: record['ttlMs'],
      issueDecisionToken: record['issueDecisionToken'],
    });
  }
  if (kind === 'S2_ACQUIRE') {
    const s2Payload = record['s2'];
    if (typeof s2Payload !== 'object' || s2Payload === null || Array.isArray(s2Payload)) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.s2',
          'S2 acquire payload must be an object',
        ),
      ]);
    }
    const s2Record = s2Payload as Record<string, unknown>;
    const s2Unknown = Object.keys(s2Record).filter((key) => !S2_PAYLOAD_KEYS.includes(key));
    if (s2Unknown.length > 0) {
      return brokerFail(
        s2Unknown.map((key) =>
          brokerDiagnostic(
            'UNKNOWN_FIELD',
            `command.s2.${key}`,
            'unknown field on S2 acquire payload; fail closed',
            'L2-inv11',
          ),
        ),
      );
    }
    return brokerOk({
      kind: 'S2_ACQUIRE',
      requestId,
      command: s2Record,
    });
  }
  if (kind === 'AUTH_USE') {
    return brokerOk({
      kind: 'AUTH_USE',
      requestId,
      ref: record['ref'],
      binding: record['binding'],
    });
  }
  if (kind === 'AUTH_REVOKE') {
    return brokerOk({ kind: 'AUTH_REVOKE', requestId, ref: record['ref'] });
  }
  return brokerOk({ kind: 'AUTH_INSPECT', requestId, ref: record['ref'] });
}

export interface NativeHostSession {
  readonly callerOrigin: string;
  /** Handle one decoded Native Messaging payload (async for the S2 lane). */
  handleMessage(
    payload: unknown,
  ): BrokerResult<BrokerResponse> | Promise<BrokerResult<BrokerResponse>>;
  /** Handle one raw frame (length prefix + payload) with the inbound size bound. */
  handleFrame(
    frame: Uint8Array,
  ): BrokerResult<BrokerResponse> | Promise<BrokerResult<BrokerResponse>>;
}

export function establishNativeHostSession(
  options: NativeHostSessionOptions,
): BrokerResult<NativeHostSession> {
  const callerOrigin = resolveCallerOrigin(options.argv);
  if (!callerOrigin.ok) {
    return brokerFail(callerOrigin.diagnostics);
  }
  const allowed = assertOriginAllowed(callerOrigin.value, options.allowedOrigins);
  if (!allowed.ok) {
    return brokerFail(allowed.diagnostics);
  }
  const maxBytes = options.maxInboundFrameBytes ?? 64 * 1024 * 1024;
  const session: NativeHostSession = {
    callerOrigin: callerOrigin.value,
    handleMessage(payload) {
      const command = decodeBrokerCommand(payload);
      if (!command.ok) {
        return brokerFail(command.diagnostics);
      }
      if (command.value.kind === 'S2_ACQUIRE') {
        if (options.s2Lane === undefined) {
          return brokerOk({
            kind: 'REJECTED',
            requestId: command.value.requestId,
            reasons: [
              brokerDiagnostic(
                'S2_LANE_UNAVAILABLE',
                'command.kind',
                'this native host was not configured with the installed S2 lane; fail closed',
              ),
            ],
          });
        }
        return options.s2Lane
          .handle({
            kind: 'S2_ACQUIRE',
            requestId: command.value.requestId,
            payload: command.value.command as Record<string, unknown>,
          })
          .then((response) => brokerOk(response));
      }
      return dispatchCommand(command.value, options.broker);
    },
    handleFrame(frame) {
      const decoded: BrokerResult<DecodedFrame> = decodeFrame(frame, maxBytes);
      if (!decoded.ok) {
        return brokerFail(decoded.diagnostics);
      }
      return session.handleMessage(decoded.value.payload);
    },
  };
  return brokerOk(Object.freeze(session));
}

function dispatchCommand(
  command: Exclude<BrokerCommand, { readonly kind: 'S2_ACQUIRE' }>,
  broker: AuthBroker,
): BrokerResult<BrokerResponse> {
  if (command.kind === 'AUTH_ISSUE') {
    const issued = broker.issue({
      binding: command.binding as CapabilityBinding,
      ttlMs: command.ttlMs as number,
      issueDecisionToken: command.issueDecisionToken as IssueRequest['issueDecisionToken'],
    });
    if (!issued.ok) {
      return brokerOk({
        kind: 'REJECTED',
        requestId: command.requestId,
        reasons: issued.diagnostics,
      });
    }
    return brokerOk({
      kind: 'ISSUED',
      requestId: command.requestId,
      ref: issued.value.ref,
      expiresAtMs: issued.value.expiresAtMs,
    });
  }
  if (command.kind === 'AUTH_USE') {
    if (typeof command.ref !== 'string') {
      return brokerOk({
        kind: 'REJECTED',
        requestId: command.requestId,
        reasons: [
          brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 'command.ref', 'ref must be a string'),
        ],
      });
    }
    const outcome = broker.use({ ref: command.ref, binding: command.binding as CapabilityBinding });
    if (outcome.outcome === 'AUTH_GRANTED') {
      return brokerOk({ kind: 'USE_GRANTED', requestId: command.requestId, ref: outcome.ref });
    }
    return brokerOk({
      kind: 'USE_DENIED',
      requestId: command.requestId,
      outcome: outcome.outcome,
      reasons: outcome.reasons,
    });
  }
  if (typeof command.ref !== 'string') {
    return brokerOk({
      kind: 'REJECTED',
      requestId: command.requestId,
      reasons: [
        brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 'command.ref', 'ref must be a string'),
      ],
    });
  }
  if (command.kind === 'AUTH_REVOKE') {
    const revoked = broker.revoke(command.ref);
    if (!revoked.ok) {
      return brokerOk({
        kind: 'REJECTED',
        requestId: command.requestId,
        reasons: revoked.diagnostics,
      });
    }
    return brokerOk({ kind: 'REVOKED', requestId: command.requestId });
  }
  const inspected = broker.inspect(command.ref);
  if (!inspected.ok) {
    return brokerOk({
      kind: 'REJECTED',
      requestId: command.requestId,
      reasons: inspected.diagnostics,
    });
  }
  return brokerOk({
    kind: 'STATUS',
    requestId: command.requestId,
    status: inspected.value.status,
    expiresAtMs: inspected.value.expiresAtMs,
  });
}

/**
 * Serve one established session over stdio using the Native Messaging frame
 * format. This is the real native-host entry point; `establishNativeHostSession`
 * carries all authorization semantics and is the unit under test.
 */
export function serveNativeHostSession(
  session: NativeHostSession,
  io: {
    readonly input: NodeJS.ReadableStream;
    readonly output: NodeJS.WritableStream;
  },
  maxInboundFrameBytes = 64 * 1024 * 1024,
): void {
  let buffer = Buffer.alloc(0);
  // Responses are written strictly in inbound frame order: the async S2 lane
  // must never reorder Native Messaging replies relative to broker commands.
  let inFlight: Promise<void> = Promise.resolve();
  io.input.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const declared = buffer.readUInt32LE(0);
      if (declared > maxInboundFrameBytes) {
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length - 4 < declared) {
        return;
      }
      const frame = new Uint8Array(buffer.subarray(0, 4 + declared));
      buffer = buffer.subarray(4 + declared);
      inFlight = inFlight.then(async () => {
        const response = await session.handleFrame(frame);
        writeResponse(io.output, response);
      });
    }
  });
  io.input.on('end', () => {
    void inFlight.then(() => {
      io.output.end();
    });
  });
}

function writeResponse(
  output: NodeJS.WritableStream,
  response: BrokerResult<BrokerResponse>,
): void {
  const payload = response.ok
    ? response.value
    : {
        kind: 'TRANSPORT_REJECTED',
        reasons: response.diagnostics,
      };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  output.write(Buffer.concat([header, Buffer.from(encoded)]));
}
