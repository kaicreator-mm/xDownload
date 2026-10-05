/**
 * T017 caller-side provider deadline/budget wrap — the recorded T012 P2
 * waiver constraint (PR #31 review): `@xdownload/ai-proposal` deliberately
 * enforces no internal provider deadline. The `ModelProviderPort` contract
 * maps hung calls to `UNAVAILABLE` *by the implementation*, and the deadline
 * authority belongs to the caller/budget per Frozen PRD §15
 * (GlobalSafetyBudget: "configured model cost/calls" and "global active
 * elapsed time", highest precedence). T017 is that caller.
 *
 * Every provider invocation in the composed path passes through this wrap:
 *
 *   composed gap → deadline derived from canonical budget facts (PRD §15)
 *   → race provider.propose against the deterministic deadline timer
 *   → expiry resolves { kind: 'UNAVAILABLE', reason: 'TIMEOUT', detail }
 *     (the adapter maps it to MODEL_UNAVAILABLE + DeterministicFallback)
 *   → exactly one budget charge per attempted call slice; the wrap never
 *     replenishes or redefines any budget
 *
 * The wrap lives at the T017 call site; `packages/ai-proposal` is untouched.
 * A hung or slow provider can stall at most its bounded slice and resolves
 * as typed unavailability — never as a hang, a silent skip, an empty
 * success, or a leaked exception.
 */

import type {
  ModelProviderPort,
  ProviderProposalOutcome,
  ProviderProposalRequest,
} from '@xdownload/ai-proposal';

/**
 * Canonical budget facts the provider deadline derives from (Frozen PRD §15
 * GlobalSafetyBudget: model cost/calls + global active elapsed time, highest
 * precedence). Facts are read from the caller's canonical budget view; the
 * wrap never writes or redefines them.
 */
export interface ModelBudgetFacts {
  /** Remaining configured model calls (GlobalSafetyBudget model cost/calls). */
  readonly modelCallsRemaining: number;
  /** Remaining global active elapsed time, in ms (GlobalSafetyBudget). */
  readonly activeElapsedMsRemaining: number;
}

/** One charged provider-call slice, applied verbatim by the budget owner. */
export interface ProviderCallCharge {
  /** Exactly one provider call was attempted against the budget. */
  readonly calls: 1;
  /** Elapsed ms the call slice consumed (0 when the budget gate pre-empted). */
  readonly elapsedMs: number;
  /** The deadline slice the call was bounded by (ms; 0 when pre-empted). */
  readonly deadlineMs: number;
  /** True when the caller-side deadline expired before the provider resolved. */
  readonly timedOut: boolean;
}

/** Deterministic ports of the deadline wrap (tests inject fakes). */
export interface DeadlineWrapPorts {
  /** Elapsed-time clock in ms (monotonic-enough for slice measurement). */
  readonly epochMs: () => number;
  /** Schedule the deadline expiry; returns the timer's cancel handle. */
  readonly scheduleTimeout: (ms: number, onExpiry: () => void) => () => void;
  /** Budget application hook: charges the consumed slice; never returns budget. */
  readonly chargeProviderCall: (charge: ProviderCallCharge) => void;
}

/** Real clock/timer ports with the caller's charge hook (production shape). */
export function realDeadlineWrapPorts(
  chargeProviderCall: (charge: ProviderCallCharge) => void,
): DeadlineWrapPorts {
  return {
    epochMs: () => Date.now(),
    scheduleTimeout: (ms, onExpiry) => {
      const handle = setTimeout(onExpiry, ms);
      return () => clearTimeout(handle);
    },
    chargeProviderCall: chargeProviderCall,
  };
}

/**
 * Pure deadline derivation from canonical budget facts (PRD §15): the
 * bounded slice is the remaining global active elapsed time, and a model
 * budget with no remaining calls (or no remaining global elapsed time)
 * pre-empts the call entirely. The derivation never replenishes or redefines
 * any budget; it only reads what remains.
 */
