# T013 Review Checklist

Policy: `review:recommended` (frozen; not recalculated)  
Risk: `risk:medium` (frozen; not recalculated)  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T013 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T013 JIT branch/base (`f5ac137f94438a591fd6781c5b758be6c375233a`) or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `b8f335d09b4a0aa4608fb755b6a1745e1ace29c0` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the CLI surface: parsing/presentation/client behavior and CLI-specific tests/docs, plus narrowly necessary workspace/test wiring.
- [ ] No private lifecycle store, scheduler, budget, selection or result semantics; no persistence/discovery/transfer/media/browser/Desktop implementation leaked into T013.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Any new CLI runtime dependency is an F2 choice only, with exact package/version/license/provenance recorded.
- [ ] `.agent/execution/T013/` remains evidence only and is not treated as product source.

## 3. Seam consumption correctness (T004/T007 contracts)

- [ ] All command submission and status reads go through `@xdownload/core-seam` (`createSeamClient`); no second client/transport/authority channel exists.
- [ ] Command/query discriminants come from the closed v1 vocabulary (`SUBMIT_CONTRACT`, `CONFIRM_SNAPSHOT`, `CANCEL_LINEAGE`, `RETRY_FAILED_MEMBERS`, `PROJECT_TERMINAL_RESULT`; `READ_PROJECTION`); no CLI-invented command types.
- [ ] The CLI presents `SurfaceKind 'CLI'` peer identity; authorization remains per-frame seam behavior, never CLI-local admission.
- [ ] Reconnection re-submits with the SAME idempotent `requestId`; no new identity on retry/reconnect.
- [ ] Unsupported/incompatible seam schema versions fail closed in the CLI presentation (no silent reinterpretation).
- [ ] Payloads are built/decoded via `@xdownload/domain-contracts` canonical vocabulary; seam ids never substitute for domain identity.

## 4. Machine-readable output / PRD §27 fidelity

- [ ] Golden output carries the exact PRD §27 required field set; values are projected verbatim from `READ_PROJECTION` views.
- [ ] Submit acceptance is exposed separately from the final acquisition result; submit exit success does not imply final task success.
- [ ] Wait-mode final exit semantics reflect the final request/selection result.
- [ ] Absent projection fields render absent/unknown; no invented or locally derived status values.
- [ ] Verified-empty scope renders as no-match truthfully, never as download success.

## 5. Non-interactive / bounded behavior

- [ ] Non-interactive mode never blocks indefinitely on confirmation.
- [ ] Confirmation-required cases return a bounded machine-readable `NEEDS_USER_ACTION` state.
- [ ] Non-interactive errors (malformed input, unknown flag/command, missing target) are typed and deterministic.
- [ ] Resolved scope is displayed before acquisition starts.

## 6. Cancel/retry routing and batch input

- [ ] Cancellation and retry route as seam commands through the same Core transition as Desktop/Browser; no surface-local precedence.
- [ ] Retry cannot add replacement/new members; membership authority stays Core-side.
- [ ] Batch input preserves per-item identity/correlation; partial failure is reportable per item without result merging.
- [ ] Batch/defaults cannot enlarge requested scope, add continuation authority, or alter budget/authorization semantics.

## 7. Exit codes / diagnostics projection

- [ ] A stable, documented exit-code table exists; `REJECTED` and non-success terminal outcomes never exit as success.
- [ ] `SeamDiagnostic`/`ValidationDiagnostic` codes/messages are projected verbatim (or with a stable, lossless documented mapping) — never swallowed or reworded into success.
- [ ] Declared `SEAM_MESSAGE_LIMITS` violations (oversized batch item, oversized envelope) surface as typed errors.

## 8. Headless operation and lifecycle boundary

- [ ] Every CLI function operates without Desktop UI running.
- [ ] The CLI never owns Core start/stop as an authority prerequisite and never caches authoritative state as a side channel.

## 9. Negative-state and oracle coverage

- [ ] Required suites from `TEST_MATRIX.yaml` are executable on the exact candidate: golden output, acceptance-vs-result, non-interactive bounded behavior, batch, cancel/retry routing, status parity, headless, no-private-authority.
- [ ] Applicable C-oracle surface renderings (C02, C05, C10, C12, C13, C14, C15, C16, C17, C23, C24, C26, C27, C32) are covered as CLI rendering/routing cases without re-deriving Core truth.
- [ ] Negative cases (including unsupported seam version, peer-unauthorized, oversized input, missing projection fields, defaults-cannot-widen-scope) reject/stay non-success.
- [ ] Tests are deterministic, local (in-process seam server + loopback transport is acceptable) and claim no unexecuted browser/network/persistence/media behavior.

## 10. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T013-specific concern tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Review disposition; version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.

## 11. Review disposition

Per the frozen `review:recommended` policy, Recommended Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
