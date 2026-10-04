# T005 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T005 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T005 JIT branch/base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `09571c7f917dfade91dd8cd0e784d5832f42203f` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the persistence/data-integrity/recovery concern: SQLite adapter, migrations, filesystem artifact store, recovery/reconciliation, one authoritative writer path, and directly necessary workspace/test wiring.
- [ ] No Desktop/Browser/CLI behavior, crawler/frontier, transfer/media adapter, scheduler/cancellation control semantics (T006), auth-secret broker, AI runtime or packaging implementation leaked into T005.
- [ ] No PostgreSQL/server backend or remote-service expansion was introduced; a state-repository boundary is preserved (L2 Decision Matrix DEFER disposition).
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] T002 canonical contracts (`packages/domain-contracts/`) are consumed, not redefined, forked or duplicated.
- [ ] Any new runtime dependency (SQLite/filesystem driver) is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Schema / migration compatibility

- [ ] Production schema carries an explicit durable version identity.
- [ ] Fresh install creates the current schema deterministically.
- [ ] Forward migrations preserve authoritative rows, durable identities and lifecycle-state distinctions.
- [ ] Backward migration behavior matches exactly the as-designed rollback contract; migrations never mutate historical identity.
- [ ] Unknown/incompatible schema versions fail closed on reopen; no silent defaulting, downgrade or reinterpretation.
- [ ] Migration tests execute against real database files.

## 4. Lineage / ledger semantics

- [ ] Command/work/effect/artifact/attempt identities are durable and stable across restart/retry.
- [ ] Staged, materialized, finalized and accepted remain distinct durable states with explicit transitions.
- [ ] Exactly one authoritative writer path exists; no surface/adapter private writer.
- [ ] Budget reservation/consumption is transactional with lifecycle transitions and survives restart without replenishment or double consumption.
- [ ] Durable transition-order facts are persisted so restart/adapter arrival cannot redefine dispatch/acceptance/cancellation order.
- [ ] Idempotency identity prevents duplicate submits from creating duplicate lineages/effects.

## 5. Artifact store / digest-provenance binding

- [ ] Downloaded bytes live in the filesystem artifact store; DB binds files to durable effect/artifact records.
- [ ] Digest/provenance binding exists before acceptance; accepted artifacts always have validation-passing, digest-bound bytes.
- [ ] Missing, unmaterialized or digest-mismatched/corrupt bytes never become success in any projection path.
- [ ] Content/digest identity does not collapse distinct logical member/effect/artifact identities.
- [ ] Stored authorization context remains opaque (`AuthorizationContextRef`-style); no raw reusable secrets as ordinary state.

## 6. Recovery / reconciliation / cancellation cutoff semantics

- [ ] Recovery classifications are deterministic functions of durable facts (candidate classes per L2 §11; exact names are downstream detail).
- [ ] DB-first recovery: `accepted` DB state with missing bytes never projects success.
- [ ] FS-first recovery: staged/finalized bytes without prior durable acceptance are never auto-accepted (SUCCEEDED_UNACCEPTED-equivalent preserved).
- [ ] Durable cancel-before-accept blocks all automatic later acceptance; unaccepted post-cancel bytes stay unaccepted/quarantined-or-cleanup-eligible.
- [ ] Accept-before-cancel is not retroactively revoked; only bounded reconciliation follows.
- [ ] Explicit retry/resume reopens the same frozen lineage with inherited remaining budgets and may reuse valid staged bytes without a duplicate external effect.
- [ ] New dispatch/budget allocation is suppressed for cancellation-authoritative lineages.
- [ ] Recovery records distinguish transactional DB state from filesystem staging/materialization/finalization.

## 7. Negative-state and oracle coverage

- [ ] Malformed ledger fields, unknown state enums, unsupported/incompatible schema versions and duplicate-effect-conflicting-payload inputs reject.
- [ ] Forbidden outcomes are tested as negatives: DB-only success, automatic acceptance after cancel, retroactive revocation, budget replenishment/double-consumption, duplicate accepted effects, corrupt-bytes success, second writer, migration identity mutation, raw-secret persistence.
- [ ] R01–R12 each have a durable fixture/oracle mapping and executable coverage appropriate to T005.
- [ ] PRD cross-references C12/C13/C18 are covered at the persistence layer.
- [ ] Required suites run against a real SQLite file and real filesystem on the local host; no in-memory DB or mocked store substitutes for a required suite.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] Real process-kill/restart tests executed on the exact candidate; the exercised host OS tuple is recorded and claims are bounded to it.
- [ ] No exactly-once or host-power-loss claim appears in code, schema, logs, docs or test names.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS and from T015 convergence and T020–T023 version-level Validation.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T005.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence; broader durability remains unproven per the Frozen Task Pack.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
