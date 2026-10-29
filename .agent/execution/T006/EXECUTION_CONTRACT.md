# T006 Execution Contract — scheduler, lifecycle budgets, cancellation and retry

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #25, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T006` / Issue `#25`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- JIT branch: `task/v0.1.0-t006-scheduler-budget-cancellation`
- Dependency completion: `T002/#21` merged as PR #52, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (this exact base)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T006_scheduler-budget-cancellation.md@4d60ae15afbc993a8b37ae0d6d7bfc850fffc36d`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Owned write boundary

Execution boundary (frozen): `scheduler/concurrency/control ordering`.

T006 owns only the single Core-owned scheduling/control layer: the lifecycle control state machine, budget reservation/consumption ordering through one mutation path, the durable cancellation-vs-acceptance cutoff decision, cancel/retry/resume control transitions, dispatch suppression, duplicate-submit convergence and idempotent work/effect lineage keys — plus their directly necessary tests, fixtures and narrowly necessary workspace wiring.

The Frozen Task Pack owned boundary is authoritative: "Scheduling/control state machine, reservations/consumption, cancel/retry transitions and dispatch suppression."

T006 consumes the T002 canonical domain layer (`packages/domain-contracts`) — `ContractId`, `SnapshotId`, `LogicalTargetId`, `MemberId`, `EffectId`, `AuthorizationContextRef`, `BudgetProfile`/`LifecycleBudget`/`BudgetRemaining`, `DomainGateway` ports and legal-combination semantics. T006 must not fork, re-declare or weaken those identities/validators; the scheduler consumes them as its canonical vocabulary.

### Persistence seam boundary

