# T019 — Version candidate preparation + visible regression convergence

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Converge all implementation/package work on `version/v0.1.0`, run configured cheap/full visible regression preconditions, repair only separately authorized bounded defects, and establish one immutable exact candidate for version-level Validation.

## Authority / dependencies
Frozen Product/L2/Task DAG after future freeze. Exact dependencies `T003,T017,T018`.

## Owned boundary
Version integration/currentness, configured CI/full regression execution and candidate stabilization; no new feature scope.

## Forbidden scope
No Candidate Freeze, Hidden Validation, Closure or Release claim; no changing tests/baselines after seeing product-gate results; no unreviewed high-blast fix folded into candidate.

## Acceptance / Validation
Clean bootstrap; CI; full unit/contract/integration discovery; S1–S6 harness available; production package builds; all implementation PRs merged; exact candidate SHA/tree recorded and thereafter immutable for T020–T023.

## Policy
`review:required`; `risk:critical`; L3 `required`; high-capability integration Builder/Controller; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch. Any post-stabilization code/config change invalidates candidate and requires successor preparation/validation. Close with exact candidate identity only.
