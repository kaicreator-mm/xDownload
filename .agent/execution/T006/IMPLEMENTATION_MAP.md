# T006 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T006 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm; TypeScript/Vitest/ESLint/Prettier are dev dependencies; no runtime dependencies | Modify only if narrowly necessary for T006 package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T006 scheduler/control code belongs under the already-existing `packages/*` seam. `apps/*` is outside T006. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T006 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T006 state-machine/property/negative tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T006 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 output, merged PR #52: `ContractId`/`SnapshotId`/`LogicalTargetId`/`MemberId`/`EffectId`/`AuthorizationContextRef` branded identities, `DiscoveryBudget`/`TransferBudget`/`GlobalSafetyBudget`/`BudgetProfile`/`BudgetRemaining`, `DomainGateway`, `TerminalResult`, fail-closed decode and legal-combination semantics with C01–C34 contract oracles | Read-only consumption as T006's canonical vocabulary. T006 must not fork, re-declare or weaken these types/validators. New control-layer types (lineage state, control transitions, control facts) compose these identities. |
| `packages/toolchain-smoke-core/`, `packages/toolchain-smoke/` | T001 smoke packages | Reference only for workspace mechanics; leave outside T006. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics | Read-only authority: §15 budget domains and §15.4 exhaustion precedence, CJ-06 retry/resume, §16.5 StopReason (incl. `USER_CANCELLED`), §30 failure taxonomy, C13/C23/C28. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: invariants 1/2/3/7/8/20, D9, ADR-010/013, cancellation/dispatch-suppression/duplicate-client semantics. |
| `docs/implementation/v0.1.0/task-packs/T006_scheduler-budget-cancellation.md` | frozen T006 WHAT blob `4d60ae15afbc993a8b37ae0d6d7bfc850fffc36d` | Read-only task authority. |
| `.agent/execution/T006/` | JIT pack created by this prep on the T006 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** scheduler/control package, no runtime/persistence package, no adapter lane package and no application package. T002's `packages/domain-contracts` is the only product-domain package. T006 therefore must create the minimum scheduler/control-layer package surface rather than wiring into a non-existent runtime.

This absence is not permission to invent later architecture. T006 stops at the scheduling/control state machine, single budget mutation ordering, cancellation cutoff, lineage/convergence semantics and their tests. The durable SQLite/filesystem ledger, production schema/migrations and DB/filesystem reconciliation remain T005 (#24)/T015 (#34); the concrete Core Runtime convergence remains T015.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- lifecycle control state machine over frozen lineage (typed transitions, deterministic reducer/transition table);
- single budget mutation path (reservation/consumption ordering, exhaustion precedence, remaining-budget accounting);
- cancellation-vs-acceptance cutoff decision (pure ordering predicate over durable control facts);
- dispatch suppression and duplicate-submit convergence rules;
- durable effect lineage/idempotency key semantics (reusing `EffectId`/`ContractId`/`SnapshotId`);
- the injectable durable-control-facts seam left implementable by T005/T015;
- deterministic in-memory factual stores + fixtures;
- tests mapping to `TEST_MATRIX.yaml`, including T006-O01–O16 and the cancel timing matrix.

Do not split by Desktop/Browser/CLI and do not add SQLite/filesystem/network/media implementations.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`. A new runtime scheduling/state-machine dependency is therefore a material T006 implementation choice, not an assumed base capability. Under F1 the Builder may:

1. implement bounded deterministic control logic inside the T006 package; or
2. add one narrowly justified runtime dependency.

If option 2 is chosen, the implementation candidate must record exact package/version/license/provenance and demonstrate that dependency semantics do not redefine Product/L2 authority. The JIT pack intentionally does not preselect a library.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T006 tests should remain package-local and should cover:

- deterministic state-machine transition legality/illegality (all cancel-timing matrix cells);
- budget exhaustion precedence and non-replenishment across restart/retry;
- single-mutation-path enforcement under concurrent/duplicate clients;
- cutoff decisions as pure functions of durable fact order, including across process death/reopen;
- duplicate-client convergence to one lineage/effect/artifact;
- retry/resume frozen-lineage constraints;
- T006-O01–O16 oracle mapping;
- negative coverage from `TEST_MATRIX.yaml`.

No browser, filesystem/SQLite engine, real network, media transfer or UI harness belongs in T006 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T006 branch descends from the manifest base (`c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`);
- frozen Task Pack/ADS identities still match (`4d60ae15afbc993a8b37ae0d6d7bfc850fffc36d`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission (issue #25 remains the canonical live work item).
