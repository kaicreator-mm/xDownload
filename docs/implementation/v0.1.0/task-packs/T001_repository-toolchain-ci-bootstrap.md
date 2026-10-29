# T001 — Repository/toolchain bootstrap + CI activation

Status: `CANDIDATE / NOT FROZEN`  
Target version: `v0.1.0`

## Goal
Establish a production monorepo workspace, concrete implementation toolchain/runtime choices needed to build/test, required commands and active minimal CI without changing Frozen Product/Architecture semantics.

## Frozen inputs / authority
ADS `4.0.0@94cad2b...`; Frozen Product/Scope + PRD v0.4.2; Frozen Architecture + L2; this Task Pack after later DAG Freeze.

## Dependencies
`NONE`. This is the bootstrap root.

## Owned boundary / allowed write set
Repository/workspace/toolchain/build/CI/bootstrap configuration and directly necessary smoke tests/documentation.

## Forbidden scope
No Product/L2 changes; no feature implementation; no broad platform support claim; do not turn a tooling choice into new Product authority.

## Inputs / outputs
Output: runnable workspace, bootstrap/build/test commands, CI profile/config and recorded concrete runtime/build choices bounded by L2 replaceability.

## Acceptance / gates / Validation
Clean checkout bootstrap succeeds; format/lint/typecheck/unit smoke can run; CI executes current exact task candidate; required commands are durable. Task validation owns only tooling truth, not product Validation.

## Review / risk / L3 / executor
`review:required`; `risk:high`; L3 `required`; preferred executor: Local Builder on real build host with strong-model guidance; freedom `F2_ENGINEERING_DISCRETION`.

## Merge / routing / closeout
Target `version/v0.1.0`; JIT branch only after future materialization/current base. Architecture-changing need → amendment; unavailable toolchain/host → BLOCKED. Close with exact toolchain/CI identities and limitations; no release claim.
