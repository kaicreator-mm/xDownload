# T019 Implementation Map — exact base `6e512e6e5397eae14bb1a4aa7d0722d517641b88`

This map records seams that exist on the exact integration base (tree `daa0853ddb6b61dbc781c9df111fe8a69f765eda`). It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T019 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace, `version: 0.1.0`; scripts `build`, `smoke`, `format:check`, `lint`, `typecheck`, `test:unit`, `ci:verify` | Run as-is for the visible regression preconditions. Edit only when a tooling defect blocks the run itself (narrowly necessary, recorded). |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml` | workspace admits `packages/*` and `apps/*`; frozen lockfile is the clean-bootstrap basis | `pnpm install --frozen-lockfile` from clean state is the bootstrap gate. Do not relax frozenness. |
| `vitest.config.ts` | Node environment; discovers `packages/*/test/**/*.test.ts` across all 16 packages | The full visible unit/contract/integration discovery seam. All suites must run and be green on the exact candidate. |
| `packages/version-validation/` | T003 visible regression engine: `src/gates.ts` (`GATE_DEFINITIONS` G0/G1a–G1d + G2–G4 statuses, `evaluateGate`, `gateStatusBoard`), `src/g0-plan.ts` (`decodeG0BaselinePlan`, pre-registered baseline plans), `src/oracles.ts`/`oracle-corpus.ts` (C01–C34), `src/corpora.ts`/`corpus-data.ts`, `src/journeys.ts`/`journey-data.ts` (S1–S6 Critical Journeys), `src/evidence-capture.ts`, `src/denominator.ts`, `src/truth-source.ts`; 8 executable test suites under `test/` | The harness whose availability is a T019 acceptance fact and whose gate API produces the truthful G0/G1 status board on the exact candidate. Consume read-only; no semantic modification. |
| `packages/converged-runtime/` | T017 surface + AI convergence: `surfaceBinding.ts`, `aiSuggestionLane.ts`, `providerDeadline.ts` | Consumed as-is; part of the converged subject under regression. |
| `packages/core-runtime/` | T015 authoritative Core: `runtime.ts`, `flow.ts`, `durable-stores.ts`, `budget-bridge.ts` | Consumed as-is; part of the converged subject under regression. |
| Other 13 `packages/*` | domain-contracts, persistence-ledger, core-scheduler, core-seam, direct-acquisition, discovery-recipe, hls-vod-adapter, browser-observation, browser-auth-broker, browser-collection-workflow, ai-proposal, toolchain-smoke, toolchain-smoke-core | Consumed as-is; all their suites are in the full visible regression denominator. |
| `apps/cli`, `apps/desktop`, `apps/browser-extension` | T018-packaged surfaces, `version: 0.0.0` manifests | Subject to package build/smoke via the root scripts; not semantically modified by T019. |
| `build/` | T018 packaging pipeline: `package.ts`, `smoke.ts`, `audit.ts`, `build-config.ts`, `identity.ts` (package identity emission), `support-matrix.json`, `native-host*.ts`, `core-host.ts`, `test/` | Run `node build/package.ts` and `node build/smoke.ts` on the exact candidate; refreshed `build/evidence/*.json` is candidate convergence evidence. |
| `build/evidence/` | existing T018 evidence: `build-reproducibility.json`, `windows-cli-core-clean-install.json`, `windows-native-host-smoke.json` | Refresh by re-running the T018 pipeline on the exact candidate; every refreshed file must name the exact candidate revision/identity per the T018 package-identity rules. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics; §31 Critical Journeys, §32.2 `G0BaselinePlan` pre-registration, §32 G0 (REQUIRED) + G1a (REQUIRED for S5/S6) + G1b (when S6 continuation) + G1c (when semantic selection) + G1d (RECOMMENDED/non-blocking v0.1.0), §35 C01–C34 | Read-only authority for gate applicability and regression honesty rules. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority; convergence must not weaken any invariant. |
| `docs/implementation/v0.1.0/task-packs/T019_candidate-preparation-visible-regression.md` | frozen T019 WHAT blob `5d2cd990b108fd5602a10b88d4fe5625011ea858` | Read-only task authority. |
| `docs/implementation/v0.1.0/TASK_DAG.md` | frozen DAG: T019 is the serial convergence point; T020–T023 run in parallel on the same immutable exact candidate (max width 4); T024 ← T020–T023; T025 hidden validation after freeze | Read-only authority for what the candidate must be: one exact SHA/tree identity. |
| `.agent/execution/T019/` | this JIT pack + the future candidate manifest | Evidence only. Never shipped as product content; not implementation source. |
| `.agent/execution/T001–T018/` | prior task packs and evidence | Read-only precedent; T018's packaging honesty/audit rules continue to bind what may enter the candidate. |

## Convergence facts that matter at the bound base

- All implementation work is already merged at base `6e512e6e…`: PR #57 (T003) through PR #77 (T018), including the #72 T010 hardening merges. T019 convergence therefore starts from a fully merged implementation state; its job is regression proof + candidate identity, not feature completion.
- The regression denominator is the full workspace: every `packages/*/test` suite (16 packages, including the 8 version-validation suites) plus root gates (`format:check`, `lint`, `typecheck`) and the build/smoke pipeline.
- The G0/G1 gate board at candidate-preparation time is expected to be honestly sparse: product-gate measurement Validation is T020–T023 work on real hosts. `NOT_RUN`/`INSUFFICIENT_EVIDENCE` entries are correct and truthful at this stage; manufacturing PASSes is forbidden.
- Candidate immutability begins when the candidate manifest records the exact SHA/tree. T019's own pack commit is NOT the candidate; the candidate is the commit on which the full visible regression actually ran and whose tree hash was observed.

## Expected evidence placement seam

- Candidate manifest + convergence/gate-status evidence: `.agent/execution/T019/` (evidence-only, package-excluded).
- Build/smoke evidence: refreshed `build/evidence/*.json` (as produced by the T018 pipeline's own conventions).
- Repair authorizations (if any): referenced in the candidate manifest with their separate review identity.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T019 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
