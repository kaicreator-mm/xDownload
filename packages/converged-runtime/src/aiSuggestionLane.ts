/**
 * T017 AI-suggestion lane — the composed discovery/confirmation-gap wiring
 * that makes the T012 bounded proposal adapter (`@xdownload/ai-proposal`, so
 * far imported by nothing outside its package) an OPTIONAL suggestion source
 * of the converged path.
 *
 * Composition (glue decides order only; every verdict stays upstream-owned):
 *
 *   discovery/confirmation gap (exact gapRef/contractRef binding)
 *   → createAiProposalAdapter (redact → bound/audit → provider → containment
 *     audit → deterministic policy → accepted proposal | typed rejection |
 *     MODEL_UNAVAILABLE + DeterministicFallback)   [consumed as-is]
 *   → provider invocations pass through the MANDATORY caller-side
 *     deadline/budget wrap (T012 P2 waiver; PRD §15 GlobalSafetyBudget)
 *   → an ACCEPTED proposal is consumed ONLY as a human-suggestion-equivalent
 *     candidate through the unmodified `@xdownload/discovery-recipe`
 *     `planConfirmationWorkflow` — the exact deterministic machinery any
 *     human suggestion passes through (C19/C34). The lane never routes
 *     around confirmation, never mints scope/membership authority, and never
 *     auto-resolves an `ASK_USER` fallback: unavailability surfaces as an
 *     explicit deterministic fallback for a surface to present.
 *
 * Deterministic-only mode (`provider: undefined`) is a first-class, complete
 * configuration: the lane composes, runs and resolves without any model
 * anywhere (C16).
 */

import {
  createAiProposalAdapter,
  type AcceptedProposal,
  type AiProposalAdapter,
  type ContractAuthorityFacts,
  type DeterministicFallback,
  type ModelProviderPort,
  type ProposalDiagnostic,
  type ProposalRequest,
  type ProposalUnavailabilityReason,
  type ProviderIdentity,
} from '@xdownload/ai-proposal';
import { planConfirmationWorkflow, type ConfirmationPlan } from '@xdownload/discovery-recipe';
import type { AutomationMode } from '@xdownload/domain-contracts';
import {
  providerDeadlineMs,
  realDeadlineWrapPorts,
  wrapProviderWithDeadline,
  type DeadlineWrapPorts,
  type ModelBudgetFacts,
  type ProviderCallCharge,
} from './providerDeadline.ts';

/** The discovery/confirmation gap the lane answers, with its exact binding. */
export interface DiscoveryGapFacts {
  /** Raw (untrusted) bounded gap envelope; redacted/bounded by the adapter. */
  readonly gapEnvelope: unknown;
  /** The gap reference a proposal must bind exactly (C20). */
  readonly expectedGapRef: string;
  /** The contract context a proposal must bind exactly (C20/C31). */
  readonly expectedContractRef: string;
  /** The confirmed-contract authority facts the deterministic policy admits against. */
  readonly contract: ContractAuthorityFacts;
}

/**
 * Confirmation-workflow facts for the canonical planner. These are the same
 * trusted caller facts the T014 adapter documents (v1 interface gap 3 of 3):
 * the plan producer is canonical (`planConfirmationWorkflow`) and the lane
 * invents no fact — a real deployment sources them from Core discovery
 * state, never from surface-local guesses.
 */
export interface ConfirmationFacts {
  readonly automationMode: AutomationMode;
  readonly selectionPolicyBasis: string;
  readonly ambiguousMaterialMemberIds: readonly string[];
  readonly candidateCount: number;
  readonly autoEvidenceSufficient: boolean;
  readonly scopeScopeKey?: string;
  readonly userRequestsManualSelection?: boolean;
}

/** Complete typed outcome space of the composed suggestion lane. */
export type SuggestionLaneOutcome =
  | {
      /** Accepted data with suggestion provenance + the canonical plan it must pass. */
      readonly kind: 'PROPOSAL_ACCEPTED';
      readonly proposal: AcceptedProposal;
      readonly plan: ConfirmationPlan;
    }
  | { readonly kind: 'PROPOSAL_REJECTED'; readonly diagnostics: readonly ProposalDiagnostic[] }
  | { readonly kind: 'MODEL_INPUT_REJECTED'; readonly diagnostics: readonly ProposalDiagnostic[] }
  | {
      readonly kind: 'MODEL_UNAVAILABLE';
      readonly reason: ProposalUnavailabilityReason;
      readonly detail: string;
      readonly fallback: DeterministicFallback;
    };

