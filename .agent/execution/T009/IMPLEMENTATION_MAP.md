# T009 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T009 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies; no runtime dependencies yet | Modify only if narrowly necessary for T009 package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T009 HLS/media adapter code belongs under the already-existing `packages/*` seam. `apps/*` is outside T009. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T009 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T009 manifest/segment/media/negative tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T009 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 canonical contract layer (`@xdownload/domain-contracts`): `ids`, `scope`, `budget`, `evidence`, `contract`, `snapshot`, `result`, `slices` (incl. `SUPPORT_SLICE_IDS` with `S4` "HLS VOD Basic"), `ports` (`DomainGateway`, `TerminalResultProjection`), `decode`, `diagnostics`, `version` | The consumption contract for T009: bind against canonical target/effect/budget/validation/result vocabulary through these public exports. Never fork, shadow or locally redefine it. |
| `packages/toolchain-smoke-core/`, `packages/toolchain-smoke/` | pure T001 smoke packages | Reference only for workspace mechanics; leave outside T009. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics through Stage 1 freeze record | Read-only authority for S4 (§"S4 — HLS VOD Basic"), TransferBudget §15, result model, C28/C15/C27 and the "universal HLS/DASH track/post-processing support" exclusion. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority for U6/ADR-006 (distinct HLS adapter behind one acquisition port), HLS VOD candidate rules, invariants 4/17/18/19, A6 topology breadth and RFC 8216 as primary protocol standard. |
| `docs/implementation/v0.1.0/task-packs/T009_hls-vod-media.md` | frozen T009 WHAT blob `685e5f384c344872d23038525e1eefd3f1124145` | Read-only task authority. |
| `.agent/execution/T009/` | JIT pack created by this T009 JIT-prep action on the T009 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** HLS/media adapter package, acquisition-runtime package, HTTP-direct package, persistence package or application package. T009 therefore creates the minimal S4 adapter surface rather than wiring into a non-existent runtime. There is also no media assembly/probe tooling wiring anywhere in the repository; any such tooling is a new, port-confined implementation choice. This absence is not permission to invent later architecture (no Core runtime, no acquisition port ownership, no persistence).

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- HLS master/media playlist parsing and manifest/rendition binding;
- provenance-bound segment plan (locator derivation from the selected manifest only);
- segment acquisition effects under canonical `TransferBudget` semantics;
- media assembly/probe port plus the concrete tooling adapter behind it;
- manifest/rendition/segment/format/media/target validation;
- deterministic synthetic HLS fixtures (playlists, segments, truncations, encrypted/unsupported-topology variants);
- tests mapping to `TEST_MATRIX.yaml`, including the applicable C-oracle subset.

Do not implement Core runtime integration, generic HTTP transfer (T008 lane), browser acquisition (T010/T016 lanes) or persistence here.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`. A new runtime dependency (e.g., an HLS/playlist parser) or an external assembly/probe tool (e.g., a media CLI suite) is therefore a material T009 implementation choice, not an assumed base capability. Under F1 the Builder may:

1. implement bounded deterministic parsing/validation in-repo; or
2. add one narrowly justified runtime dependency; and/or
3. invoke an external media tool strictly behind the assembly/probe port.

For option 2/3 the implementation candidate must record exact package/tool name, version, license and primary source, and demonstrate that the dependency/tool does not redefine Product/L2 authority. Any tooling used by tests must be deterministic and locally available; unavailability is `VALIDATION_NOT_EXECUTED`, never a silent skip. The JIT pack intentionally does not preselect a library or tool.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T009 tests should remain package-local and should cover:

- manifest/rendition binding success and immutable-binding negatives;
- provenance-bound locator derivation and unrelated-locator rejection;
- segment plan/budget accounting (C28 semantics);
- missing/truncated/failed-segment non-acceptance;
- assembly/probe validation through the port, using deterministic local fixtures;
- unsupported encryption/track/mux/post-processing topology fail-closed to `UNSUPPORTED/FAILED`;
- canonical record emission (no adapter-local success semantics);
- malformed/unknown-version/duplicate-identity decode negatives.

No real network, real CDN, real DRM content, filesystem/persistence harness or UI belongs in T009 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T009 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`685e5f384c344872d23038525e1eefd3f1124145`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