export function providerDeadlineMs(facts: ModelBudgetFacts): number | undefined {
  if (facts.modelCallsRemaining <= 0 || facts.activeElapsedMsRemaining <= 0) {
    return undefined;
  }
  return Math.floor(facts.activeElapsedMsRemaining);
}

export interface DeadlineBoundedProviderOptions {
  /**
   * Per-call deadline derivation from the caller's canonical budget facts.
   * `undefined` means the budget gate pre-empts the call: typed
   * unavailability resolves without invoking the provider at all.
   */
  readonly deadlineFor: () => number | undefined;
  /** Deterministic wrap ports (charge hook included). */
  readonly ports: DeadlineWrapPorts;
}

/**
 * Wrap one provider port with the mandatory caller-side deadline/budget
 * bound. The wrapped port keeps the provider's identity (proposals stay
 * traceable to the same provider) and guarantees, for every call:
 *
 * - exactly one budget charge (the consumed slice, truthful elapsed/timedOut);
 * - a hung provider resolves as `UNAVAILABLE/TIMEOUT` within `deadlineMs`;
 * - a thrown provider failure resolves as `UNAVAILABLE/OUTAGE` (never a
 *   leaked exception, never an empty success);
 * - a pre-empted (budget-exhausted) call never reaches the provider and
 *   resolves as typed `UNAVAILABLE/OUTAGE` naming the budget gate.
 */
export function wrapProviderWithDeadline(
  provider: ModelProviderPort,
  options: DeadlineBoundedProviderOptions,
): ModelProviderPort {
  const { ports, deadlineFor } = options;
  return {
    identity: provider.identity,
    propose(request: ProviderProposalRequest): Promise<ProviderProposalOutcome> {
      const deadlineMs = deadlineFor();
      if (deadlineMs === undefined) {
        ports.chargeProviderCall({ calls: 1, elapsedMs: 0, deadlineMs: 0, timedOut: false });
        return Promise.resolve({
          kind: 'UNAVAILABLE',
          reason: 'OUTAGE',
          detail:
            'provider call pre-empted by the caller-side budget gate: no configured model calls or global active elapsed time remain (PRD §15 GlobalSafetyBudget); the provider was not invoked',
        } as const);
      }
      const startedAt = ports.epochMs();
      return new Promise<ProviderProposalOutcome>((resolve) => {
        let settled = false;
        const cancelTimer = ports.scheduleTimeout(deadlineMs, () => {
          if (settled) {
            return;
          }
          settled = true;
          const elapsedMs = Math.max(0, ports.epochMs() - startedAt);
          ports.chargeProviderCall({
            calls: 1,
            elapsedMs: elapsedMs,
            deadlineMs: deadlineMs,
            timedOut: true,
          });
          resolve({
            kind: 'UNAVAILABLE',
            reason: 'TIMEOUT',
            detail: `provider call exceeded the caller-side deadline bound of ${String(deadlineMs)} ms derived from the canonical budget facts (PRD §15); a hung provider stalls at most its bounded slice`,
          } as const);
        });
        provider.propose(request).then(
          (outcome) => {
            if (settled) {
              return;
            }
            settled = true;
            cancelTimer();
            ports.chargeProviderCall({
              calls: 1,
              elapsedMs: Math.max(0, ports.epochMs() - startedAt),
              deadlineMs: deadlineMs,
              timedOut: false,
            });
            resolve(outcome);
          },
          () => {
            if (settled) {
              // The deadline already resolved the call truthfully; a late
              // inner failure never upgrades the typed TIMEOUT and never
              // leaks past the wrap.
              return;
            }
            settled = true;
            cancelTimer();
            ports.chargeProviderCall({
              calls: 1,
              elapsedMs: Math.max(0, ports.epochMs() - startedAt),
              deadlineMs: deadlineMs,
              timedOut: false,
            });
            resolve({
              kind: 'UNAVAILABLE',
              reason: 'OUTAGE',
              detail:
                'provider call failed; the thrown failure is mapped to typed unavailability at the caller-side wrap (never a leaked exception, never a silent skip)',
            } as const);
          },
        );
      });
    },
  };
}
