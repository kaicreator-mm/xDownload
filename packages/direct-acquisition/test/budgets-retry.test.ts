/**
 * TEST_MATRIX suites `budget-consumption` and `retries` plus the `safe-restart`
 * budget rules (frozen PRD §15, frozen L2 invariant 7, counterexamples
 * C12/C13): transfer/retry requests and bytes count against TransferBudget
 * through the authoritative seam, GlobalSafetyBudget has the highest
 * precedence, retry inherits remaining budgets without replenishment, and
 * retry cannot create replacement targets or escape the failed lineage.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoDuplicateAllocation,
  decodeBudgetProfile,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import type { PartialTransferState } from '../src/index.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import {
  directRequest,
  effectIdOf,
  payload,
  targetIdOf,
  transferProfile,
} from './helpers/fixtures.ts';

const FULL = payload(100);
const WRONG_VARIANT = payload(100, 21);

let fixture: ControlledHttpFixture;
let baseUri: string;

beforeAll(async () => {
  fixture = new ControlledHttpFixture();
  baseUri = await fixture.start();
});

beforeEach(() => {
  fixture.clearRequests();
});

afterAll(async () => {
  await fixture.stop();
});

function carriedPartial(bytes: Uint8Array): PartialTransferState {
  return {
    bytes,
    receivedBytes: bytes.byteLength,
    identity: {},
    effectId: effectIdOf('effect-001'),
    targetId: targetIdOf('target-file-001'),
  };
}

describe('budget-consumption: units are counted through the authoritative seam', () => {
  it('transfer bytes and requests are charged to the canonical ledger, exactly once', async () => {
    fixture.serveFile('/counted.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/counted.bin', FULL, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(ledger.transferRequestsReported).toBe(1);
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(900);
    expect(ledger.remaining().transfer.exhausted).toBe(false);
  });

  it('retry transfer requests count against TransferBudget without replenishment (C13)', async () => {
    let serveCorrectVariant = false;
    fixture.on('/retry-budget.bin', (_request, response) => {
      const body = serveCorrectVariant ? FULL : WRONG_VARIANT;
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.end(Buffer.from(body));
    });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, maxRetryTransferRequests: 3 }),
    );
    const adapter = new DirectHttpAdapter(ledger);

    const first = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/retry-budget.bin', FULL, { effectId: 'effect-001' }),
      ),
    );
    expect(first.reason).toBe('WRONG_TARGET');

    serveCorrectVariant = true;
    const retry = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/retry-budget.bin', FULL, {
          effectId: 'effect-001',
          attempt: 1,
          retryLineage: {
            effectId: effectIdOf('effect-001'),
            targetId: targetIdOf('target-file-001'),
          },
        }),
      ),
    );

    expect(retry.reason).toBe('COMPLETED');
    // Same effect lineage, no new allocation; both transfers' bytes remain
    // consumed — retry inherited, never replenished.
    expect(retry.effectId).toBe(first.effectId);
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(100_000 - 200);
    expect(ledger.remaining().transfer.perLimit['retryTransferRequests']).toBe(2);
    expect(ledger.transferRequestsReported).toBe(1);
  });

  it('GlobalSafetyBudget hard ceiling stops work first, without redefining scope', async () => {
    fixture.serveFile('/gated.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, globalMaxTotalGeneratedRequests: 5 }),
    );
    ledger.preConsume({ globalSafety: { totalGeneratedRequests: 5 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(directRequest(baseUri, '/gated.bin', FULL, { effectId: 'effect-001' })),
    );

    expect(outcome.reason).toBe('GLOBAL_SAFETY_EXHAUSTED');
    expect(fixture.requests.length).toBe(0);
    expect(outcome.terminalResult.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
    expect(outcome.terminalResult.requestFulfillment).toBe('UNSATISFIED');
    expect(outcome.terminalResult.coverage).toBe('NOT_APPLICABLE');
    expect(outcome.allApplicableValidationPassed).toBe(false);
  });

  it('exhausted DiscoveryBudget does not block a frozen target while transfer budgets remain (C28)', async () => {
    fixture.serveFile('/frozen-target.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, discoveryMaxGeneratedRequests: 1 }),
    );
    ledger.preConsume({ discovery: { generatedRequests: 1 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/frozen-target.bin', FULL, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(fixture.requests.length).toBe(1);
  });

  it('mid-transfer byte exhaustion stops work truthfully and can never project COMPLETE', async () => {
    const large = payload(2_000_000);
    fixture.serveFile('/large.bin', { body: large });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/large.bin', large, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(outcome.receivedBytes).toBeLessThan(large.byteLength);
    expect(fixture.requests.length).toBe(1);
    expect(outcome.terminalResult.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(outcome.terminalResult.selectionAcquisition === 'COMPLETE').toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('PARTIAL');
    expect(outcome.allApplicableValidationPassed).toBe(false);
  });

  it('exhausted transfer budget blocks the request before any HTTP traffic', async () => {
    fixture.serveFile('/blocked.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 0 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/blocked.bin', FULL, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(fixture.requests.length).toBe(0);
    expect(outcome.bytes).toBeUndefined();
  });
});

describe('retries: same lineage only (C12), budget boundaries enforced', () => {
  it('retry claiming a replacement target is rejected before transfer (C12)', async () => {
    fixture.serveFile('/lineage.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, maxRetryTransferRequests: 5 }),
    );
    const adapter = new DirectHttpAdapter(ledger);
    const before = fixture.requests.length;

    const rejected = await adapter.acquire(
      directRequest(baseUri, '/lineage.bin', FULL, {
        effectId: 'effect-001',
        targetId: 'target-file-001',
        attempt: 1,
        retryLineage: {
          effectId: effectIdOf('effect-001'),
          targetId: targetIdOf('target-REPLACEMENT'),
        },
      }),
    );

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      const drift = rejected.diagnostics.find((entry) => entry.code === 'MEMBERSHIP_DRIFT');
      expect(drift?.invariant).toBe('C12');
    }
    expect(fixture.requests.length).toBe(before);
  });

  it('retry beyond exhausted retry budget is blocked at the seam (no request)', async () => {
    fixture.serveFile('/exhausted.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, maxRetryTransferRequests: 2 }),
    );
    ledger.preConsume({ transfer: { retryTransferRequests: 2 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/exhausted.bin', FULL, {
          effectId: 'effect-001',
          attempt: 1,
          retryLineage: {
            effectId: effectIdOf('effect-001'),
            targetId: targetIdOf('target-file-001'),
          },
        }),
      ),
    );

    expect(outcome.reason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(fixture.requests.length).toBe(0);
    expect(outcome.terminalResult.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
  });

  it('safe restart inherits remaining budgets and stable lineage (C13 restart)', async () => {
    fixture.serveFile('/restart-lineage.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    ledger.preConsume({ transfer: { bytes: 40 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(baseUri, '/restart-lineage.bin', FULL, {
          effectId: 'effect-001',
          attempt: 1,
        }),
        resumeFrom: carriedPartial(payload(40)),
      }),
    );

    expect(outcome.resumeDecision).toEqual({ kind: 'SAFE_RESTART', reason: 'NO_STRONG_VALIDATOR' });
    expect(outcome.effectId).toBe('effect-001');
    expect(outcome.targetId).toBe('target-file-001');
    expect(outcome.reason).toBe('COMPLETED');
    // 40 carried + 100 fresh consumed; no replenishment.
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(860);
  });

  it('reusing one effect identity is lineage reuse, not double allocation (C13)', () => {
    const effect = effectIdOf('effect-001');
    // A retry/restart reconciles by lineage (same effect id), while a second
    // allocation of the same effect identity is rejected by the canonical rule.
    expect(assertNoDuplicateAllocation([effect], effect).ok).toBe(false);
    const profile = unwrapOrThrow(
      decodeBudgetProfile({
        discovery: { domain: 'discovery' },
        transfer: { domain: 'transfer', maxBytes: 1000 },
        globalSafety: { domain: 'global_safety' },
      }),
    );
    expect(profile.transfer.domain).toBe('transfer');
  });
});
