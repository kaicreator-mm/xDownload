# xDownload v0.2.2 — Domain Package Architecture Cleanup R0

> Status: planning candidate for independent review; not a frozen Product/L2/DAG and not a source dispatch. Target is the v0.2.2 successor WIP only. No change to v0.2.1, main, DomainHarness v0.10.3, or public SDK ABI.

## 1. Decision

Apply the post-v0.10.3 Domain Package function/Tool boundaries from DomainHarness #1465 / PR #1466 to the existing xDownload implementation. This is a non-functional architecture cleanup: preserve user-visible download behavior, existing K/S/B/C semantics, current Core Seam contracts, and the existing direct/HLS data plane.

The current source baseline is:

- Integration branch: wip/v0.2.2-ui-rebuild-r0
- Exact HEAD: 9e3ccd382311619e60b8d2a7373e8a7d34733334
- Tree: ba48b805697ad19c36a6eb3a5e54b6d601b36120
- SDK source: DomainHarness v0.10.3 tag at 061376f4a023070f215f9feffad5c24d96d503cb; tree 099cdc831aef63befd62aaede7e7a853d1be468f
- xDownload #183 bounded packed-SDK PoC: DOMAIN_APP_POC=PASS, SDK_GAP=NO; this does not prove full installed journeys or multi-process SQLite CAS.

## 2. Source-confirmed problems

### 2.1 App / Host package cycle

The current package manifests declare a cycle:

- download-domain-app depends on download-domain-host.
- download-domain-host depends on download-domain-app.

The source graph confirms the same inversion:

- packages/download-domain-app/src/composition/runtime.ts imports DirectAcquisitionBridge / CanonicalBudgetLedger from the Host package and implements FileCasDocStore.
- packages/download-domain-app/src/integrations/s4-hls-vod.ts imports the Host HLS acquisition bridge.
- packages/download-domain-host/src/direct/direct-acquisition-bridge.ts imports validators/types through a deep App source path.
- download-domain-app/src/index.ts exports FileCasDocStore and runtime assembly functions.

This is a downstream package/Host wiring defect, not an SDK defect.

### 2.2 Host infrastructure is owned/exported by the App package

FileCasDocStore is a physical filesystem implementation of the SDK V10DocStore port. Direct/HLS bridges are physical effect handlers. Runtime assembly binds SDK BUILD, K lifecycle, and Host ports. These belong to Host/Core composition, not the Domain App public root.

### 2.3 Persistence responsibilities need a verified authority map

The current implementation contains distinct records:

| Mechanism | Intended responsibility |
|---|---|
| DomainHarness K V10DocStore / Effect Journal / Effect Permit | K business Admission, Effect authority, replay and UNKNOWN |
| FileBackedSeamJournal | accepted Core Seam command transport idempotency/replay |
| FileBackedDomainAppRouteLog | Core route CLAIM/ATTEMPT/OUTCOME facts used for product Job Projection |
| T09 LineageLedger | old-core/new-k ownership partition, migration admission and UNKNOWN disposition |

These are not automatically duplicate databases. RouteLog.CLAIM and T09 LineageLedger ownership semantics may overlap conceptually, but source review has not proved two active production writers for the same fact. The implementation task must build the actual production call graph and select one authoritative owner; it must not blindly delete or merge stores.

OUTCOME derived from a K receipt is a product read model, not a second K Effect Journal. Unprovable in-flight work remains UNKNOWN. FileCasDocStore currently claims single-process writer safety only; multi-process SQLite CAS remains NOT_PROVEN until physically verified.

### 2.4 Product Query and K Query are different surfaces

The current CLI Facade maps query() to Core Seam READ_JOB_PROJECTION; subscribe() typed-refuses because the current Seam has no subscription frames. This is a downstream product adapter choice. Do not describe it as an SDK K Query/Subscription implementation, and do not infer a generic SDK API gap.

## 3. Target dependency direction

