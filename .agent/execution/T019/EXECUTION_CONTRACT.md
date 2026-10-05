# T019 Execution Contract — version candidate preparation + visible regression convergence

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #38, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T019` / Issue `#38`
- Integration base: `version/v0.1.0@6e512e6e5397eae14bb1a4aa7d0722d517641b88`
- Base tree: `daa0853ddb6b61dbc781c9df111fe8a69f765eda`
- JIT branch: `task/v0.1.0-t019-candidate-preparation`
- Dependency completion:
  - `T003/#22` CLOSED, merge commit `e06cc15c937ba3ac50bc7bd16b707c2d20bb194b` (PR #57, validation harness/corpora/gate instrumentation)
  - `T017/#36` CLOSED, merge commit `888ce342b1d170ab4a217e0fff418cd8b0a0a712` (PR #76, surface + AI convergence)
  - `T018/#37` CLOSED, merge commit `6e512e6e5397eae14bb1a4aa7d0722d517641b88` (PR #77, packaging and platform integration — the observed integration base itself)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T019_candidate-preparation-visible-regression.md@5d2cd990b108fd5602a10b88d4fe5625011ea858`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Goal of the task (frozen, unchanged)

Converge all implementation/package work on `version/v0.1.0`, run configured cheap/full visible regression preconditions, repair only separately authorized bounded defects, and establish one immutable exact candidate for version-level Validation.

## Owned write boundary

T019 owns version integration/currentness, configured CI/full regression execution and candidate stabilization. Per the Frozen Task Pack acceptance line, the version artifacts this task owns and must produce are:

1. **Exact candidate identity (version metadata, now in scope)** — one recorded candidate manifest binding the exact candidate commit SHA **and** tree SHA, the producing branch, and the gate-status summary, written under `.agent/execution/T019/` (evidence-only location). Once recorded, the candidate identity is immutable for T020–T023: any post-recording code/config change invalidates the candidate and requires successor preparation/validation.
2. **Visible regression convergence evidence** — the full visible regression run executed on that exact candidate: clean bootstrap (`pnpm install --frozen-lockfile`), configured CI (`pnpm ci:verify`), full workspace unit/contract/integration discovery (`pnpm test:unit` over all 16 `packages/*/test` suites), S1–S6 harness availability (the `packages/version-validation` corpora/oracles/journeys/gates suites), and production package build + smoke (`node build/package.ts`, `node build/smoke.ts`, refreshing `build/evidence/`). All visible suites green; any red suite is a candidate FAIL with no waiver.
3. **G0/G1 gate status from version-validation** — the gate instrumentation built by T003 (`GATE_DEFINITIONS`, `evaluateGate`, `gateStatusBoard` in `packages/version-validation`) evaluated on the exact candidate, with the status board recorded truthfully. A gate may be recorded PASS only where the harness-visible evidence on this candidate actually proves it under the frozen `G0BaselinePlan` rules; everything else stays `NOT_RUN` / `INSUFFICIENT_EVIDENCE` / `FAIL` as observed. G0/G1 product measurement Validation itself is owned by T020–T023; T019 records the honest starting board, it does not manufacture gate PASSes.
4. **Bounded defect repairs (separately authorized only)** — where a visible regression defect blocks convergence, repair only with a separate authorization reference per repair; an unreviewed high-blast fix must never be folded into the candidate.

The convergence baseline being converged is: all implementation PRs T003–T018 merged on `version/v0.1.0` through base `6e512e6e…` (PRs #57, #59–#76, #77 plus the #72 hardening merges).

### Convergence honesty rule (binding for this task)

- The candidate manifest may only be written after the full visible regression run has actually executed on the exact candidate commit and its tree hash has been observed.
- Every recorded suite result must come from a real execution on the exact candidate with the command, environment and result identity recorded. An unexecuted or partially executed suite is `NOT_EXECUTED`, never PASS.
- Tests, corpora, oracles and baselines must not change after product-gate results are seen (Frozen Task Pack forbidden scope; PRD C33).
- Gate statuses are recorded exactly as the version-validation harness evaluates them; no manual promotion of `NOT_RUN`/`INSUFFICIENT_EVIDENCE` to `PASS`.

### Forbidden scope

Do not:

- claim or perform Candidate Freeze (T024), Hidden Validation (T025), Version Closure (T026), Release Qualification (T027) or Repository Integration (T028);
- run hidden/private validation packs — everything T019 runs is visible regression;
- add new feature scope, new product behavior, or new adapters;
- change tests/baselines/oracles after seeing product-gate results;
- fold any unreviewed high-blast fix into the candidate;
- semantically modify consumed packages (the 16 `packages/*`), `apps/` sources, or Frozen docs to make regression pass;
- mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T019 Task Pack;
- let `.agent/execution/**` enter any shipped package (T018 audit rule continues to hold).

## Required outputs

1. Candidate manifest recording: exact candidate SHA/tree, producing branch, base ancestry (descends from `6e512e6e…`), full visible regression suite results with command identities, S1–S6 harness availability, package build/smoke evidence references, and the truthful G0/G1 gate status board snapshot.
2. Executed full visible regression evidence: clean bootstrap log/result, `pnpm ci:verify` result, `pnpm test:unit` full-workspace result (all suites enumerated, all green or candidate FAIL), version-validation harness suite results, `node build/package.ts` + `node build/smoke.ts` results with refreshed `build/evidence/*.json`.
3. Gate evaluations: `gateStatusBoard()` output on the exact candidate, evaluated through `evaluateGate` from actually captured evidence, recorded as-is.
4. Explicit non-claims recorded with the candidate: NO hidden validation was run (T025's), NO Candidate Freeze occurred (T024's), NO version closure/release qualification is claimed (T026/T027's), NO version-level visible Validation PASS is claimed (T020–T023's). Concern-level validation scope only: clean bootstrap, configured CI, full unit/contract/integration, S1–S6 harness discovery, package smoke and currentness.
5. Any bounded defect repair carries its separate authorization reference and its own review outcome; none may be silently folded in.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- the exact candidate-manifest file name/schema within `.agent/execution/T019/` (evidence-only; must contain at minimum the identity fields above);
- the execution order of the visible regression preconditions, provided all of them execute on the same exact candidate commit;
- whether a currently red suite justifies a separately authorized bounded repair or a candidate FAIL report — repairs always require separate authorization; re-running after an authorized repair creates a new exact candidate identity;
- narrowly necessary root script/config wiring when a tooling defect blocks the regression run itself (tooling-only, directly necessary, recorded);
- the depth of environment provenance recorded with each suite result (host, toolchain versions, commit), which must at minimum identify the exact candidate.

## Verification commands available on the exact base

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit          # full workspace: 16 packages/*/test, incl. version-validation harness suites
pnpm ci:verify          # format:check && lint && typecheck && test:unit
node build/package.ts   # production package build (T018)
node build/smoke.ts     # package smoke; refreshes build/evidence/*.json
```

The T003 version-validation machinery on the exact base: `packages/version-validation/src/gates.ts` (`GATE_DEFINITIONS` for G0, G1a–G1d with G2–G4 statuses recorded; `evaluateGate`; `gateStatusBoard`), `g0-plan.ts` (`decodeG0BaselinePlan`), corpora/oracles (S1–S6, C01–C34), journeys and evidence-capture modules, with their own executable suites under `packages/version-validation/test/`.

T019 concern Validation is the visible regression convergence described above. Version-level visible Validation is owned by T020–T023 on the exact T019 candidate; this JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T019 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: convergence would require violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules — a candidate prepared on a stale base is invalid and requires successor preparation.

## Non-authority note

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. If `.dev-standard/PROJECT_OVERRIDES.md` descriptive text conflicts with the durable execution facts above (dependency closures, base identity), treat the facts as current and the conflict as an authority contradiction to route, not something to silently rewrite here.
