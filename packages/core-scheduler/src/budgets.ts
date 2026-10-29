/**
 * T006 single Core-owned budget mutation path (frozen L2 invariant 7,
 * PRD §15/§15.4).
 *
 * `BudgetLedger` is the only code shape that can record budget
 * reservation/consumption: budget facts carry an unforgeable consumption
 * token minted here and the fact log rejects any other writer, so a second
 * private per-worker/per-surface counter is unrepresentable.
 *
 * Semantics:
 * - reservations gate dispatch; consumption records what actually happened;
 *   remaining budgets derive from committed consumption facts only;
 * - exhaustion precedence (PRD §15.4): global_safety > transfer > discovery,
 *   with budget-truthful `StopReason`s (never scope truth);
 * - reopen/replay recomputes remaining from committed facts: restart, retry,
 *   resume and repair inherit remaining budgets and never replenish any
 *   domain (PRD §15.4, counterexample C13/C28);
 * - only active time is recordable; user pause time has no representation in
 *   consumption (PRD §15.4 pause exclusion).
 */

import {
  budgetRemaining,
  decodeBudgetProfile,
  assertNoDuplicateAllocation,
  type BudgetDomain,
  type BudgetProfile,
  type BudgetRemaining,
  type ConsumedBudget,
  type ContractId,
  type DomainBudgetRemaining,
  type EffectId,
  type StopReason,
} from '@xdownload/domain-contracts';
import type {
  BudgetActionKind,
  BudgetAmounts,
  CommitSequence,
  DurableControlFact,
  LineageKey,
  UncommittedControlFact,
} from './facts.ts';
import { mintConsumptionToken, type ConsumptionToken } from './store.ts';
import { controlOk, controlReject, type ControlResult } from './rejections.ts';

/** A budgeted scheduling action (all amounts explicit — deterministic, no defaults). */
export type BudgetAction =
  | { readonly kind: 'GENERATED_REQUEST'; readonly count: number }
  | { readonly kind: 'NAVIGATION'; readonly count: number }
  | { readonly kind: 'MODEL_CALL'; readonly count: number; readonly costUnits: number }
  | { readonly kind: 'TRANSFER_BYTES'; readonly bytes: number }
  | { readonly kind: 'TRANSFER_SEGMENT'; readonly count: number }
  | { readonly kind: 'TRANSFER_TIME'; readonly ms: number }
  | { readonly kind: 'RETRY_TRANSFER_REQUEST'; readonly count: number }
  | { readonly kind: 'ACTIVE_ELAPSED'; readonly ms: number };

/** Active-time observation: only `activeMs` is billable (pause exclusion). */
export interface ActiveTimeObservation {
  readonly activeMs: number;
  readonly pausedMs: number;
}

/**
 * Pause exclusion (PRD §15.4): user pause time is structurally excluded from
 * active elapsed-time counters — it has no path into budget consumption. A
 * specific global wall-clock limit, if ever configured, would be its own
 * limit and still would not turn pause time into active time.
 */
export function billableActiveMs(observation: ActiveTimeObservation): number {
  return observation.activeMs;
}

/** Budget-truthful stop reason per domain (PRD §16.5 vocabulary). */
export const STOP_REASON_BY_DOMAIN: Readonly<Record<BudgetDomain, StopReason>> = Object.freeze({
  global_safety: 'GLOBAL_SAFETY_LIMIT',
  transfer: 'TRANSFER_BUDGET_EXHAUSTED',
  discovery: 'DISCOVERY_BUDGET_EXHAUSTED',
});

/** Domain precedence for exhaustion reporting: global safety stops everything first. */
const DOMAIN_PRECEDENCE: readonly BudgetDomain[] = ['global_safety', 'transfer', 'discovery'];

interface LimitTouch {
  readonly domain: BudgetDomain;
  readonly limitKey: string;
  readonly field: keyof BudgetAmounts;
}

