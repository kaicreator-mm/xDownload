/**
 * T010 broker channel policy: Native Messaging is the ONLY transport.
 *
 * If Native Messaging is rejected/unavailable the task path fails closed.
 * There is deliberately no alternate IPC branch in this module — any attempt
 * to describe a fallback channel (local socket, TCP, WebSocket, HTTP loopback,
 * anything that is not Native Messaging) is a typed rejection, never a
 * degraded mode (frozen L2 invariant 14, FAILURE_MATRIX
 * `allowed-origins-bypass`).
 */

import { brokerDiagnostic, brokerFail, brokerOk, type BrokerResult } from './result.ts';
import { assertOriginAllowed, type AllowedOrigins } from './allowedOrigins.ts';

/**
 * The one sanctioned channel descriptor. `hostName` is the Native Messaging
 * host name registered in the browser's native messaging host manifest for
 * the tested tuple.
 */
export interface NativeMessagingChannel {
  readonly kind: 'NATIVE_MESSAGING';
  readonly hostName: string;
  /** The exact extension origins the channel may be reached from. */
  readonly allowedOrigins: AllowedOrigins;
}

/** Any descriptor kind other than NATIVE_MESSAGING is a fallback attempt. */
export type ForbiddenChannelKind =
  | 'LOCAL_IPC'
  | 'LOCAL_SOCKET'
  | 'TCP'
  | 'WEBSOCKET'
  | 'HTTP_LOOPBACK'
  | 'STDIO_FALLBACK'
  | (string & {});

export function createNativeMessagingChannel(descriptor: {
  hostName: string;
  allowedOrigins: AllowedOrigins;
}): BrokerResult<NativeMessagingChannel> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(descriptor.hostName)) {
    return brokerFail([
      brokerDiagnostic('NATIVE_MESSAGE_MALFORMED', 'channel.hostName', 'host name is malformed'),
    ]);
  }
  const channel: NativeMessagingChannel = {
    kind: 'NATIVE_MESSAGING',
    hostName: descriptor.hostName,
    allowedOrigins: descriptor.allowedOrigins,
  };
  return brokerOk(Object.freeze(channel));
}

/**
 * An untrusted channel descriptor: any kind label, with unchecked extra
 * fields — exactly what a hostile/fallback attempt looks like before the
 * policy decides.
 */
export interface UntrustedChannelDescriptor {
  readonly kind: ForbiddenChannelKind;
  readonly hostName?: unknown;
  readonly allowedOrigins?: unknown;
}

/**
 * Open a broker channel from an untrusted descriptor. Only a
 * NATIVE_MESSAGING descriptor can ever succeed; every other kind is rejected
 * as a forbidden fallback with no degraded mode.
 */
export function openBrokerChannel(
  descriptor: UntrustedChannelDescriptor,
): BrokerResult<NativeMessagingChannel> {
  if (descriptor.kind !== 'NATIVE_MESSAGING') {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGING_FALLBACK_FORBIDDEN',
        'channel.kind',
        `channel kind '${String(descriptor.kind)}' is a fallback transport around Native Messaging; no such path exists by design`,
        'L2-inv14',
      ),
    ]);
  }
  if (typeof descriptor.hostName !== 'string' || !Array.isArray(descriptor.allowedOrigins)) {
    return brokerFail([
      brokerDiagnostic(
        'NATIVE_MESSAGE_MALFORMED',
        'channel',
        'NATIVE_MESSAGING channel requires hostName and allowedOrigins',
      ),
    ]);
  }
  return createNativeMessagingChannel({
    hostName: descriptor.hostName,
    allowedOrigins: descriptor.allowedOrigins as AllowedOrigins,
  });
}

/**
 * Session establishment at the broker edge: the connecting origin must be
 * exactly allow-listed. This is the broker's own second lock; it never
 * replaces the platform `allowed_origins` enforcement and there is no code
 * path that reaches the broker except through an allow-listed Native
 * Messaging session.
 */
export function establishBrokerSession(
  channel: NativeMessagingChannel,
  callerOrigin: string,
): BrokerResult<'ESTABLISHED'> {
  const allowed = assertOriginAllowed(callerOrigin, channel.allowedOrigins);
  if (!allowed.ok) {
    return allowed;
  }
  return brokerOk('ESTABLISHED' as const);
}
