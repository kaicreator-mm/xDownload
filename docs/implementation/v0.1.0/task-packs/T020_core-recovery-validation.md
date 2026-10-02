# T020 — Core crash/restart/data-integrity Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Independently validate the exact T019 candidate for real SQLite/filesystem crash/restart, recovery, idempotency, non-replenishing budgets, cancellation cutoff and artifact integrity.

## Dependencies / boundary
Exact dependency `T019`. Validation/evidence only; production code repair is forbidden in this task.

## Inputs / outputs
Input exact candidate SHA + T003 harness + Frozen Product/L2. Output exact-subject PASS/FAIL/BLOCKED evidence and limitations.

## Acceptance / Validation
Execute process-kill/restart windows, DB/FS-first reconciliation, duplicate clients, cancel-before/after-accept matrix, explicit retry/resume, missing/corrupt bytes and no duplicate accepted effect. Do not upgrade to host-power-loss proof unless actually authorized/tested.

## Policy
`review:not-required` because this task is itself independent exact-subject Validation; `risk:critical`; L3 `not-required`; independent real-host Validator; freedom `F0_MECHANICAL`.

## Merge / routing
No implementation branch. Failure creates bounded repair + successor candidate Validation; stale SHA means NOT_RUN/blocked, never transferred PASS. Close with exact evidence identity.