const ACTION_TOUCHES: Readonly<Record<BudgetActionKind, readonly LimitTouch[]>> = Object.freeze({
  GENERATED_REQUEST: [
    { domain: 'global_safety', limitKey: 'totalGeneratedRequests', field: 'generatedRequests' },
    { domain: 'discovery', limitKey: 'generatedRequests', field: 'generatedRequests' },
  ],
  NAVIGATION: [{ domain: 'discovery', limitKey: 'navigationActions', field: 'navigationActions' }],
  MODEL_CALL: [
    { domain: 'global_safety', limitKey: 'modelCostUnits', field: 'modelCostUnits' },
    { domain: 'discovery', limitKey: 'modelCalls', field: 'modelCalls' },
  ],
  TRANSFER_BYTES: [{ domain: 'transfer', limitKey: 'bytes', field: 'bytes' }],
  TRANSFER_SEGMENT: [{ domain: 'transfer', limitKey: 'segments', field: 'segments' }],
  TRANSFER_TIME: [{ domain: 'transfer', limitKey: 'activeTransferMs', field: 'activeTransferMs' }],
  RETRY_TRANSFER_REQUEST: [
    { domain: 'transfer', limitKey: 'retryTransferRequests', field: 'retryTransferRequests' },
  ],
  ACTIVE_ELAPSED: [
    { domain: 'global_safety', limitKey: 'activeElapsedMs', field: 'activeElapsedMs' },
  ],
});

function remainingFor(remaining: BudgetRemaining, domain: BudgetDomain): DomainBudgetRemaining {
  return domain === 'global_safety' ? remaining.globalSafety : remaining[domain];
}

/** Normalize an action into the flat amounts record it touches. */
export function actionAmounts(action: BudgetAction): BudgetAmounts {
  switch (action.kind) {
    case 'GENERATED_REQUEST':
      return { generatedRequests: action.count };
    case 'NAVIGATION':
      return { navigationActions: action.count };
    case 'MODEL_CALL':
      return { modelCalls: action.count, modelCostUnits: action.costUnits };
    case 'TRANSFER_BYTES':
      return { bytes: action.bytes };
    case 'TRANSFER_SEGMENT':
      return { segments: action.count };
    case 'TRANSFER_TIME':
      return { activeTransferMs: action.ms };
    case 'RETRY_TRANSFER_REQUEST':
      return { retryTransferRequests: action.count };
    case 'ACTIVE_ELAPSED':
      return { activeElapsedMs: action.ms };
  }
}

const ZERO_CONSUMED: ConsumedBudget = Object.freeze({
  discovery: Object.freeze({ generatedRequests: 0, navigationActions: 0, modelCalls: 0 }),
  transfer: Object.freeze({
    bytes: 0,
    segments: 0,
    activeTransferMs: 0,
    retryTransferRequests: 0,
  }),
  globalSafety: Object.freeze({ totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 }),
});

function addAmounts(consumed: ConsumedBudget, amounts: BudgetAmounts): ConsumedBudget {
  return {
    discovery: {
      generatedRequests: consumed.discovery.generatedRequests + (amounts.generatedRequests ?? 0),
      navigationActions: consumed.discovery.navigationActions + (amounts.navigationActions ?? 0),
      modelCalls: consumed.discovery.modelCalls + (amounts.modelCalls ?? 0),
    },
    transfer: {
      bytes: consumed.transfer.bytes + (amounts.bytes ?? 0),
      segments: consumed.transfer.segments + (amounts.segments ?? 0),
      activeTransferMs: consumed.transfer.activeTransferMs + (amounts.activeTransferMs ?? 0),
      retryTransferRequests:
        consumed.transfer.retryTransferRequests + (amounts.retryTransferRequests ?? 0),
    },
    globalSafety: {
      totalGeneratedRequests:
        consumed.globalSafety.totalGeneratedRequests + (amounts.generatedRequests ?? 0),
      modelCostUnits: consumed.globalSafety.modelCostUnits + (amounts.modelCostUnits ?? 0),
      activeElapsedMs: consumed.globalSafety.activeElapsedMs + (amounts.activeElapsedMs ?? 0),
    },
  };
}

