/**
 * T017 AI-lane test fixtures — compose the real T012 adapter doubles with the
 * T017 caller-side deadline wrap. The T012 fake provider, legal proposal and
 * gap fixtures are REUSED verbatim (same discipline: raw untrusted shapes,
 * deterministic local data). No real network provider, no SDK, no model.
 */

import type {
  ModelProviderPort,
  ProviderProposalOutcome,
  ProviderProposalRequest,
} from '@xdownload/ai-proposal';
import type { ModelBudgetFacts, ProviderCallCharge } from '../src/index.ts';
import { FAKE_PROVIDER_IDENTITY } from '../../ai-proposal/test/fixtures.ts';

export {
  FAKE_PROVIDER_IDENTITY,
  GAP_REF,
  CONTRACT_REF,
  CONTINUATION_CONTRACT,
  CURRENT_PAGE_CONTRACT,
  legalProposalBytes,
  legalRecipePayload,
  gapEnvelopeInput,
  proposalEnvelope,
} from '../../ai-proposal/test/fixtures.ts';
export { deterministicFakeProvider } from '../../ai-proposal/test/fakeProvider.ts';

/** Open canonical budget facts (PRD §15): calls and global elapsed time remain. */
export function openBudgetFacts(overrides: Partial<ModelBudgetFacts> = {}): ModelBudgetFacts {
  return {
    modelCallsRemaining: 5,
    activeElapsedMsRemaining: 60_000,
    ...overrides,
  };
}

/**
 * A hung provider: `propose` never settles. The caller-side deadline wrap is
 * the ONLY thing that can resolve a call against it — the direct proof of
 * the T012 P2 waiver constraint.
 */
export function hungProvider(): ModelProviderPort & { readonly calls: () => number } {
  let calls = 0;
  return {
    identity: FAKE_PROVIDER_IDENTITY,
    calls: () => calls,
    propose(_request: ProviderProposalRequest): Promise<ProviderProposalOutcome> {
      calls += 1;
      return new Promise<ProviderProposalOutcome>(() => undefined);
    },
  };
}

/** Deterministic charge recorder standing in for the canonical budget owner. */
export interface ChargeRecorder {
  readonly charges: readonly ProviderCallCharge[];
  readonly record: (charge: ProviderCallCharge) => void;
}

export function chargeRecorder(): ChargeRecorder {
  const charges: ProviderCallCharge[] = [];
  return {
    charges: charges,
    record: (charge) => {
      charges.push(charge);
    },
  };
}

/**
 * Deterministic wrap clock: instant elapsed measurement and a manually
 * steppable timer queue, so deadline tests never depend on real timeouts.
 */
export interface DeterministicClock {
  readonly ports: {
    readonly epochMs: () => number;
    readonly scheduleTimeout: (ms: number, onExpiry: () => void) => () => void;
  };
  /** Advance the clock and fire due timers, in schedule order. */
  readonly advance: (ms: number) => void;
  readonly pendingTimers: () => number;
}

export function deterministicClock(startAt = 1_000): DeterministicClock {
  let now = startAt;
  let seq = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  return {
    ports: {
      epochMs: () => now,
      scheduleTimeout: (ms, onExpiry) => {
        seq += 1;
        const id = seq;
        timers.set(id, { at: now + ms, fire: onExpiry });
        return () => {
          timers.delete(id);
        };
      },
    },
    advance: (ms) => {
      now += ms;
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fire();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}
