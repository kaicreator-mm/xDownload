/**
 * T015 canonical budget bridge — the single mutation path handed to the
 * T008/T009 adapters.
 *
 * The composed runtime exposes the scheduler's `BudgetLedger` (the only
 * writer of budget facts, frozen L2 invariant 7) to the execution adapters
 * through the two upstream port shapes they consume:
 *
 * - `TransferBudgetLedgerPort` (`@xdownload/direct-acquisition`) for S1/S3;
 * - `TransferLedger` (`@xdownload/hls-vod-adapter`) for S4.
 *
 * Both bridges rebuild the canonical ledger view from the durable fact log
 * on every call (the scheduler's own duplicate-client pattern), reserve
 * through `BudgetLedger.reserve` and consume through `BudgetLedger.consume`
 * with the ledger's unforgeable consumption token. There is no glue-local
 * counter, no re-minted token and no private ledger: exhaustion and
 * precedence semantics are upstream-owned and surface verbatim.
 */

import {
  BudgetLedger,
  type BudgetAction,
  type BudgetAmounts,
  type BudgetLedger as BudgetLedgerType,
  type LedgerAppend,
  type LineageKey,
} from '@xdownload/core-scheduler';
import {
  canTransferAfterDiscoveryExhaustion,
  diagnostic,
  fail,
  ok,
  type BudgetDomain,
  type BudgetRemaining,
  type ConsumedBudget,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import type { TransferBudgetLedgerPort, TransferConsumption } from '@xdownload/direct-acquisition';
import type { TransferLedger, TransferWorkKind } from '@xdownload/hls-vod-adapter';
import type { CoreRuntime } from './runtime.ts';

/** A bridge bound to one registered lineage's contract budget lifecycle. */
export class CoreRuntimeBudgetBridge {
  readonly #runtime: CoreRuntime;
  readonly #lineageKey: LineageKey;
  readonly #contractId: string;

  constructor(runtime: CoreRuntime, lineageKey: LineageKey) {
    this.#runtime = runtime;
    this.#lineageKey = lineageKey;
    const binding = bindingOf(runtime, lineageKey);
    this.#contractId = binding.contractId;
  }

  /** Rebuild the canonical ledger view from durable facts (never cached authority). */
  ledger(): BudgetLedgerType {
    const facts = this.#runtime.scheduler.log().readAll();
    for (const fact of facts) {
      if (fact.kind === 'lineageSubmitted' && fact.lineageKey === this.#lineageKey) {
        const append: LedgerAppend = (uncommitted, token) =>
          this.#runtime.scheduler.log().append(uncommitted, token);
        return BudgetLedger.open(fact.budgetProfile, fact.binding.contractId, facts, append);
      }
    }
    throw new Error(
      `budget bridge bound to an unregistered lineage '${this.#lineageKey}'; submit the lineage first`,
    );
  }

  get contractId(): string {
    return this.#contractId;
  }

  get lineageKey(): LineageKey {
    return this.#lineageKey;
  }

  /**
   * Reserve + consume one action through the canonical mutation path. The
   * reservation is committed first and the consumption runs on a freshly
   * rebuilt view (the scheduler's own duplicate-client pattern: every view
   * is derived from durable facts, never from cached in-memory state).
   * A `BUDGET_EXHAUSTED` reserve is a refusal: nothing is charged and the
   * caller observes the truthful remaining projection (exhaustion is budget
   * truth, not an error to mask).
   */
  charge(action: BudgetAction, actual?: BudgetAmounts): void {
    const reservation = this.ledger().reserve(this.#lineageKey, action);
    if (!reservation.ok) {
      if (reservation.rejection.code === 'BUDGET_EXHAUSTED') {
        return;
      }
      // Suppression/unknown-lineage/authority violations propagate verbatim:
      // they are control-truth failures, never soft no-ops.
      throw new Error(
        `budget bridge charge rejected: ${reservation.rejection.code}: ${reservation.rejection.message}`,
      );
    }
    const consumption = this.ledger().consume(reservation.value, actual);
    if (!consumption.ok) {
      throw new Error(
        `budget bridge consumption rejected: ${consumption.rejection.code}: ${consumption.rejection.message}`,
      );
    }
  }

  /**
   * Charge streaming transfer bytes with canonical stream semantics: a chunk
   * larger than the remaining room charges exactly the remaining room (the
   * canonical budgetRemaining projection caps at zero and can never go
   * negative), so the very chunk that crosses the boundary flips the domain
   * to exhausted and the adapter stops truthfully. Nothing is ever charged
   * beyond the durable limit, and nothing is invented: the charge is bounded
   * by both the received chunk and the remaining room.
   */
  chargeTransferBytes(bytes: number): void {
    if (bytes <= 0) {
      return;
    }
    const left = this.remaining().transfer.perLimit['bytes'];
    const chargeable = left === undefined ? bytes : Math.min(bytes, left);
    if (chargeable > 0) {
      this.charge({ kind: 'TRANSFER_BYTES', bytes: chargeable });
    }
  }

  /** Charge one discrete unit when the domain still admits it (refused otherwise). */
  chargeDiscreteUnit(
    action: Extract<BudgetAction, { readonly kind: 'TRANSFER_SEGMENT' | 'RETRY_TRANSFER_REQUEST' }>,
  ): void {
    const remaining = this.remaining();
    const perLimit = remaining.transfer.perLimit;
    const limitKey = action.kind === 'TRANSFER_SEGMENT' ? 'segments' : 'retryTransferRequests';
    const left = perLimit[limitKey];
    if (left !== undefined && left < 1) {
      return; // the domain is exhausted for this unit; the caller observes it
    }
    this.charge(action);
  }

  remaining(): BudgetRemaining {
    return this.ledger().remaining();
  }

  consumed(): ConsumedBudget {
    return this.ledger().consumed();
  }

  exhaustedDomain(): BudgetDomain | undefined {
    return this.ledger().projectBudgetStop().exhaustedDomains[0];
  }
}

interface LineageBindingLike {
  readonly contractId: string;
}

function bindingOf(runtime: CoreRuntime, lineageKey: LineageKey): LineageBindingLike {
  for (const fact of runtime.scheduler.log().readAll()) {
    if (fact.kind === 'lineageSubmitted' && fact.lineageKey === lineageKey) {
      return fact.binding;
    }
  }
  throw new Error(`unregistered lineage '${lineageKey}'`);
}

/**
 * Canonical `TransferBudgetLedgerPort` for the direct HTTP adapter:
 * transfer bytes and retry requests debit the scheduler-owned ledger;
 * remaining budget is always the durable, capped projection.
 */
export function schedulerTransferBudgetPort(
  runtime: CoreRuntime,
  lineageKey: LineageKey,
): TransferBudgetLedgerPort {
  const bridge = new CoreRuntimeBudgetBridge(runtime, lineageKey);
  return {
    remaining: () => bridge.remaining(),
    consume: (units: TransferConsumption): BudgetRemaining => {
      if (units.retryTransferRequests > 0) {
        bridge.chargeDiscreteUnit({
          kind: 'RETRY_TRANSFER_REQUEST',
          count: units.retryTransferRequests,
        });
      }
      bridge.chargeTransferBytes(units.bytes);
      return bridge.remaining();
    },
  };
}

/**
 * Canonical `TransferLedger` for the HLS VOD pipeline: manifest/segment/
 * retry requests debit the same scheduler-owned transfer domain; the C28
 * admission rule (frozen-target transfer while transfer + global safety
 * remain, discovery exhaustion alone never blocks) is the canonical
 * `canTransferAfterDiscoveryExhaustion` projection of the durable ledger.
 */
export function schedulerHlsTransferLedger(
  runtime: CoreRuntime,
  lineageKey: LineageKey,
): TransferLedger {
  const bridge = new CoreRuntimeBudgetBridge(runtime, lineageKey);
  const chargeSegmentWork = (work: TransferWorkKind, bytes: number): void => {
    if (work === 'SEGMENT_REQUEST') {
      bridge.chargeDiscreteUnit({ kind: 'TRANSFER_SEGMENT', count: 1 });
    }
    if (work === 'RETRY_TRANSFER_REQUEST') {
      bridge.chargeDiscreteUnit({ kind: 'RETRY_TRANSFER_REQUEST', count: 1 });
    }
    bridge.chargeTransferBytes(bytes);
  };
  return {
    remaining: () => bridge.remaining(),
    consumed: () => bridge.consumed(),
    admitTransferWork: (work: TransferWorkKind): DomainValidationResult<void> => {
      const remaining = bridge.remaining();
      if (canTransferAfterDiscoveryExhaustion(remaining)) {
        return ok(undefined);
      }
      const reason = remaining.globalSafety.exhausted
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
    },
    recordTransfer: (work: TransferWorkKind, bytes: number): void => {
      chargeSegmentWork(work, bytes);
    },
  };
}
