# T019 L3 Reference Pack — version candidate preparation + visible regression convergence

Task: `T019` / Issue `#38`  
Bound base: `version/v0.1.0@6e512e6e5397eae14bb1a4aa7d0722d517641b88` (tree `daa0853ddb6b61dbc781c9df111fe8a69f765eda`)  
Evidence order: **Executed regression results → Gate status board → Candidate identity record → Repair authorizations (if any) → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not run Validation and does not create the candidate; the Builder does, on the exact candidate commit.

## 1. Executed regression results — highest priority references

### 1.1 The visible regression engine already on the base

T003 delivered the complete visible regression machinery in `packages/version-validation/`. T019 does not rebuild it; T019 runs it on the exact candidate and records what it says:

- `src/gates.ts` — `GATE_DEFINITIONS` (frozen gate/metric definitions for **G0** REQUIRED, **G1a** REQUIRED_FOR_S5_S6, **G1b** REQUIRED_WHEN_S6_CONTINUATION, **G1c** REQUIRED_WHEN_SEMANTIC_SELECTION, **G1d** RECOMMENDED_NON_BLOCKING for v0.1.0, plus G2–G4 recorded statuses; PRD §32 refs), `GateResult = PASS | FAIL | INSUFFICIENT_EVIDENCE`, `GateStatus` (adds `NOT_RUN`), `evaluateGate(evidence)`, `gateStatusBoard()`.
- `src/g0-plan.ts` — `decodeG0BaselinePlan`, draft builders; enforces PRD §32.2 pre-registration (baseline/comparison-set/aggregation fixed before Phase B; C33 invalidation on change).
- `src/oracles.ts` + `src/oracle-corpus.ts` — C01–C34 Product counterexample oracles.
- `src/corpora.ts` + `src/corpus-data.ts` — S1–S6 corpora; `src/journeys.ts` + `src/journey-data.ts` — Critical Journeys (PRD §31).
- `src/evidence-capture.ts`, `src/denominator.ts`, `src/truth-source.ts` — exact-subject evidence capture, denominator accounting, truth-source independence.
- 8 executable suites under `test/`: corpora-identity, denominator-accounting, evidence-exact-subject, g0-baseline-plan, gates, harness-determinism, journeys, oracles-c01-c34.

### 1.2 Run mechanics on the exact base

```text
# 1. clean bootstrap
pnpm install --frozen-lockfile          # Node 24.21.0, pnpm 12.8.1 — record versions

# 2. configured CI + full workspace regression (one commit = the candidate)
pnpm ci:verify                           # format:check && lint && typecheck && test:unit
pnpm test:unit                           # vitest over all 16 packages/*/test

# 3. production package build + smoke (T018 pipeline)
node build/package.ts
node build/smoke.ts                      # refreshes build/evidence/*.json

# 4. record identity + gate board + suite results in the candidate manifest
git rev-parse HEAD; git rev-parse HEAD^{tree}
```

Practical honesty rules:

- Run every suite from one working tree at one exact commit; record `git rev-parse HEAD` and `git rev-parse HEAD^{tree}` from that tree.
- Enumerate every suite in the manifest — a bare "N passed" is not an identity-preserving record; a red suite must be named, not aggregated away.
- If anything is red, the candidate is FAILED for binding purposes. Repair only with separate authorization; a repaired state is a NEW candidate needing the full run again.

## 2. Contract / interface references

### 2.1 The candidate manifest (the version artifact T019 owns)

The Frozen Task Pack acceptance: *"exact candidate SHA/tree recorded and thereafter immutable for T020–T023"*. The manifest is the durable record of that. Minimum content:

```yaml
candidate_id: <stable label, e.g. xdownload-v0.1.0-candidate-<short-sha>>
commit_sha: <exact full SHA>
tree_sha: <exact full tree SHA>
branch: <producing branch>
base_ancestry: descends-from 6e512e6e5397eae14bb1a4aa7d0722d517641b88
merged_implementation: T003-T018 all merged (PRs #57..#77 + #72 hardening)
visible_regression:
  clean_bootstrap: <result + toolchain versions>
  ci_verify: <per-gate results>
  full_unit_suites: <per-suite enumerated results, all green>
  s1_s6_harness: <available + suites green>
  package_build_smoke: <results + refreshed build/evidence refs>
gate_status_board: <gateStatusBoard() output, as emitted>
non_claims:
  candidate_freeze: NOT_CLAIMED   # T024
  hidden_validation: NOT_RUN      # T025
  version_closure: NOT_CLAIMED    # T026
  release_qualification: NOT_CLAIMED # T027
  version_level_validation: NOT_CLAIMED # T020-T023
repairs: []                       # each entry: separate authorization ref + review identity
immutability: binding-for-T020-T023-once-recorded
```

Place it under `.agent/execution/T019/` (evidence-only, package-excluded). Keep the schema honest and flat; do not invent fields that imply authority T019 does not have (no freeze verdicts, no closure checklists).

### 2.2 Authority map for every downstream gate (so non-claims stay exact)

| Gate | Owner | T019 role |
| --- | --- | --- |
| Concern-level visible regression (bootstrap/CI/full discovery/S1–S6 harness/package smoke/currentness) | T019 (this task) | run + record on exact candidate |
| G0/G1a–d gate *evaluation machinery* | T003 harness | execute + record board as emitted |
| G0/G1a–d product *measurement* Validation | T020–T023 | none — board stays truthful/ sparse |
| Candidate Freeze | T024 | none — supplies the identity it will freeze |
| Hidden Validation | T025 | none — explicitly not run |
| Version Closure | T026 | none |
| Release Qualification | T027 | none |
| Repository Integration | T028 | none |

