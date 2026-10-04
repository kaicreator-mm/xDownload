/**
 * T009 — segment acquisition under canonical TransferBudget semantics.
 *
 * PRD §15.2/§15.4 + counterexample C28: manifest, media playlist and segment
 * requests are transfer effects and debit the transfer domain only;
 * DiscoveryBudget exhaustion does not block transfer of an already-frozen
 * HLS target while TransferBudget and GlobalSafetyBudget remain; exhaustion
 * stops work truthfully without redefining requested scope; retry inherits
 * remaining budget and never implies replenishment. The authoritative budget
 * ledger belongs to the Core scheduler (L2 invariant 7); this adapter-side
 * ledger is a deterministic constraint consumer of the canonical
 * BudgetProfile/ConsumedBudget semantics and never redefines scope.
 */

import {
  budgetRemaining,
  canTransferAfterDiscoveryExhaustion,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type BudgetProfile,
  type BudgetRemaining,
  type ConsumedBudget,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';

export type TransferWorkKind = 'MANIFEST_REQUEST' | 'SEGMENT_REQUEST' | 'RETRY_TRANSFER_REQUEST';

export interface TransferLedger {
  /** Canonical remaining budget across all three domains (capped at zero, never replenished). */
  readonly remaining: () => BudgetRemaining;
  readonly consumed: () => ConsumedBudget;
  /**
   * C28 admission rule: frozen-target transfer work may start only when the
   * transfer and global-safety domains remain; discovery exhaustion alone
   * never blocks it.
   */
  readonly admitTransferWork: (work: TransferWorkKind) => DomainValidationResult<void>;
  /** Record one transfer request effect; consumption is a fact once the request is issued. */
  readonly recordTransfer: (work: TransferWorkKind, bytes: number) => void;
}

function zeroConsumed(): ConsumedBudget {
  return deepFreeze({
    discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
    transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
    globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
  });
}

/** Create an adapter-side ledger over a canonical budget profile and prior consumption. */
export function createTransferLedger(
  profile: BudgetProfile,
  priorConsumed?: ConsumedBudget,
): TransferLedger {
  let consumed = priorConsumed ?? zeroConsumed();
  const remaining = (): BudgetRemaining => budgetRemaining(profile, consumed);
  const admitTransferWork = (work: TransferWorkKind): DomainValidationResult<void> => {
    const state = remaining();
    if (!canTransferAfterDiscoveryExhaustion(state)) {
      const reason = state.globalSafety.exhausted
        ? 'GLOBAL_SAFETY_LIMIT'
        : 'TRANSFER_BUDGET_EXHAUSTED';
      return fail([
        diagnostic(
          'ADMISSION_REJECTED',
          'budget.transfer',
          `${work} refused: ${reason}; budget exhaustion stops work truthfully and never redefines requested scope`,
          'PRD-§15.4/C28',
        ),
      ]);
    }
    return ok(undefined);
  };
  const recordTransfer = (work: TransferWorkKind, bytes: number): void => {
    const prior = consumed;
    consumed = deepFreeze({
      discovery: prior.discovery,
      transfer: {
        bytes: prior.transfer.bytes + bytes,
        segments: prior.transfer.segments + (work === 'SEGMENT_REQUEST' ? 1 : 0),
        activeTransferMs: prior.transfer.activeTransferMs,
        retryTransferRequests:
          prior.transfer.retryTransferRequests + (work === 'RETRY_TRANSFER_REQUEST' ? 1 : 0),
      },
      globalSafety: prior.globalSafety,
    });
  };
  return deepFreeze({ remaining, consumed: () => consumed, admitTransferWork, recordTransfer });
}
