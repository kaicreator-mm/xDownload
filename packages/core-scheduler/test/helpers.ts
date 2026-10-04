/**
 * T006 concern-test fixtures. Deterministic, local, in-memory only: no
 * browser, network, filesystem/SQLite or media behavior is exercised.
 */
import { expect } from 'vitest';
import {
  CoreScheduler,
  InMemoryControlFactLog,
  controlUnwrap,
  type ControlRejection,
  type ControlRejectionCode,
  type ControlResult,
  type LineageKey,
  type LineageSubmitInput,
} from '../src/index.ts';

export const CONTRACT = 'contract-collection-001';
export const SNAPSHOT = 'snapshot-001';
export const TARGET = 'target-file-001';
export const AUTH_REF = 'authctx/local-001';

/**
 * Small deterministic budget profile. Limits are deliberately tight so the
 * exhaustion precedence matrix is reachable in a few actions:
 * - discovery: 3 generated requests, 2 navigations, 5 model calls;
 * - transfer: 1000 bytes, 5 segments, 60s active transfer, 2 retry requests;
 * - global safety: 4 total generated requests, 1 model cost unit, 120s active.
 */
export const PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 3,
    maxNavigationActions: 2,
    maxModelCalls: 5,
  },
  transfer: {
    domain: 'transfer',
    maxBytes: 1000,
    maxSegments: 5,
    maxActiveTransferMs: 60_000,
    maxRetryTransferRequests: 2,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 4,
    maxModelCostUnits: 1,
    maxActiveElapsedMs: 120_000,
  },
} as const;

/** A profile variant with no discovery limits (used for transfer-focused suites). */
export const PROFILE_UNLIMITED_DISCOVERY = {
  discovery: { domain: 'discovery' },
  transfer: PROFILE.transfer,
  globalSafety: PROFILE.globalSafety,
} as const;

export interface Harness {
  readonly log: InMemoryControlFactLog;
  readonly scheduler: CoreScheduler;
}

export function setup(): Harness {
  const log = InMemoryControlFactLog.empty();
  return { log, scheduler: new CoreScheduler(log) };
}

export function submitInput(overrides: Partial<LineageSubmitInput> = {}): LineageSubmitInput {
  return {
    contractId: CONTRACT,
    snapshotId: SNAPSHOT,
    targetId: TARGET,
    authorizationContextRef: AUTH_REF,
    frozenMemberIds: ['member-001', 'member-002'],
    budgetProfile: PROFILE,
    ...overrides,
  };
}

/** Submit the default lineage and return its key. */
export function submitDefault(harness: Harness): LineageKey {
  const submission = expectOk(harness.scheduler.submitLineage(submitInput()));
  return submission.lineageKey;
}

/**
 * Default frozen lineage with one durably succeeded attempt ("bytes are
 * there") — the fixture for acceptance/cutoff cells.
 */
export function succeededLineage(harness: Harness): LineageKey {
  const key = submitDefault(harness);
  expectOk(harness.scheduler.startEffectAttempt(key, 'attempt-1'));
  expectOk(
    harness.scheduler.recordEffectOutcome(key, { attemptId: 'attempt-1', outcome: 'SUCCEEDED' }),
  );
  return key;
}

/** Unwrap a control result or fail the test with its rejection. */
export function expectOk<T>(result: ControlResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected control ok, got ${result.rejection.code}: ${result.rejection.message}` +
        (result.rejection.detail === undefined ? '' : ` [${result.rejection.detail}]`),
    );
  }
  return controlUnwrap(result);
}

/** Assert a typed rejection (optionally its budget-truthful stop reason). */
export function expectRejection<T>(
  result: ControlResult<T>,
  code: ControlRejectionCode,
  stopReason?: string,
): ControlRejection {
  if (result.ok) {
    throw new Error(`expected control rejection ${code}, but the operation succeeded`);
  }
  expect(result.rejection.code).toBe(code);
  if (stopReason !== undefined) {
    expect(result.rejection.stopReason).toBe(stopReason);
  }
  return result.rejection;
}

/**
 * Simulate process death: serialize committed facts, drop everything
 * in-memory, decode and reopen a fresh scheduler over the rebuilt log.
 */
export function restart(harness: Harness): Harness {
  const json = JSON.stringify(harness.log.readAll());
  const reopened = expectOk(CoreScheduler.reopenFromJson(json));
  const log = reopened.log() as InMemoryControlFactLog;
  return { log, scheduler: reopened };
}

/**
 * A second independent scheduler instance over the SAME durable log — the
 * duplicate concurrent client (Desktop UI + CLI + restart all resolve through
 * one Core-owned durable total order).
 */
export function duplicateClient(harness: Harness): CoreScheduler {
  return new CoreScheduler(harness.log);
}