## 3. Core implementation patterns worth reusing conceptually

### 3.1 One candidate, one run, one identity

The DAG makes T019 the single serial convergence point (TASK_DAG §"Serial convergence … T019 (one exact candidate)"), after which T020–T023 fan out in parallel (max width 4) on the **same immutable exact candidate**. Everything in the manifest must therefore be derivable from `(commit_sha, tree_sha)` alone. If any recorded fact cannot be reproduced from that identity, the record is incomplete.

### 3.2 Truthful sparseness of the gate board

At candidate-preparation time, product-gate measurements (real-host Critical Journeys, baseline comparisons, ablations) are T020–T023 work. A board of mostly `NOT_RUN` is the correct output. The failure mode to design against is *promotion*: any code path or manual edit that turns `INSUFFICIENT_EVIDENCE`/`NOT_RUN` into `PASS` without `evaluateGate` accepting real evidence is a false-validation claim (PRD §20–§22 semantics; `test-tooling-failure`/`false-gate-pass` failure classes).

### 3.3 C33 discipline as an operational rule

PRD C33 (and the Frozen Task Pack forbidden scope) invalidate a run when protocol/template/support/decision-rule/baseline identity changes after results were visible. Operationally: freeze the run configuration (suite list, commands, environment) **before** executing, and never edit tests/corpora/oracles/baselines in the same lifetime as a recorded result. Config-with-results is a new run.

### 3.4 Bounded repair loop

```text
red suite → classify (product defect vs tooling vs environment)
  → tooling/environment: fix harness invocation only, rerun same candidate-state
  → product defect: STOP; separate authorization → bounded fix → NEW commit
    → NEW full visible regression run → NEW candidate identity
```

Never "hot-fix" inside a recorded candidate. Never widen a bounded fix into refactoring.

## 4. Failure handling patterns

- Any red visible suite → `CANDIDATE_REGRESSION_FAIL` — no waiver, no skip, no tolerance. The candidate simply does not converge; that is a valid, honest outcome to report.
- Unavailable toolchain/host → `VALIDATION_NOT_EXECUTED` with exact command/environment; no PASS from an unexecuted gate.
- Base drift (`version/v0.1.0` advanced) → re-classify under pack-staleness rules; a stale-base candidate is invalid, never silently rebound.
- Contradiction with higher authority → `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` routing per the Frozen Task Pack.

## 5. Examples / docs mapping to T019 acceptance

| Acceptance concern (Frozen Task Pack) | Where it comes from | Required T019 proof |
| --- | --- | --- |
| Clean bootstrap | root lockfile/toolchain pins | `pnpm install --frozen-lockfile` result + toolchain versions |
| CI | root `ci:verify` script | per-gate results on exact candidate |
| Full unit/contract/integration discovery | `vitest.config.ts` over `packages/*/test` | per-suite enumerated results, all green |
| S1–S6 harness available | `packages/version-validation` corpora/journeys/oracles | harness suites execute green |
| Production package builds | `build/package.ts` + `build/smoke.ts` (T018) | build/smoke results + refreshed `build/evidence/*.json` |
| All implementation PRs merged | `version/v0.1.0` history at `6e512e6e…` | merged-state statement in manifest |
| Exact candidate SHA/tree recorded, thereafter immutable | this task's own manifest | candidate manifest with SHA/tree + immutability rule |

## 6. Dependency/version/license facts

No new dependency is introduced by T019. Everything used is already pinned on the base:

| Tool | Version on base | Role |
| --- | --- | --- |
| Node | 24.21.0 | runtime/toolchain |
| pnpm | 12.8.1 | workspace/lockfile bootstrap |
| TypeScript | 5.9.3 | `typecheck` gate |
| Vitest | 4.1.11 | full workspace regression runner |
| ESLint / Prettier | per root lockfile | lint/format gates |

If a tooling defect forces a toolchain change, that is a narrowly necessary convergence change to be recorded — and it changes the candidate identity, requiring the full run on the new state.

## 7. Do / Don't

### Do

- run the full visible regression on exactly one commit and record its SHA/tree from that tree;
- enumerate every suite result; name every red suite;
- record `gateStatusBoard()` output verbatim, sparse and honest;
- write the candidate manifest after the run, in the evidence-only location;
- state the non-claims explicitly (T020–T023, T024, T025, T026, T027);
- treat repairs as separate authorized events that create new candidates.

### Don't

- don't waive, skip, or retry-to-green a red suite and call the candidate converged;
- don't change tests/baselines after seeing gate results (C33);
- don't promote gate statuses by hand;
- don't claim freeze/hidden-validation/closure/release anything;
- don't fold an unreviewed high-blast fix into the candidate;
- don't let `.agent/execution/**` into a shipped package;
- don't run a private/hidden validation pack alongside — T019 is visible-only.

## 8. Reuse / license risk

None material: no new dependency, no copied code. The candidate manifest is original evidence describing this repository's own state.

## 9. Validation boundary

This Reference Pack does not prove T019. The Builder executes the visible regression on the exact candidate; T019 concern Validation PASSes only on that executed, all-green, identity-complete state; version-level visible Validation is T020–T023's, on the exact T019 candidate; Fresh Independent Review is separately required because T019 is `risk:critical` and `review:required`.
