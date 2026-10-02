# T025 — Hidden Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Execute the authorized hidden/adversarial validation pack after Candidate Freeze on the exact frozen candidate without changing the subject.

## Dependency
Exact dependency `T024`.

## Boundary / forbidden scope
Independent Validation only; no production-code repair, no disclosure-driven test oracle mutation, no transfer of visible-gate PASS to hidden scenarios.

## Acceptance / Validation
Run hidden normal/boundary/negative scenarios with exact candidate/environment binding; preserve failure evidence; any defect routes to repair and a successor candidate/visible gates/freeze as required.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; independent Hidden Validator; freedom `F0_MECHANICAL`.

## Closeout
Durable PASS/FAIL/BLOCKED evidence bound to `CANDIDATE_FROZEN_SHA`; no Closure/Release claim.
