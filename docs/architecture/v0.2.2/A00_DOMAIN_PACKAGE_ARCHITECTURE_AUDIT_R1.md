# A00 — Domain Package Architecture Inventory & Authority Audit R1

> Result: source audit completed read-only against the exact WIP baseline below. This report records observed facts and bounded decisions; it does not modify source code or authorize implementation.
>
> Parent: [#337](https://github.com/kaicreator-mm/xDownload/issues/337)  
> Planning PR: [#336](https://github.com/kaicreator-mm/xDownload/pull/336)  
> Upstream architecture: DomainHarness [#1465](https://github.com/kaicreator-mm/domain-harness/issues/1465), [PR #1466](https://github.com/kaicreator-mm/domain-harness/pull/1466), [#1392](https://github.com/kaicreator-mm/domain-harness/issues/1392)

## 1. Exact subject

- Repository: kaicreator-mm/xDownload
- Branch: wip/v0.2.2-ui-rebuild-r0
- Commit: 9e3ccd382311619e60b8d2a7373e8a7d34733334
- Tree: ba48b805697ad19c36a6eb3a5e54b6d601b36120
- Audit type: read-only source and package graph inspection.
- No source, manifest, lockfile, test, branch, or WIP ref was modified.

## 2. Evidence inventory

| Area | Exact file | Blob SHA | Observation |
|---|---|---|---|
| App manifest | packages/download-domain-app/package.json | e92967a325316db4d02c8b14f147c4f387a41e6f | Depends on @xdownload/download-domain-host and @xdownload/domain-contracts |
| Host manifest | packages/download-domain-host/package.json | 8c3e72d3a03c562eb78d597a339612baaa88f090 | Depends on @xdownload/download-domain-app and @xdownload/domain-contracts |
| Contracts manifest | packages/domain-contracts/package.json | bb27e9e2b45184ba04ef682547b41c84c37471ff | Neutral package already exists; exports its root index |
| Core manifest | packages/core-runtime/package.json | dbca164e73dfb2741d6c52ccbfb1b63d6f4c4ce1 | Depends on App, Host, Contracts and Core infrastructure |
| App root | packages/download-domain-app/src/index.ts | f84b6f1a5b40cbd99c9443a27989e34a549ee830 | Re-exports physical store and runtime assembly functions |
| App Direct composition | packages/download-domain-app/src/composition/runtime.ts | 3a3a4c1343e12b2afd298749b74fbca71b28339a | Imports Host Direct bridge; defines FileCasDocStore and assembleDownloadRuntime |
| App S4 integration | packages/download-domain-app/src/integrations/s4-hls-vod.ts | c5d8542c915fe001f5c766c242f18716bdb288db | Imports Host HLS bridge; defines K composition, bridge pin and assembleS4HlsRuntime |
| App media registry | packages/download-domain-app/src/integrations/media-registry.ts | edd9eb2115055330bf18f743009eca87bb22d706 | App registry imports a Host target-ref helper |
| Host Direct bridge | packages/download-domain-host/src/direct/direct-acquisition-bridge.ts | 2d6597e93cd20178fbf9bd16b3d6fb06508fa7ee | Imports App contracts through deep package source path |
| Host Media bridge | packages/download-domain-host/src/media/media-acquisition-bridge.ts | 47edb1b0d650a48895822c74607a3e2c424ffda1 | Imports App contracts and S4-specific App contract |
| Core route | packages/core-runtime/src/domain-app-route.ts | 902326da55429ba781a8e3485cb0989dec8b6027 | Loads K; uses RouteLog CLAIM for new-K ownership; imports deep App and Host source |
| Core durable stores | packages/core-runtime/src/durable-stores.ts | 8ab7f2c759ef2d2d5993bee92074a8d2772194d9 | Implements Core Seam Journal and FileBackedDomainAppRouteLog |
| Core Runtime | packages/core-runtime/src/runtime.ts | 604ed3ad5e33fd387792c377b5e0ed3f598a117c | create/reopen lifecycle composes Domain App route into one Core Runtime |
| T09 Ledger | packages/download-domain-app/src/migration/lineage-ledger.ts | 9f3649a4499f6cee819a603a1128dc4e3bca0cc5 | Domain policy for old-core/new-k ownership and explicit UNKNOWN resolution |
| T09 Store | packages/download-domain-app/src/migration/lineage-store.ts | 5a18cd5bd5bea6a8463f6545a2ccc99990d9ae0d | LineageStore port and PlainFileLineageStore physical file implementation |

## 3. Findings and decisions

### A00-F01 — App and Host manifest cycle: CONFIRMED

App manifest depends on @xdownload/download-domain-host, and Host manifest depends on @xdownload/download-domain-app. Both also depend on neutral Contracts.

Decision: A01/A02/A03 must remove both directions; no partial manifest-only workaround.

### A00-F02 — App → Host source imports: CONFIRMED

- App Direct composition imports download-domain-host/src/direct/index.ts.
- App S4 integration imports download-domain-host/src/media/media-acquisition-bridge.ts.
- App media registry imports download-domain-host/src/direct/target-ref-registry.ts.

Decision: App keeps domain declarations, pure business policy, schemas, intents and Workflow definitions. Host handlers, registries and physical implementations are injected from outside App.

### A00-F03 — Host → App deep imports: CONFIRMED

- Direct Host bridge imports @xdownload/download-domain-app/src/contracts/index.ts.
- Media Host bridge imports App contracts and s4-hls-vod-contract.ts through deep source paths.
- Host target-ref registry imports REFERENCE_TOKEN_PATTERN from the App contract source.

Decision: A01 moves only genuinely shared C/Host contracts and opaque-reference grammar to neutral Contracts. A03 consumes neutral public exports; no deep App imports.

### A00-F04 — Core Runtime is the active Domain App composition root, but its imports are too deep

- createCoreRuntime is the Core lifecycle entry point.
- Core route composes the selected K and is installed into the Core Seam.
- Core route imports App S4 integration, App S4 contract, App media registry, App contracts, App FileCasDocStore and Host HLS bridge by deep source paths.
- Core Runtime package manifest depends on App and Host.

Decision: retain Core Runtime as the sole production composition root. A04 replaces deep source imports with stable package exports and injected Host ports.

### A00-F05 — App public API leaks runtime and Host concerns

The App root re-exports FileCasDocStore, assembleDownloadRuntime, DIRECT_BRIDGE_PIN, and App integration exports that include runtime assembly/pin functionality.

Decision: narrow the App public root to Domain App ABI and domain-owned declarations. Preserve explicitly named test fixtures where necessary; do not leave alternate production assembly entrypoints.

### A00-F06 — Current RouteLog owns the active new-K route claim

Core route resolves lineage ownership from the old Core fact and the new-K fact in FileBackedDomainAppRouteLog.isClaimed. On a fresh new-K lineage it appends durable CLAIM, then ATTEMPT, before sending to K.

Decision:
- RouteLog CLAIM is currently the active new-K route ownership fact.
- RouteLog ATTEMPT is route-attempt history.
- RouteLog OUTCOME is derived from the K receipt and is not K effect truth.
- K Effect Journal / Permit remains the external-effect authority.
- Core Seam Journal remains the accepted command/response transport journal.
- Do not relabel the entire RouteLog as a disposable projection.

### A00-F07 — T09 LineageLedger has no confirmed active Core Runtime caller

T09 exports a separate old-core/new-k ownership policy, explicit release and UNKNOWN resolution. LineageLedger.open defaults to PlainFileLineageStore.

The audited Core Runtime route instead uses resolveLineageOwner and RouteLog facts; it does not import or instantiate T09 LineageLedger. No production call site was found in the inspected App/Host/Core composition paths at this baseline.

Decision:
- Do not claim two active production Lineage writers.
- Do not activate T09 as a second authority.
- Do not delete or merge T09 based on assumptions.
- Keep the policy in App if retained.
- If its physical store remains a supported adapter, move the adapter behind a Host-owned boundary while keeping the narrow port and policy in the appropriate neutral/App layer.
- A future migration from RouteLog CLAIM to T09 must be a separately reviewed atomic authority migration with replay/recovery evidence.

### A00-F08 — Physical store ownership must be selective

- FileCasDocStore is a filesystem implementation of the SDK V10DocStore port and is consumed by the active Core Domain App route. It is an active physical Host adapter and must leave the App package.
- PlainFileLineageStore is physical file I/O but belongs to the currently unreferenced T09 module. It must not be silently activated or treated as a second production store.
- FileBackedSeamJournal and FileBackedDomainAppRouteLog are Core runtime durability mechanisms with distinct responsibilities. Do not move or merge them solely because they use files. Their authority and port ownership must remain explicit.

### A00-F09 — Multi-process CAS is NOT_PROVEN

T09 documentation states the SQLite driver is unavailable and real SQLite CAS is NOT_PROVEN. Plain-file temp+rename/revision checking does not prove cross-process locking.

Decision: no SQLite Native Driver, no multi-process CAS claim, no new storage engine in this scope.

## 4. Authority matrix

| Fact / mechanism | Current owner | Evidence / boundary |
|---|---|---|
| K external-effect admission and settlement | DomainHarness K Effect Journal / Permit | SDK public K load and Host permit gate |
| Accepted command / response replay | Core Seam Journal | Core Seam's own journal and replay |
| New-K route ownership | Core RouteLog CLAIM | isClaimed feeds resolveLineageOwner; durable CLAIM precedes K send |
| Route attempt history | Core RouteLog ATTEMPT | Durable ATTEMPT precedes K send |
| Route outcome view | Core RouteLog OUTCOME | Derived from K receipt; not a replacement for K effect truth |
| T09 old-core/new-k policy | Domain App LineageLedger module | Exported migration policy; no active production caller found |
| K V10DocStore bytes | Current FileCasDocStore in App; target Host adapter | Physical SDK port implementation consumed by Core route |
| T09 LineageStore bytes | PlainFileLineageStore in App; dormant in audited production graph | Physical file adapter; no confirmed production T09 caller |
| Core scheduler / business lifecycle | Existing Core Scheduler and AuthoritativeLedgerWriter | Preserve; not part of this package refactor |

## 5. Runtime / public API decisions

1. Core Runtime remains the sole production composition root for the Domain App route.
2. App may export BUILD/domain declarations and stable business ABI, but not production Host assembly or physical storage.
3. Host implements C operations and Host ports; it does not instantiate a second K or journal.
4. Tests may use explicit fixture assembly APIs, clearly separated from production exports.
5. UI/CLI surfaces consume Core Seam and public Core APIs, not deep App/Host modules.
6. Function exports, C Operation declarations, Business Intents, K Queries and Agent Tools remain separate categories. No Agent Tool is introduced in this refactor.

## 6. Follow-up task gates

- A01: freeze neutral contracts and exact symbol/file movement. Do not move all App contracts wholesale.
- A02: remove App → Host imports and public runtime/store leaks.
- A03: remove Host → App deep imports and implement neutral ports.
- A04: update Core Runtime to stable public APIs/injected ports; preserve RouteLog claim semantics.
- A05: document Domain Knowledge, Workflow and Function/Tool map without adding a runtime.
- A06: architecture-negative tests and regression/packaging verification.
- A07: independent Exact-SHA review.

## 7. Validation limitation

This is a GitHub source-level audit. It did not run Node, package tests, real download, Electron, Windows, Docker, or Woodpecker. Runtime claims requiring those environments remain NOT_RUN until exact-SHA local evidence is attached.
