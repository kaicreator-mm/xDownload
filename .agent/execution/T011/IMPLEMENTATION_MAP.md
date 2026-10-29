# T011 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T011 use / constraint |
| --- | --- | --- |
| `packages/domain-contracts/` | T002 output (`@xdownload/domain-contracts`), merged via PR #52. Exports canonical contract/snapshot/scope/budget/evidence/result vocabulary and the `DomainGateway` seam (`submitContract` with collection admission, `confirmSnapshot` with scope/continuation binding, `appendEvidence`, `projectTerminalResult`) | Read-only consumption. T011 builds discovery/recipe/confirmation logic on these canonical values. Do not modify its semantics; a required change routes to escalation, not local rewrite (DAG: parallel lanes "do not rewrite T002 contracts"). |
| `packages/domain-contracts/src/contract.ts` | `decodeAcquisitionContract`, `validateContractSemantics`, `confirmContract`, `admitCollectionContract` (§9 admission incl. frontier rejection), `deriveSuccessorContract`, `assertContractTransition` | T011 admits/dispatches only contracts that pass this boundary; successor continuation flows through `deriveSuccessorContract`. |
| `packages/domain-contracts/src/scope.ts` | `SCOPE_PRIMITIVES` (PRD §10 grammar), `ContinuationScope` (NONE / declared bounds), `decodeRequestedScope`, `validateScopeContinuationPair`, `sameScopeIdentity`, `sameContinuationIdentity` | The continuation vocabulary T011 honors is exactly this grammar; no new scope/continuation forms. |
| `packages/domain-contracts/src/snapshot.ts` | `buildSnapshot`, `validateSnapshotSemantics`, `assertSnapshotImmutable`, `planRetryOfFailedMembers`, `deriveSuccessorSnapshot`, `MemberBasis` kinds | Frozen confirmed membership, retry domain and successor derivation; T011 must not bypass or mutate. |
| `packages/domain-contracts/src/budget.ts` | `DiscoveryBudget`/`TransferBudget`/`GlobalSafetyBudget` values, `budgetRemaining`, `canStartNewDiscoveryWork`, `canTransferAfterDiscoveryExhaustion`, `assertNoDuplicateAllocation` | T011 reads budget state to decide stop/discover; the durable budget ledger/writer remains T006/scheduler. Budgets are constraints, never scope sources. |
| `packages/domain-contracts/src/evidence.ts` | `EvidenceRecord` (claim type/subject/provenance/scope/independence), `canServeAsIndependentValidationOracle`, `assertNoDiscoverySelfCertification`, confirmation outcomes `CONFIRMED/FAILED/ABANDONED/UNKNOWN/OUT_OF_SCOPE` | Discovery output is `DISCOVERY_DERIVED` evidence; membership/completeness truth needs `INDEPENDENT` provenance or correctly-scoped user confirmation claims. |
| `packages/domain-contracts/src/result.ts` | Multidimensional `TerminalResult` + `validateTerminalResult` legal-combination semantics (§16–§18) | T011 produces inputs to terminal projection; it never projects per-surface status or relaxes legal combinations. |
| `packages/domain-contracts/src/slices.ts` | S1–S6 `SupportSliceRepresentation` registry (PRD §28), S5/S6 surface class `COLLECTION` with `defaultContinuation` and required validation layers | T011 implements S5/S6 engine behavior consistent with these frozen declarations; the registry itself stays representation-only. |
| `packages/domain-contracts/src/ports.ts` | `DomainGateway`, `SurfaceCommand` (opaque identity references, never raw secrets) | The adapter-facing seam T011 logic should bind to; no new competing gateway authority. |
| `package.json` / `pnpm-workspace.yaml` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; workspace admits `packages/*` and `apps/*`; scripts `format:check/lint/typecheck/test:unit/ci:verify` | Modify only if narrowly necessary for T011 package/test wiring. `apps/*` is outside T011. |
| `tsconfig.json` / `vitest.config.ts` / `eslint.config.js` | strict TS incl. `packages/*/src` + `packages/*/test`; Vitest discovers `packages/*/test/**/*.test.ts`; T001 root lint authority | T011 source/tests should fit existing include patterns; lint edits must be tooling-only and directly necessary. |
| `packages/toolchain-smoke*/` | T001 toolchain smoke packages | Reference only; leave outside T011. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics; directly load-bearing sections for T011: §9 Collection Admission, §10 Scope Grammar + R01 continuation rules, §11 Collection Sets accounting, §12 SelectionSnapshot, §13 Automation Modes, §14 allowed/forbidden navigation, §15.1/§15.4 DiscoveryBudget, §19 Completeness Contract, §21 Confirmation Claims, §23 Recipe Contract, §28 S5/S6, §35 C01-C34 | Read-only authority. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7`; D5 (bounded discovery, no crawler frontier), §6.6 Recipe/AI boundary (`RecipeDefinition` + finite capability execution), responsibility seams `core/discovery` + `core/recipe-runtime`, ADR-007, data-ownership rows for Recipes/SelectionSnapshot/Evidence | Read-only authority. |
| `docs/implementation/v0.1.0/task-packs/T011_recipe-discovery-collection.md` | frozen T011 WHAT blob `2e4a3b178bb33a41ff8e47307a3915c4a0ca872d` | Read-only task authority. |
| `.agent/execution/T011/` | JIT pack created by T011 JIT-prep on the T011 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is no discovery/recipe/collection engine package, no scheduler/budget ledger (T006), no browser integration (T010), no persistence (T005), no acquisition runtime (T008/T009) and no application adapters. T011 therefore creates the minimum discovery/recipe/confirmation package surface consuming only `@xdownload/domain-contracts` values plus plain fixture inputs — it cannot wire into a real browser or a budget ledger that does not exist yet.

This absence is not permission to invent later architecture. T011 stops at recipe schema/interpreter, bounded discovery orchestration semantics, collection/member identity handling, continuation admission and selection/confirmation workflow logic plus their tests.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. Whatever layout is chosen should keep these concerns explicit and separate:

- Recipe schema + finite capability vocabulary + deterministic matcher/interpreter;
- bounded discovery orchestration (snapshot membership resolution, declared-bounds continuation stepping, natural-end handling, stop reasons);
- collection/member identity handling (identity correspondence, provenance-bound locator transitions);
- continuation/successor admission rules;
- selection/confirmation workflow logic (AUTO/ASSISTED/MANUAL_SELECTION, batch/manual confirmation admission);
- fixtures and tests mapping to `TEST_MATRIX.yaml`, including the applicable C01-C34 collection oracles.

Do not implement browser/network I/O, transfer, persistence, scheduler ownership, AI adapter, or Desktop/CLI surfaces, and do not split authority into surfaces.

## Dependency decision seam

The exact base has no new runtime dependencies beyond the T001 dev toolchain; `@xdownload/domain-contracts` is a workspace package, not an external dependency. Recipe matching may be implemented with pure in-repo deterministic code; under F1 the Builder may add one narrowly justified runtime dependency only if it does not redefine Product/L2 authority — if so, record exact package/version/license/provenance in the implementation evidence. The JIT pack intentionally does not preselect a library, and none is recommended.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T011 tests should remain package-local and cover:

- current-page snapshot membership freezing and `continuation_scope=NONE` exclusion/passive-completion behavior;
- declared batch/page-range/natural-end bound stepping and exact §10.2 result tuples;
- continuation/successor admission (successor required on expansion; exact frozen scope enforced);
- collection admission rejection incl. crawl/filter frontier (C06) and budget-as-scope rejection;
- discovery-budget stop semantics (C23/C28 shapes) without ledger implementation;
- identity-not-count completeness and provenance-bound member detail/CDN transitions (C01/C04/C07/C29);
- recipe decode/capability vocabulary positive and fail-closed negative cases;
- confirmation workflow (batch/manual resolution, confirmation-not-evidence rules, C26/C27/C30/C31/C34);
- S5/S6 slice-level behavior coverage per PRD §28.

No browser, filesystem, database, real network, media transfer or UI harness belongs in T011 concern tests. Fixture page/member corpora are structured local fixtures, not live-web fixtures (T003 owns the validation corpora).

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T011 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
