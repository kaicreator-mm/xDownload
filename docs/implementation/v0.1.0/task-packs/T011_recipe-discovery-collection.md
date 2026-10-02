# T011 — Recipe/discovery engine + bounded collection semantics

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement declarative Recipe matching/interpreter with finite capabilities, deterministic policy/scope validation, current-page confirmed membership snapshot, explicit bounded continuation, S6 membership/navigation and HITL confirmation.

## Authority / dependency
Frozen collection grammar/S5/S6 + L2 ADR-007; exact dependency `T002`.

## Owned boundary
Recipe schema/interpreter, bounded discovery orchestration, collection/member identity, continuation admission and selection/confirmation workflow logic.

## Forbidden scope
No arbitrary shell/JS/filesystem/cookie export, no recursive frontier/general crawl, no budget-as-scope, no silent candidate replacement or post-confirmation membership growth.

## Acceptance / Validation
Fixtures cover `continuation_scope=NONE`, declared batch/page/natural-end bounds, successor contract/snapshot, page loops/failures, member detail/CDN provenance, identity-not-count completeness, crawler rejection and batch/manual confirmation.

## Policy
`review:required`; `risk:high`; L3 `required`; high-capability Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. New capability requiring broader authority → architecture review. Close with S5/S6 fixture evidence.
