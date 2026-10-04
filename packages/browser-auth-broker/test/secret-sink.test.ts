/**
 * T010 secret-sink containment (TEST_MATRIX suite: secret-sink-containment;
 * PRD §29, counterexample C21). Sentinel-based audits over the tested exit
 * sinks: Core-durable, log, evidence, Recipe and model input.
 */

import { describe, expect, it } from 'vitest';
import {
  auditContainsSecretSentinel,
  guardedSinkWrite,
  projectAuthLimitedResult,
  rejectRawSecretPayload,
} from '../src/index.ts';

const SENTINEL = 'SESSsupersecretcookievalue001';
const JWT_SENTINEL = 'eyJhbGciOi.JFUzI1NiIs.InRlc3Q.signedpart';

describe('raw-secret-field-in-canonical-or-logged-state', () => {
  it('rejects raw-secret fields in broker-boundary payloads (canonical state)', () => {
    const rejected = rejectRawSecretPayload(
      {
        authorizationContextRef: 'authctx/test/1@0',
        cookie: SENTINEL,
      },
      'canonical',
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((d) => d.code)).toContain('RAW_SECRET_FIELD');
      expect(rejected.diagnostics.some((d) => d.invariant === 'PRD-§29')).toBe(true);
    }
  });

  it('rejects nested raw-secret fields, not just top-level ones', () => {
    const rejected = rejectRawSecretPayload(
      { task: { state: { sessionToken: 'abc' } } },
      'canonical',
    );
    expect(rejected.ok).toBe(false);
    const clean = rejectRawSecretPayload(
      { task: { state: { authorizationContextRef: 'authctx/test/1@0' } } },
      'canonical',
    );
    expect(clean.ok).toBe(true);
  });

  const sinks = ['core-durable', 'log', 'evidence', 'recipe', 'model'] as const;

  for (const sink of sinks) {
    it(`sentinel secret material never reaches the ${sink} sink`, () => {
      const raw = {
        sink,
        authorizationContextRef: 'authctx/test/1@0',
        // Secret smuggled under a non-secret-named field:
        notes: `session=${SENTINEL}`,
        // Secret under a secret-named field:
        cookie: SENTINEL,
        nested: { authorization: `Bearer ${JWT_SENTINEL}` },
      };
      // Every sink write goes through the guarded exit.
      const written = guardedSinkWrite(raw, [SENTINEL, JWT_SENTINEL]);
      expect(written.ok).toBe(true);
      if (!written.ok) return;
      expect(auditContainsSecretSentinel(written.value, SENTINEL)).toBe(false);
      expect(auditContainsSecretSentinel(written.value, JWT_SENTINEL)).toBe(false);
      // Canonical opaque ref survives; that is the only auth identity exposed.
      expect(JSON.stringify(written.value)).toContain('authctx/test/1@0');
      expect(JSON.stringify(written.value)).toContain('[REDACTED]');
    });
  }

  it('guardedSinkWrite fails closed instead of writing when the audit backstop fires', () => {
    // Pathological sentinel that matches the redaction marker itself: redaction
    // output would still audit as containing sentinel material, so the guard
    // refuses the sink write — a false pass is impossible.
    const result = guardedSinkWrite({ cookie: SENTINEL }, ['[REDACTED]']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('SECRET_IN_SINK');
    }
  });

  it('guardedSinkWrite scrubs listed sentinels even when embedded in ordinary fields', () => {
    const result = guardedSinkWrite(
      { notes: `session=${SENTINEL}`, authorizationContextRef: 'authctx/test/1@0' },
      [SENTINEL],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).toContain('[REDACTED]');
      expect(serialized).toContain('authctx/test/1@0');
    }
  });

  it('projection output for an auth-limited result carries no raw-secret material', () => {
    const projected = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 3,
      accessibleMemberIds: ['member-001'],
      inaccessibleMemberIds: ['member-002', 'member-003'],
      authStopReason: 'AUTH_REQUIRED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(JSON.stringify(projected.value)).not.toMatch(/cookie|token|password|secret/i);
  });
});
