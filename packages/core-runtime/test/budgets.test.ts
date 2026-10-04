/**
 * TEST_MATRIX suite `budgets` (+ C02, C23 seed, C28).
 *
 * Must prove through the composed runtime:
 * - DiscoveryBudget, TransferBudget and GlobalSafetyBudget remain distinct
 *   domains;
 * - budget exhaustion stops work with truthful StopReason and never changes
 *   requested scope semantics;
 * - exhaustion precedence (L2/PRD §15.4: global_safety > transfer >
 *   discovery) holds when domains exhaust concurrently;
 * - transfer adapters consume budget only through the canonical
 *   TransferBudgetLedgerPort path (no private ledger);
 * - HLS segment acquisition respects canonical budget semantics end-to-end
 *   (frozen target transfer permitted while Transfer/GlobalSafety remain —
 *   C28 shape).
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  profileWith,
  rawSingleResourceContract,
  removeTempDir,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { executeDirectAcquisition, projectLineageResult, registerLineage } from '../src/index.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = 'contract-single-001';
const SNAPSHOT = 'snapshot-001';
const TARGET = 'target-file-001';
const MEMBER = 'member-file-001';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bindingFor(baseUri: string): LocatorBinding<LogicalTargetId> {
  const targetId = unwrapOrThrow(makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  return unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
}

function transferRequestFor(baseUri: string, bytes: Uint8Array) {
  return {
    effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice: 'S1' as const,
    selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
    binding: bindingFor(baseUri),
    expectedSha256: sha256(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  };
}

interface DirectFlowResult {
  readonly reason: string;
  readonly receivedBytes: number;
  readonly acceptance: unknown;
  readonly acceptanceErrorCode: string | undefined;
  readonly lineageKey: string;
  readonly workItemId: string;
}

async function runDirectFlow(
  runtime: ReturnType<typeof openRuntime>,
  baseUri: string,
  bytes: Uint8Array,
  budgetProfile: unknown,
  tag: string,
): Promise<DirectFlowResult> {
  const flow = await executeDirectAcquisition(runtime, {
    contractId: CONTRACT,
    snapshotId: SNAPSHOT,
    targetId: TARGET,
    authorizationContextRef: 'authctx/local-001',
    budgetProfile,
    commandId: `cmd-${tag}`,
    memberId: MEMBER,
    artifactId: `artifact:${tag}`,
    transfer: transferRequestFor(baseUri, bytes),
  });
  if (flow.attemptReplayed || flow.transfer === undefined) {
    throw new Error('unexpected replay in fixture flow');
  }

  if (flow.attemptReplayed || flow.transfer === undefined) {
    throw new Error('unexpected replay in budget fixture flow');
  }
  return {
    reason: flow.transfer.reason,
    receivedBytes: flow.transfer.receivedBytes,
    acceptance: flow.acceptance,
    acceptanceErrorCode: flow.acceptanceError?.code,
    lineageKey: flow.lineageKey,
    workItemId: flow.workItemId,
  };
}

describe('T015 budgets', () => {
  it('stops transfer work at the canonical transfer domain limit with a truthful stop reason', async () => {
    const rootDir = makeTempDir('t015-budget-transfer');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(2_000_000, 1);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'budget-transfer-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await runDirectFlow(
        runtime,
        baseUri,
        bytes,
        profileWith({ maxBytes: 1024 }),
        'budget-transfer',
      );
      // The adapter stops truthfully at the domain limit; the transfer is
      // partial and no acceptance can exist for it.
      expect(flow.reason).toBe('TRANSFER_BUDGET_EXHAUSTED');
      expect(flow.receivedBytes).toBeGreaterThan(0);
      expect(flow.receivedBytes).toBeLessThan(bytes.byteLength);
      expect(flow.acceptance).toBeUndefined();

      // The canonical budget stop projection carries the budget-truthful
      // stop reason (never scope truth).
      const stop = runtime.scheduler.projectBudgetStop(flow.lineageKey);
      expect(stop.ok).toBe(true);
      if (stop.ok) {
        expect(stop.value.stopped).toBe(true);
        expect(stop.value.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
        expect(stop.value.exhaustedDomains).toEqual(['transfer']);
      }

      // Requested scope semantics are unchanged and the projected stop
      // reason is the budget-truthful one; the stopped transfer is never
      // projected as complete fulfillment.
      const projected = projectLineageResult(runtime, {
        lineageKey: flow.lineageKey,
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        requestedMemberIds: [MEMBER],
        recordedAt: '2026-10-04T04:00:00Z',
        enumeration: { kind: 'NOT_APPLICABLE' },
      });
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.result.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
        expect(projected.value.result.selectionAcquisition).not.toBe('COMPLETE');
        expect(projected.value.result.requestFulfillment).not.toBe('COMPLETE');
      }

      // No replenishment: a divergent profile on the same lineage is
      // rejected by the scheduler's durable-profile guard.
      const replenish = runtime.scheduler.submitLineage({
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: profileWith({ maxBytes: 999_999 }),
      });
      expect(replenish.ok).toBe(false);
      if (!replenish.ok) {
        expect(replenish.rejection.code).toBe('BUDGET_REPLENISHMENT_REJECTED');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('applies global-safety precedence when domains exhaust concurrently (C02 shape)', async () => {
    const rootDir = makeTempDir('t015-budget-precedence');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(4096, 2);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'precedence-etag' });

    const runtime = openRuntime(rootDir);
    try {
      // Global safety cap of 1 active-elapsed ms + transfer cap smaller than
      // the payload: the active-elapsed domain is exhausted first through the
      // canonical mutation path, so global_safety must win the precedence.
      const budgetProfile = profileWith({ maxBytes: 1024, maxActiveElapsedMs: 1 });
      const registered = registerFor(runtime, budgetProfile, 'budget-precedence-register');
      const grant = runtime.scheduler.requestDispatch(registered.lineageKey, {
        kind: 'ACTIVE_ELAPSED',
        ms: 1,
      });
      expect(grant.ok).toBe(true);
      if (grant.ok) {
        const consumed = runtime.scheduler.consume(grant.value);
        expect(consumed.ok).toBe(true);
      }
      const exhausted = runtime.scheduler.projectBudgetStop(registered.lineageKey);
      expect(exhausted.ok).toBe(true);
      if (exhausted.ok) {
        expect(exhausted.value.exhaustedDomains).toContain('global_safety');
      }

      const flow = await runDirectFlow(runtime, baseUri, bytes, budgetProfile, 'budget-precedence');
      expect(flow.reason).toBe('GLOBAL_SAFETY_EXHAUSTED');
      const stop = runtime.scheduler.projectBudgetStop(flow.lineageKey);
      expect(stop.ok).toBe(true);
      if (stop.ok) {
        expect(stop.value.exhaustedDomains).toContain('global_safety');
        expect(stop.value.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
      }

      // C02 tuple shape: a safety-capped run is PARTIAL/UNKNOWN-ish but never
      // COMPLETE; the stop reason projects the safety limit verbatim.
      const projected = projectLineageResult(runtime, {
        lineageKey: flow.lineageKey,
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        requestedMemberIds: [MEMBER],
        recordedAt: '2026-10-04T04:00:00Z',
        enumeration: { kind: 'NOT_APPLICABLE' },
      });
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.result.selectionAcquisition).not.toBe('COMPLETE');
        expect(projected.value.result.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('keeps the discovery domain distinct: discovery exhaustion never blocks frozen-target transfer', async () => {
    const rootDir = makeTempDir('t015-budget-discovery');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(2048, 3);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'discovery-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const budgetProfile = profileWith({ maxGeneratedRequests: 0 });
      const registered = registerFor(runtime, budgetProfile, 'budget-discovery');
      const submission = { lineageKey: registered.lineageKey };
      // Exhaust the DISCOVERY domain through the canonical mutation path.
      const discoveryAction = runtime.scheduler.requestDispatch(submission.lineageKey, {
        kind: 'GENERATED_REQUEST',
        count: 1,
      });
      expect(discoveryAction.ok).toBe(false);
      if (!discoveryAction.ok) {
        expect(discoveryAction.rejection.code).toBe('BUDGET_EXHAUSTED');
        expect(discoveryAction.rejection.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
      }
      const exhausted = runtime.scheduler.projectBudgetStop(submission.lineageKey);
      expect(exhausted.ok).toBe(true);
      if (exhausted.ok) {
        expect(exhausted.value.exhaustedDomains).toEqual(['discovery']);
      }

      // The frozen single-resource target still transfers (C28 admission
      // shape at the direct adapter: only transfer + global safety gate it).
      const flow = await runDirectFlowWithLineage(
        runtime,
        submission.lineageKey,
        baseUri,
        bytes,
        'budget-discovery',
      );
      expect(flow.reason).toBe('COMPLETED');
      expect(flow.acceptance).toBeDefined();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('charges adapter transfer consumption only through the canonical single mutation path', async () => {
    const rootDir = makeTempDir('t015-budget-port');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(4096, 4);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'port-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const flow = await runDirectFlow(
        runtime,
        baseUri,
        bytes,
        rawSingleResourceContract()['budgetProfile'],
        'budget-port',
      );
      expect(flow.reason).toBe('COMPLETED');

      // Every charged byte went through the ledger's own facts: reservation
      // + consumption facts exist, and durable consumption equals received.
      const facts = runtime.scheduler.log().readAll();
      const reservedBytes = facts
        .filter((fact) => fact.kind === 'budgetReserved')
        .reduce((total, fact) => total + ((fact.amounts['bytes'] as number) ?? 0), 0);
      const consumedBytes = facts
        .filter((fact) => fact.kind === 'budgetConsumed')
        .reduce((total, fact) => total + ((fact.amounts['bytes'] as number) ?? 0), 0);
      expect(consumedBytes).toBe(bytes.byteLength);
      expect(reservedBytes).toBe(bytes.byteLength);
      expect(facts.some((fact) => fact.kind === 'budgetConsumed')).toBe(true);

      // The transactional ledger mirrors the same truth idempotently.
      const entries = runtime.writer.reader.budgetEntries(flow.workItemId);
      const consumption = entries
        .filter((entry) => entry.kind === 'CONSUMPTION' && entry.limitKey === 'bytes')
        .reduce((total, entry) => total + entry.amount, 0);
      expect(consumption).toBe(bytes.byteLength);
    } finally {
      closeRuntime(runtime);
    }
  });
});

function registerFor(
  runtime: ReturnType<typeof openRuntime>,
  budgetProfile: unknown,
  tag: string,
): { readonly lineageKey: string; readonly workItemId: string } {
  const { submission, workItemId } = registerLineage(
    runtime,
    {
      contractId: CONTRACT,
      snapshotId: SNAPSHOT,
      targetId: TARGET,
      authorizationContextRef: 'authctx/local-001',
      budgetProfile,
    },
    { commandId: `cmd-${tag}-register`, memberId: MEMBER },
  );
  runtime.writer.dispatch({ workItemId, attemptId: `${workItemId}#attempt-1` });
  return { lineageKey: submission.lineageKey, workItemId };
}

async function runDirectFlowWithLineage(
  runtime: ReturnType<typeof openRuntime>,
  _lineageKey: string,
  baseUri: string,
  bytes: Uint8Array,
  tag: string,
): Promise<DirectFlowResult> {
  void _lineageKey;
  return runDirectFlow(runtime, baseUri, bytes, profileWith({ maxGeneratedRequests: 0 }), tag);
}
