# T015 Execution Contract — authoritative Core runtime integration

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #34, the Frozen Task Pack (`T015_core-runtime-integration.md@d176b357b7278b229091ee2e3d624b0ff691802d`), Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T015` / Issue `#34`
- Integration base: `version/v0.1.0@4d40a2a1c389f6de4f3ce916c113fe4055f5e197` (the T009 merge; base tree `1fdb53447a84492b8d4dba051fc0846b3b0f8549`)
- JIT branch: `task/v0.1.0-t015-core-runtime-integration`
- Dependency completion (all CLOSED on the integration base):
  - `T004/#23` merge `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2` — core command/query seam
  - `T005/#24` merge `7f56a6e45845b4039a0d7cbc7b96d162802fad33` — SQLite persistence, durable ledger, recovery
  - `T006/#25` merge `4416bb1d45a6058b493c179c1715fe745c25c0a8` — scheduler, lifecycle budgets, cancellation, retry
  - `T007/#26` merge `8a87797ca21d9603fd8bd6be35dec1169f9ad97e` — typed evidence/validation/coverage/result projection
  - `T008/#27` merge `ac4e04a12a5274f4ac777e4fb182f450c419e4d0` — direct HTTP/file acquisition
  - `T009/#28` merge `4d40a2a1c389f6de4f3ce916c113fe4055f5e197` — HLS VOD media adapter
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T015_core-runtime-integration.md@d176b357b7278b229091ee2e3d624b0ff691802d`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Goal of the task (frozen, unchanged)

Converge command/query, persistence, scheduler, evidence/result and Direct HTTP/HLS adapters into one authoritative Core Control Runtime supporting deterministic S1/S3/S4 foundations.

## Required outputs

The implementation must provide ONE authoritative Core Runtime — a single composition in which:

1. Command/query entry is served through the `@xdownload/core-seam` authority boundary (`createCoreSeamServer` / `createSeamClient`); canonical payload vocabulary comes only from `@xdownload/domain-contracts`.
2. Accepted commands drive the `@xdownload/core-scheduler` control layer (`CoreScheduler` over a durable `DurableControlFactLog`, with `acceptanceCutoff`, `BudgetLedger` and the machine's cancellation/reconciliation semantics).
3. Durable state is owned exclusively by the `@xdownload/persistence-ledger` single-writer path (`AuthoritativeLedgerWriter`, `LedgerConnection`, `FilesystemArtifactStore`, `LedgerReader`, `RecoveryService`) — no second writer, no parallel mutable store.
4. Terminal evidence/result truth flows through the T007 typed layer in `@xdownload/domain-contracts` (typed evidence, validation records, coverage accounting, `result-projector`); the runtime never projects terminal status outside the projector.
5. S1/S3 transfer execution is wired behind the canonical acquisition port via `@xdownload/direct-acquisition` (`DirectHttpAdapter` + `validateTransfer/validateFormat/validateMedia/validateTarget` + `projectOutcome`) and S4 HLS VOD execution via `@xdownload/hls-vod-adapter` (playlist/plan/acquire/assemble/validate pipeline), both consuming canonical budget/effect identities only.
6. Restart recovery composes `RecoveryService` DB-first/FS-first classification with scheduler reopen (`CoreScheduler.reopenFromJson`) and seam journal replay so a killed/restarted process resumes the same frozen lineages and remaining budgets, with no budget replenishment and no membership drift.
7. Duplicate/idempotent submit, cancellation cutoff (cancel-before-accept blocks automatic later acceptance; accept-before-cancel is not retroactively revoked), budget exhaustion (Discovery/Transfer/GlobalSafety domains with L2 §15.4/§32 precedence) and projection reads all behave per Frozen L2 §11 / ADR-013 without new semantics invented in glue.

The runtime is one composition/lifecycle owner, not a new domain layer. Focused integration tests covering the concern must accompany it (see `TEST_MATRIX.yaml`).

## Owned write boundary

T015 owns only Core composition/runtime lifecycle, adapter wiring and focused integration tests. Concretely:

- Create the minimal new integration package(s) under the existing `packages/*` workspace seam (naming/decomposition is an F1 choice) that compose the listed upstream packages into the single runtime.
- Add narrowly necessary root workspace dependency/script/config wiring directly required by that package and its tests.
- Add package-local focused integration tests fit for the existing `vitest.config.ts` discovery seam (`packages/*/test/**/*.test.ts`).

### Forbidden scope

Do not implement, integrate or claim:

- **No T016 scope**: no browser→broker→Core cross-boundary handoff workflow, no collection workflow orchestration for S2/S5/S6, no real-browser/end-to-end fixtures. `@xdownload/browser-observation`, `@xdownload/browser-auth-broker` and `@xdownload/discovery-recipe` exist on the base and MAY be referenced as ports where composition requires their types, but their workflow integration belongs to T016 (#35, depends on T015). Recipe/discovery-driven acquisition loops are out of T015 concern.
- **No T017 scope**: no Desktop/CLI application surfaces, no `apps/*` product work beyond what already exists, no AI proposal adapter, no cross-surface convergence.
- **No frozen-doc mutation**: never modify `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json`, the T015 Task Pack, or any other frozen task pack to ease integration.
- **No consumed-package semantic modification**: upstream package APIs are consumed as-is. Integration glue + composition only. Do not edit `packages/domain-contracts`, `packages/core-seam`, `packages/core-scheduler`, `packages/persistence-ledger`, `packages/direct-acquisition`, `packages/hls-vod-adapter` (or the T010/T011/T003 packages) to change their semantics, exports or invariants in order to solve an integration problem. A genuine API-gap blocker routes as an escalation, not a local rewrite.
- **No parallel mutable authority**: no second writer path, no surface-local precedence, no private budget ledger, no store outside `persistence-ledger`, no terminal truth outside the result projector.
- **No semantic rewrites to solve integration**: forbidden tuples, acceptance cutoff, budget domains, identity/locator separation and evidence independence must survive composition unchanged.
- **No broad platform claims**: no daemonization/packaging/service-installation promises; on-demand launch remains the L2-sanctioned escape hatch.
- **No acceptance before required validation**: close with Core integration evidence only, never version Validation (owned by T020–T023 on the exact T019 candidate).

## Integration precedence rules (glue may decide order, never outcomes)

Where upstream packages leave composition open, glue may choose:

- construction/assembly order and dependency injection layout;
- in-process loopback transport vs. a future transport port for the seam (ADR-012 replaceability preserved);
- concrete SQLite file / temp-dir locations for tests;
- fact-log storage binding (in-memory for focused cases, persisted journal for restart cases).

Glue may never decide: terminal statuses, acceptance/cancellation outcomes, budget truths, membership identity, or validation verdicts. Those are upstream-owned semantics the runtime must expose verbatim.

## Successor / restart rule (restated for the integrator)

Restart/reopen of the runtime must re-derive state only from durable truth (persistence ledger + durable fact log + seam journal + artifact store). A restarted runtime inherits remaining budgets on the same frozen lineage; it must not treat restart as replenishment, re-enumeration, or a successor identity event. Duplicate submission of an already-accepted idempotent command must be rejected/idempotently absorbed without creating a second effect lineage.

## Verification commands available on the exact base

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T015 concern Validation is separate from this prep task and must additionally prove the `TEST_MATRIX.yaml` suites on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T015 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (including any need to modify a consumed package's semantics).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.
- `CONSUMED_API_GAP`: a required composition is impossible without changing an upstream package's public API or semantics — stop; classify as architecture contradiction or route to the owning task/amendment. Do not patch upstream semantics locally.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text. Do not rewrite it as part of T015. Current durable execution facts are the materialization terminal, the Issue DAG (native blocked-by relations), the six dependency closeouts above and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
