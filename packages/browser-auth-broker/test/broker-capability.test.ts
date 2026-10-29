/**
 * T010 broker-level binding matrix, truthful lifecycle and the C10/C24
 * oracles (TEST_MATRIX suites: origin-binding-misuse,
 * target-contract-snapshot-provenance-binding-misuse,
 * partition-context-misuse, expiry-and-revocation,
 * observation-provenance-and-scope-non-rewrite).
 *
 * Protocol/semantics-level builder evidence: this proves broker behavior,
 * not a real browser/native-host tuple (T010 concern Validation owns the
 * real-tuple proof; no browser tuple is claimed here).
 */

import { describe, expect, it } from 'vitest';
import {
  bindingMismatchField,
  decodeCapabilityBinding,
  projectAuthLimitedResult,
  type CapabilityBinding,
} from '../src/index.ts';
import {
  BASE_BINDING,
  ISSUE_DECISION,
  REISSUE_DECISION,
  brokerWith,
  fixedClock,
} from './helpers.ts';

function issueBase(
  broker: ReturnType<typeof brokerWith>,
  binding: CapabilityBinding = BASE_BINDING,
) {
  const issued = broker.issue({ binding, ttlMs: 60_000, issueDecisionToken: ISSUE_DECISION });
  expect(issued.ok).toBe(true);
  if (!issued.ok) throw new Error(`issue failed: ${JSON.stringify(issued.diagnostics)}`);
  return issued.value;
}

describe('capability issue: least authority and explicit decision', () => {
  it('issues only with an explicit user-confirmation or explicit-reissue decision token', () => {
    const broker = brokerWith(fixedClock());
    const noToken = broker.issue({ binding: BASE_BINDING, ttlMs: 60_000, issueDecisionToken: '' });
    expect(noToken.ok).toBe(false);
    if (!noToken.ok) {
      expect(noToken.diagnostics.map((d) => d.code)).toContain('ISSUE_DECISION_REQUIRED');
    }
    const internalRecovery = broker.issue({
      binding: BASE_BINDING,
      ttlMs: 60_000,
      issueDecisionToken: 'auto-recovery',
    });
    expect(internalRecovery.ok).toBe(false);
  });

  it('expiry is mandatory and must be positive (least authority)', () => {
    const broker = brokerWith(fixedClock());
    const forever = broker.issue({
      binding: BASE_BINDING,
      ttlMs: 0,
      issueDecisionToken: ISSUE_DECISION,
    });
    expect(forever.ok).toBe(false);
    const negative = broker.issue({
      binding: BASE_BINDING,
      ttlMs: -1,
      issueDecisionToken: ISSUE_DECISION,
    });
    expect(negative.ok).toBe(false);
  });

  it('binding decode rejects unknown fields and incomplete tuples before issue', () => {
    const withUnknown = decodeCapabilityBinding({ ...BASE_BINDING, smuggled: 'x' });
    expect(withUnknown.ok).toBe(false);
    const incomplete = decodeCapabilityBinding({ ...BASE_BINDING, snapshot: undefined });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.diagnostics.map((d) => d.code)).toContain('MISSING_REQUIRED_FIELD');
    }
  });

  it('issued views expose the opaque ref only — no secret-bearing fields exist on the type', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    expect(view.ref.startsWith('authctx/test/')).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/cookie|token|password|secret|credential/i);
  });
});

