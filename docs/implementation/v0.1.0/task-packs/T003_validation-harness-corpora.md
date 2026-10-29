# T003 — Validation harness, corpora and gate instrumentation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Create reusable version-validation harnesses/corpora for S1–S6, C01–C34, G0/G1 measurement protocol, Critical Journeys and exact-subject evidence capture without claiming any gate PASS.

## Authority / dependencies
Frozen PRD/L2/ADS; exact dependency `T002` because fixtures/oracles must bind canonical identities/results.

## Owned boundary
Version validation infrastructure, deterministic corpora/controlled servers/fixtures, baseline-plan registration, denominator/UNKNOWN/abandonment accounting and evidence formatting. Task-local tests remain owned by each implementation task.

## Forbidden scope
No favorable post-hoc baseline selection, no self-generated truth from UI/discovery output, no Product gate PASS claim, no production feature changes.

## Acceptance / Validation
Harness self-tests prove corpus identity, pre-registration immutability, common denominator rules, evidence exact-subject binding and expected C01–C34 oracle loading. G0/G1 are runnable later but remain NOT_RUN here.

## Policy
`review:required`; `risk:high`; L3 `required`; executor local validation-engineering Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Oracle/Product ambiguity routes upward rather than being guessed. Close with harness/corpus identities only.
