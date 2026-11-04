# Task Pack R1 — V022-A04-CORE-RUNTIME-CONSOLIDATION

> TASK_PACK_STATE: OWNER_SEQUENCE_APPROVED / EXACT_STAGING_BASE_FROZEN / BUILDER_CLAIM_REQUIRED
> Task: #357
> Parent DAG: #337
> Tracking issue: #346
> Version: v0.2.2
> Owner A04 sequence authorization: #346 comment 6616591377
> Delivery-First practice input: ADS #1359 (Product/L2 intake only; not frozen)
> Preparation: `docs/architecture/v0.2.2/A04_CORE_RUNTIME_CONSOLIDATION_PREPARATION_R1.md`
> A02 staging input: PR #344 HEAD `330efd081a89e443d79fa27064109c4c40d17b16` (P1 remains open)
> A03 staging input: PR #345 HEAD `d0eafef73229daa379c58d8101f303f396a09fcf` (R2 source PASS P0=0/P1=0/P2=3)
> Exact source base: `staging/v0.2.2-a04-domain-package-integration@8620090b41f4745394b8371b00307b441baecad7`
> Exact source tree: `f50e1115f14c220d4ca4d9b9c16ae09e09e2989e`
> WIP is NOT the base: `wip/v0.2.2-ui-rebuild-r0@ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
> Product blob (immutable): `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob (immutable): `2b984b859acdba4e5cc9b85813fbbb4c29eea288`

## 1. Goal

Make Core Runtime the only production composition root for the selected Domain App and its physical Host adapters. Remove transitional physical runtime/registry/store ownership from Domain App, expose stable package-root APIs, and re-establish the missing real-fixture integration coverage under Core Runtime.

This Task closes the A02 P1 by migrating all 25 S2/S5/S6 tests into Core's `ci:verify` include. It closes A02/A03 P2 composition and boundary gaps without changing Product/L2 or adding a second authority.

## 2. Exact exclusive write set — 34 paths

Only the following paths may change. New paths are marked NEW; relocated App files are marked DELETE.

### Core Runtime — single production composition root (9 paths)

1. `packages/core-runtime/src/domain-app-route.ts`
2. `packages/core-runtime/src/runtime.ts`
3. `packages/core-runtime/test/domain-app-route.test.ts`
4. `packages/core-runtime/test/slice-journey-testkit.ts` — NEW
5. `packages/core-runtime/test/s2-discovery-journey.test.ts` — NEW
6. `packages/core-runtime/test/s5-collection-journey.test.ts` — NEW
7. `packages/core-runtime/test/s6-navigation-journey.test.ts` — NEW
8. `packages/core-runtime/test/domain-app-media-flow.test.ts` — NEW
9. `packages/core-runtime/test/domain-app-direct-flow.test.ts` — NEW

### Domain App — domain declarations and tests only (16 paths)

10. `packages/download-domain-app/src/composition/runtime.ts`
11. `packages/download-domain-app/src/composition/composition-runtime.test.ts`
12. `packages/download-domain-app/src/integrations/index.ts`
13. `packages/download-domain-app/src/integrations/media-registry.ts` — DELETE after relocation
14. `packages/download-domain-app/src/integrations/s3-media.ts`
15. `packages/download-domain-app/src/integrations/s3-media.test.ts`
16. `packages/download-domain-app/src/integrations/s4-hls-vod.ts`
17. `packages/download-domain-app/src/integrations/s4-hls-vod.test.ts`
18. `packages/download-domain-app/src/integrations/slice-journey-testkit.ts` — DELETE after migration
19. `packages/download-domain-app/src/integrations/s2-discovery.test.ts` — DELETE after migration
20. `packages/download-domain-app/src/integrations/s5-collection.test.ts` — DELETE after migration
21. `packages/download-domain-app/src/integrations/s6-navigation.test.ts` — DELETE after migration
22. `packages/download-domain-app/src/migration/index.ts`
23. `packages/download-domain-app/src/migration/lineage-store.ts`
24. `packages/download-domain-app/src/migration/lineage-ledger.test.ts`
25. `packages/download-domain-app/src/package-boundary.test.ts`

### Domain Host — physical adapters and stable exports (6 paths)

