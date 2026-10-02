# T006 — Scheduler, lifecycle budgets, cancellation and retry

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement the single Core-owned scheduler and budget mutation path, durable cancellation-vs-acceptance cutoff, idempotent work/effect lineage, duplicate-submit convergence and explicit retry/resume using remaining budgets.

## Authority / dependency
Frozen Product budget rules + L2 ADR-010/013; exact dependency `T002`.

## Owned boundary
Scheduling/control state machine, reservations/consumption, cancel/retry transitions and dispatch suppression.

## Forbidden scope
No private per-worker/surface budget counters; no restart replenishment; no auto-accept after authoritative cancel; no new member/target on retry; no multi-host/distributed claims.

## Acceptance / Validation
Property/state-machine tests cover cancel timing matrix, duplicate clients, budget exhaustion precedence, crash-adjacent durable facts, no new dispatch after cancellation and explicit resume without duplicate acceptance.

## Policy
`review:required`; `risk:critical`; L3 `required`; high-capability local Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Semantic conflict with persistence/recovery routes to planning/architecture, not parallel redefinition. Close with deterministic transition evidence.
