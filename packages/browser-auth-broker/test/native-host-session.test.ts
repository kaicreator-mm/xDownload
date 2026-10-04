/**
 * T010 native host session — protocol-level end-to-end flow (TEST_MATRIX
 * required suite `real-browser-native-host-tuple` is the Validation-owned
 * real-tuple proof; this suite deliberately stays at the broker-protocol and
 * semantics level and claims NO browser tuple).
 *
 * Recorded environment for this protocol evidence: Node.js 24.21.0 (fnm),
 * Windows host — the native-host runtime choice; no Chromium execution and
 * no Windows/macOS registration claim is made or testable here.
 */

import { describe, expect, it } from 'vitest';
import { establishNativeHostSession, encodeFrame } from '../src/index.ts';
import type { AuthBroker } from '../src/index.ts';
import {
  ALLOWED_EXTENSION_ORIGIN,
  BASE_BINDING,
  ISSUE_DECISION,
  OTHER_EXTENSION_ORIGIN,
  brokerWith,
  fixedClock,
} from './helpers.ts';

function sessionWith(allowed: readonly string[] = [ALLOWED_EXTENSION_ORIGIN]) {
  const clock = fixedClock();
  const broker: AuthBroker = brokerWith(clock);
  const session = establishNativeHostSession({
    argv: ['chrome', ALLOWED_EXTENSION_ORIGIN, '--parent-window=0'],
    allowedOrigins: allowed,
    broker,
    maxInboundFrameBytes: 1024,
  });
  return { clock, broker, session };
}

describe('session establishment', () => {
  it('establishes for an allow-listed caller origin', () => {
    const { session } = sessionWith();
    expect(session.ok).toBe(true);
    if (session.ok) {
      expect(session.value.callerOrigin).toBe(ALLOWED_EXTENSION_ORIGIN);
    }
  });

  it('fails closed for a non-allow-listed caller origin', () => {
    const { session } = sessionWith([OTHER_EXTENSION_ORIGIN]);
    expect(session.ok).toBe(false);
    if (!session.ok) {
      expect(session.diagnostics.map((d) => d.code)).toContain('ALLOWED_ORIGINS_REJECTED');
    }
  });

  it('fails closed with no caller origin argument at all', () => {
    const clock = fixedClock();
    const session = establishNativeHostSession({
      argv: ['node', 'host.js'],
      allowedOrigins: [ALLOWED_EXTENSION_ORIGIN],
      broker: brokerWith(clock),
    });
    expect(session.ok).toBe(false);
    if (!session.ok) {
      expect(session.diagnostics.map((d) => d.code)).toContain('CALLER_ORIGIN_MISSING');
    }
  });
});

describe('protocol flow: gate -> broker -> truthful responses', () => {
  it('end-to-end: issue with decision, use with exact tuple, expiry truth, revoke truth', () => {
    const { clock, session } = sessionWith();
    if (!session.ok) throw new Error('session not established');
    const host = session.value;

    const issued = host.handleMessage({
      kind: 'AUTH_ISSUE',
      requestId: 'r1',
      binding: BASE_BINDING,
      ttlMs: 1000,
      issueDecisionToken: ISSUE_DECISION,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok || issued.value.kind !== 'ISSUED') throw new Error('issue must succeed');
    const ref = issued.value.ref;

    const used = host.handleMessage({
      kind: 'AUTH_USE',
      requestId: 'r2',
      ref,
      binding: BASE_BINDING,
    });
    expect(used.ok).toBe(true);
    if (!used.ok || used.value.kind !== 'USE_GRANTED')
      throw new Error('exact-tuple use must grant');

    clock.advanceMs(1001);
    const expired = host.handleMessage({
      kind: 'AUTH_USE',
      requestId: 'r3',
      ref,
      binding: BASE_BINDING,
    });
    if (!expired.ok || expired.value.kind !== 'USE_DENIED')
      throw new Error('expired use must be denied');
    expect(expired.value.outcome).toBe('AUTH_REQUIRED');
    expect(expired.value.reasons.map((d) => d.code)).toContain('CAPABILITY_EXPIRED');

    const revoked = host.handleMessage({ kind: 'AUTH_REVOKE', requestId: 'r4', ref });
    if (!revoked.ok || revoked.value.kind !== 'REVOKED') throw new Error('revoke must succeed');

    const afterRevoke = host.handleMessage({
      kind: 'AUTH_USE',
      requestId: 'r5',
      ref,
      binding: BASE_BINDING,
    });
    if (!afterRevoke.ok || afterRevoke.value.kind !== 'USE_DENIED') {
      throw new Error('revoked use must be denied');
    }
    expect(afterRevoke.value.outcome).toBe('AUTH_FAILED');
  });

  it('frame-level flow: oversized host-bound frames are rejected before dispatch', () => {
    const { session } = sessionWith();
    if (!session.ok) throw new Error('session not established');
    const big = encodeFrame({ blob: 'x'.repeat(2048) }, 1024);
    expect(big.ok).toBe(false); // encode side refuses
    const frame = new Uint8Array(4);
    new DataView(frame.buffer).setUint32(0, 4096, true); // declares 4 KiB > 1 KiB bound
    const decoded = session.value.handleFrame(frame);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.diagnostics.map((d) => d.code)).toContain('NATIVE_MESSAGE_OVERSIZED');
    }
  });

  it('unknown authoritative fields in broker commands fail closed', () => {
    const { session } = sessionWith();
    if (!session.ok) throw new Error('session not established');
    const response = session.value.handleMessage({
      kind: 'AUTH_USE',
      requestId: 'r6',
      ref: 'authctx/test/x@0',
      binding: BASE_BINDING,
      smuggledPrivilege: 'grant-all',
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.diagnostics.map((d) => d.code)).toContain('UNKNOWN_FIELD');
    }
  });

  it('binding misuse through the host protocol denies with typed reasons', () => {
    const { session } = sessionWith();
    if (!session.ok) throw new Error('session not established');
    const host = session.value;
    const issued = host.handleMessage({
      kind: 'AUTH_ISSUE',
      requestId: 'r7',
      binding: BASE_BINDING,
      ttlMs: 60_000,
      issueDecisionToken: ISSUE_DECISION,
    });
    if (!issued.ok || issued.value.kind !== 'ISSUED') throw new Error('issue must succeed');
    const wrongOrigin = host.handleMessage({
      kind: 'AUTH_USE',
      requestId: 'r8',
      ref: issued.value.ref,
      binding: { ...BASE_BINDING, origin: 'https://unrelated.example.org' },
    });
    if (!wrongOrigin.ok || wrongOrigin.value.kind !== 'USE_DENIED') {
      throw new Error('wrong-origin use must be denied');
    }
    expect(wrongOrigin.value.outcome).toBe('AUTH_FAILED');
    expect(wrongOrigin.value.reasons.map((d) => d.code)).toContain('AUTH_BINDING_VIOLATED');
  });
});
