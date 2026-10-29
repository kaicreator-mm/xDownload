# T008 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T008 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies; no runtime dependencies | Modify only if narrowly necessary for T008 adapter/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T008 direct-acquisition adapter code belongs under the already-existing `packages/*` seam. `apps/*` is outside T008. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T008 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T008 controlled-server protocol tests should fit this existing test seam (Node env can host a localhost fixture server). |
| `eslint.config.js` | root lint authority established by T001 | T008 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 output: canonical domain vocabulary — `ids`, `decode`, `version`, `contract`, `scope`, `snapshot`, `budget`, `result`, `evidence`, `slices`, `diagnostics`, `ports` (`DomainGateway`, `SurfaceCommand`, effect-identity envelope, `TerminalResultProjection`); tests include `identity-locator.test.ts` and `oracles-c01-c34.test.ts` | Consume as the only canonical domain vocabulary. The T008 adapter must translate through these ports (effect identity, budget, evidence/validation, result), never fork or shadow them. If a needed canonical value is genuinely absent, escalate as `TASK_PACK_DEFECT`/`ARCHITECTURE_CONTRADICTION` rather than inventing competing truth. |
| `packages/toolchain-smoke-core/`, `packages/toolchain-smoke/` | T001 toolchain smoke packages | Leave outside T008 concern. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics; S1/S3 slice definitions (§28), TransferBudget/GlobalSafetyBudget (§15), Validation Layers (§22), result model (§16–19), counterexample corpus C01–C34 (§35) | Read-only authority. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7`; §6.5 download/media execution boundary and HTTP resume/retry candidate rules; U5; ADR-006/ADR-011; invariants 4/7/17/18 | Read-only authority for the adapter boundary, resume rule, identity/locator split and budget path. |
| `docs/implementation/v0.1.0/task-packs/T008_direct-http-transfer.md` | frozen T008 WHAT blob `8e4135d31bf495915f98586ff958415a467e4d52` | Read-only task authority. |
| `.agent/execution/T008/` | this JIT pack | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** HTTP/network adapter package, no transfer runtime, no persistence package, no scheduler and no browser package. T008 therefore creates the minimum direct-acquisition adapter surface rather than wiring into a non-existent runtime. The exact base also has **no runtime dependencies**; built-in Node HTTP capability (`fetch`/undici globals, `node:http`/`node:https`) exists on the pinned Node `24.21.0` runtime without a new dependency.

This absence is not permission to invent later architecture. T008 stops at the direct HTTP/file adapter, its controlled protocol fixtures and their tests. HLS VOD (S4), browser handoff (S2), collections (S5/S6), persistence, scheduling and surfaces remain in other lanes.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a very small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- adapter port implementation consuming `packages/domain-contracts` types (effect/command in, canonical evidence/validation/result out);
- representation-identity/validator tracking (strong validator, `If-Range` decision, ETag/Last-Modified handling);
- range/resume state and the restart-vs-append decision;
- redirect/CDN/signed-locator handling with provenance binding against the frozen logical target;
- integrity hooks (transfer completeness, format probe, target identity match, S3 media checks as applicable);
- budget consumption reporting onto the canonical budget/effect identities (the authoritative ledger itself is Core-owned and not T008's to implement);
- controlled localhost HTTP fixture server + scenario fixtures;
- tests mapping to `TEST_MATRIX.yaml`, including the applicable C-oracle subset.

Do not split by surface (Desktop/Browser/CLI) and do not add persistence, scheduling, discovery or HLS implementation.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`. Under F1 the Builder may:

1. use Node built-in HTTP capability only (no new dependency); or
2. add one narrowly justified runtime HTTP/client dependency.

If option 2 is chosen, the implementation candidate must record exact package/version/license/provenance and demonstrate that dependency semantics do not redefine Product/L2 authority. The JIT pack intentionally does not preselect a library.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T008 tests should remain package-local against a controlled localhost server (task-owned fixture; deterministic, no third-party network) and should cover:

- strong-validator and no-validator resume semantics (`If-Range` present/absent);
- range support and validator/range change handling;
- safe restart when identity cannot be proven;
- truncation detection and non-acceptance;
- retry budget consumption and lineage stability;
- provenance-bound redirects/signed-locator refresh vs unrelated redirect rejection;
- wrong-target/integrity/corruption fail-closed outcomes;
- applicable C-oracle subset (C09/C12/C13/C27/C28/C29) at transfer level.

No real external network, browser, database or UI harness belongs in T008 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T008 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