/** The composed lane surface (same optional-provider shape as the adapter). */
export interface AiSuggestionLane {
  /** Provider identity when configured; `undefined` is deterministic-only mode. */
  readonly provider: ProviderIdentity | undefined;
  propose(
    input: DiscoveryGapFacts & { readonly confirmation: ConfirmationFacts },
  ): Promise<SuggestionLaneOutcome>;
}

export interface AiSuggestionLaneOptions {
  /** Strictly optional; omit for deterministic-only operation (no model anywhere). */
  readonly provider?: ModelProviderPort;
  /**
   * Per-call canonical budget facts (PRD §15). REQUIRED whenever a provider
   * is configured — the caller-side deadline/budget wrap is mandatory and
   * there is no unwrapped call site.
   */
  readonly budgetFacts?: () => ModelBudgetFacts;
  /** Budget application hook for charged provider-call slices. */
  readonly chargeProviderCall?: (charge: ProviderCallCharge) => void;
  /** Deterministic clock/timer ports; defaults to the real ones. */
  readonly wrapClock?: Omit<DeadlineWrapPorts, 'chargeProviderCall'>;
}

/** Fail-closed composition error: a configured provider without budget facts. */
export class AiSuggestionLaneCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSuggestionLaneCompositionError';
  }
}

/**
 * Compose the bounded AI-suggestion lane. With a provider configured, every
 * provider invocation is wrapped by the caller-side deadline/budget bound
 * derived per call from `budgetFacts`; composing a provider lane without
 * budget facts is a composition error (no unbounded call site may exist).
 */
export function createAiSuggestionLane(options: AiSuggestionLaneOptions = {}): AiSuggestionLane {
  if (options.provider !== undefined && options.budgetFacts === undefined) {
    throw new AiSuggestionLaneCompositionError(
      'a configured provider requires caller-side budget facts: the deadline/budget wrap is mandatory (T012 P2 waiver; PRD §15 GlobalSafetyBudget). Compose the lane with budgetFacts, or omit the provider for deterministic-only operation.',
    );
  }
  let adapter: AiProposalAdapter;
  if (options.provider === undefined) {
    adapter = createAiProposalAdapter();
  } else {
    const provider = options.provider;
    const budgetFacts = options.budgetFacts!;
    const ports: DeadlineWrapPorts = {
      ...(options.wrapClock ?? realDeadlineWrapPorts(() => undefined)),
      chargeProviderCall: options.chargeProviderCall ?? (() => undefined),
    };
    adapter = createAiProposalAdapter({
      provider: wrapProviderWithDeadline(provider, {
        deadlineFor: () => providerDeadlineMs(budgetFacts()),
        ports: ports,
      }),
    });
  }
  return {
    provider: adapter.provider,
    async propose(
      input: DiscoveryGapFacts & { readonly confirmation: ConfirmationFacts },
    ): Promise<SuggestionLaneOutcome> {
      const request: ProposalRequest = {
        gap: input.gapEnvelope,
        expectedGapRef: input.expectedGapRef,
        expectedContractRef: input.expectedContractRef,
        contract: input.contract,
      };
      const path = await adapter.proposeRecipe(request);
      if (path.kind !== 'PROPOSAL_ACCEPTED') {
        // Typed rejection / input rejection / typed unavailability pass
        // through verbatim. The unavailability's ASK_USER/ABORT fallback is
        // carried as an explicit decision for a surface to present — the
        // glue never auto-resolves it.
        return path;
      }
      // Suggestion ceiling: the accepted proposal is consumed ONLY as a
      // human-suggestion-equivalent candidate through the unmodified
      // deterministic confirmation planner. No authority, no bypass (C19).
      const plan = planConfirmationWorkflow({
        contract: {
          automationMode: input.confirmation.automationMode,
          selectionPolicy: { basis: input.confirmation.selectionPolicyBasis },
        },
        ...(input.confirmation.scopeScopeKey === undefined
          ? {}
          : { scopeScopeKey: input.confirmation.scopeScopeKey }),
        ambiguousMaterialMemberIds: input.confirmation.ambiguousMaterialMemberIds,
        candidateCount: input.confirmation.candidateCount,
        autoEvidenceSufficient: input.confirmation.autoEvidenceSufficient,
        ...(input.confirmation.userRequestsManualSelection === undefined
          ? {}
          : { userRequestsManualSelection: input.confirmation.userRequestsManualSelection }),
      });
      return { kind: 'PROPOSAL_ACCEPTED', proposal: path.proposal, plan: plan };
    },
  };
}
