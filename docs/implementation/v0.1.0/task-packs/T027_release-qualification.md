# T027 — Release Qualification

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Apply ADS Release Qualification to the exact closed candidate. PASS only when every Frozen mandatory gate is PASS and no release blocker remains.

## Dependency
Exact dependency `T026`.

## Boundary / forbidden scope
Release decision authority only; no new implementation, no inventing missing gate evidence, no converting BLOCKED/NOT_RUN to PASS.

## Acceptance
Verify Closure identity, mandatory gates, S1–S6/product gate/security/recovery/package evidence, support matrix, release notes/known limitations when required and absence of unresolved blocker. Return exactly PASS/FAIL/BLOCKED.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; high-capability Release Controller; freedom `F0_MECHANICAL`.

## Closeout
Bind qualification to exact candidate/package identities. Release Qualification PASS authorizes only the downstream integration/release path defined by authority; it is not retroactive evidence for task PRs.
