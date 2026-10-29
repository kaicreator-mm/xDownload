# T003 Execution Contract — validation harness, corpora and gate instrumentation

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #22, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T003` / Issue `#22`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- JIT branch: `task/v0.1.0-t003-validation-harness-corpora`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (Merge PR #52 — canonical domain contracts now exist as `packages/domain-contracts`)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T003_validation-harness-corpora.md@39c205ec8ee9ccd9b6f47eeca401ec1ee76c307e`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061` (tree `2766b482c23c7c78a4b2b4e451277e91ded11097`)
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`

## Goal (frozen, verbatim from the Task Pack)

Create reusable version-validation harnesses/corpora for S1–S6, C01–C34, G0/G1 measurement protocol, Critical Journeys and exact-subject evidence capture **without claiming any gate PASS**.

## Owned write boundary

T003 owns only version validation infrastructure: deterministic corpora/controlled servers/fixtures, baseline-plan registration, denominator/UNKNOWN/abandonment accounting and evidence formatting. Task-local tests remain owned by each implementation task.

The exact base has a TypeScript/pnpm monorepo with `packages/*` admitted by `pnpm-workspace.yaml` and a T002 `packages/domain-contracts` package exporting canonical contract/result/evidence/snapshot/budget/identity vocabulary. The Builder may create the minimal version-validation package(s) under the existing `packages/*` workspace seam needed to satisfy T003, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its harness self-tests.

Validation ownership is **concern-level only**: this task builds and self-tests the harness/corpus infrastructure. Version-level visible Validation is owned by T020–T023 on the exact T019 candidate. G0/G1 and C01–C34 execution remain `NOT_RUN` here.

### Forbidden scope (frozen)

- No favorable post-hoc baseline selection (PRD §32.2 / §33 Baseline rule R03).
- No self-generated truth from UI/discovery output (PRD §22, §32.1 truth-source rule, C34).
- No Product gate PASS claim — G0/G1 remain `NOT_RUN` in this task (Task Pack Acceptance).
- No production feature changes — no Desktop/Browser/CLI/persistence/transfer/media/scheduler/AI implementation belongs to T003.
- No self-Validation of other tasks' scopes, no self-Review, no merge authority: concern Validation ownership rules and `review:required` stand.
- Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T003 Task Pack to make implementation easier.

## Required outputs

The implementation must provide reusable, deterministic, offline-runnable validation infrastructure. At minimum:

1. **Corpus registries** for PRD §33 corpora (Natural, Collection, Hard, Holdout) with stable, immutable corpus/task-case identities across S1–S6 (PRD §28) — deterministic fixtures/controlled-server definitions only, no live-network truth.
2. **C01–C34 oracle corpus** loading the PRD §35 counterexamples with pre-registered expected behaviors/status tuples bound to the canonical result vocabulary from `@xdownload/domain-contracts` (TASK_DAG: "validation corpora/oracles must bind Frozen canonical identities and result semantics"). Loading must prove each oracle record parses, has a known C-identity, and binds expected statuses; execution against a product candidate stays outside T003.
3. **G0BaselinePlan registration** implementing the PRD §32.2 R03 normative shape (`g0_baseline_plan_id`, candidate baseline registry, selection rule, comparison sets, aggregation rule, tie-break, `frozen_at`, ...) with fail-closed immutability: a frozen plan cannot be silently mutated; post-exposure protocol/baseline change must be representable as run invalidation (C33), never as plan mutation.
4. **Denominator/UNKNOWN/abandonment accounting** implementing PRD §32.1 common confirmation rules: sample unit = end-to-end task; out-of-scope excluded from primary denominator but reported; `UNKNOWN` remains in denominator unless independent truth is unavailable (`INSUFFICIENT_EVIDENCE`); friction-caused abandonment is non-success; external cancellation excluded only with pre-recorded reason; repeated runs are not independent samples.
5. **Critical Journey harness definitions** for CJ-01..CJ-09 (PRD §31) with pre-registered expectations (target, scope, expected stop, expected result statuses, truth source — PRD §35 preamble), reusable by later Validators.
6. **Gate instrumentation** for G0 and G1a–G1d (PRD §32): metric collection definitions (correct completion, active user time, manual actions, recovery effort, false-success rate) and PASS-rule evaluation functions that consume recorded evidence. Instrumentation must be runnable later but remain `NOT_RUN` here.
7. **Evidence exact-subject capture/formatting** per PRD §20 claim model (`claim_type`, `claim_subject`, source identity/provenance, `independence_from_discovery`, scope, certainty class) and §22 validation layers, including the rule that discovery/UI suggestion cannot be typed as independent truth for the same claim (C34).

## Required invariants / invalid states

Fail closed when harness/corpus/plan/oracle data is malformed or tampered with. The infrastructure must reject at least:

- corpus/task-case identity mutation or reuse of an identity for changed content;
- oracle records referencing unknown C-identities or unknown canonical status values;
- baseline plans missing required §32.2 fields, with non-deterministic selection rules, or with post-hoc candidate additions;
- any post-freeze mutation of a registered plan/snapshot of pre-registered expectations;
- denominator computations that count `UNKNOWN` as success, drop abandonment silently, or exclude external cancellation without a pre-recorded reason;
- evidence records typed as independent when their provenance is discovery/UI output;
- gate result computation producing `PASS` from missing/insufficient instrumentation evidence.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming/decomposition under `packages/*` (one validation package or a small split);
- fixture/controlled-server implementation technique (static fixtures, local deterministic servers) provided runs are offline-deterministic;
- internal file layout and helper APIs;
- small new dev/test-only dependencies if justified, with exact version/license recorded;
- storage format for registries/plans (code-defined, JSON, etc.) provided identity and immutability invariants hold.

These choices must not weaken or reinterpret the required harness/oracle semantics or claim any gate PASS.

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

T003 concern Validation is separate from this prep task and must additionally prove harness self-tests, corpus identity/denominator checks and baseline pre-registration enforcement on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T003 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.
- Oracle/Product ambiguity: routes upward rather than being guessed (Task Pack Merge/routing).

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T003. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