26. `packages/download-domain-host/src/index.ts` — NEW
27. `packages/download-domain-host/src/media/index.ts` — NEW
28. `packages/download-domain-host/src/media/media-target-registry.ts` — NEW
29. `packages/download-domain-host/src/media/media-target-registry.test.ts` — NEW
30. `packages/download-domain-host/src/migration/index.ts` — NEW
31. `packages/download-domain-host/src/package-boundary.test.ts`

### Workspace manifests — sole A04 manifest writer (3 paths)

32. `packages/download-domain-app/package.json`
33. `packages/download-domain-host/package.json`
34. `pnpm-lock.yaml`

No other file may change. Do not expand this write set silently.

## 3. Architecture and ownership requirements

### 3.1 One Core, one K, one load

1. Core Runtime is the only production composition root and calls the pinned public DomainHarness SDK `load()` exactly once per Core process for the selected Domain App.
2. The existing K/S payload bytes and frozen identities remain unchanged. Preserve the #183 sealed K/S hashes and the existing Direct/S3/S4 route and operation vocabulary.
3. Compose the needed route contributions into the one K using the public SDK. Do not instantiate a second K, nested runtime, per-surface K or test-only production bypass.
4. If the pinned SDK cannot represent the required contribution set in one K without changing frozen K/S bytes or identities, stop and report the exact public API limitation. Do not load multiple K instances or change Product/L2.
5. The actual Core `load()` callsite must compile with the Host `FileCasDocStore` structurally assignable to the installed public SDK `V10DocStore`. No temporary-only probe, unsafe cast or type assertion may substitute for this callsite proof.

### 3.2 Package dependency direction and stable exports

- Domain App owns contracts, sealed K/S/B/C declarations, route/intent validation and domain journeys. It must not import Host and must not own physical stores, bridges, registries or runtime assemblers.
- Domain Host owns physical direct/media bridges, opaque targetRef registries, `FileCasDocStore` and dormant `PlainFileLineageStore`.
- Core may import both packages, but only through stable package root exports. Replace deep `@xdownload/download-domain-app/src/**` and `@xdownload/download-domain-host/src/**` imports in Core.
- Remove the reciprocal App → Host and Host → App workspace dependencies. Core remains the composition layer that depends on both.
- Host root/media/migration barrels must export the intended physical APIs without re-exporting App symbols. App root must not expose physical Host implementations.
- App boundary regression test must catch static, export-from, side-effect, dynamic `import()` and CommonJS `require()` forms.
- Host boundary regression test must check the root/media/migration barrels and all module-reference forms for any App import.
- `REFERENCE_TOKEN_PATTERN` and `isRawLocatorShape` are available from neutral `@xdownload/domain-contracts`; the moved media registry must not import App contracts.

### 3.3 Physical Host composition and effect gates

- Move the media targetRef registry from App to Host. It remains a trusted composition-seeded opaque-handle registry; never parse a handle as a URL/path.
- S3/S4 targetRef resolution and permit derivation occur behind the Core/Host composition. The caller cannot supply or widen manifest URI, selected rendition, allowed origins, segment origins or budget.
- The kernel-minted permit identity must be bound to the resolved Host registry facts. Existing Host bridges revalidate permits before network/file effects.
- Unknown, locator-shaped, mismatched or unauthorized targetRefs fail closed before segment requests and before file creation.
- Preserve existing DirectAcquisitionBridge, DirectHttpAdapter, HLS/FFmpeg engine, scheduler, ledger, artifact store, budget, digest, redirect, journal and terminal-result authorities. No new transfer engine or second authority.
- `FileCasDocStore` is Host-owned. `PlainFileLineageStore` remains Host-owned and dormant; A04 must not activate T09, UNKNOWN auto-resolution, SQLite or multi-process CAS.
- App S3/S4 public journey signatures must use domain-facing ports and must not expose `FileCasDocStore`, Host registry or physical Runtime types.

## 4. Required test migration and preservation

### 4.1 S2/S5/S6 — all 25 cases (A02 P1 closure)

Move the existing `slice-journey-testkit.ts` and all 25 S2/S5/S6 test cases from App into the new Core test files. Preserve the real 127.0.0.1 HTTP fixture and every existing assertion. Do not replace them with mocks or reduce the case count.

The migrated tests must instantiate the real Core Runtime and the Core-owned single-K route. They must be discovered by the existing `pnpm run ci:verify` test configuration. After migration, delete the App copies so there is one authoritative test location.

