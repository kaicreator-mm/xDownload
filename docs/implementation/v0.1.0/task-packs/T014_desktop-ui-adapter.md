# T014 — Desktop UI adapter

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement primary Desktop UI as thin presentation/interaction adapter for intent entry, scope preview/confirmation, selection, progress/status, cancellation/retry and truthful result explanation.

## Authority / dependencies
Frozen Desktop Product surface + exact dependencies `T004,T007`.

## Owned boundary
Desktop presentation, interaction state that is non-authoritative, Core client wiring abstractions and UI tests.

## Forbidden scope
No UI-owned contract/snapshot/budget/result truth; no silent selection/scope change; no item-by-item confirmation when batch/manual surface resolves same ambiguity.

## Acceptance / Validation
Interaction/component tests for immutable confirmed scope, batch selection, auth/action prompts, cancellation/retry routing, partial/unknown result explanation and Core-disconnect behavior.

## Policy
`review:recommended`; `risk:medium`; L3 `recommended`; Local Builder with desktop runtime; freedom `F2_ENGINEERING_DISCRETION`.

## Merge / routing
Target version branch; JIT after dependencies. Framework choice remains bounded implementation detail. Close with UI tests, not release UX claims.