T005 (#24, SQLite persistence/durable ledger/recovery) and T015 (#34, Core runtime integration) own the durable storage engine and DB/filesystem reconciliation. T006 depends only on T002, so T006 defines its control-ordering semantics against an injectable durable-control-facts seam (append/observe factual records: submitted lineage, reservation/consumption, durable `USER_CANCELLED` authority, durable acceptance) and proves its concern with deterministic in-memory implementations of that seam. T006 must not implement a SQLite/database engine, filesystem artifact store, migration schema or DB/filesystem reconciliation; the seam it defines must be implementable by T005 without semantic reinterpretation. Semantic conflict with persistence/recovery routes to planning/architecture, not parallel redefinition (Frozen Task Pack Merge/routing).

### Forbidden scope

From the Frozen Task Pack, verbatim, plus directly implied exclusions. Do not implement or redesign:

- private per-worker/surface budget counters (budget mutation has exactly one Core-owned path);
- restart replenishment of any budget (retry/restart/resume/repair inherit remaining budgets only);
- auto-accept after authoritative cancel (the acceptance cutoff is inviolable);
- new member/target introduction on retry (retry/resume operates on the same frozen Contract/SelectionSnapshot/target/effect lineage only);
- multi-host/distributed claims (single local authoritative Core; no distributed locks/leases/claim coordinators);
- Desktop, Browser Integration or CLI surfaces; browser/extension/broker code;
- SQLite/filesystem persistence implementation, production schema/migrations or DB/filesystem reconciliation (T005/T015);
- crawler/frontier/navigation engines and direct-transfer/HLS/media adapters (T008/T009 lanes);
- authorization secret broker or credential storage;
- AI/model execution;
- packaging/release/platform qualification;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T006 Task Pack to make implementation easier.

## Required semantic outputs

The implementation must provide the one Core-owned scheduling/budget/control vocabulary and state machine sufficient for T005/T015 and adapter lanes to consume without inventing competing truth. At minimum:

1. **Lifecycle control state machine** over a frozen Contract/SelectionSnapshot/target/effect lineage: explicit, deterministic transitions for dispatch, suppression, durable cancellation (`USER_CANCELLED`), durable acceptance, retry and resume, with every transition decided by the Core — never by surfaces/adapters (L2 invariant 1/2).
2. **Single budget mutation path**: generated discovery, transfer, retry and model actions consume budget through exactly one authoritative reservation/consumption ordering (L2 invariant 7). The path enforces PRD §15.4 exhaustion precedence: DiscoveryBudget exhausted → no new discovery/navigation while already-frozen targets may continue if TransferBudget and GlobalSafetyBudget remain; TransferBudget exhausted → no further acquisition bytes/segments; GlobalSafetyBudget exhausted → all generated work stops; user pause time excluded from active elapsed-time counters unless a specific global wall-clock limit says otherwise.
3. **Scope is not budget**: budget exhaustion may stop work but cannot create, enlarge, narrow or reinterpret requested scope (L2 invariant 3, PRD §15.4).
4. **Durable cancellation-vs-acceptance cutoff**: for a frozen target/effect lineage, if durable `USER_CANCELLED` authority is committed before durable acceptance, automatic recovery/reconciliation MUST NOT later create acceptance for already-staged/completed/validated/materialized or otherwise externally successful-but-unaccepted bytes; if durable acceptance was committed before cancellation, cancellation cannot retroactively revoke that accepted identity; bounded reconciliation may establish truthful facts on either side of the cutoff; only an explicit retry/resume control transition reopens acceptance processing (L2 invariant 20, ADR-013).
5. **Dispatch suppression**: once durable cancellation is authoritative for a still-unaccepted lineage, all new discovery/transfer/retry dispatch and automatic acceptance is suppressed, while bounded reconciliation required to determine truthful pre-existing durable/external facts remains permitted (L2 cancellation semantics).
6. **Duplicate-submit convergence**: two independent duplicate clients converge to one lineage, one effect and one accepted artifact; duplicate submit does not silently create another acquisition (L2, Research Demo #7 tuple).
7. **Idempotent effect lineage**: commands/work/effects/attempts use durable IDs so retry/restart can reconcile instead of blindly replaying (L2 invariant 8); recoverable at-least-once external effects plus idempotent acceptance/reconciliation, with no exactly-once claim (ADR-010).
8. **Explicit retry/resume**: retry/resume is a new authorized control transition on the same frozen Contract/SelectionSnapshot/target/effect lineage (PRD CJ-06: original targets only, no target replacement, scope expansion or budget reset), inheriting remaining budgets, never creating a duplicate accepted effect; already-staged bytes may be reused only after ordinary identity/provenance/validation rules succeed.
9. **Crash-adjacent determinism**: committed control facts (cancellation authority, acceptance, consumption) survive process death/reopen and determine the cutoff deterministically; uncertain/failed work is never rewritten into success by restart, retry or reconciliation (L2 D9).

## Required invariants / invalid states

Fail closed when a control transition or budget mutation is malformed or violates Frozen Product/L2 semantics. The control layer must reject at least:

- a second/private budget mutation path, or budget consumption recorded outside the single authoritative ordering;
- any budget value or exhaustion being used as a scope/membership source;
- budget replenishment implied by retry/restart/resume/repair;
- acceptance created for a lineage whose durable `USER_CANCELLED` authority precedes it (cancel-before-accept);
- cancellation retroactively revoking an already durably accepted effect identity (accept-before-cancel);
- new discovery/transfer/retry dispatch emitted after durable cancellation for a still-unaccepted lineage;
- a duplicate submit forking a second lineage/effect/artifact for the same logical work;
- retry/resume introducing a new member/target, successor scope, or a different Contract/Snapshot identity than the frozen lineage;
- resume without an explicit authorized control transition (reconciliation alone must never reopen acceptance processing);
- control transitions consuming unknown/incompatible canonical identities or bypassing T002 decode/validation at the seam;
- rewriting uncertain/failed work into success through retry, reconciliation or AI explanation (PRD §30).

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal file decomposition under the existing `packages/*` workspace seam;
- the concrete shape of the durable-control-facts seam (interface/ports layout, event/record typing) provided T005 can implement it without semantic reinterpretation;
- state-machine encoding (explicit transition table, reducer, typed transitions) and the internal representation of lineage state;
- deterministic in-memory factual-store implementations used by concern tests;
- whether pure ordering predicates (e.g. cutoff decision) are separated from the state-machine driver;
- fixture organization and helper APIs;
- table-driven versus generated property-style test harness implementation (no new property-testing dependency is required).

These choices must not weaken or reinterpret the required state machine, budget single-path, cutoff, convergence, lineage or resume invariants.

## Verification commands available on the exact base

The T001 toolchain provides the durable root gates:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T006 concern Validation is separate from this prep task and must additionally prove the T006 state-machine/oracle matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T006 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries — including any pressure to introduce a second budget mutation path, a per-surface scheduler authority, or a cancellation rule weaker than L2 invariant 20/ADR-013.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.
- `PERSISTENCE_SEMANTIC_CONFLICT`: the control-ordering seam cannot be defined without redefining T005/T015 persistence/recovery semantics — route to planning/architecture per the Frozen Task Pack Merge/routing rule; never resolve by parallel redefinition.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T006. Current durable execution facts are the materialization terminal (issue #19 comment `5968293780`), the Issue DAG (#21 closed, #25 open `state:planned`), T002 closeout (PR #52 merge `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
