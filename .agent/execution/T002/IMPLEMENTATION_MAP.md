# T002 Implementation Map — exact base `72b04774592265953671f7203d5ca0687da5b033`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T002 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies | Modify only if narrowly necessary for T002 package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T002 product/domain code belongs under the already-existing `packages/*` seam. `apps/*` is outside T002. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T002 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T002 contract/schema/negative tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T002 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/` | currently contains only T001 toolchain smoke packages | Create only the minimal T002 domain/public contract package(s) needed. Do not repurpose smoke packages as Product/domain authority. |
| `packages/toolchain-smoke-core/` | pure T001 smoke package with ESM package export | Reference only for local workspace/package mechanics; not domain architecture. |
| `packages/toolchain-smoke/` | T001 workspace-link/toolchain tests | Leave outside T002 concern unless an unavoidable root-toolchain compatibility repair is necessary. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics through Stage 1 freeze record | Read-only authority for AcquisitionContract, SelectionSnapshot, result model, S1-S6 and C01-C34. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority for Core ownership, identity/locator split, typed evidence, budget authority and adapter boundaries. |
| `docs/implementation/v0.1.0/task-packs/T002_canonical-domain-contracts.md` | frozen T002 WHAT blob `ca43f082a9ecf083b4ca755c2706809c5fab82f4` | Read-only task authority. |
| `.agent/execution/T002/` | JIT pack created by Issue #51 on the T002 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** existing domain-contract package, public schema package, downloader/core runtime package, browser package, persistence package, application package or product adapter package. T002 therefore must create the minimum contract-layer package surface rather than wiring into a non-existent Product runtime.

This absence is not permission to invent later architecture. T002 stops at canonical contracts/schemas/pure semantic rules and their tests.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a very small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- public versioned contract types and discriminants;
- stable/branded logical identifiers;
- runtime decode/validation at trust boundaries;
- pure semantic predicates/legal-combination rules;
- fixtures covering compatibility and negative states;
- tests mapping to `TEST_MATRIX.yaml`, including C01-C34 contract-level oracles.

Do not split by Desktop/Browser/CLI and do not add persistence/network/media implementations.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`. A new runtime validation dependency is therefore a material T002 implementation choice, not an assumed base capability. Under F1 the Builder may:

1. use small deterministic validators implemented inside the T002 package; or
2. add one narrowly justified runtime validation/schema dependency.

If option 2 is chosen, the implementation candidate must record exact package/version/license/provenance and demonstrate that dependency semantics do not redefine Product/L2 authority. The JIT pack intentionally does not preselect a library.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T002 tests should remain package-local and should cover:

- decode/validation success for canonical legal values;
- malformed/unknown/incompatible version rejection;
- semantic negative-state rejection;
- immutability/successor rules;
- identity-versus-locator rules;
- C01-C34 contract-level fixture/oracle mapping;
- S1-S6 representation-only coverage.

No browser, filesystem, database, real network, media transfer or UI harness belongs in T002 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T002 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
