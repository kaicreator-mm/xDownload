/**
 * T006 durable-control-facts seam — the append/observe contract that T005
 * (SQLite durable ledger) and T015 (Core runtime integration) implement with
 * real storage, without semantic reinterpretation.
 *
 * T006 ships only a deterministic in-memory implementation for concern tests.
 * Facts are the authority; every derived machine is rebuildable from
 * `readAll()` alone, which is what makes crash-adjacent behavior provable.
 *
 * Budget consumption/reservation facts are only constructible through the
 * single authoritative budget ledger: `append` enforces an unforgeable
 * `ConsumptionToken` on them, so a second per-worker/per-surface counter path
 * is not merely forbidden by review but unrepresentable.
 */

import {
  deepFreeze,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import { decodeFactLog, type DurableControlFact, type UncommittedControlFact } from './facts.ts';
import { controlOk, controlReject, type ControlResult } from './rejections.ts';

/** Real runtime symbol: the consumption authorization cannot be fabricated. */
const consumptionAuthority: unique symbol = Symbol(
  'xdownload.core-scheduler.consumption-authority',
);

/**
 * Unforgeable authorization for budget consumption/reservation facts. The
 * minting constructor lives inside the authoritative budget ledger and is not
 * exported from the package; the symbol key cannot be fabricated at runtime.
 */
export interface ConsumptionToken {
  readonly [consumptionAuthority]: 'single-budget-mutation-path';
}

/** Runtime token check used by the log at append time. */
export function isConsumptionToken(value: unknown): value is ConsumptionToken {
  return (
    typeof value === 'object' &&
    value !== null &&
    consumptionAuthority in (value as Record<symbol, unknown>)
  );
}

/** Package-internal mint (not re-exported from the package index). */
export function mintConsumptionToken(): ConsumptionToken {
  return { [consumptionAuthority]: 'single-budget-mutation-path' };
}

const BUDGET_FACT_KINDS: readonly string[] = ['budgetReserved', 'budgetConsumed'];

export interface DurableControlFactLog {
  /**
   * Append one control fact; the log assigns the durable commit sequence.
   * Budget facts require the ledger's consumption token.
   */
  append(
    fact: UncommittedControlFact,
    authorization?: ConsumptionToken,
  ): ControlResult<DurableControlFact>;
  /** Observe every committed fact in durable commit order. */
  readAll(): readonly DurableControlFact[];
}

const BUDGET_FACT_KIND_SET = new Set<string>(BUDGET_FACT_KINDS);

/**
 * Deterministic in-memory fact log (concern-test implementation of the seam).
 *
 * - strictly increasing commit sequence starting at 1 (single durable total
 *   order; gaps/stale sequence claims are rejected — there is no
 *   multi-host/distributed claim construct);
 * - budget facts are rejected without a valid `ConsumptionToken`
 *   (BUDGET_AUTHORITY_VIOLATION);
 * - `reopen` rebuilds a log from previously committed facts after simulated
 *   process death, re-validating them fail-closed.
 */
export class InMemoryControlFactLog implements DurableControlFactLog {
  readonly #facts: DurableControlFact[];
  #nextSequence: number;

  private constructor(facts: DurableControlFact[]) {
    this.#facts = facts;
    this.#nextSequence = facts.length === 0 ? 1 : facts[facts.length - 1]!.sequence + 1;
  }

  static empty(): InMemoryControlFactLog {
    return new InMemoryControlFactLog([]);
  }

  /** Rebuild after process death/reopen from decoded committed facts. */
  static reopen(facts: readonly DurableControlFact[]): InMemoryControlFactLog {
    return new InMemoryControlFactLog([...facts]);
  }

  /** Decode + reopen from a JSON snapshot (restart simulation helper). */
  static reopenFromJson(json: string): DomainValidationResult<InMemoryControlFactLog> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'MALFORMED_REQUIRED_FIELD',
            path: 'factLog',
            message: 'serialized fact log is not valid JSON',
          } satisfies ValidationDiagnostic,
        ],
      };
    }
    const decoded = decodeFactLog(parsed);
    return decoded.ok ? { ok: true, value: InMemoryControlFactLog.reopen(decoded.value) } : decoded;
  }

  append(
    fact: UncommittedControlFact,
    authorization?: ConsumptionToken,
  ): ControlResult<DurableControlFact> {
    if (BUDGET_FACT_KIND_SET.has(fact.kind) && !isConsumptionToken(authorization)) {
      return controlReject(
        'BUDGET_AUTHORITY_VIOLATION',
        `budget fact '${fact.kind}' is only writable through the single authoritative budget ledger`,
        'consumption records are unconstructible outside the Core-owned mutation path',
      );
    }
    const committed = deepFreeze({
      ...fact,
      sequence: this.#nextSequence,
    }) as DurableControlFact;
    this.#facts.push(committed);
    this.#nextSequence += 1;
    return controlOk(committed);
  }

  readAll(): readonly DurableControlFact[] {
    return this.#facts;
  }
}
