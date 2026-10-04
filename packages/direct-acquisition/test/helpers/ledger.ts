/**
 * T008 test-side authoritative budget ledger (implements the canonical
 * `TransferBudgetLedgerPort` seam). Remaining budget is always computed with
 * the canonical `budgetRemaining` semantics from @xdownload/domain-contracts;
 * the adapter never sees or mutates internal counters — proving consumption
 * flows through the authoritative seam (frozen L2 invariant 7).
 */

import {
  budgetRemaining,
  decodeBudgetProfile,
  type BudgetProfile,
  type BudgetRemaining,
  type ConsumedBudget,
} from '@xdownload/domain-contracts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';
import type { TransferBudgetLedgerPort, TransferConsumption } from '../../src/index.ts';

interface DiscoveryConsumption {
  generatedRequests: number;
  navigationActions: number;
  modelCalls: number;
}

interface GlobalSafetyConsumption {
  totalGeneratedRequests: number;
  modelCostUnits: number;
  activeElapsedMs: number;
}

export class InMemoryAuthoritativeLedger implements TransferBudgetLedgerPort {
  private readonly profile: BudgetProfile;
  private readonly consumed: {
    discovery: DiscoveryConsumption;
    transfer: {
      bytes: number;
      segments: number;
      activeTransferMs: number;
      retryTransferRequests: number;
    };
    globalSafety: GlobalSafetyConsumption;
  };
  /** Plain transfer requests reported to the seam (observability). */
  transferRequestsReported = 0;

  constructor(rawProfile: unknown) {
    this.profile = unwrapOrThrow(decodeBudgetProfile(rawProfile));
    this.consumed = {
      discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
    };
  }

  /** Simulate pre-existing lifecycle consumption (e.g. earlier effects). */
  preConsume(delta: {
    discovery?: Partial<DiscoveryConsumption>;
    transfer?: Partial<{ bytes: number; retryTransferRequests: number }>;
    globalSafety?: Partial<GlobalSafetyConsumption>;
  }): void {
    if (delta.discovery !== undefined) {
      this.consumed.discovery = { ...this.consumed.discovery, ...delta.discovery };
    }
    if (delta.transfer !== undefined) {
      this.consumed.transfer = { ...this.consumed.transfer, ...delta.transfer };
    }
    if (delta.globalSafety !== undefined) {
      this.consumed.globalSafety = { ...this.consumed.globalSafety, ...delta.globalSafety };
    }
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
}
