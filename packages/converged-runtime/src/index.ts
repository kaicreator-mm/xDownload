/**
 * @xdownload/converged-runtime — T017 surface + AI convergence integration.
 *
 * The ONE convergence composition layer over the already-merged packages and
 * apps, consumed as-is through their public APIs. It is glue/wiring only: no
 * domain decision lives here — statuses, verdicts, membership identity,
 * coverage truth, continuation admission, confirmation plans, proposal
 * acceptance and validation outcomes remain owned by the consumed packages
 * and surface verbatim.
 *
 * Composition seams:
 *
 * - `providerDeadline.ts` — the mandatory caller-side provider deadline and
 *   budget wrap (T012 P2 waiver; Frozen PRD §15 GlobalSafetyBudget). Every
 *   provider invocation in the composed path is bounded; a hung provider
 *   resolves as typed MODEL_UNAVAILABLE/TIMEOUT → deterministic fallback
 *   within its bounded slice, never a hang and never a budget redefinition.
 * - `aiSuggestionLane.ts` — wires `@xdownload/ai-proposal` into the
 *   composed discovery/confirmation gap as an OPTIONAL suggestion source
 *   bound to the exact gapRef/contractRef; accepted proposals are consumed
 *   ONLY as human-suggestion-equivalent candidates through the unmodified
 *   `@xdownload/discovery-recipe` confirmation machinery. Deterministic-only
 *   mode (`provider: undefined`) is complete and first-class (C16).
 * - `surfaceBinding.ts` — the shared one-authority surface binder: CLI,
 *   DESKTOP_UI and BROWSER_EXTENSION connect through the same T004 seam
 *   client construction against the single `@xdownload/core-runtime`
 *   authority, render SeamResponse/PROJECTION verbatim, and degrade
 *   explicitly on disconnect. No surface-local truth, no per-surface
 *   command vocabulary.
 */

export * from './providerDeadline.ts';
export * from './aiSuggestionLane.ts';
export * from './surfaceBinding.ts';