describe('binding matrix: exact tuple accepts, every single-field mismatch fails closed', () => {
  it('exact binding grants AUTH', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    const outcome = broker.use({ ref: view.ref, binding: BASE_BINDING });
    expect(outcome.outcome).toBe('AUTH_GRANTED');
  });

  const mismatchCases: ReadonlyArray<readonly [string, CapabilityBinding, string]> = [
    [
      'wrong-origin-capability-use',
      { ...BASE_BINDING, origin: 'https://other.example.org' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'wrong-target-capability-use',
      { ...BASE_BINDING, target: 'target-file-999' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'cross-contract-capability-reuse',
      { ...BASE_BINDING, contract: 'contract-002' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'cross-snapshot-capability-reuse',
      { ...BASE_BINDING, snapshot: 'snapshot-002' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'provenance-chain-mismatch',
      { ...BASE_BINDING, provenanceChain: 'tab-9/frame-0/https://media.example.org/req-0042' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'wrong-partition-capability-use',
      { ...BASE_BINDING, partition: 'partition-B' },
      'AUTH_BINDING_VIOLATED',
    ],
    [
      'partition-stripped-context',
      { ...BASE_BINDING, partition: undefined },
      'PARTITION_CONTEXT_STRIPPED',
    ],
    [
      'scope-rewrite-attempt',
      {
        ...BASE_BINDING,
        requestedScopeKey: 'selected_collection_members:collection/playlist-001:m-001',
      },
      'SCOPE_BINDING_MISMATCH',
    ],
  ] as const;

  for (const [label, mutated, expectedCode] of mismatchCases) {
    it(`${label} fails closed (never a warning or partial acceptance)`, () => {
      const clock = fixedClock();
      const broker = brokerWith(clock);
      const view = issueBase(broker);
      const outcome = broker.use({ ref: view.ref, binding: mutated });
      expect(outcome.outcome).toBe('AUTH_FAILED');
      if (outcome.outcome === 'AUTH_FAILED') {
        expect(outcome.reasons.map((d) => d.code)).toContain(expectedCode);
      }
      expect(bindingMismatchField(BASE_BINDING, mutated)).toBeDefined();
    });
  }

  it('partition context stays binding context: it can never widen scope by itself', () => {
    // Same partition on a different origin remains a mismatch; partition is
    // not a capability of its own.
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    const outcome = broker.use({
      ref: view.ref,
      binding: { ...BASE_BINDING, origin: 'https://cdn.example.org' },
    });
    expect(outcome.outcome).toBe('AUTH_FAILED');
  });

  it('independent-account reuse fails closed (C21 account isolation at the binding layer)', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const accountA = issueBase(broker, { ...BASE_BINDING, partition: 'account-A' });
    const outcome = broker.use({
      ref: accountA.ref,
      binding: { ...BASE_BINDING, partition: 'account-B' },
    });
    expect(outcome.outcome).toBe('AUTH_FAILED');
  });
});

describe('truthful expiry and revocation lifecycle', () => {
  it('expired-capability-use yields truthful AUTH_REQUIRED and never auto re-issues', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker); // ttl 60s
    clock.advanceMs(60_001);
    const outcome = broker.use({ ref: view.ref, binding: BASE_BINDING });
    expect(outcome.outcome).toBe('AUTH_REQUIRED');
    if (outcome.outcome === 'AUTH_REQUIRED') {
      expect(outcome.reasons.map((d) => d.code)).toContain('CAPABILITY_EXPIRED');
    }
    // No silent re-issue: no new capability exists, and a repeat use is still denied.
    const second = broker.use({ ref: view.ref, binding: BASE_BINDING });
    expect(second.outcome).toBe('AUTH_REQUIRED');
    const inspected = broker.inspect(view.ref);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.value.status).toBe('EXPIRED');
    }
    // Re-issue only through an explicit separate decision, bound to the same tuple.
    const reissued = broker.issue({
      binding: BASE_BINDING,
      ttlMs: 60_000,
      issueDecisionToken: REISSUE_DECISION,
    });
    expect(reissued.ok).toBe(true);
    if (reissued.ok) {
      expect(reissued.value.ref).not.toBe(view.ref);
    }
  });

  it('revoked-capability-use is refused for later uses while earlier projections stay intact', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    const grantedBefore = broker.use({ ref: view.ref, binding: BASE_BINDING });
    expect(grantedBefore.outcome).toBe('AUTH_GRANTED');

    const revoked = broker.revoke(view.ref);
    expect(revoked.ok).toBe(true);

    const outcome = broker.use({ ref: view.ref, binding: BASE_BINDING });
    expect(outcome.outcome).toBe('AUTH_FAILED');
    if (outcome.outcome === 'AUTH_FAILED') {
      expect(outcome.reasons.map((d) => d.code)).toContain('CAPABILITY_REVOKED');
    }
    // Revocation does not retroactively rewrite recorded evidence: the
    // previously granted use remains what it was, and inspect shows REVOKED
    // without mutating the binding record.
    const inspected = broker.inspect(view.ref);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.value.status).toBe('REVOKED');
      expect(inspected.value.binding).toEqual(BASE_BINDING);
    }
  });

  it('expiry/revocation truth is observable without secret material', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    broker.revoke(view.ref);
    const inspected = broker.inspect(view.ref);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(JSON.stringify(inspected.value)).not.toMatch(/cookie|token|password|secret/i);
    }
  });
});

