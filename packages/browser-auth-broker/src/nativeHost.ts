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
  type BrokerDiagnosticCode,
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
  /**
   * #151/#152: the installed S5 current-page group lane (browser batch
   * prepare/confirm/execute/status over the OS-verified Core pipe). Absent →
   * every S5 command fails closed with a typed rejection; the broker-only
   * behavior of existing deployments is unchanged.
   */
  readonly s5Lane?: S5LaneHandler;
  /**
   * #154: the installed S6 explicit-collection lane (browser finite
   * playlist/gallery prepare/page-walk/confirm/execute/status over the
   * OS-verified Core pipe). Absent -> every S6 command fails closed with a
   * typed rejection; the broker-only behavior of existing deployments is
   * unchanged.
   */
  readonly s6Lane?: S6LaneHandler;
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
    }
  | {
      /**
       * #95 R1/F04: one bounded byte slab of a chunked S2 delivery. Bytes
       * never ride the S2_ACQUIRE frame itself; the session reassembles the
       * stream and invokes the lane only after S2_ACQUIRE_END verifies it.
       */
      readonly kind: 'S2_ACQUIRE_CHUNK';
      readonly requestId: string;
      readonly seq: number;
      readonly data: string;
    }
  | {
      readonly kind: 'S5_GROUP_STATUS';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | { readonly kind: 'S2_ACQUIRE_END'; readonly requestId: string }
  | {
      readonly kind: 'S5_GROUP_PREPARE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_CONFIRM';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_EXECUTE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_STATUS';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_PREPARE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_PAGE_ADMIT';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_PAGE_RECORD';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_CONFIRM';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_EXECUTE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_STATUS';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
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
 * Structurally decoded S5 command (closed top-level shape only — semantic
 * decode, confirmation challenge handling and Core submission live in the
 * injected installed-lane implementation, never in the broker session).
 */
export type S5LaneCommandShape =
  | {
      readonly kind: 'S5_GROUP_PREPARE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_CONFIRM';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_EXECUTE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_GROUP_STATUS';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    };

/** Async installed-S5 lane handler (#151). See `s5-installed-lane.ts`. */
export interface S5LaneHandler {
  handle(command: S5LaneCommandShape): Promise<BrokerResponse>;
}

/**
 * Structurally decoded S6 command (closed top-level shape only — semantic
 * decode, confirmation challenge handling and Core submission live in the
 * injected installed-lane implementation, never in the broker session).
 */
export type S6LaneCommandShape =
  | {
      readonly kind: 'S6_GROUP_PREPARE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_PAGE_ADMIT';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_PAGE_RECORD';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_CONFIRM';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_EXECUTE';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'S6_GROUP_STATUS';
      readonly requestId: string;
      readonly payload: Record<string, unknown>;
    };

/** Async installed-S6 lane handler (#154). See `s6-installed-lane.ts`. */
export interface S6LaneHandler {
  handle(command: S6LaneCommandShape): Promise<BrokerResponse>;
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
    }
  | {
      /** #95 R1/F04: the S2 acquisition metadata frame was accepted; byte chunks may follow. */
      readonly kind: 'S2_ACQUIRE_ACCEPTED';
      readonly requestId: string;
    }
  | {
      /** #95 R1/F04: one byte chunk was staged in order. */
      readonly kind: 'S2_CHUNK_ACK';
      readonly requestId: string;
      readonly seq: number;
    }
  | {
      /** #151 installed S5 lane: truthful Core phase facts (verbatim projection). */
      readonly kind: 'S5_RESULT';
      readonly requestId: string;
      readonly phase: 'PREPARED' | 'CONFIRMED' | 'TERMINAL' | 'RUNNING' | 'STATUS';
      readonly contractId: string;
      readonly facts: Record<string, unknown>;
    }
  | {
      /** #151 installed S5 lane: typed stage-labelled rejection (fail closed). */
      readonly kind: 'S5_REJECTED';
      readonly requestId: string;
      readonly stage: string;
      readonly reasons: readonly S2LaneDiagnostic[];
    }
  | {
      /** #154 installed S6 lane: truthful Core phase facts (verbatim projection). */
      readonly kind: 'S6_RESULT';
      readonly requestId: string;
      readonly phase:
        | 'PREPARED'
        | 'PAGE_ADMITTED'
        | 'PAGE_RECORDED'
        | 'CONFIRMED'
        | 'TERMINAL'
        | 'RUNNING'
        | 'STATUS';
      readonly contractId: string;
      readonly facts: Record<string, unknown>;
    }
  | {
      /** #154 installed S6 lane: typed stage-labelled rejection (fail closed). */
      readonly kind: 'S6_REJECTED';
      readonly requestId: string;
      readonly stage: string;
      readonly reasons: readonly S2LaneDiagnostic[];
    };

/**
 * #95 R1/F04 bounds of the chunked S2 delivery over Native Messaging: one
 * chunk frame carries at most 768 KiB of raw bytes (1,048,576 base64 chars),
 * and one assembled acquisition never exceeds the declared v0.1.0 S2 bound
 * of 64 MiB. The bound is enforced while staging, before the assembled
 * stream is buffered for the lane.
 */
export const S2_NM_CHUNK_MAX_CHARS = 1_048_576;
export const MAX_S2_ASSEMBLY_BYTES = 64 * 1024 * 1024;
/** Seam-string bound of the Core payload the lane consumes (≤4096 chars). */
const S2_SEAM_CHUNK_CHARS = 3072;
/** Bounded number of concurrent S2 assemblies per host process. */
const MAX_PENDING_S2_ASSEMBLIES = 4;

const COMMAND_KEYS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  AUTH_ISSUE: ['kind', 'requestId', 'binding', 'ttlMs', 'issueDecisionToken'],
  AUTH_USE: ['kind', 'requestId', 'ref', 'binding'],
  AUTH_REVOKE: ['kind', 'requestId', 'ref'],
  AUTH_INSPECT: ['kind', 'requestId', 'ref'],
  S2_ACQUIRE: ['kind', 'requestId', 's2'],
  S2_ACQUIRE_CHUNK: ['kind', 'requestId', 'seq', 'data'],
  S2_ACQUIRE_END: ['kind', 'requestId'],
  S5_GROUP_PREPARE: ['kind', 'requestId', 's5'],
  S5_GROUP_CONFIRM: ['kind', 'requestId', 's5'],
  S5_GROUP_EXECUTE: ['kind', 'requestId', 's5'],
  S5_GROUP_STATUS: ['kind', 'requestId', 's5'],
  S6_GROUP_PREPARE: ['kind', 'requestId', 's6'],
  S6_PAGE_ADMIT: ['kind', 'requestId', 's6'],
  S6_PAGE_RECORD: ['kind', 'requestId', 's6'],
  S6_GROUP_CONFIRM: ['kind', 'requestId', 's6'],
  S6_GROUP_EXECUTE: ['kind', 'requestId', 's6'],
  S6_GROUP_STATUS: ['kind', 'requestId', 's6'],
};

// #95 R1/F04: bytes cross as bounded S2_ACQUIRE_CHUNK frames, never inline;
// the S2_ACQUIRE frame carries the declared total when the browser observed
// a Content-Length.
const S2_PAYLOAD_KEYS: readonly string[] = [
  'handoff',
  'decisionToken',
  'ttlMs',
  'delivery',
  'browserResponse',
  'byteCount',
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
  if (
    kind === 'S5_GROUP_PREPARE' ||
    kind === 'S5_GROUP_CONFIRM' ||
    kind === 'S5_GROUP_EXECUTE' ||
    kind === 'S5_GROUP_STATUS'
  ) {
    // Semantic decode, challenge handling and Core submission live in the
    // injected lane; the session only enforces the closed payload shape.
    const s5Payload = record['s5'];
    if (typeof s5Payload !== 'object' || s5Payload === null || Array.isArray(s5Payload)) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.s5',
          'the S5 payload must be a closed object',
        ),
      ]);
    }
    return brokerOk({
      kind,
      requestId,
      payload: s5Payload as Record<string, unknown>,
    } as BrokerCommand);
  }
  if (
    kind === 'S6_GROUP_PREPARE' ||
    kind === 'S6_PAGE_ADMIT' ||
    kind === 'S6_PAGE_RECORD' ||
    kind === 'S6_GROUP_CONFIRM' ||
    kind === 'S6_GROUP_EXECUTE' ||
    kind === 'S6_GROUP_STATUS'
  ) {
    // Semantic decode, challenge handling and Core submission live in the
    // injected lane; the session only enforces the closed payload shape.
    const s6Payload = record['s6'];
    if (typeof s6Payload !== 'object' || s6Payload === null || Array.isArray(s6Payload)) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.s6',
          'the S6 payload must be a closed object',
        ),
      ]);
    }
    return brokerOk({
      kind,
      requestId,
      payload: s6Payload as Record<string, unknown>,
    } as BrokerCommand);
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
    const byteCount = s2Record['byteCount'];
    if (
      byteCount !== undefined &&
      (typeof byteCount !== 'number' ||
        !Number.isInteger(byteCount) ||
        byteCount < 1 ||
        byteCount > MAX_S2_ASSEMBLY_BYTES)
    ) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.s2.byteCount',
          `byteCount, when declared, must be an integer in 1..${String(MAX_S2_ASSEMBLY_BYTES)} (the declared v0.1.0 S2 bound)`,
        ),
      ]);
    }
    return brokerOk({
      kind: 'S2_ACQUIRE',
      requestId,
      command: s2Record,
    });
  }
  if (kind === 'S2_ACQUIRE_CHUNK') {
    const seq = record['seq'];
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.seq',
          'chunk seq must be a non-negative integer',
        ),
      ]);
    }
    const data = record['data'];
    if (
      typeof data !== 'string' ||
      data.length === 0 ||
      data.length > S2_NM_CHUNK_MAX_CHARS ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)
    ) {
      return brokerFail([
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'command.data',
          'chunk data must be quantum-aligned canonical base64 within the declared chunk bound',
        ),
      ]);
    }
    return brokerOk({ kind: 'S2_ACQUIRE_CHUNK', requestId, seq, data });
  }
  if (kind === 'S2_ACQUIRE_END') {
    return brokerOk({ kind: 'S2_ACQUIRE_END', requestId });
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
  // #95 R1/F04: in-flight chunked S2 deliveries, keyed by requestId. The
  // lane runs only after S2_ACQUIRE_END verifies the assembled stream.
  const assemblies = new Map<string, S2Assembly>();
  const laneUnavailable = (requestId: string): BrokerResult<BrokerResponse> =>
    brokerOk({
      kind: 'REJECTED',
      requestId,
      reasons: [
        brokerDiagnostic(
          'S2_LANE_UNAVAILABLE',
          'command.kind',
          'this native host was not configured with the installed S2 lane; fail closed',
        ),
      ],
    });
  const session: NativeHostSession = {
    callerOrigin: callerOrigin.value,
    handleMessage(payload) {
      const command = decodeBrokerCommand(payload);
      if (!command.ok) {
        return brokerFail(command.diagnostics);
      }
      if (
        command.value.kind === 'S5_GROUP_PREPARE' ||
        command.value.kind === 'S5_GROUP_CONFIRM' ||
        command.value.kind === 'S5_GROUP_EXECUTE' ||
        command.value.kind === 'S5_GROUP_STATUS'
      ) {
        if (options.s5Lane === undefined) {
          return brokerOk({
            kind: 'REJECTED',
            requestId: command.value.requestId,
            reasons: [
              brokerDiagnostic(
                'S5_LANE_UNAVAILABLE',
                'command.kind',
                'this native host was not configured with the installed S5 lane; fail closed',
              ),
            ],
          } as BrokerResponse);
        }
        return options.s5Lane
          .handle({
            kind: command.value.kind,
            requestId: command.value.requestId,
            payload: command.value.payload,
          })
          .then((response) => brokerOk(response));
      }
      if (
        command.value.kind === 'S6_GROUP_PREPARE' ||
        command.value.kind === 'S6_PAGE_ADMIT' ||
        command.value.kind === 'S6_PAGE_RECORD' ||
        command.value.kind === 'S6_GROUP_CONFIRM' ||
        command.value.kind === 'S6_GROUP_EXECUTE' ||
        command.value.kind === 'S6_GROUP_STATUS'
      ) {
        if (options.s6Lane === undefined) {
          return brokerOk({
            kind: 'REJECTED',
            requestId: command.value.requestId,
            reasons: [
              brokerDiagnostic(
                'S6_LANE_UNAVAILABLE',
                'command.kind',
                'this native host was not configured with the installed S6 lane; fail closed',
              ),
            ],
          } as BrokerResponse);
        }
        return options.s6Lane
          .handle({
            kind: command.value.kind,
            requestId: command.value.requestId,
            payload: command.value.payload,
          })
          .then((response) => brokerOk(response));
      }
      if (command.value.kind === 'S2_ACQUIRE') {
        if (options.s2Lane === undefined) {
          return laneUnavailable(command.value.requestId);
        }
        return brokerOk(beginS2Assembly(assemblies, command.value));
      }
      if (command.value.kind === 'S2_ACQUIRE_CHUNK') {
        if (options.s2Lane === undefined) {
          return laneUnavailable(command.value.requestId);
        }
        return brokerOk(stageS2Chunk(assemblies, command.value));
      }
      if (command.value.kind === 'S2_ACQUIRE_END') {
        if (options.s2Lane === undefined) {
          return laneUnavailable(command.value.requestId);
        }
        const assembled = completeS2Assembly(assemblies, command.value.requestId);
        if (!assembled.ok) {
          return brokerOk(assembled.response);
        }
        return options.s2Lane
          .handle({
            kind: 'S2_ACQUIRE',
            requestId: command.value.requestId,
            payload: assembled.payload,
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

// ------------------------------------------------------ S2 chunked delivery

interface S2Assembly {
  readonly command: Record<string, unknown>;
  readonly declaredByteCount: number | undefined;
  readonly chunks: string[];
  receivedBytes: number;
}

function rejectedS2(
  requestId: string,
  code: BrokerDiagnosticCode,
  path: string,
  message: string,
): BrokerResponse {
  return {
    kind: 'REJECTED',
    requestId,
    reasons: [brokerDiagnostic(code, path, message)],
  };
}

function beginS2Assembly(
  assemblies: Map<string, S2Assembly>,
  command: { readonly requestId: string; readonly command: unknown },
): BrokerResponse {
  if (assemblies.has(command.requestId)) {
    return rejectedS2(
      command.requestId,
      'MALFORMED_REQUIRED_FIELD',
      'command.requestId',
      'an S2 acquisition with this requestId is already in progress; fail closed',
    );
  }
  if (assemblies.size >= MAX_PENDING_S2_ASSEMBLIES) {
    return rejectedS2(
      command.requestId,
      'MALFORMED_REQUIRED_FIELD',
      'command.requestId',
      'too many concurrent S2 acquisitions in this host process; fail closed',
    );
  }
  const meta = command.command as Record<string, unknown>;
  assemblies.set(command.requestId, {
    command: meta,
    declaredByteCount: meta['byteCount'] as number | undefined,
    chunks: [],
    receivedBytes: 0,
  });
  return { kind: 'S2_ACQUIRE_ACCEPTED', requestId: command.requestId };
}

/** Decoded byte length of a quantum-aligned canonical base64 chunk. */
function decodedChunkBytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function stageS2Chunk(
  assemblies: Map<string, S2Assembly>,
  command: { readonly requestId: string; readonly seq: number; readonly data: string },
): BrokerResponse {
  const assembly = assemblies.get(command.requestId);
  if (assembly === undefined) {
    return rejectedS2(
      command.requestId,
      'MALFORMED_REQUIRED_FIELD',
      'command.requestId',
      'no S2 acquisition is in progress for this requestId; fail closed',
    );
  }
  if (command.seq !== assembly.chunks.length) {
    return rejectedS2(
      command.requestId,
      'MALFORMED_REQUIRED_FIELD',
      'command.seq',
      'chunk sequence must be strictly contiguous from 0; fail closed',
    );
  }
  const received = assembly.receivedBytes + decodedChunkBytes(command.data);
  if (received > MAX_S2_ASSEMBLY_BYTES) {
    assemblies.delete(command.requestId);
    return rejectedS2(
      command.requestId,
      'MALFORMED_REQUIRED_FIELD',
      'command.data',
      `the assembled stream crosses the declared v0.1.0 S2 bound of ${String(MAX_S2_ASSEMBLY_BYTES)} bytes; fail closed`,
    );
  }
  assembly.chunks.push(command.data);
  assembly.receivedBytes = received;
  return { kind: 'S2_CHUNK_ACK', requestId: command.requestId, seq: command.seq };
}

type S2AssemblyCompletion =
  | { readonly ok: true; readonly payload: Record<string, unknown> }
  | { readonly ok: false; readonly response: BrokerResponse };

function completeS2Assembly(
  assemblies: Map<string, S2Assembly>,
  requestId: string,
): S2AssemblyCompletion {
  const assembly = assemblies.get(requestId);
  assemblies.delete(requestId);
  if (assembly === undefined) {
    return {
      ok: false,
      response: rejectedS2(
        requestId,
        'MALFORMED_REQUIRED_FIELD',
        'command.requestId',
        'no S2 acquisition is in progress for this requestId; fail closed',
      ),
    };
  }
  if (
    assembly.chunks.length === 0 ||
    assembly.receivedBytes === 0 ||
    (assembly.declaredByteCount !== undefined &&
      assembly.receivedBytes !== assembly.declaredByteCount)
  ) {
    return {
      ok: false,
      response: rejectedS2(
        requestId,
        'MALFORMED_REQUIRED_FIELD',
        'command.requestId',
        'the assembled byte stream does not match the declared byte count; fail closed',
      ),
    };
  }
  // Stream integrity: padding may appear only in the final chunk.
  for (let index = 0; index < assembly.chunks.length - 1; index += 1) {
    if (assembly.chunks[index]!.endsWith('=')) {
      return {
        ok: false,
        response: rejectedS2(
          requestId,
          'MALFORMED_REQUIRED_FIELD',
          'command.requestId',
          'base64 padding inside a non-final chunk; the stream is not canonical',
        ),
      };
    }
  }
  const whole = assembly.chunks.join('');
  const bytes: string[] = [];
  for (let index = 0; index < whole.length; index += S2_SEAM_CHUNK_CHARS) {
    bytes.push(whole.slice(index, index + S2_SEAM_CHUNK_CHARS));
  }
  return { ok: true, payload: { ...assembly.command, bytes } };
}

function dispatchCommand(
  command: Exclude<
    BrokerCommand,
    | { readonly kind: 'S2_ACQUIRE' }
    | { readonly kind: 'S2_ACQUIRE_CHUNK' }
    | { readonly kind: 'S2_ACQUIRE_END' }
    | { readonly kind: 'S5_GROUP_PREPARE' }
    | { readonly kind: 'S5_GROUP_CONFIRM' }
    | { readonly kind: 'S5_GROUP_EXECUTE' }
    | { readonly kind: 'S5_GROUP_STATUS' }
    | { readonly kind: 'S6_GROUP_PREPARE' }
    | { readonly kind: 'S6_PAGE_ADMIT' }
    | { readonly kind: 'S6_PAGE_RECORD' }
    | { readonly kind: 'S6_GROUP_CONFIRM' }
    | { readonly kind: 'S6_GROUP_EXECUTE' }
    | { readonly kind: 'S6_GROUP_STATUS' }
  >,
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
