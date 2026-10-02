# T018 — Packaging and platform integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Create production build/package integration for the actually selected v0.1.0 runtime/shell/browser tuple(s), including Desktop/CLI/Core artifacts, extension/native-host registration, package layout and exclusion of development Execution Pack material.

## Authority / dependency
Frozen L2 says platform/runtime/framework/IPC matrix is replaceable until downstream evidence. Exact dependency `T017`.

## Owned boundary
Production build/packaging/install wiring, platform-specific native-host registration and package manifest/content rules.

## Forbidden scope
No broad OS/browser promise from research evidence; no silent security weakening for packaging; no `.agent/execution` leakage into shipped package; no updater/signing claim unless actually configured/validated.

## Acceptance / Validation
Production package/build smoke on each candidate tuple, clean install/launch/Core reachability/native-host registration where applicable, package-content audit and explicit support/NOT_PROVEN matrix.

## Policy
`review:required`; `risk:high`; L3 `required`; real platform Build Host; freedom `F2_ENGINEERING_DISCRETION`.

## Merge / routing
Target version branch; JIT after T017. Platform blocker is BLOCKED, not invented PASS. Close with package identities and claimed tuples.
