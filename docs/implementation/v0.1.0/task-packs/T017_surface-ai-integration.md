# T017 — Surface + AI convergence integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Wire Desktop, CLI and bounded AI proposal behavior to integrated Core/Browser/Collection so all surfaces share one contract/result authority and deterministic/template-supported work remains model-independent.

## Authority / dependencies
Frozen surfaces/AI rules. Exact dependencies `T012,T013,T014,T015,T016`.

## Owned boundary
Product-surface convergence, cross-surface client behavior and AI fallback integration.

## Forbidden scope
No surface fork of Product truth; no AI authority elevation; no model requirement for ordinary deterministic tasks; no scope/authorization drift across UI vs CLI.

## Acceptance / Validation
Same contract produces compatible UI/CLI status; concurrent clients converge; browser-triggered actions project identically; AI outage/malicious proposal fails safely; HITL choices remain explicit.

## Policy
`review:required`; `risk:high`; L3 `required`; high-capability integration Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after dependencies. Any need to change shared contracts returns to owning authority. Close with cross-surface integration evidence.
