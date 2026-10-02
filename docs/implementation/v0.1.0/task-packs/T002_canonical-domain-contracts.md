# T002 — Canonical domain contracts, schemas and semantic kernel

Status: `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement one Core-owned versioned contract/schema layer for AcquisitionContract, SelectionSnapshot, logical target/member/effect identities, immutable requested/continuation scope, budget domains, typed Evidence/Validation/Result identities and stable adapter ports.

## Authority / dependencies
Frozen PRD/L2 + ADS pin. Exact dependency: `T001` because executable schemas/tests require the established workspace.

## Owned boundary
Canonical domain/public schema packages, pure semantic rules, compatibility/negative fixtures. Shared mutable authority belongs here; later lanes consume it.

## Forbidden scope
No surface-specific truth, persistence implementation, crawler API, raw-secret fields, arbitrary Recipe code or Product/L2 redesign.

## Outputs / acceptance
Versioned contracts and ports; successor-contract/snapshot rules; logical-target vs locator separation; canonical S1–S6 types. Schema/contract tests reject invalid states, budget-as-scope, silent membership drift and incompatible status combinations; C01–C34 contract-level oracles are represented.

## Gates / policy
Task-owned schema/contract Validation. `review:required` (public API/schema); `risk:critical`; L3 `required`; preferred high-capability Builder + local tests; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / failure / closeout
Target `version/v0.1.0`; JIT branch after T001 merged/current base. Contract contradiction → `TASK_PACK_DEFECT` or Architecture Amendment, never executor redesign. Close with exact schema/test identity; Task PASS != Release PASS.
