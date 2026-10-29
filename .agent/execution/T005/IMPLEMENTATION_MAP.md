# T005 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T005 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies; no runtime dependency exists | Modify only if narrowly necessary for T005 package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T005 persistence/artifact/recovery code belongs under the already-existing `packages/*` seam. `apps/*` is outside T005. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T005 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T005 persistence/recovery tests should fit this existing test seam; process-kill/restart tests may spawn real child processes from it on the local host. |
| `eslint.config.js` | root lint authority established by T001 | T005 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | merged T002 output (PR #52): canonical domain contracts, schemas and semantic kernel | Read/consume as the identity/contract vocabulary to persist. Never redefine, fork or duplicate its semantics inside T005. |
| `packages/toolchain-smoke-core/` | pure T001 smoke package with ESM package export | Reference only for local workspace/package mechanics; not persistence architecture. |
| `packages/toolchain-smoke/` | T001 workspace-link/toolchain tests | Leave outside T005 concern unless an unavoidable root-toolchain compatibility repair is necessary. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: ADR-003/004/010/013, D9, Invariants 3/7/8/9/10/20, §6.2 (persistence candidates + promoted rules), §6.3 (transaction/effect pattern), §6.8 (scheduling/cancellation), §10 (ownership/synchronization), §11 + §11.1 (failure/restart/idempotency + AR-F01 cutoff and cancel timing matrix). |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics through Stage 1 freeze record | Read-only authority: §15 budget domains/exhaustion precedence, §16 result model, §35 counterexamples (esp. C12, C13, C18). |
| `docs/implementation/v0.1.0/task-packs/T005_persistence-recovery-ledger.md` | frozen T005 WHAT blob `09571c7f917dfade91dd8cd0e784d5832f42203f` | Read-only task authority. |
| `docs/planning/STAGE2_ARCHITECTURE_FREEZE.md` | freeze record binding the L2 | Read-only provenance for the architecture authority chain. |
| `.agent/execution/T005/` | JIT pack created by this prep on the T005 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** persistence package, SQLite adapter, migration system, filesystem artifact store, recovery/reconciliation module, scheduler runtime, downloader/core runtime, application package or product adapter package. `docs/experiments/` (the #7 durable-ledger research report location referenced by L2) is also absent from this tree — the report lives at the Issue #7 research HEAD `4adbe7c587920383a654e020de757e2de657c312`, not on `version/v0.1.0`. T005 therefore creates the minimum persistence-layer surface; it does not wire into a non-existent Core runtime (that convergence belongs to T015).

No SQLite driver/library is pinned anywhere on the base. The pinned Node `24.21.0` runtime ships a built-in `node:sqlite` module, so a zero-new-dependency implementation may be possible; any driver dependency remains an F1 choice requiring recorded exact version/license/provenance.

This absence is not permission to invent later architecture. T005 stops at the persistence/artifact/recovery layer and its tests; scheduler control semantics (T006), transfer/media adapters, surfaces and Core integration (T015) stay outside.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- schema definition + ordered migrations + version identity/fail-closed open;
- durable lineage/state records: command/work/effect/artifact identity, staged/materialized/finalized/accepted states, transition-order facts (dispatch → external effect → validation → FS states → acceptance → `USER_CANCELLED` → explicit retry/resume);
- transactional budget reservation/consumption facts;
- filesystem artifact store with digest/provenance binding and staged→materialized→finalized byte lifecycle;
- recovery/reconciliation classification over DB-first and FS-first observations;
- a single authoritative-writer façade (no second writable path);
- tests mapping to `TEST_MATRIX.yaml`, using a real SQLite file and real filesystem temp directories.

Do not split by Desktop/Browser/CLI and do not add crawler, transfer/media, scheduler-control or UI implementations.

## Dependency decision seam

The exact base has no runtime dependencies. Under F1 the Builder may:

1. use the Node built-in `node:sqlite` module (verify its exact stability/behavior on `24.21.0` and record that fact); or
2. add one narrowly justified SQLite/filesystem driver dependency with exact package/version/license/provenance recorded.

If option 2 is chosen, the implementation candidate must demonstrate that the driver does not redefine Product/L2 authority or smuggle in server/database expansion. The JIT pack intentionally does not preselect a library.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T005 tests should remain package-local and should cover:

- migration success/failure matrices (fresh install; forward from supported prior versions; designed backward path; unsupported version fail-closed);
- real process-kill/restart windows: spawn a real worker against a real SQLite file + real temp artifact directories, kill at injected windows (after stage-record commit, after byte write, after materialize, after finalize, after acceptance commit, mid-external-effect), reopen and classify;
- DB-first reconciliation: `accepted` DB row with missing/unmaterialized bytes never projects success;
- FS-first reconciliation: staged/finalized bytes without DB acceptance never become accepted automatically;
- digest/provenance: match binds; mismatch/missing/corrupt classifies as failure, never success;
- cancellation cutoff: durable cancel-before-accept blocks automatic acceptance; accept-before-cancel survives cancellation; staged bytes post-cancel remain unaccepted/quarantined-or-cleanup-eligible;
- duplicate clients/commands converge to one lineage/effect/accepted artifact;
- budget facts survive restart without replenishment or double consumption;
- single-writer enforcement (concurrent second writer fails or serializes through the one path).

Tests must be deterministic, local and must record the host OS tuple actually exercised (the #7 evidence tuple was Linux process-death/reopen; a Windows-host CI/local run proves the Windows tuple only). No real network, media transfer or UI harness belongs in T005 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T005 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`09571c7f917dfade91dd8cd0e784d5832f42203f` / `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
