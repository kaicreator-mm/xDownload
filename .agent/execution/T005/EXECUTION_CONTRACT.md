# T005 Execution Contract — SQLite persistence, durable ledger and recovery

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #24, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T005` / Issue `#24`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- JIT branch: `task/v0.1.0-t005-persistence-recovery-ledger`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (PR #52) — identical to this task's integration base
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T005_persistence-recovery-ledger.md@09571c7f917dfade91dd8cd0e784d5832f42203f`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Owned write boundary

T005 owns only the persistence/data-integrity/recovery concern: the SQLite metadata/state ledger adapter, production schema/migrations, the filesystem artifact store, recovery/reconciliation, and exactly one authoritative writer path for lifecycle state, plus directly necessary tests and workspace wiring.

The exact base currently has a TypeScript/pnpm monorepo workspace with `packages/*` admitted by `pnpm-workspace.yaml`; `tsconfig.json` typechecks `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts`; `vitest.config.ts` discovers `packages/*/test/**/*.test.ts`. The merged T002 output (`packages/domain-contracts/`) provides the canonical contract/schema vocabulary. The Builder may create the minimal persistence/artifact-store/recovery package(s) under the existing `packages/*` workspace seam needed to satisfy T005, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by those packages and their tests.

T005 persistence must persist the T002 canonical identities — it must not invent competing or reinterpreted contract/snapshot/result semantics (Frozen Task DAG: T005 ← T002 "schema/migrations/ledger persist canonical identities and cannot pre-invent them").

### Forbidden scope

From the Frozen Task Pack, the implementation must NOT contain or claim:

- an exactly-once execution claim;
- a host-power-loss durability guarantee (only process-death/reopen may be claimed);
- DB-only final success (an `accepted` DB state alone never implies final success when validated bytes are absent);
- any new acceptance after durable cancel-before-accept (L2 ADR-013 / Invariant 20 cutoff);
- PostgreSQL/server expansion (L2 Decision Matrix: DEFER; preserve a state-repository boundary instead).

Do not implement or redesign: Desktop/Browser/CLI surfaces; crawler/frontier/navigation engines; download/transfer/media adapters; scheduler/cancellation control semantics (T006 lane; T005 persists the durable facts the cutoff is read from, per the Frozen Task DAG convergence note "T005 + T006, converged in T015"); authorization secret broker or credential storage; AI/model execution; packaging/release/platform qualification; Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T005 Task Pack to make implementation easier.

## Required outputs

The implementation must provide a persistence layer that durably stores and reconciles, without redefining, the canonical domain:

1. **Production SQLite schema/migrations** with an explicit schema version identity; fresh-install and forward/backward migration paths exactly as designed; unsupported/incompatible versions fail closed; migrations never mutate historical identity.
2. **Stable durable lineage**: command/work/effect/artifact/attempt identities persisted so restart/retry reconciles instead of blindly replaying (L2 Invariant 8).
3. **Explicit lifecycle state distinctions**: staged vs materialized vs finalized vs accepted are distinct durable states (L2 §6.2 candidate rules; ADR-004).
4. **Lifecycle-budget facts**: transactional reservation/consumption records that survive restart without replenishment or double consumption (PRD §15; L2 Invariant 3/7; #7 evidence).
5. **Filesystem artifact store**: downloaded bytes live in the filesystem store; DB records bind bytes to durable effect/artifact identity via digest/provenance (L2 §6.2; Invariant 9; data-ownership table "artifact bytes").
6. **Digest/provenance binding**: digest/provenance validation before any terminal success; missing/corrupt bytes never become success.
7. **Recovery/reconciliation**: deterministic classification across process-kill/restart windows, including explicit filesystem-first/DB-first reconciliation. L2 §11 candidate classes `NOT_DISPATCHED`, `IN_FLIGHT_UNKNOWN`, `PARTIAL_RECOVERABLE`, `SUCCEEDED_UNACCEPTED`, `ACCEPTED` and explicit terminal-failure equivalents are the semantic requirement; exact production names remain a downstream contract detail.
8. **Durable control-transition order facts**: persistence stores the durable order among dispatch, external effect, validation, filesystem staging/materialization/finalization, acceptance, `USER_CANCELLED` and explicit retry/resume (L2 §11.1) so that: cancel-before-accept blocks automatic later acceptance; accept-before-cancel is not retroactively revoked; only explicit retry/resume reopens processing on the same frozen lineage and remaining budgets.
9. **Idempotent acceptance/duplicate convergence**: duplicate submits/clients converge to one lineage, one effect and one accepted artifact; no duplicate accepted effect is created by retry/restart.
10. **One authoritative writer path**: a single Core-owned lifecycle writer; no surface/adapter private writer (L2 §10 synchronization rules).
11. **Opaque authorization references only**: persistence stores `AuthorizationContextRef`-style opaque references; raw reusable cookie/password/token/signed-URL secret material is never ordinary stored state (L2 Invariant 12).

## Required invariants / invalid states

Fail closed. The persistence/recovery layer must reject or never produce at least:

- reopening a database with an unsupported or semantically incompatible schema version without an explicit supported migration;
- an `accepted` state without a corresponding digest-bound artifact record;
- acceptance of missing, unmaterialized or digest-mismatched/corrupt bytes as success;
- automatic acceptance of any lineage whose durable `USER_CANCELLED` fact precedes durable acceptance;
- retroactive revocation of an accepted identity by later cancellation;
- projection of cancelled work as `COMPLETE` solely because valid bytes happen to exist;
- budget facts replenished or double-consumed across restart/retry;
- duplicate effect/accepted-artifact identities for one frozen lineage from duplicate submits/clients/restarts;
- a second writable path bypassing the single authoritative writer;
- membership/lineage drift where counts match but identities differ (count is never completeness);
- raw reusable secret material persisted as ordinary state.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal decomposition under `packages/*` (L2 §8 names `adapters/persistence-sqlite/` and `adapters/artifact-filesystem/` only as a responsibility map — "not an implementation scaffold instruction; no empty modules are authorized");
- the SQLite access mechanism: the pinned Node `24.21.0` runtime provides a built-in `node:sqlite` module (zero new dependency), or one narrowly justified driver may be added, provided exact package/version/license/provenance is recorded and no new Product/L2 authority is implied; the pack does not preselect;
- journal/WAL and synchronous configuration, provided the resulting durability claims never exceed process-death/reopen truth;
- migration representation (e.g. ordered migration scripts vs explicit versioned DDL) and its backward-safety design;
- filesystem artifact store layout/naming/sharding, provided bytes remain digest/provenance-bindable to DB identity;
- exact recovery-class production names and enum shapes;
- process-kill/restart test harness mechanics (e.g. real child processes killed at injected windows on the local host), provided the tests exercise a real SQLite file and real filesystem, not mocks/in-memory databases;
- fixture organization and helper APIs.

These choices must not weaken or reinterpret the required outputs/invariants.

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

T005 concern Validation is separate from this prep task and must additionally execute the real SQLite/filesystem process-kill/restart, migration, DB-first/FS-first reconciliation and digest/provenance matrix on the exact implementation candidate (`TEST_MATRIX.yaml`). This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T005 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (e.g. only a host-power-loss guarantee or exactly-once semantics could satisfy a required test).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5. Do not rewrite it as part of T005. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout (merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
