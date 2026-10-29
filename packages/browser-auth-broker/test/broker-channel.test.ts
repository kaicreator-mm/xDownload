/**
 * T010 no-fallback transport policy (TEST_MATRIX suite:
 * allowed-origins-enforcement / negative case
 * `native-messaging-fallback-ipc-attempt`; frozen L2 invariant 14).
 */

import { describe, expect, it } from 'vitest';
import {
  createNativeMessagingChannel,
  establishBrokerSession,
  openBrokerChannel,
} from '../src/index.ts';
import { ALLOWED_EXTENSION_ORIGIN, OTHER_EXTENSION_ORIGIN } from './helpers.ts';

describe('native-messaging-fallback-ipc-attempt', () => {
  it('a NATIVE_MESSAGING channel descriptor is the only accepted kind', () => {
    const opened = openBrokerChannel({
      kind: 'NATIVE_MESSAGING',
      hostName: 'com.xdownload.broker',
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.kind).toBe('NATIVE_MESSAGING');
    }
  });

  const fallbackKinds = [
    'LOCAL_IPC',
    'LOCAL_SOCKET',
    'TCP',
    'WEBSOCKET',
    'HTTP_LOOPBACK',
    'STDIO_FALLBACK',
  ] as const;

  for (const kind of fallbackKinds) {
    it(`channel kind '${kind}' is a typed rejection — no degraded mode exists`, () => {
      const opened = openBrokerChannel({
        kind,
        hostName: 'com.xdownload.broker',
        allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
      });
      expect(opened.ok).toBe(false);
      if (!opened.ok) {
        expect(opened.diagnostics.map((d) => d.code)).toContain(
          'NATIVE_MESSAGING_FALLBACK_FORBIDDEN',
        );
        expect(opened.diagnostics.some((d) => d.invariant === 'L2-inv14')).toBe(true);
      }
    });
  }

  it('forcing a Native Messaging rejection leaves no alternate transport reachable', () => {
    // Establish the channel, then present a disallowed caller: the session
    // fails closed and no other channel factory exists in the package to
    // fall back to (openBrokerChannel is the single entry point).
    const created = createNativeMessagingChannel({
      hostName: 'com.xdownload.broker',
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rejected = establishBrokerSession(created.value, OTHER_EXTENSION_ORIGIN);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.code)).toContain('ALLOWED_ORIGINS_REJECTED');
    }
    // And a "fallback" attempt after the rejection is still rejected, not
    // converted into a degraded session.
    const fallback = openBrokerChannel({
      kind: 'STDIO_FALLBACK',
      hostName: 'com.xdownload.broker',
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    });
    expect(fallback.ok).toBe(false);
  });

  it('session establishment requires the exact allow-listed origin', () => {
    const created = createNativeMessagingChannel({
      hostName: 'com.xdownload.broker',
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
    });
    if (!created.ok) throw new Error('channel creation failed');
    const established = establishBrokerSession(created.value, ALLOWED_EXTENSION_ORIGIN);
    expect(established.ok).toBe(true);
  });
});
