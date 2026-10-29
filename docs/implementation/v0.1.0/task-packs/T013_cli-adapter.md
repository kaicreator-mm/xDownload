# T013 — CLI adapter

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement first-class CLI direct/batch submission and machine-readable status as a thin adapter over shared command/query/result contracts.

## Authority / dependencies
Frozen CLI surface + exact dependencies `T004,T007`.

## Owned boundary
CLI parsing/presentation/client behavior and CLI-specific tests/docs.

## Forbidden scope
No private lifecycle store, scheduler, budget, selection or result semantics; no Desktop dependency for CLI lifetime; no hidden scope broadening in defaults.

## Acceptance / Validation
Golden machine-readable output, stable exit/error behavior, batch input, cancel/retry routing, status parity with Core and headless operation.

## Policy
`review:recommended`; `risk:medium`; L3 `recommended`; Local Builder; freedom `F2_ENGINEERING_DISCRETION`.

## Merge / routing
Target version branch; JIT after dependencies. Contract mismatch routes to T004/T007 owner, not CLI fork. Close with CLI contract tests.