### 4.2 Direct lane — seven scenario groups

Re-establish under Core, reusing existing Core tests where equivalent coverage already exists:
1. Real intent → K permit → Host bridge → existing DirectHttpAdapter → digest-backed artifact.
2. Exactly one K permit and one journal row; replay creates no second effect.
3. Duplicate `messageId` converges with zero second effects.
4. Mid-flight AbortSignal propagation; no false file/success; fresh identity required for a new attempt.
5. Durable store stop/reopen and idempotent replay.
6. Digest mismatch never materializes or overwrites a prior artifact.
7. T01 no-widening/raw-locator refusal before send, proven with fixture requests, Host counters and durable K evidence.

### 4.3 S3/S4 media — real Host/Core path

Re-establish the scenario maps recorded in `s3-media.test.ts` and `s4-hls-vod.test.ts` under Core:
- S3 positive bounded HLS journey, one K permit, real engine, digest-backed materialization and exact fixture hit accounting.
- S3 pre-send refusal for foreign operation/slice, widened intent and incomplete profile with zero effects.
- S3 unknown/locator-shaped targetRef and invalid budget/profile refuse before segment request/file write.
- S3 digest mismatch does not overwrite a prior completed artifact.
- S4 unknown target, wrong selected rendition tuple, manifest re-observation, origin/budget widening and Host permit binding fail closed.
- S4 standalone second-assembly/pin conflict is preserved and tested.
- S4 real FFmpeg fixture remains explicitly environment-gated; absence of ffmpeg/ffprobe is NOT_PROVEN, not silently PASS.

### 4.4 Evidence precision

- A same-process close/reopen test is named and described as same-process reopen.
- Add a spawned child-process readback only if the actual acceptance contract requires process-boundary evidence; otherwise explicitly qualify the limit.
- Never claim crash, power-loss, cross-process or multi-process CAS proof from same-process tests.
- No real external download; all transfer tests use bounded localhost fixtures.

## 5. Required pre-merge validation

The Builder owns implementation, repair and local validation in one continuous work unit. Do not dispatch a standalone `LOCAL_VALIDATION` task.

1. Verify the task branch and staging source HEAD/tree equal `8620090b41f4745394b8371b00307b441baecad7` / `f50e1115f14c220d4ca4d9b9c16ae09e09e2989e`.
2. Publish an accepted generation-1 CAS `DISPATCH_CLAIMED` bound to this Task Pack, exact base/tree and all 34 paths before any source mutation.
3. Run Node 24 syntax preflight on every changed JS/TS file.
4. Run changed-file Prettier before CI.
5. Run focused Core/App/Host tests, including all 25 migrated cases and Direct/S3/S4 integration scenarios.
6. Run `pnpm run typecheck`.
7. Run aggregate `pnpm run ci:verify`.
8. Run local Docker Woodpecker against the exact candidate SHA and record actual Build ID/result.
9. Record Exact HEAD/tree, all commands, exit codes, test counts, environment limitations and Build ID in #356.

No PASS may be inferred from an absent test, excluded suite, same-process-only restart claim or a different SHA.

## 6. Independent review and integration boundary

- After the implementation candidate is complete, obtain independent Exact-SHA source review. This is proportionate and required because the change consolidates the Core/Host physical-effect boundary, moves targetRef/permit authority and changes workspace package direction.
- Reuse A03's already-PASS source review and existing exact-SHA evidence; do not repeat unchanged reviews.
- A04 must close A02 P1 and the A02/A03 P2 items listed in the preparation R1 document. P2 may remain only with explicit evidence-backed disposition and no effect on acceptance.
- WIP integration is a separate Owner decision that must name the exact candidate HEAD/tree. This Task Pack does not authorize WIP merge.
- No main/version mutation, tag, Release, deployment, Native Host, registry side effect, physical side effect or real external download.

## 7. Completion

A04 is ready for independent review only when all required tests are included in Core `ci:verify`, the actual SDK load callsite and one-K invariant pass, package boundaries are enforced, Node24/Prettier/typecheck/aggregate CI/Woodpecker are green at the exact candidate SHA, and the P1/P2 dispositions are recorded.

Task completion/root-DAG closure and WIP integration are not inferred from a Builder Claim, a staging merge or a PR being mergeable.
