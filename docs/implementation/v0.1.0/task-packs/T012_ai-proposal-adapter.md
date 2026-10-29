# T012 — Bounded AI proposal adapter

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement optional model-provider adapter receiving only redacted bounded knowledge gaps/observations and returning schema-constrained Recipe proposals validated by deterministic Core policy.

## Authority / dependencies
Frozen Minimum Necessary Intelligence + L2 ADR-008; exact dependencies `T007,T011`.

## Owned boundary
Provider abstraction, redaction, proposal schema, proposal validation/rejection and no-model fallback.

## Forbidden scope
AI cannot mutate confirmed scope, grant navigation/auth, execute shell/JS, persist/export secrets, certify validation/coverage or become required for deterministic/template-supported ordinary tasks.

## Acceptance / Validation
Malicious/oversized/invalid proposal rejection, secret sentinel tests, provider outage/timeouts, deterministic fallback, same policy with/without model and no hidden authority elevation.

## Policy
`review:required`; `risk:high`; L3 `required`; strong-model/local Builder pair; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after both dependencies. Model unreliability must degrade truthfully, not widen behavior. Close with provider-offline and redaction evidence.
