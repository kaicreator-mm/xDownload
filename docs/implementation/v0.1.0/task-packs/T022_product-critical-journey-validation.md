# T022 — Product gates + Critical Journey Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Independently execute required S1–S6 Critical Journeys, C01–C34 counterexamples and Frozen Product gates G0/G1a/G1b/G1c; execute G2 only when AI is release-enabled.

## Dependencies / boundary
Exact dependency `T019`; T003 corpora/harness; evidence-only.

## Acceptance / Validation
Pre-register deterministic G0 baseline before Phase B; preserve common denominators, UNKNOWN/abandonment/out-of-scope truth and independent ground truth; no post-exposure baseline/rule change; verify model-unavailable ordinary path; current-page/collection and auth-limited tuples match Frozen expected outcomes. Critical wrong-target/false-success is blocking.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; independent Product Validator; freedom `F0_MECHANICAL`.

## Failure / closeout
FAIL/INSUFFICIENT_EVIDENCE is not converted to PASS; repairs require successor candidate. Close with exact corpus/baseline/candidate identities and per-gate state.
