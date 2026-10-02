# T024 — Candidate Freeze gate

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Record Candidate Freeze only when every mandatory visible gate from T020–T023 is current and PASS on one exact immutable candidate SHA/tree/ref.

## Dependencies
Exact dependencies `T020,T021,T022,T023`.

## Boundary / forbidden scope
Controller/currentness reduction only. No implementation, no rerunning hidden validation early, no mixing evidence from different SHAs, no Release PASS.

## Acceptance
Re-read current version candidate and all visible validation identities; verify required S1–S6/CJ/G0/G1/security/recovery/package gates; record the freeze only when same-subject conditions hold. The freeze record preserves at least `candidate_sha`, `candidate_tree`, `candidate_ref`, visible-closure evidence references, pinned ADS standard version + revision, `frozen_at`, and actor/operator identity. Before T025 Hidden Validation starts, the declared candidate ref SHA/tree MUST be re-read and match the freeze record. Otherwise report truthful FAIL/BLOCKED/NOT_RUN rather than freezing.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; high-capability ChatGPT Web/Controller; freedom `F0_MECHANICAL`.

## Closeout
Output the complete freeze checkpoint/evidence pointer only. Any source/config/docs/workflow mutation that changes the declared candidate after freeze invalidates the downstream hidden/closure path and requires explicit thaw/invalidate/successor candidate processing.
