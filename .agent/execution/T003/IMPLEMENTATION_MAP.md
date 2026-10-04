# T003 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T003 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies | Modify only if narrowly necessary for T003 validation-package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T003 validation infrastructure belongs under the already-existing `packages/*` seam. `apps/*` is outside T003. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T003 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T003 harness self-tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T003 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 output `@xdownload/domain-contracts` (merge `c813d3a1`): `src/{contract,scope,snapshot,budget,result,evidence,ids,decode,diagnostics,ports,slices,version,index}.ts`; tests include `oracles-c01-c34.test.ts` | Primary integration point. T003 corpora/oracles/plan records must bind these canonical identities/results, not re-declare competing vocabulary. Read/consume only; do not modify T002-owned contracts. |
| `packages/toolchain-smoke/`, `packages/toolchain-smoke-core/` | T001 toolchain smoke packages | Leave outside T003 concern. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product authority | Read-only source for §16–§19 result/coverage rules, §20–§22 evidence/confirmation/validation layers, §28 S1–S6, §30 failure taxonomy, §31 CJ-01..CJ-09, §32/32.1/32.2 gates + G0 baseline protocol, §33 corpora, §34 ablation, §35 C01–C34. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority; §18 lane hint "Validation harness": stable input = Frozen Product counterexamples + Frozen L2; ownership = fixtures/contract/CJ harness; convergence = version validation. |
| `docs/implementation/v0.1.0/task-packs/T003_validation-harness-corpora.md` | frozen T003 WHAT blob `39c205ec8ee9ccd9b6f47eeca401ec1ee76c307e` | Read-only task authority. |
| `.agent/execution/T003/` | this JIT pack | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** version-validation package, no corpus registries, no G0BaselinePlan registration, no denominator accounting, no Critical Journey harness definitions and no gate instrumentation. T003 must create this minimum infrastructure surface. There is also no T019 candidate yet — G0/G1 and C-execution against a product are structurally impossible here and must remain `NOT_RUN`.

This absence is not permission to invent later architecture. T003 stops at harness/corpus/plan/oracle infrastructure and its self-tests.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package (e.g. `packages/version-validation/`) or a very small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- corpus registries and frozen task-case identities (Natural/Collection/Hard/Holdout across S1–S6);
- C01–C34 oracle corpus records and loader;
- G0BaselinePlan schema/registration/immutability;
- denominator/UNKNOWN/abandonment accounting;
- Critical Journey (CJ-01..CJ-09) definitions with pre-registered expectations;
- gate instrumentation definitions for G0/G1a–G1d (evaluation functions, NOT_RUN by default);
- evidence exact-subject capture/formatting helpers;
- controlled fixtures/fixture-server helpers that stay deterministic and offline;
- harness self-tests mapping to `TEST_MATRIX.yaml`.

Naming conventions to follow: scoped private workspace package name matching the existing `@xdownload/<name>` convention (`@xdownload/domain-contracts` precedent); ESM (`"type": "module"`); package entry via `exports` pointing at source like T002 did; tests in `packages/<pkg>/test/*.test.ts` so the existing `vitest.config.ts` and `tsconfig.json` includes discover them without config changes.

Do not split by Desktop/Browser/CLI and do not add product runtime implementations.

## Integration points with `@xdownload/domain-contracts`

Per the frozen dependency note (TASK_DAG: "**T003** ← `T002` — validation corpora/oracles must bind Frozen canonical identities and result semantics"):

- oracle expected tuples use the canonical status enums (`result.ts`: RequestFulfillment/TargetResolution/SelectionAcquisition/Coverage/StopReason, ValidationSummary);
- corpus task-case records reference contract/snapshot/identity types (`contract.ts`, `snapshot.ts`, `ids.ts`, `scope.ts`) rather than ad-hoc shapes;
- evidence capture/formatting uses `evidence.ts` claim identities (claim_type, subject, provenance, independence) and `diagnostics.ts` conventions for typed failures;
- budget-domain fields in scenario definitions use `budget.ts` domains; slice tagging uses `slices.ts` S1–S6 representation;
- decode of harness/plan/oracle inputs from `unknown` should reuse `decode.ts`/`version.ts` patterns so harness data fails closed like canonical data.

If a needed canonical binding does not exist, that is an upward-routing Oracle/Product ambiguity or `ARCHITECTURE_CONTRADICTION` signal — not a reason to fork semantics inside T003.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T003 harness self-tests should remain package-local and should cover:

- corpus identity stability/immutability and load determinism;
- C01–C34 oracle corpus loads completely with canonical-bound expected statuses;
- G0BaselinePlan registration, freeze and tamper/invalidation detection;
- denominator/UNKNOWN/abandonment accounting rules (PRD §32.1);
- evidence exact-subject binding and non-self-certification;
- CJ definitions completeness against PRD §31;
- gate instrumentation evaluates NOT_RUN/PASS/FAIL/INSUFFICIENT_EVIDENCE correctly on synthetic recorded evidence without claiming any real gate result.

No live-network, real-browser, real-persistence or real-media harness belongs in T003 concern tests; controlled fixtures must be deterministic.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T003 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`39c205ec8ee9ccd9b6f47eeca401ec1ee76c307e`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