| Package | Responsibility |
|---|---|
| domain-contracts | neutral, stable cross-layer DTOs and business contracts |
| download-domain-app | K/S/B/C declarations, Business Intents, schemas and pure business logic; no Host imports |
| download-domain-host | C handlers, V10DocStore/CAS, Provider and physical Host ports; no deep App-source imports |
| core-runtime | sole production composition root; BUILD, Host injection, one K load lifecycle, Core Seam binding |
| UI / CLI / Desktop / Browser | consume through Core Seam; no direct physical Host or Journal access |

Rules:

1. App must not import Host implementations or depend on the Host package.
2. Host must not import deep App source paths. Move only genuinely shared contracts to domain-contracts; avoid creating a broad generic abstraction.
3. Core Runtime owns production assembly and injects Host ports into the selected K/C composition.
4. Move physical V10DocStore/CAS implementation to Host. Keep SDK semantics unchanged.
5. Move assembleDownloadRuntime / assembleS4HlsRuntime production entry points to Core/Host composition. Standalone K assemblies belong in test fixtures, not App root exports.
6. Keep exactly one production K and one business Writer per Lineage. No second scheduler, Journal, Permit authority or implicit effect path.

## 4. Bounded implementation scope

Included:

- Remove the App↔Host package dependency cycle.
- Relocate physical Host stores, direct/HLS bridges and production composition functions to the Host/Core composition layer.
- Re-home shared DTO/validation contracts only where required to establish the acyclic graph.
- Keep the existing selected K/S/B/C BUILD, operation IDs, public SDK exports, permit semantics and direct/HLS behavior unchanged.
- Make the persistence/authority map explicit in code comments and focused tests; only remove a duplicate writer if actual production use proves it is redundant.
- Preserve Core Job Projection as a clearly identified read model; do not invent SDK subscribe support or bypass K governance.
- Add architecture and package-graph tests that fail on App→Host imports, Host deep-App imports, duplicate production K assembly, and unintended root exports.

Excluded:

- No DomainHarness SDK source/API/ABI change, no npm publication and no vendored SDK byte changes.
- No v0.2.1, main, release, deployment or tag changes.
- No Product/L2 user-facing capability expansion; no new download feature, permission, IPC, Provider or network scope.
- No real external downloads as part of this architecture task.
- No blanket rewrite of CoreScheduler/AuthoritativeLedgerWriter or mass Lineage migration.
- No forced storage consolidation absent exact production call-graph and recovery evidence.

## 5. Acceptance and validation

1. Workspace dependency graph is acyclic; App has no Host package/source imports; Host has no deep App source imports.
2. Core Runtime is the only production composition root and loads exactly one selected K for the new-K lineage.
3. Host owns physical V10DocStore/CAS and direct/HLS physical effect handlers; App root exports no Host assembly or physical store.
4. K Effect Journal/Permit remains authoritative; Seam Journal remains transport acceptance; RouteLog is an explicitly derived Core projection; Lineage ownership has exactly one authoritative owner. If source evidence cannot prove an overlap, preserve distinct responsibilities and mark unresolved items UNKNOWN.
5. No behavior/contract regression in direct, S2/S3/S4/S5/S6, cancellation, budget, digest, restart, duplicate and UNKNOWN paths.
6. DomainHarness v0.10.3 source/tag and all four vendored tarball bytes remain unchanged; no registry fallback.
7. Node 24 syntax/type preflight and changed-file Prettier run before CI; focused tests, typecheck, aggregate pnpm run ci:verify and local Docker Woodpecker exact-SHA SUCCESS; independent Exact-SHA review.
8. Final merge target is wip/v0.2.2-ui-rebuild-r0 only. Re-read the current WIP HEAD before integration and rerun gates on the actual integration SHA.

## 6. Execution topology

This is an adjacent architecture lane, not a new U00–U06 UI lane. Its source write set is under packages/download-domain-app, packages/download-domain-host, packages/domain-contracts (only if required), and packages/core-runtime, plus the architecture record and relevant tests. It is disjoint from the current Desktop renderer, Browser popup, and UI harness task write sets.

The current UI PRs/tasks may continue in parallel. Before merge, rebase/rebind to the current WIP SHA, verify no overlap, and validate the actual integration head. No task is dispatched by this planning document.
