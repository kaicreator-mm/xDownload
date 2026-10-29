# T005 L3 Reference Pack — SQLite persistence, durable ledger and recovery

Task: `T005` / Issue `#24`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a runtime SQLite driver, pre-write the schema, or redefine recovery semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

T005's distinguishing requirement is real crash coverage: spawn a real child process against a real SQLite file and real temp artifact directories, kill it (`SIGKILL`-class hard kill, not graceful shutdown) at injected windows, reopen, and assert the deterministic recovery classification. Inject windows at durable-fact boundaries: after stage-record commit; after byte write but before materialize-record; after materialize; after finalize; after acceptance commit; while an external effect is plausibly in flight. Keep a per-window table so every window has a stable oracle identity (R01–R12 style), positive and negative adjacent.

**Patterns to emulate:**

- table-driven kill-window × recovery-classification matrices;
- a small crash-harness helper (spawn/kill/reopen) reused by every window case, so the kill mechanics are tested once;
- migration matrix tests: fresh install; each supported prior version → current; designed backward path; unsupported version reopen → fail-closed assertion;
- duplicate-client convergence tests: two independent writers/submits converging on one lineage/effect/accepted artifact;
- restart-budget invariance: snapshot remaining budgets before kill, assert equality (not replenishment, not double-consumption) after recovery;
- DB-first/FS-first reconciliation fixtures: mutate only one side (delete bytes vs delete/alter rows) and assert truthful classification, never success;
- digest tamper fixtures: flip one byte, assert failed/uncertain classification, never success.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`. License fact: MIT at tag `v4.1.11`; already selected by T001; T005 does not introduce it.

### 1.2 OS-tuple honesty

Process-kill semantics and fsync behavior differ per OS. The frozen L2 evidence (`#7`) proved the Linux process-death/reopen tuple with an `fsync=volatile` limitation — power-loss is unproven and unclaimable. Whatever host the tests run on (the local Builder host, possibly Windows), record the tuple actually exercised and bound every claim to it. Never name a suite in a way that implies power-loss coverage.

### 1.3 Property-style invariants without adding a property-test dependency

High-ROI invariant families can be exercised by small deterministic generated tables using existing Vitest first:

- duplicate submit N times ⇒ still exactly one accepted artifact for one frozen lineage;
- kill/restart at any injected window ⇒ budget remaining values unchanged;
- accepted ⇒ digest-bound and bytes present; the converse projection never holds (accepted row does not prove bytes);
- order of independent staged artifacts does not change recovery classifications;
- reopening the same DB twice yields the same classification (determinism).

Do not add a property-testing package merely for L3 convenience.

## 2. Contract / interface references

### 2.1 SQLite schema identity and versioning — design references, not mandated implementation

SQLite provides durable primitives the schema design should use deliberately:

- `PRAGMA user_version` as the natural explicit schema-version marker;
- transactions (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) for atomic multi-record lifecycle transitions;
- journal/WAL modes and `synchronous` settings as explicit F1 choices — chosen configuration must never be cited as a power-loss guarantee; the frozen L2 position (§6.2) is that no host-power-loss durability guarantee is claimed;
- `FOREIGN KEY`/`UNIQUE` constraints as fail-closed backstops for duplicate effect identity and orphaned records.

Use SQLite's own documentation for the pinned runtime's capability set. T005 does not require an ORM; raw explicit SQL behind a narrow repository façade keeps the one-writer path auditable.

### 2.2 State-repository boundary

L2 Decision Matrix keeps `backend abstraction + separate storage Demo if required` as the escape hatch and DEFERs PostgreSQL. Shape the adapter behind a narrow state-repository port so a future backend swap does not redefine domain contracts — without building a speculative abstraction layer or server mode now.

### 2.3 TypeScript integration

Exact compiler on the base: `typescript@5.9.3`, strict, `noUncheckedIndexedAccess`. Primary reference: `https://github.com/microsoft/TypeScript/tree/v5.9.3` (Apache-2.0; already selected by T001). Consume `packages/domain-contracts/` types for persisted identity/state vocabulary; do not fork them. TypeScript types are erased at runtime — DB rows and filesystem state are untrusted input to recovery logic and must pass runtime checks before influencing classifications.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 One authoritative writer façade

Expose exactly one writer entry through which every lifecycle transition (state change, budget delta, effect intent, transition-order fact) commits in one transaction. Surfaces/adapters submit commands; they never open their own write path. L2 §10 synchronization rows (`budgets`, `cancellation/retry control order`, `artifact bytes`) are the ownership contract.

### 3.2 Write the order, not just the state

For each frozen lineage persist an ordered control/transition fact stream (L2 §11.1): dispatch intent → external effect → validation → FS staging/materialization/finalization → acceptance → `USER_CANCELLED` → explicit retry/resume. Recovery reads this durable order; it must not reconstruct order from timestamps, arrival times or memory. The AR-F01 cutoff is a query over these facts, not an ad-hoc comparison.

### 3.3 Staged → materialized → finalized → accepted as distinct durable states

Keep the four states explicitly distinct (L2 ADR-004, §6.2 promoted rules). Write the FS-side record and the byte lifecycle as separate durable facts bound by digest/provenance. `accepted` requires: digest bound, bytes present, validation passing — and no authoritative cancellation earlier in the durable order.

### 3.4 Effect-intent / outcome reconciliation (at-least-once)

