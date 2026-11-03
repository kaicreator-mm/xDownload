# xDownload v0.2.2 — Domain Package Refinement Implementation Plan R1

> Status: planning baseline committed to the architecture lane. A00 source audit is read-only and has produced the evidence summarized below. No source implementation task is dispatched by this document.
>
> Parent tracking: [#337](https://github.com/kaicreator-mm/xDownload/issues/337)  
> Planning PR: [#336](https://github.com/kaicreator-mm/xDownload/pull/336)  
> Upstream: DomainHarness [#1465](https://github.com/kaicreator-mm/domain-harness/issues/1465), [PR #1466](https://github.com/kaicreator-mm/domain-harness/pull/1466), [#1392](https://github.com/kaicreator-mm/domain-harness/issues/1392)

## 1. Objective

Refine the existing xDownload v0.2.x Domain Package architecture using the latest DomainHarness function/tool, Host boundary, workflow, and downstream-consumer lessons.

This is an implementation-architecture change only. Preserve the existing product contract, DomainHarness SDK semantics, K/S/B/C identifiers, permit gate, download behavior, and current UI work.

The target is a small, acyclic package graph with one production composition root, explicit authority ownership, and independently verifiable package boundaries. Do not add a second kernel, workflow engine, journal, scheduler, or persistence authority.

## 2. Exact source baseline

- Repository: \`kaicreator-mm/xDownload\`
- WIP branch: \`wip/v0.2.2-ui-rebuild-r0\`
- Audit baseline: \`9e3ccd382311619e60b8d2a7373e8a7d34733334\`
- Current WIP integration HEAD: `5880731aa84601373c028e45f2ec0380e521686f` (A01 + U03 + U02/U04 + U06 merged; integrated Woodpecker pipeline #16 SUCCESS)
- Tree: \`ba48b805697ad19c36a6eb3a5e54b6d601b36120\`
- Product/version branches are not write targets.
- The current xDownload baseline vendors DomainHarness SDK package tarballs at 0.10.2-rc.0 (vendor/sdk/*-0.10.2-rc.0.tgz, package manifests and pnpm-workspace.yaml overrides). This plan preserves those exact existing pins and bytes; it does not upgrade the vendored SDK to v0.10.3. Any SDK upgrade requires a separate scoped decision and validation.

This is an exact-baseline audit, not a claim that the WIP branch is still current at a future dispatch. Every implementation Task must re-read the current WIP head and rebind its own accepted Claim before writing.

## 3. A00 source-audit findings

The following findings were checked against the exact baseline above.

### F01 — App and Host manifests form a package dependency cycle

- \`packages/download-domain-app/package.json\` depends on \`@xdownload/download-domain-host\`.
- \`packages/download-domain-host/package.json\` depends on \`@xdownload/download-domain-app\`.
- The manifests also show both packages depending on the neutral \`@xdownload/domain-contracts\`.

Conclusion: the package cycle is real at manifest level; it is not merely a relative-import style issue.

### F02 — App imports physical Host implementations

Source-confirmed paths include:

- \`download-domain-app/src/composition/runtime.ts\` imports Direct Host bridge implementations from \`download-domain-host/src/direct/index.ts\`.
- \`download-domain-app/src/integrations/s4-hls-vod.ts\` imports the Host HLS acquisition bridge.
- \`download-domain-app/src/integrations/media-registry.ts\` imports \`isRawLocatorShape\` from the Host target-ref registry.

Conclusion: App currently mixes domain declarations/composition with trusted Host implementation details. Split pure contracts and domain policy from physical handlers and Host registries.

### F03 — Host imports deep App source paths

Source-confirmed paths include:

- \`download-domain-host/src/direct/direct-acquisition-bridge.ts\` imports validators and types from \`@xdownload/download-domain-app/src/contracts/index.ts\`.
- \`download-domain-host/src/media/media-acquisition-bridge.ts\` imports App contracts and the S4-specific contract through deep relative paths.
- \`download-domain-host/src/direct/target-ref-registry.ts\` imports \`REFERENCE_TOKEN_PATTERN\` from the App contract source.

Conclusion: the shared contract surface is not yet neutral. Only genuinely cross-boundary DTOs, validators, operation contracts, and opaque-reference grammar should move to \`domain-contracts\`; business policy must remain in App.

### F04 — Core Runtime is the active production composition root, but imports deep App and Host modules

- \`packages/core-runtime/src/runtime.ts\` exposes \`createCoreRuntime\` / reopen lifecycle and composes the route into the Core Seam.
- \`packages/core-runtime/src/domain-app-route.ts\` loads the selected K and imports App S4 declarations/contracts, App \`FileCasDocStore\`, and the Host HLS bridge through deep source paths.
- The Core Runtime package manifest depends on both App and Host.

Conclusion: retain Core Runtime as the single production composition root, but make it consume stable package entrypoints/ports rather than deep source paths. Keep UI/CLI surfaces as Core Seam consumers.

### F05 — App root exports alternate runtime assemblers and physical storage

\`packages/download-domain-app/src/index.ts\` currently re-exports \`FileCasDocStore\`, \`assembleDownloadRuntime\`, \`sealDirectComposition\`, and App integration exports that include \`assembleS4HlsRuntime\` / media assembly helpers.

Conclusion: the public App root currently exposes more than a Domain App ABI. After consumer call-graph verification, keep pure BUILD/contract/domain exports in App and move production runtime assembly and physical storage exports behind Core/Host boundaries. Do not break tests or consumers silently; preserve explicit test-fixture entrypoints where needed.

### F06 — Current new-K Lineage routing authority is the Core RouteLog CLAIM, not the T09 LineageLedger

The active Core route uses \`resolveLineageOwner\` with:
- the legacy fact read from the old Core Seam projection/state; and
- the new-K fact read from \`FileBackedDomainAppRouteLog.isClaimed(lineageId)\`.

For a fresh new-K lineage, the route durably appends \`CLAIM\` before appending \`ATTEMPT\` and before sending to K. The route also records \`OUTCOME\` from the K receipt path.

Therefore:
- RouteLog \`CLAIM\` currently participates in the new-K route ownership decision; it is not merely a disposable read model.
- RouteLog \`ATTEMPT\` records admitted route attempts.
- RouteLog \`OUTCOME\` is derived from the K receipt and is a read-side record; it must not replace K Effect Journal truth.
- K Effect Journal / Permit remains the authority for K external-effect execution and settlement.
- Core Seam Journal remains the accepted command/response transport journal.

### F07 — T09 LineageLedger exists but no active production call site was found in the audited Core route

The T09 \`LineageLedger\` and \`PlainFileLineageStore\` are exported from the Domain App migration module/root. The ledger contains old-core/new-k ownership, release, UNKNOWN recording and explicit-resolution policy. Its default \`open\` path constructs \`PlainFileLineageStore\`.

However, the audited production \`core-runtime/src/domain-app-route.ts\` uses \`resolveLineageOwner\` plus RouteLog facts and does not import or instantiate T09 \`LineageLedger\`. No production call site was found in the inspected App/Host/Core composition paths at this baseline.

Conclusion: do not describe RouteLog and T09 LineageLedger as two proven active production writers. Treat T09 as an exported migration-policy module with no confirmed active Core Runtime wiring. Preserve its semantics and tests; do not activate, delete, or merge it as part of the dependency cleanup without a separate explicit decision.

### F08 — Physical stores need boundary-specific treatment

- \`FileCasDocStore\` is a physical filesystem implementation of the SDK V10DocStore port, currently implemented/exported from App and consumed by Core route composition. Move this adapter behind the Host/Runtime injection boundary; keep SDK store semantics unchanged.
- \`PlainFileLineageStore\` is physical file I/O behind the T09 \`LineageStore\` port, but the T09 ledger has no confirmed production caller. If T09 remains a supported exported module, its policy stays in App and its physical adapter belongs behind a Host-owned adapter boundary; do not add SQLite or activate a second authority.
- \`FileBackedSeamJournal\` and \`FileBackedDomainAppRouteLog\` are Core runtime durability mechanisms with distinct transport/route responsibilities. Do not move or merge them merely because they use files. Their authority and port ownership must remain explicit.

### F09 — Existing file CAS does not prove multi-process safety

The T09 store documentation explicitly marks the real SQLite CAS leg \`NOT_PROVEN\`; the plain-file adapter uses temp+rename and revision checking but does not establish cross-process writer locking. Do not claim multi-process CAS, add a Native SQLite driver, or expand persistence scope in this refinement.

## 4. Target package responsibilities

| Package | Owns | Must not own |
|---|---|---|
| \`domain-contracts\` | genuinely shared neutral DTOs, schemas, opaque-reference grammar, narrow ports | Host I/O, Domain policy, K execution |
| \`download-domain-app\` | K/S/B/C declarations, Business Intents, domain rules, semantic recipe, Workflow definitions, T09 policy | Host package dependency, physical I/O, production runtime assembly |
| \`download-domain-host\` | trusted C handlers, Direct/HLS adapters, Host registries, physical SDK store adapters | deep App imports, independent K/Journal/Permit authority |
| \`core-runtime\` | BUILD orchestration, Host injection, one K lifecycle, Core Seam and route composition | duplicate business policy or second execution authority |
| UI / CLI / Desktop / Browser | consume Core Seam / stable Core APIs | direct K loading, physical Host access, private Journal scans |

Target dependency direction:

\`\`\`text
             domain-contracts
               ^          ^
               |          |
      download-domain-app  download-domain-host
               ^          ^
               |          |
               +--- core-runtime
                       |
                    apps / UI
\`\`\`

The arrows mean dependency/import direction: App and Host may both depend on neutral contracts; Core Runtime composes App and Host. App must not depend on Host, and Host must not depend on App.

## 5. Task DAG

| Task | Deliverable | Depends on | Candidate exclusive write set |
|---|---|---|---|
| A00 | Architecture inventory and authority audit | — | read-only source; audit report only |
| A01 | Neutral Domain Contracts and dependency-boundary extraction | A00 | \`packages/domain-contracts/src/download-host/**; src/index.ts additive exports only; test/download-host/**\`; no App/Host/Core paths; exact neutral-contract paths only |
| A01B | S3 media Host request DTO | A01 | `packages/domain-contracts/src/download-host/s3-media-request.ts`; `src/download-host/index.ts` additive export only; `test/download-host/s3-media-request.test.ts` |
| A02 | Domain App public boundary and Host decoupling | A01 | Task Pack V022-A02-DOMAIN-APP-PUBLIC-BOUNDARY.md (11 exact App source/test paths); package.json/root lockfile forbidden |
| A03 | Domain Host boundary and physical adapters | A01, A01B | Task Pack V022-A03-DOMAIN-HOST-BOUNDARY.md (14 exact Host source/test paths); package.json/root lockfile forbidden |
| A04 | Core Runtime consolidation and dependency injection | A02, A03 | \`packages/core-runtime/**\` plus exact consumer adapters, both Domain App/Host package.json files, and root pnpm-lock.yaml (sole manifest + lockfile writer) |
| A05 | Domain Knowledge / Workflow / Function-Tool mapping | A00 | \`docs/architecture/v0.2.2/domain-package/**\` |
| A06 | Architecture integration tests and exact-SHA verification | A04, A05 | dedicated architecture tests / validation evidence, exact paths frozen later |
| A07 | Final independent Exact-SHA review and closure | A06 | read-only |

### Parallelism

1. A00 is the first gate and is read-only.
2. After A00, A01 and A05 can run in parallel.
3. After A01, A02 and A01B can run in parallel.
4. After A01B, A03 can run in parallel with A02; A02/A03 keep disjoint package source write sets.
5. A04 starts only after A02 and A03 are complete.
6. A06 follows A04 and A05.
7. A07 is an independent read-only review.

**Manifest/lockfile ownership:** A01, A02 and A03 do not edit either Domain App/Host package.json or the root pnpm-lock.yaml. A02/A03 are source-only parallel Tasks. A04 is the sole writer for both `packages/download-domain-app/package.json`, `packages/download-domain-host/package.json`, and root `pnpm-lock.yaml`: after A02/A03 source changes are integrated, it removes the reciprocal workspace dependencies and regenerates the lockfile once. This is required because the local Woodpecker pipeline runs `pnpm install --frozen-lockfile` before `ci:verify`; changing a package importer without the matching lockfile would fail before tests. Later Task Packs must encode this single-writer ownership explicitly.

Do not create A02/A03/A04 source Tasks with broad or overlapping write sets before A00 has frozen their exact paths and contracts.

## 6. Task requirements

### A00 — Architecture Inventory & Authority Audit

Read-only source audit at the exact baseline. Produce:
- package dependency graph and manifest evidence;
- import-boundary matrix;
- production runtime call graph;
- public App API / alternate assembly consumer inventory;
- K / Seam Journal / RouteLog / T09 LineageLedger authority matrix;
- physical-store ownership matrix;
- exact decisions and unresolved items for A01–A04.

No source code, manifests, lockfile, tests, or runtime behavior may be changed.

### A01 — Domain Contracts & Dependency Decoupling

Extract only truly shared contracts used by both App and Host. Preserve domain-specific policy in App. Candidate shared items include C operation payload types/validators, S4 Host-facing intent contract, bounded effect/evidence DTOs, and opaque target-reference grammar. Final paths and symbols must be frozen by the A01 Task Pack after A00.

### A01B — S3 Media Host Request DTO

Add a dedicated neutral S3 Host request DTO pinned to `media.acquire` + `S3`. A01's direct request is pinned to `acquisition.acquire`, while its S4 request requires the S4 selected-rendition tuple; neither represents the existing S3 media lane. Reuse A01's neutral exact-key, opaque-targetRef, output-root, digest/bytes and caller primitives. No Host consumer or App source change in this Task.

Formal Task Pack: `V022-A01B-S3-MEDIA-HOST-REQUEST.md`; Issue #340. PR #343 is merged to WIP at `a3e1b22c200ef11a942dacc953e2bfecdc3db03c`; exact candidate Woodpecker #17 SUCCESS; independent Exact-SHA review PASS (P0=0/P1=0/P2=1). The non-blocking P2 diagnostic hardening is carried into A06 follow-up.

### A02 — Domain App Refactoring

Remove App→Host source imports and narrow the public root to domain-owned declarations, BUILD producers, Business Intents, pure rules, Workflow definitions and journeys. Preserve internal deep-import compatibility required by the current Core route until A04 moves it to Host-owned adapters; those transitional surfaces must not be re-exported from the App root. Keep K/S/B/C identifiers, sealed bytes, operation IDs and behavior unchanged. The existing App runtime integration tests must be re-established under Core A04, not silently dropped.

Task Pack: V022-A02-DOMAIN-APP-PUBLIC-BOUNDARY.md; Issue #341. PR #344 is rebased onto WIP base `a3e1b22c200ef11a942dacc953e2bfecdc3db03c` at candidate `330efd081a89e443d79fa27064109c4c40d17b16` / tree `253ad057c813c1c447e05d57d5afb1737b092457`; the 11 App file blobs are unchanged. Independent Exact-SHA review PASS (P0=0/P1=0/P2=2); Node 24 syntax/Prettier and exact-SHA local Docker validation are pending on the rebased candidate.

### A03 — Domain Host Refactoring

Remove Host→App deep imports. This Task depends on A01 and A01B so both S3 and S4 media Host requests have neutral, operation-pinned schemas. Own Direct/HLS physical handlers, target registries, FileCasDocStore and the dormant T09 plain-file adapter. Preserve permit checks, targetRef opacity, budget, digest, atomic materialization and cancellation. Keep T09 dormant; do not add K or a private journal.

Task Pack: V022-A03-DOMAIN-HOST-BOUNDARY.md; Issue #342 (Task Pack review PASS; exact-base rebind completed after #343). Current base `a3e1b22c200ef11a942dacc953e2bfecdc3db03c` / tree `0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7`; Execution Pack is current. Ready for the Local Builder's own accepted Claim.

### A04 — Core Runtime Consolidation

Use stable App/Host entrypoints and injected ports. Keep Core Runtime as the only production composition root and load exactly one selected K. Preserve Core Seam acceptance/replay, route ownership, K effect governance and restart/UNKNOWN semantics. Do not silently switch the active RouteLog ownership source to T09 LineageLedger.

Preparation: `A04_CORE_RUNTIME_CONSOLIDATION_PREPARATION_R0.md` records the current Core import inventory, reciprocal package dependency, App compatibility surfaces, test relocation matrix and three non-blocking boundary/API P2 follow-ups. It is read-only preparation, not a Task Pack or dispatch authorization. Freeze A04's exact write set only after A02 and A03 are integrated.

### A05 — Domain Knowledge & Workflow Mapping

Create a lightweight, traceable map for glossary, authority, schemas, business rules, Workflow definitions, Function/Tool classification, UI Journey boundaries and validation evidence. No new DSL or runtime.

Six documents are complete. The corrected validation-map filename passed independent R2 re-review in Issue #339 on 2026-11-04 (P0=0/P1=0/P2=0); A05 documentation is ready for A06.

### A06 — Architecture Integration & Verification

Add negative architecture tests for App→Host imports, Host→App deep imports, duplicate production K composition, and accidental Host/runtime exports from App root. Verify clean consumer packaging, Node 24, direct/HLS, budget, digest, cancellation, restart, duplicate, UNKNOWN and Core Seam behavior.

### A07 — Final Review & Closure

Independent Exact-SHA review of source diff, package graph, tests, exact WIP integration head, local Docker Woodpecker evidence and remaining P0/P1/P2. No self-review PASS.

## 7. Global acceptance gates

- App and Host manifests no longer depend on each other.
- Contracts is independent of App and Host.
- App contains no Host implementation imports or physical Host adapters.
- Host contains no deep App source imports.
- Core Runtime is the only production Domain App composition root.
- Exactly one production K is loaded for the new-K route.
- K Effect Journal / Permit, Core Seam Journal, RouteLog and T09 policy retain distinct documented authority.
- Current RouteLog CLAIM remains the route ownership fact unless an explicitly reviewed migration replaces it atomically.
- RouteLog OUTCOME remains derived from K receipt; it does not become K effect truth.
- T09 is not activated as a second authority; UNKNOWN is never auto-cleared.
- Existing direct/HLS, budget, digest, cancellation, restart, duplicate and projection behavior remains compatible.
- No multi-process CAS claim without real target-environment proof.
- The existing xDownload-vendored DomainHarness SDK pins (0.10.2-rc.0) and tarball bytes remain unchanged; no SDK upgrade is included.
- Node 24 syntax/type preflight and changed-file Prettier run before CI.
- Focused tests, \`pnpm run typecheck\`, \`pnpm run ci:verify\`, and local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA review PASS.
- Integration target is \`wip/v0.2.2-ui-rebuild-r0\` only; re-read the current WIP head before every integration.

## 8. Explicit exclusions

No Product/L1 or L2 expansion; no new download protocol or engine; no Agent Tool feature; no new permissions, IPC, Provider or network scope; no new Workflow Engine, Scheduler, Journal, SQLite Native Driver or second K; no DomainHarness SDK change; no v0.2.1/main mutation; no release, tag, deployment, Windows registry/Native Host side effect, or real external download.

## 9. CI and execution discipline

Before CI:
1. Node 24 syntax parse / transpile check for changed TypeScript and JavaScript.
2. TypeScript typecheck for the affected package graph.
3. Changed-file Prettier check.
4. Focused tests.

Then run repository verification and local Docker Woodpecker. Every result must identify the exact commit SHA and actual Build ID. No GitHub Actions.

Each source Task needs its own Task Pack, exact base, allowed write set, accepted ADS dispatch/Claim, task branch and independent review. A local Agent may implement or repair bounded code when the Task Pack and Claim authorize it; it is not restricted to validation-only work. Web Builder and Local Agent coordinate only through GitHub.

## 10. Current status

- Parent tracking issue: #337.
- A00 read-only audit is complete at the exact baseline; independent review PASS is recorded in [#338](https://github.com/kaicreator-mm/xDownload/issues/338).
- A00 report: [A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md](./A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md); Task Pack blob `1591be332f3ba76e8e5a14d5f062e27860dcc219`.
- [#335](https://github.com/kaicreator-mm/xDownload/issues/335) A01 neutral Host contracts are implemented, reviewed and merged to WIP at merge commit `a3cc525df6a8c561f396dadf1e79bbb549fcc036`.
- [#340](https://github.com/kaicreator-mm/xDownload/issues/340) A01B merged via PR #343 to WIP at `a3e1b22c200ef11a942dacc953e2bfecdc3db03c`; Woodpecker #17 SUCCESS; independent review PASS, P0=0/P1=0/P2=1.
- [#341](https://github.com/kaicreator-mm/xDownload/issues/341) A02 PR #344 rebased to `330efd081a89e443d79fa27064109c4c40d17b16`; independent review PASS, P0=0/P1=0/P2=2; rebase syntax/Prettier and exact-SHA local CI pending.
- [#342](https://github.com/kaicreator-mm/xDownload/issues/342) A03 Task Pack rebound to WIP `a3e1b22c200ef11a942dacc953e2bfecdc3db03c`; Execution Pack ready; awaiting Local Builder Claim.
- [#339](https://github.com/kaicreator-mm/xDownload/issues/339) A05 corrected six-document set passed R2 re-review, P0=0/P1=0/P2=0.
- A01 and A01B are integrated to WIP. A02 source implementation and independent review are complete; its rebased exact-SHA syntax/Prettier and local CI are pending. A03 is rebound and ready for Local Builder Claim. A04 awaits A02/A03 integration; A06/A07 remain downstream.
- UI U00–U06 remains a separate lane and may continue in parallel where exact write sets do not overlap.
