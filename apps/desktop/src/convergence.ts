/**
 * T017 desktop-side convergence wiring — presentation-only glue that binds
 * the desktop surface to the ONE converged authority and to the composed
 * AI-suggestion lane.
 *
 * T014 authority rules survive verbatim: no UI-derived completion, no local
 * truth, no per-item explosion of batch ambiguity, no auto-resolved
 * fallbacks. This module only
 *
 * - binds SurfaceKind 'DESKTOP_UI' through the shared `bindSurfaceToCore`
 *   (the same binder every surface uses; per-frame authorization stays the
 *   seam's decision);
 * - exposes the composed `AiSuggestionLane` for the discovery/confirmation
 *   gap path; an accepted AI suggestion renders exactly like any other
 *   candidate — with its canonical plan and its SUGGESTIVE ceiling verbatim
 *   (C19/C26/C34) — and `ASK_USER` unavailability renders as an explicit
 *   pending user decision, never auto-resolved and never collapsed into
 *   per-item prompts (C30).
 */

import {
  bindSurfaceToCore,
  degradedState,
  type AiSuggestionLane,
  type BoundSurface,
  type SuggestionLaneOutcome,
  type SurfaceBindingInput,
} from '@xdownload/converged-runtime';
import type { SeamClientTransport, SeamListenTarget } from '@xdownload/core-seam';

/** The desktop surface kind is fixed: this binding is the DESKTOP_UI peer. */
export const DESKTOP_SURFACE = 'DESKTOP_UI' as const;

export interface DesktopSurfaceBindingInput {
  readonly installId: string;
  readonly userId: string;
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  readonly makeRequestId: () => string;
  readonly now?: () => string;
}

/** Bind the desktop surface to the single Core authority (shared binder). */
export function bindDesktopSurface(input: DesktopSurfaceBindingInput): BoundSurface {
  const binding: SurfaceBindingInput = {
    surface: DESKTOP_SURFACE,
    installId: input.installId,
    userId: input.userId,
    transport: input.transport,
    target: input.target,
    makeRequestId: input.makeRequestId,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  return bindSurfaceToCore(binding);
}

/** The composed AI-suggestion lane, as consumed by the desktop surface. */
export type DesktopSuggestionLane = AiSuggestionLane;

/**
 * The desktop suggestion view: a one-way rendering of the lane outcome.
 * `PENDING_USER_DECISION` is the ONLY rendering an `ASK_USER` fallback can
 * produce — the decision itself belongs to the user through the ordinary
 * confirmation flow, never to the glue.
 */
export type DesktopSuggestionView =
  | {
      readonly view: 'SUGGESTION_PRESENTED';
      readonly proposalId: string;
      readonly providerId: string;
      readonly modelId: string;
      /** Verbatim typed ceiling: a suggestion is never independent truth (C34). */
      readonly certaintyCeiling: 'SUGGESTIVE';
      readonly recipeId: string;
      /** The canonical plan rendered verbatim; answers route as Core commands. */
      readonly plan: unknown;
    }
  | {
      readonly view: 'PENDING_USER_DECISION';
      readonly fallbackKind: 'ASK_USER';
      readonly reason: string;
      readonly detail: string;
    }
  | {
      readonly view: 'SUGGESTION_ABORTED';
      readonly fallbackKind: 'ABORT';
      readonly reason: string;
      readonly detail: string;
    }
  | {
      readonly view: 'SUGGESTION_REJECTED';
      readonly diagnostics: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };

/** Render one lane outcome as the desktop view — verbatim, no derivation. */
export function desktopSuggestionView(outcome: SuggestionLaneOutcome): DesktopSuggestionView {
  if (outcome.kind === 'PROPOSAL_ACCEPTED') {
    return {
      view: 'SUGGESTION_PRESENTED',
      proposalId: outcome.proposal.proposalId,
      providerId: outcome.proposal.provider.providerId,
      modelId: outcome.proposal.provider.modelId,
      certaintyCeiling: outcome.proposal.certaintyCeiling,
      recipeId: outcome.proposal.recipe.recipeId,
      plan: outcome.plan,
    };
  }
  if (outcome.kind === 'MODEL_UNAVAILABLE') {
    // ASK_USER is an explicit pending decision, never auto-resolved;
    // ABORT is the truthful typed non-completion.
    return outcome.fallback.kind === 'ASK_USER'
      ? {
          view: 'PENDING_USER_DECISION',
          fallbackKind: 'ASK_USER',
          reason: outcome.reason,
          detail: outcome.detail,
        }
      : {
          view: 'SUGGESTION_ABORTED',
          fallbackKind: 'ABORT',
          reason: outcome.reason,
          detail: outcome.detail,
        };
  }
  return { view: 'SUGGESTION_REJECTED', diagnostics: [...outcome.diagnostics] };
}

/** Explicit degraded display state for a failed read (no fabricated progress). */
export function desktopDegraded(error: unknown): {
  readonly degraded: true;
  readonly detail: string;
} {
  return degradedState(error);
}
