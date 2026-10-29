/**
 * v0.2 T04 — single-budget-truth adapter for the direct-acquisition ledger
 * seam (frozen L2 invariant 7).
 *
 * This is the ONLY budget mutation path the bridge and the existing
 * `DirectHttpAdapter` share: remaining budget is always projected with the
 * canonical `budgetRemaining` semantics from @xdownload/domain-contracts and
 * consumption is recorded exclusively through `consume`. There is no second
 * ledger and no private byte counter anywhere in the bridge — the counters
 * the bridge exposes are observability only and never gate anything.
 *
 * In the composed product this port is bound to the durable Core-owned
 * ledger; this canonical in-host implementation exists so the T04 lane can
 * run real transfers against the same seam with real budget math.
 */
import {
  budgetRemaining,
  decodeBudgetProfile,
  unwrapOrThrow,
  type BudgetProfile,
  type BudgetRemaining,
  type ConsumedBudget,
} from '@xdownload/domain-contracts';
import type { TransferBudgetLedgerPort, TransferConsumption } from '../../../direct-acquisition/src/index.ts';

export class CanonicalBudgetLedger implements TransferBudgetLedgerPort {
  private readonly profile: BudgetProfile;
  private readonly consumed: {
    discovery: { generatedRequests: number; navigationActions: number; modelCalls: number };
    transfer: { bytes: number; segments: number; activeTransferMs: number; retryTransferRequests: number };
    globalSafety: { totalGeneratedRequests: number; modelCostUnits: number; activeElapsedMs: number };
  };
  /** Plain transfer requests reported to the seam (observability only, not budget math). */
  transferRequestsReported = 0;

  constructor(rawProfile: unknown) {
    this.profile = unwrapOrThrow(decodeBudgetProfile(rawProfile));
    this.consumed = {
      discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
    };
  }

  remaining(): BudgetRemaining {
    const snapshot: ConsumedBudget = {
      discovery: this.consumed.discovery,
      transfer: this.consumed.transfer,
      globalSafety: this.consumed.globalSafety,
    };
    return budgetRemaining(this.profile, snapshot);
  }

  consume(units: TransferConsumption): BudgetRemaining {
    this.transferRequestsReported += units.transferRequests;
    this.consumed.transfer.bytes += units.bytes;
    this.consumed.transfer.retryTransferRequests += units.retryTransferRequests;
    return this.remaining();
  }

  /** Read-only consumption view for evidence/tests; never a second projection authority. */
  get consumedSnapshot(): ConsumedBudget {
    return {
      discovery: { ...this.consumed.discovery },
      transfer: { ...this.consumed.transfer },
      globalSafety: { ...this.consumed.globalSafety },
    };
  }
}