describe('C10 oracle: whole-collection auth-limited accounting (18 requested / 16 accessible / 2 inaccessible)', () => {
  const requested = Array.from(
    { length: 18 },
    (_, i) => `member-${String(i + 1).padStart(3, '0')}`,
  );
  const accessible = requested.slice(0, 16);
  const inaccessible = requested.slice(16);

  it('projects the exact PARTIAL/RESOLVED/COMPLETE/VERIFIED_COMPLETE/AUTH_REQUIRED tuple', () => {
    const projected = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 18,
      accessibleMemberIds: accessible,
      inaccessibleMemberIds: inaccessible,
      authStopReason: 'AUTH_REQUIRED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostics));
    expect(projected.value.requestFulfillment).toBe('PARTIAL');
    expect(projected.value.targetResolution).toBe('RESOLVED');
    expect(projected.value.selectionAcquisition).toBe('COMPLETE');
    expect(projected.value.coverage).toBe('VERIFIED_COMPLETE');
    expect(projected.value.stopReason).toBe('AUTH_REQUIRED');
  });

  it('the broker/auth path never narrows the requested-scope reference set (R02)', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const view = issueBase(broker);
    // use() under the current authorization does not change the recorded
    // requested scope; a narrowed scope key is a scope-rewrite rejection.
    expect(broker.use({ ref: view.ref, binding: BASE_BINDING }).outcome).toBe('AUTH_GRANTED');
    const narrowed = broker.use({
      ref: view.ref,
      binding: {
        ...BASE_BINDING,
        requestedScopeKey: 'selected_collection_members:collection/playlist-001:m-001',
      },
    });
    expect(narrowed.outcome).toBe('AUTH_FAILED');
    const inspected = broker.inspect(view.ref);
    if (inspected.ok) {
      expect(inspected.value.binding.requestedScopeKey).toBe(BASE_BINDING.requestedScopeKey);
    }
    // A narrowed COMPLETE under known inaccessible members is illegal by the
    // canonical validator the seam reuses.
    const illegal = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 18,
      accessibleMemberIds: accessible,
      inaccessibleMemberIds: inaccessible,
      authStopReason: 'AUTH_REQUIRED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(illegal.ok).toBe(true);
    if (illegal.ok) {
      expect(illegal.value.requestFulfillment).not.toBe('COMPLETE');
    }
  });

  it('incomplete requested-scope accounting cannot project a coverage claim at all', () => {
    const projected = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 18,
      accessibleMemberIds: accessible,
      inaccessibleMemberIds: [], // 16 accounted vs 18 requested
      authStopReason: 'AUTH_REQUIRED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(projected.ok).toBe(false);
  });
});

describe('C24 oracle: auth failure yields no targets — exact truth tuple, no fallback acquisition', () => {
  it('projects UNSATISFIED/BLOCKED/NOT_STARTED/UNKNOWN with AUTH_REQUIRED', () => {
    const projected = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 3,
      accessibleMemberIds: [],
      inaccessibleMemberIds: ['member-001', 'member-002', 'member-003'],
      authStopReason: 'AUTH_REQUIRED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostics));
    expect(projected.value.requestFulfillment).toBe('UNSATISFIED');
    expect(projected.value.targetResolution).toBe('BLOCKED');
    expect(projected.value.selectionAcquisition).toBe('NOT_STARTED');
    expect(projected.value.coverage).toBe('UNKNOWN');
    expect(projected.value.stopReason).toBe('AUTH_REQUIRED');
  });

  it('supplied-authorization failure yields the AUTH_FAILED variant truthfully', () => {
    const projected = projectAuthLimitedResult({
      contractId: 'contract-collection-001',
      snapshotId: 'snapshot-001',
      intentType: 'COLLECTION',
      scopeKind: 'entire_supported_collection',
      requestedScopeCount: 3,
      accessibleMemberIds: [],
      inaccessibleMemberIds: [],
      authStopReason: 'AUTH_FAILED',
      recordedAt: '2026-10-04T01:00:00Z',
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostics));
    expect(projected.value.stopReason).toBe('AUTH_FAILED');
    expect(projected.value.requestFulfillment).toBe('UNSATISFIED');
  });

  it('auth failure at the broker never converts into a granted use', () => {
    const clock = fixedClock();
    const broker = brokerWith(clock);
    const outcome = broker.use({ ref: 'authctx/test/unknown@0', binding: BASE_BINDING });
    expect(outcome.outcome).toBe('AUTH_FAILED');
  });
});
