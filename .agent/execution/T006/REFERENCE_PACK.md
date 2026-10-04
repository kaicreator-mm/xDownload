# T006 L3 Reference Pack — scheduler, lifecycle budgets, cancellation and retry

Task: `T006` / Issue `#25`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a new runtime dependency or redefine control semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

T006's acceptance is state-machine/property shaped. Model every concern as a deterministic transition system and drive it with explicit scenario tables before reaching for any new property-testing dependency.

**Patterns to emulate:**

- one explicit scenario table cell per cancel-timing-matrix interleaving (cancel-before-accept, accept-before-cancel, both orders across restart), each with its expected cutoff outcome;
- exhaustive transition-legality tables: every (state, event) pair is either an asserted transition or an asserted rejection — no "unexpected success" gaps;
- restart simulation by serializing committed control facts, dropping the in-memory machine, rebuilding from facts and re-checking suppression/cutoff/remaining-budget invariants;
- duplicate-client tests: two concurrent submissions/cancels/accepts against one lineage, asserting convergence to one lineage/effect/artifact and order-deterministic outcomes;
- remaining-budget accounting assertions after every restart/retry/resume path (equal to pre-event remaining, never greater);
- monotonicity/scarcity invariants as generated tables: consumption never increases remaining; total consumption never exceeds profile limits; scope/membership sets never change under budget events;
- oracle-tagged cases T006-O01–O16 with the scenario named in the test identity so Review can map evidence 1:1.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`. License fact: MIT at that tag; already selected by T001, T006 does not introduce it.

### 1.2 Property-style invariants without adding a property-test dependency

High-ROI invariant families are exercisable with deterministic generated tables on existing Vitest:

- for any fact order, cutoff(cancel, accept) == cutoff(serialize(facts)) — order determinism;
- for any budget event sequence with restarts, remaining budgets are non-increasing within a lifecycle;
- for any retry/resume transition, the reachable member/target identity set is a subset of the frozen snapshot's;
- for any number of duplicate submits of the same work, the accepted-artifact count is exactly one;
- for any interleaving of duplicate cancel/accept commits, no state exists where acceptance appears after authoritative cancellation;
- replay of any already-recorded effect attempt changes no authoritative state (idempotency).

A Builder may later justify a property-testing framework under F1, but it is not required by this pack and none is pinned here.

## 2. Contract / interface references

### 2.1 T002 canonical vocabulary is the only identity source

`packages/domain-contracts` (PR #52) provides the frozen identity/type vocabulary this layer composes:

- `ContractId`, `SnapshotId`, `LogicalTargetId`, `MemberId`, `EffectId`, `AuthorizationContextRef` (branded, `packages/domain-contracts/src/ids.ts`);
- `DiscoveryBudget` / `TransferBudget` / `GlobalSafetyBudget` / `BudgetProfile` / `ConsumedBudget` / `BudgetRemaining` (`src/budget.ts`) — constraints only, never scope;
- `DomainGateway` (`src/ports.ts`) as the only seam surfaces/adapters use;
- `TerminalResult` + legal-combination semantics (`src/result.ts`).

T006 control types (lineage state, control transitions, durable control facts, cutoff decisions) reference these identities; they must not re-declare parallel identity types or bypass decode at the seam.

### 2.2 State-machine encoding patterns

Any of these encodings is acceptable under F1 provided transitions stay total, explicit and deterministic:

- explicit typed transition table: `(State, ControlEvent) → Transition | Rejection`, with rejections carrying typed reasons tied to FAILURE_MATRIX classifications;
- reducer over durable facts: `apply(facts) → control state` such that the same fact multiset always yields the same state (this is what makes the crash-adjacent suite provable);
- pure cutoff predicate: `cutoff(cancelCommitOrder, acceptCommitOrder) → BLOCK_ACCEPTANCE | ACCEPTANCE_STANDS` as a standalone function the state machine calls — keeping it pure makes the timing matrix table-testable without simulating concurrency.

### 2.3 Durable-control-facts seam

Define the minimal append/observe seam T005/T015 can implement without reinterpretation, e.g. (names are F1 choices):

- `lineageSubmitted` (contract/snapshot/effect identity binding),
- `budgetReserved` / `budgetConsumed` (domain, amount, remaining),
- `cancelAuthorityCommitted` (`USER_CANCELLED`, lineage),
- `acceptanceCommitted` (effect identity, lineage),
- each carrying durable IDs and commit-ordering identity.

Facts are the authority; the in-memory machine is derivable state. Tests must be able to serialize facts, rebuild, and observe identical decisions.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Facts decide, machines derive

Keep all decisions functions of committed durable facts, never of in-flight memory. The cancellation cutoff (L2 invariant 20 / ADR-013) then becomes an ordering predicate over two committed facts, and suppression/reconciliation-after-restart falls out of re-derivation instead of special-case code.

### 3.2 One mutation path as a type-level fact

Make the budget ledger the only code shape that can record consumption: single entry point, serialized ordering, and typed remaining-budget results. Design so a second counter is not merely forbidden by review but unrepresentable (e.g. consumption records are only constructible by the authoritative path).

### 3.3 Suppression as state, reconciliation as capability

Suppressing new dispatch is a state property of the lineage after authoritative cancel; bounded reconciliation (determining truthful pre-existing facts, preserving/quarantining/cleaning bytes) remains an allowed capability. Model them as separate concerns so suppression never accidentally blocks truthful reconciliation and reconciliation never accidentally reopens acceptance.

### 3.4 Duplicate convergence by identity, not by locking heuristics

Convergence keys are the durable lineage/effect identities. Duplicate submit looks up by identity and attaches; it never creates a sibling lineage. This holds under UI+CLI+restart concurrency (PRD C13 tuple) without distributed claims.

### 3.5 Retry/resume as explicit authorized transition

Retry/resume is a control transition with an authorizing identity on the same frozen lineage. Reconciliation, recovery and restart are not resume. If a fact pattern looks like "work should continue", the only path is an explicit resume transition — the machine must not infer one.

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Illegal transitions and budget violations

- every illegal `(state, event)` yields a typed rejection tied to a `FAILURE_MATRIX.yaml` classification, never a silent no-op or nearest-legal coercion;
- second-path consumption, replenishment, budget-as-scope, duplicate lineage fork, retry membership drift all reject deterministically;
- cancellation cutoff violations are structurally impossible to satisfy, not merely warned.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict (e.g. pressure toward per-surface schedulers or a weaker cutoff) → `ARCHITECTURE_CONTRADICTION`
- control seam cannot avoid redefining T005/T015 persistence semantics → `PERSISTENCE_SEMANTIC_CONFLICT`, routed to planning/architecture per the Frozen Task Pack Merge/routing rule
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T006 acceptance

| Acceptance concern | Frozen authority | Required T006 proof |
| --- | --- | --- |
| Single Core-owned scheduler/budget mutation | L2 invariants 1/7; TASK_DAG T006 line | one path; second-path rejection; serialized concurrent consumption |
| Budget domains + exhaustion precedence | PRD §15/§15.4 | discovery/transfer/global-safety precedence; frozen-target transfer continues under discovery exhaustion; global stop |
| No replenishment | PRD §15 preamble; L2 D9/invariant 8 | remaining budgets identical across restart/retry/resume/repair |
| Scope is not budget | L2 invariant 3; PRD §15.4 | budget stop yields budget-truthful stop reasons, never scope/coverage completion |
| Cancellation acceptance cutoff | L2 invariant 20 / ADR-013 | full cancel timing matrix deterministic, incl. across process death/reopen |
| Dispatch suppression after cancel | L2 cancellation semantics | no new dispatch; reconciliation still permitted; survives restart |
| Duplicate client convergence | L2 Research Demo #7 tuple; PRD C13 | two clients → one lineage, one effect, one accepted artifact |
| Retry/resume | PRD CJ-06; L2 retry/resume rules | same frozen lineage only; no new member/target; remaining budgets; no duplicate acceptance |
| Effect lineage/idempotency | L2 invariant 8 / ADR-010 | durable IDs; replay reconciles; no exactly-once claim |
| Crash-adjacent durable facts | L2 D9 | committed facts survive death/reopen; no success rewriting |

## 6. Dependency/version/license facts

### Already pinned and recommended for T006 use

| Package | Exact version on bound base | License | T006 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict control-state/transition typing, exhaustiveness |
| `vitest` | `4.1.11` | MIT | executable state-machine/property-table/negative tests |

Sources: root `package.json` on exact base; upstream exact-tag license files in `microsoft/TypeScript@v5.9.3` and `vitest-dev/vitest@v4.1.11`.

### New runtime dependency

**None is recommended or pinned by this Reference Pack.** The exact base has no runtime dependencies. Under `F1_BOUNDED_IMPLEMENTATION` the Builder may implement bounded deterministic control logic in-package or add one narrowly justified runtime dependency. If adding a package, the implementation evidence must record exact package name/version/license and primary source, and Review must check the library does not become de facto Product/Architecture authority. No database/SQLite dependency belongs in T006 (that is T005's material choice).

## 7. Do / Don't

### Do

- derive all control state from committed durable facts; make decisions reproducible from a fact log;
- keep the cutoff a pure ordering predicate and table-test every interleaving;
- route all budget consumption through one serialized authoritative path;
- treat suppression and bounded reconciliation as separately representable concerns;
- converge duplicates by durable identity;
- make retry/resume an explicit authorized transition and reconciliation never-resuming;
- reject illegal transitions with typed, matrix-linked reasons;
- consume T002 canonical identities/validators at the seam.

### Don't

- don't implement per-worker/per-surface budget counters or any second mutation path;
- don't replenish budgets on retry/restart/resume/repair;
- don't let budget exhaustion mutate requested scope or coverage truth;
- don't auto-accept anything after authoritative cancellation, and don't revoke accepted identities after cancellation;
- don't let reconciliation alone reopen acceptance processing;
- don't add members/targets/scope on retry;
- don't introduce multi-host claims, leases or exactly-once claims;
- don't implement SQLite/filesystem persistence, migrations or DB/filesystem reconciliation (T005/T015);
- don't rewrite uncertain/failed work into success via retry, reconciliation or AI explanation;
- don't copy large external implementations or licenses into this repository.

## 8. Reuse / license risk

Risk is low if external material is used as design/testing reference only. Do not copy substantial source from libraries into T006. If a new dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T006. The later Builder produces an exact candidate; T006 concern Validation must execute the state-machine/oracle matrix on that exact candidate; Fresh Independent Review is separately required because the task is `risk:critical` and `review:required`; version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
