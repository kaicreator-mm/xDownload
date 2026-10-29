# T023 — Package/platform qualification Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Independently validate production package/build/install/launch/native-host registration on each concrete release-claimed platform/browser tuple and record unsupported/unproven tuples explicitly.

## Dependencies / boundary
Exact dependency `T019`; exact candidate/package evidence only; no in-place repair.

## Acceptance / Validation
Clean-machine/install context where applicable; package integrity/content; Desktop/CLI/Core launch/reachability; browser native-host registration; extension/package wiring; uninstall/cleanup if product packaging defines it; `.agent/execution` and secrets absent from shipped artifacts.

## Policy
`review:not-required`; `risk:high`; L3 `not-required`; independent Platform Validator; freedom `F0_MECHANICAL`.

## Failure / closeout
Unavailable required host is BLOCKED. Do not infer Windows/macOS/Firefox/Safari support from research evidence. Close with candidate/package hashes, exact environment tuples and gate states.
