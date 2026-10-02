# T027 — Release Qualification

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Apply ADS Release Qualification to the exact closed candidate and emit the canonical Release Qualification verdict without conflating it with generic Gate PASS or Version Closure.

## Dependency
Exact dependency `T026`.

## Boundary / forbidden scope
Release decision authority only; no new implementation, no inventing missing gate evidence, no converting BLOCKED/NOT_RUN to PASS, and no renaming the canonical release verdicts.

## Acceptance
Verify Version Closure identity, mandatory gates, S1–S6/product gate/security/recovery/package evidence, support matrix, release notes/known limitations when required, and unresolved blockers. Return exactly one canonical Release Qualification verdict: `READY|CONDITIONAL|BLOCKED|FAIL`.

- `READY`: all frozen mandatory blockers are resolved, required gates PASS, implementation/docs/architecture are reconciled, and no undeclared scope gap remains.
- `CONDITIONAL`: all mandatory gates pass, but an appropriate authority explicitly accepts a documented non-blocking limitation with impact and follow-up. `CONDITIONAL` is a first-class release verdict and MUST NOT be aliased to PASS or collapsed into `READY`/`BLOCKED`.
- `BLOCKED`: a release blocker remains, a mandatory gate is BLOCKED/NOT_RUN, candidate identity is not trustworthy, or scope/authority is unresolved.
- `FAIL`: a mandatory gate executed and failed, with no newer valid candidate evidence superseding it.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; high-capability Release Controller; freedom `F0_MECHANICAL`.

## Closeout
Bind the Release Qualification verdict to exact candidate/package identities and supporting/unsatisfied facts. Only canonical `READY` authorizes T028 repository integration under the pinned Release Standard. A Version Closure PASS is an input to this decision, not the Release Qualification verdict, and this verdict is not retroactive evidence for task/PR gates.
