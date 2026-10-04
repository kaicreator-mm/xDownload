# T006 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T006 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T006 JIT branch/base (`c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `4d60ae15afbc993a8b37ae0d6d7bfc850fffc36d` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.
- [ ] Dependency fact remains: T002/#21 merged (PR #52) at the manifest base.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the scheduler/control layer: control state machine, budget reservation/consumption ordering, cancellation cutoff, cancel/retry/resume transitions, dispatch suppression, duplicate convergence, lineage/idempotency semantics, and their directly necessary tests/fixtures/wiring.
- [ ] No Desktop/Browser/CLI behavior, SQLite/filesystem persistence engine, migrations, DB/filesystem reconciliation, crawler/frontier, transfer/media adapters, auth-secret broker, AI runtime or packaging implementation leaked into T006.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Implementation does not create a competing mutable authority outside the single Core-owned scheduler/budget path.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Single budget mutation path / budget semantics

- [ ] Exactly one Core-owned mutation path consumes discovery, transfer, retry and model budget; no private per-worker/surface counters exist or are constructible.
- [ ] PRD §15.4 exhaustion precedence is enforced: discovery stop ≠ frozen-target transfer stop; transfer exhaustion blocks completion claims; global safety stops everything with highest precedence.
- [ ] Retry/restart/resume/repair inherit remaining budgets and can never replenish any domain.
- [ ] Budget values/exhaustion cannot create, enlarge, narrow or reinterpret requested scope.
- [ ] User pause time is excluded from active elapsed-time counters unless a specific global wall-clock limit says otherwise.
- [ ] T002 `BudgetProfile`/`LifecycleBudget`/`BudgetRemaining` semantics are consumed, not forked.

## 4. Cancellation acceptance cutoff

- [ ] Cancel-before-accept: durable `USER_CANCELLED` committed before durable acceptance deterministically blocks all later automatic acceptance for staged/completed/validated/materialized or externally successful-but-unaccepted bytes.
- [ ] Accept-before-cancel: accepted effect identity is never retroactively revoked; only bounded materialization/finalization truth reconciliation remains available.
- [ ] The cutoff is a deterministic function of committed durable fact order for every interleaving in the cancel timing matrix, including across process death/reopen.
- [ ] Bounded reconciliation can establish truthful facts on either side of the cutoff without creating or destroying acceptance identity.
- [ ] No auto-accept path exists after authoritative cancellation.

## 5. Dispatch suppression / duplicate clients

- [ ] Durable cancellation for a still-unaccepted lineage suppresses all new discovery/transfer/retry dispatch and automatic acceptance.
- [ ] Suppression persists across process death/reopen.
- [ ] Two independent duplicate clients converge to one lineage, one effect and one accepted artifact; duplicate submit never forks a second acquisition.
- [ ] Duplicate cancel/accept control facts are idempotent and order-deterministic.

## 6. Retry/resume and effect lineage

- [ ] Commands/work/effects/attempts carry durable identities that survive restart and enable reconciliation instead of blind replay (L2 invariant 8).
- [ ] Retry/resume is an explicit authorized control transition on the same frozen Contract/SelectionSnapshot/target/effect lineage only (CJ-06).
- [ ] Retry cannot add/replace members or targets, expand scope, or bind a different Contract/Snapshot identity.
- [ ] Resume never creates a duplicate accepted effect; already-staged bytes are reused only after ordinary identity/provenance/validation rules succeed.
- [ ] Reconciliation alone never reopens acceptance processing.
- [ ] No exactly-once execution claim is made; at-least-once + idempotent acceptance semantics hold (ADR-010).

## 7. Crash-adjacent / truthful-state semantics

- [ ] Committed cancellation authority, acceptance and budget consumption survive process death/reopen.
- [ ] Uncertain/failed work is never rewritten into success by restart, retry, reconciliation or AI explanation (L2 D9; PRD §30).
- [ ] Control transitions consume canonical values through T002 decode/validation; unknown/incompatible identities fail closed.
- [ ] The durable-control-facts seam is implementable by T005/T015 without semantic reinterpretation; no persistence engine was implemented in T006.

## 8. Negative-state and oracle coverage

- [ ] All `TEST_MATRIX.yaml` required suites are executable on the exact candidate.
- [ ] T006-O01–O16 each have a durable state-machine/property fixture/oracle mapping consistent with PRD C13/C23/C28.
- [ ] Every negative-coverage entry rejects deterministically.
- [ ] Tests are deterministic, local and do not claim unexecuted browser/network/SQLite/media behavior.

## 9. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T006-specific state-machine/property tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS; version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.

## 10. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T006.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 11. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