/** Durable reservation grant returned by the single mutation path. */
export interface DispatchGrant {
  readonly reservationId: string;
  readonly lineageKey: LineageKey;
  readonly contractId: string;
  readonly action: BudgetActionKind;
  readonly reservedAmounts: BudgetAmounts;
}

export interface ConsumptionRecord {
  readonly reservationId: string;
  readonly lineageKey: LineageKey;
  readonly consumedAmounts: BudgetAmounts;
  readonly sequence: CommitSequence;
}

export interface BudgetStopProjection {
  readonly stopped: boolean;
  /** Highest-precedence exhausted domain, mapped to its budget-truthful stop reason. */
  readonly stopReason?: StopReason;
  readonly exhaustedDomains: readonly BudgetDomain[];
}

function profileEquals(a: BudgetProfile, b: BudgetProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ReplayState {
  readonly consumed: ConsumedBudget;
  readonly outstanding: ReadonlySet<string>;
  readonly reservationCount: number;
}

/** Fold committed facts into ledger accounting (replay is the only rebuild path). */
function replay(facts: readonly DurableControlFact[], contractId: string): ReplayState {
  let consumed = ZERO_CONSUMED;
  const outstanding = new Set<string>();
  let reservationCount = 0;
  for (const fact of facts) {
    if (fact.kind === 'budgetReserved' && fact.contractId === contractId) {
      reservationCount += 1;
      outstanding.add(fact.reservationId);
    }
    if (fact.kind === 'budgetConsumed' && fact.contractId === contractId) {
      consumed = addAmounts(consumed, fact.amounts);
      outstanding.delete(fact.reservationId);
    }
  }
  return { consumed, outstanding, reservationCount };
}

/** The append function the ledger is authorized to call (it supplies the token). */
export type LedgerAppend = (
  fact: UncommittedControlFact,
  token: ConsumptionToken,
) => ControlResult<DurableControlFact>;

/**
 * The one authoritative budget ledger per acquisition contract lifecycle.
 * All consumption is recorded through `reserve` → `consume`; the ledger is
 * rebuilt from durable facts on every scheduler decision, so concurrent
 * duplicate clients (UI/CLI/restart) observe one serialized ledger view.
 */
export class BudgetLedger {
  readonly #profile: BudgetProfile;
  readonly #contractId: ContractId;
  readonly #facts: readonly DurableControlFact[];
  readonly #append: LedgerAppend;
  readonly #token: ConsumptionToken;
  readonly #state: ReplayState;

  private constructor(
    profile: BudgetProfile,
    contractId: ContractId,
    facts: readonly DurableControlFact[],
    append: LedgerAppend,
  ) {
    this.#profile = profile;
    this.#contractId = contractId;
    this.#facts = facts;
    this.#append = append;
    this.#token = mintConsumptionToken();
    this.#state = replay(facts, contractId);
  }

  /**
   * Open the ledger over committed facts. The ledger mints the consumption
   * token, making it the sole writer of budget facts for this lifecycle.
   */
  static open(
    profile: BudgetProfile,
    contractId: ContractId,
    facts: readonly DurableControlFact[],
    append: LedgerAppend,
  ): BudgetLedger {
    return new BudgetLedger(profile, contractId, facts, append);
  }

  profile(): BudgetProfile {
    return this.#profile;
  }

  /** Current consumed accounting (replayed from durable consumption facts). */
  consumed(): ConsumedBudget {
    return this.#state.consumed;
  }

  /** Inherited remaining budgets (capped at zero, never replenished). */
  remaining(): BudgetRemaining {
    return budgetRemaining(this.#profile, this.#state.consumed);
  }

  /**
   * Restart/reopen guard: a candidate profile must equal the durably
   * registered profile. Any divergent/re-set profile is budget replenishment
   * and is rejected (PRD §15.4; FAILURE_MATRIX budget-replenishment).
   */
  assertCompatibleProfile(candidate: BudgetProfile): ControlResult<void> {
    if (!profileEquals(this.#profile, candidate)) {
      return controlReject(
        'BUDGET_REPLENISHMENT_REJECTED',
        'retry/restart/resume/repair must inherit the durably registered budget profile; a divergent profile implies replenishment or reset',
        `registered=${JSON.stringify(this.#profile)} candidate=${JSON.stringify(candidate)}`,
      );
    }
    return controlOk(undefined);
  }

  /**
   * Reserve budget for one generated action through the single mutation
   * path. Exhaustion precedence (PRD §15.4):
   * 1. an exhausted GlobalSafetyBudget stops ALL generated work (highest
   *    precedence), regardless of which domain the action touches;
   * 2. an exhausted TransferBudget stops every transfer action; an exhausted
   *    DiscoveryBudget stops every discovery/navigation/model action
   *    (domain-level exhaustion per T002 `DomainBudgetRemaining`);
   * 3. otherwise the action's per-limit amounts must fit the remaining room.
   */
  reserve(lineageKey: LineageKey, action: BudgetAction): ControlResult<DispatchGrant> {
    const amounts = actionAmounts(action);
    const values = Object.values(amounts);
    if (
      values.length === 0 ||
      values.some((value) => value === undefined || !Number.isInteger(value) || value < 0) ||
      values.every((value) => value === 0)
    ) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'budget action amounts must be positive integers',
        action.kind,
      );
    }
    const remaining = this.remaining();
    if (remainingFor(remaining, 'global_safety').exhausted) {
      return controlReject(
        'BUDGET_EXHAUSTED',
        'global_safety budget is exhausted: all generated work stops (highest precedence)',
        `${action.kind} on ${lineageKey}`,
        STOP_REASON_BY_DOMAIN.global_safety,
      );
    }
    const exhaustedDomain = this.#firstShortDomain(action.kind, amounts, remaining);
    if (exhaustedDomain !== undefined) {
      return controlReject(
        'BUDGET_EXHAUSTED',
        `${exhaustedDomain} budget cannot cover a ${action.kind} action; remaining is budget truth and is never replenished`,
        `${action.kind} on ${lineageKey}`,
        STOP_REASON_BY_DOMAIN[exhaustedDomain],
      );
    }
    const reservationId = `${this.#contractId}#res-${this.#state.reservationCount + 1}`;
    const appended = this.#append(
      {
        kind: 'budgetReserved',
        lineageKey,
        contractId: this.#contractId,
        reservationId,
        action: action.kind,
        amounts,
      },
      this.#token,
    );
    if (!appended.ok) {
      return appended;
    }
    return controlOk({
      reservationId,
      lineageKey,
      contractId: this.#contractId,
      action: action.kind,
      reservedAmounts: amounts,
    });
  }

  /**
   * Record actual consumption for an outstanding reservation (single-use;
   * no double counting — the durable consumed fact is the guard). Actual
   * amounts must not exceed the reservation: consumption outside the
   * reservation ordering is a budget-authority violation.
   */
  consume(grant: DispatchGrant, actual?: BudgetAmounts): ControlResult<ConsumptionRecord> {
    if (!this.#state.outstanding.has(grant.reservationId)) {
      const alreadyConsumed = this.#facts.some(
        (fact) => fact.kind === 'budgetConsumed' && fact.reservationId === grant.reservationId,
      );
      return controlReject(
        'BUDGET_AUTHORITY_VIOLATION',
        alreadyConsumed
          ? `reservation '${grant.reservationId}' was already consumed; double-counted consumption is rejected`
          : `reservation '${grant.reservationId}' is unknown to the durable ledger`,
        grant.reservationId,
      );
    }
    const reserved = grant.reservedAmounts;
    const recorded = actual ?? reserved;
    for (const field of Object.keys(recorded) as (keyof BudgetAmounts)[]) {
      const value = recorded[field] ?? 0;
      const reservedValue = reserved[field] ?? 0;
      if (value < 0 || value > reservedValue) {
        return controlReject(
          'BUDGET_AUTHORITY_VIOLATION',
          `consumption of '${String(field)}' exceeds or bypasses the reservation ordering`,
          `actual=${String(value)} reserved=${String(reservedValue)}`,
        );
      }
    }
    const appended = this.#append(
      {
        kind: 'budgetConsumed',
        lineageKey: grant.lineageKey,
        contractId: this.#contractId,
        reservationId: grant.reservationId,
        amounts: recorded,
      },
      this.#token,
    );
    if (!appended.ok) {
      return appended;
    }
    return controlOk({
      reservationId: grant.reservationId,
      lineageKey: grant.lineageKey,
      consumedAmounts: recorded,
      sequence: appended.value.sequence,
    });
  }

  /**
   * Budget-truthful stop projection (PRD §15.4, C23/C28): reports which
   * domains are exhausted and the highest-precedence budget stop reason.
   * Budget exhaustion never projects as scope/coverage completion — the stop
   * reason vocabulary stays budget-truthful by construction.
   */
  projectBudgetStop(): BudgetStopProjection {
    const remaining = this.remaining();
    const exhaustedDomains = DOMAIN_PRECEDENCE.filter(
      (domain) => remainingFor(remaining, domain).exhausted,
    );
    const highest = exhaustedDomains[0];
    return {
      stopped: exhaustedDomains.length > 0,
      stopReason: highest === undefined ? undefined : STOP_REASON_BY_DOMAIN[highest],
      exhaustedDomains,
    };
  }

  /** Effect-identity allocation guard (T002 C13): identities never double-allocated. */
  assertNoDuplicateEffectAllocation(
    allocated: readonly EffectId[],
    next: EffectId,
  ): ControlResult<void> {
    const result = assertNoDuplicateAllocation(allocated, next);
    return result.ok
      ? controlOk(undefined)
      : controlReject(
          'LINEAGE_FORK_REJECTED',
          'effect identity is already allocated; duplicate allocation is rejected',
          next,
        );
  }

  #firstShortDomain(
    kind: BudgetActionKind,
    amounts: BudgetAmounts,
    remaining: BudgetRemaining,
  ): BudgetDomain | undefined {
    for (const domain of DOMAIN_PRECEDENCE) {
      const touches = ACTION_TOUCHES[kind].filter((touch) => touch.domain === domain);
      if (touches.length === 0) {
        continue;
      }
      const domainRoom = remainingFor(remaining, domain);
      // Domain-level exhaustion (any limit at zero) stops the whole domain's
      // new work — a domain is not a bundle of independent counters.
      if (domainRoom.exhausted) {
        return domain;
      }
      for (const touch of touches) {
        const needed = amounts[touch.field] ?? 0;
        const left = domainRoom.perLimit[touch.limitKey];
        if (left !== undefined && needed > left) {
          return domain;
        }
      }
    }
    return undefined;
  }
}

/**
 * Decode the durable budget profile for submit/restart paths (fail closed
 * through the T002 decode, never bypassed).
 */
export function decodeDurableBudgetProfile(raw: unknown): ControlResult<BudgetProfile> {
  const decoded = decodeBudgetProfile(raw);
  return decoded.ok
    ? controlOk(decoded.value)
    : controlReject(
        'MALFORMED_CONTROL_FACT',
        'durable budget profile rejected by T002 decode',
        JSON.stringify(decoded.diagnostics),
      );
}