Record effect intent before/at dispatch; record outcome only as observed durable facts. On restart, classify from (intent, outcome, DB state, FS observation): absent intent → `NOT_DISPATCHED`; intent without outcome → `IN_FLIGHT_UNKNOWN` (reconcile, never silently succeed, never blindly replay); partial bytes → `PARTIAL_RECOVERABLE`; FS-complete without acceptance → `SUCCEEDED_UNACCEPTED`; acceptance committed → `ACCEPTED` (still verify bytes for success projection). Exact names are downstream contract detail (L2 §11).

### 3.5 Idempotent acceptance and duplicate convergence

Key acceptance on durable lineage/effect identity so duplicate submits/clients/restarts converge (the #7-proven behavior). A repeat operation may no-op, reconcile or reuse valid staged bytes — it must never create a second accepted artifact.

### 3.6 Budget facts as transactional ledger rows

Reserve/consume budgets in the same transaction as the lifecycle transition that causes them (L2 Invariant 7). Recovery recomputes "remaining" from durable rows only; restart never replenishes (PRD §15.4).

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Unknown/incompatible schema version

Typed rejection on reopen; preserve the file for diagnostics; migrate only via explicit tested steps; never reinterpret unknown fields/enums into current semantics.

### Corrupt/missing state

Digest mismatch, missing bytes, torn records and contradictory DB-vs-FS facts classify truthfully into the recovery vocabulary — they never normalize into success and never auto-repair by overwriting evidence.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T005 acceptance

| Acceptance concern (Frozen Task Pack) | Reference pattern | Required T005 proof |
| --- | --- | --- |
| Real SQLite/filesystem process-kill/restart tests | §1.1 crash harness + kill-window matrix | deterministic classification per window on a real host; exercised OS tuple recorded |
| DB-first/FS-first recovery | §3.4/§3.5 + one-side-mutated fixtures | SUCCEEDED_UNACCEPTED preserved; accepted-without-bytes never success; duplicates converge |
| Migration forward/backward safety as designed | §2.1 user_version + matrix tests | supported transitions preserve rows/identity; unsupported fails closed; backward behaves as designed |
| Digest/provenance binding | §3.3 + tamper fixtures | binding precedes acceptance; mismatch/missing never success |
| Stable lineage | §3.1/§3.2 | durable IDs + ordered transition facts survive restart |
| Lifecycle-budget facts | §3.6 | no replenishment/double-consumption across kill windows |
| Staged/materialized/finalized/accepted distinctions | §3.3 | four states remain distinct and explicit |
| Cancellation cutoff facts (T005 share with T006) | §3.2 + R01/R08/R11 | durable order enforces ADR-013 outcomes from stored facts |
| No exactly-once / no power-loss claim | §1.2 + FAILURE_MATRIX `durability-overclaim` | at-least-once semantics; claims bounded to tested tuple |

## 6. Dependency/version/license facts

### Already pinned and recommended for T005 use

| Package | Exact version on bound base | License | T005 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static modeling over persisted shapes; already selected by T001 |
| `vitest` | `4.1.11` | MIT | executable persistence/migration/recovery tests; already selected by T001 |

Sources: root `package.json` on exact base; upstream exact-tag license files.

### SQLite access mechanism

**None is recommended or pinned by this Reference Pack.** Two F1 options:

1. the Node `24.21.0` built-in `node:sqlite` module (zero new dependency — verify its exact stability/behavior on `24.21.0` and record the fact); or
2. one narrowly justified driver dependency (e.g. a synchronous embedded SQLite binding), recording exact package/version/license/provenance in the implementation PR.

Server-backed databases remain forbidden scope (PostgreSQL DEFER). This keeps library popularity from becoming an architectural decision.

## 7. Do / Don't

### Do

- use a real SQLite file and real temp directories in every required-suite test;
- inject hard kills at durable-fact boundaries and classify deterministically on reopen;
- keep one transaction per lifecycle transition (state + budget + order fact);
- persist the durable order and query the cutoff from it;
- bind bytes via digest/provenance before acceptance;
- converge duplicates on durable identity;
- consume `packages/domain-contracts/` identities unchanged;
- record the exercised host OS tuple with every durability claim;
- keep the state-repository boundary replaceable without server expansion.

### Don't

- don't claim exactly-once or host-power-loss anywhere;
- don't project success from an `accepted` DB row alone;
- don't auto-accept bytes discovered after a durable cancel-before-accept;
- don't replenish or double-consume budgets across restarts;
- don't create a second writer path or a second accepted artifact for one lineage;
- don't migrate by mutating historical identity;
- don't store raw reusable secrets as ordinary state;
- don't mock the database/store in a required crash suite;
- don't implement T006 scheduler-control semantics, transfer/media adapters or surfaces under T005;
- don't copy large external implementations or licenses into this repository.

## 8. Reuse / license risk

Risk is low if external material is used as interface/testing/design reference only. Do not copy substantial source from Vitest, TypeScript or any SQLite library into T005. If a driver dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR. SQLite and Node documentation references here are standards/design references; no spec text needs to be copied into product source.

## 9. Validation boundary

This Reference Pack does not prove T005. The later Builder produces an exact candidate; T005 concern Validation must execute the real-host process-kill/restart, migration, DB-first/FS-first reconciliation and digest/provenance matrix on that exact candidate; Fresh Independent Review is separately required because this task is `risk:critical` and `review:required`. Broader durability remains unproven per the Frozen Task Pack; T015 convergence and T020–T023 version-level Validation are separate later gates.
