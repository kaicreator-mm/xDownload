# T024 — Candidate Freeze gate

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Record Candidate Freeze only when every mandatory visible gate from T020–T023 is current and PASS on one exact immutable candidate SHA.

## Dependencies
Exact dependencies `T020,T021,T022,T023`.

## Boundary / forbidden scope
Controller/currentness reduction only. No implementation, no rerunning hidden validation early, no mixing evidence from different SHAs, no Release PASS.

## Acceptance
Re-read current version candidate and all visible validation identities; verify required S1–S6/CJ/G0/G1/security/recovery/package gates; record `CANDIDATE_FROZEN_SHA` only when same-subject conditions hold. Otherwise truthful FAIL/BLOCKED/NOT_RUN.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; high-capability ChatGPT Web/Controller; freedom `F0_MECHANICAL`.

## Closeout
Output freeze checkpoint/evidence pointer only. Any source/config mutation after freeze invalidates downstream hidden/closure path and requires successor candidate processing.
