# Task Pack — V022-A02 Domain App Public Boundary

> Status: bounded source Task; Local Builder Claim required before mutation.
>
> Parent tracking: xDownload #337  
> Formal Task Issue: xDownload #341  
> Dependency: A01 #335 (implemented and merged to WIP)  
> Planning baseline: planning/v0.2.2-domain-package-architecture-r0  
> Source baseline: wip/v0.2.2-ui-rebuild-r0@5880731aa84601373c028e45f2ec0380e521686f

## Contract

- Task ID: V022-A02-DOMAIN-APP-PUBLIC-BOUNDARY
- Version: v0.2.2 successor
- Integration target: wip/v0.2.2-ui-rebuild-r0 only
- Baseline SHA: 5880731aa84601373c028e45f2ec0380e521686f
- Depends on: A01
- Parallel with: A01B #340
- Review policy: required
- Risk: medium
- Pinned ADS standard: 2c395c55569fe2edf3f4135f12d3d069e526d0b7 (v4.18.0)
- Execution profile: LOCAL_BUILDER / LOCAL
- Validation scope: App source dependency boundary, public export ABI, domain-only tests

## Goal

Remove all App source imports of download-domain-host and narrow the public App root to domain-owned declarations, Business Intents, pure contracts, semantic rules, Workflow definitions, BUILD producers and domain journeys.

Preserve the current Core Runtime's deep-import compatibility only where required until A04 moves those consumers to Host entrypoints. Transitional compatibility files must not be exported by the public App root and must be explicitly marked for deletion by A04.

## Exact allowed write set

1. packages/download-domain-app/src/index.ts
2. packages/download-domain-app/src/composition/runtime.ts
3. packages/download-domain-app/src/composition/journey.ts
4. packages/download-domain-app/src/composition/composition-runtime.test.ts
5. packages/download-domain-app/src/integrations/index.ts
6. packages/download-domain-app/src/integrations/media-registry.ts
7. packages/download-domain-app/src/integrations/s3-media.ts
8. packages/download-domain-app/src/integrations/s3-media.test.ts
9. packages/download-domain-app/src/integrations/s4-hls-vod.ts
10. packages/download-domain-app/src/integrations/s4-hls-vod.test.ts
11. packages/download-domain-app/src/migration/index.ts
12. packages/download-domain-app/src/migration/lineage-ledger.ts
13. packages/download-domain-app/src/migration/lineage-ledger.test.ts
14. packages/download-domain-app/src/migration/lineage-store.ts
15. packages/download-domain-app/src/package-boundary.test.ts (new)

No other file.

## Required changes

### App → Host source imports

Remove these edges:
- composition/runtime.ts → download-domain-host/src/direct/index.ts
- integrations/s3-media.ts → download-domain-host/src/media/media-acquisition-bridge.ts
- integrations/s4-hls-vod.ts → download-domain-host/src/media/media-acquisition-bridge.ts
- integrations/media-registry.ts → download-domain-host/src/direct/target-ref-registry.ts

The media registry must consume A01's neutral isRawLocatorShape / targetRef grammar from @xdownload/domain-contracts.

No App source file may import @xdownload/download-domain-host or a relative path into packages/download-domain-host.

### Public root

Replace broad star exports that leak Host/runtime implementation with curated domain exports. The public root must not export:
- FileCasDocStore or PlainFileLineageStore;
- assembleDownloadRuntime, assembleMediaRuntime or assembleS4HlsRuntime;
- Host bridge implementations, Host pin registries or physical adapter classes;
- transitional Core-only compatibility details.

Keep K/S/B/C declarations, sealed BUILD producers, Business Intent schemas/validators, semantic recipe, Workflow/domain journeys and T09 policy types. Do not change K/S/B/C identifiers, module bytes, hashes, route IDs or operation IDs.

### Transitional Core compatibility

The current Core route still imports the App FileCasDocStore, InMemoryMediaTargetRegistry and S4 pin contract through deep paths. Do not break these existing imports in A02. They remain internal transitional compatibility only, are not exported by the public App root, and are explicitly removed by A04 after Core consumes the Host-owned adapters.

Remove only production assembly functions that directly invoke Host bridges and are not used by the current Core route. Keep the pure BUILD producer and the S4 bridge ABI seam required by the current Core route until A04.

### Test ownership

The current App colocated composition-runtime, S3 media and S4 HLS test files include real Host/runtime integration. They must not be silently discarded:
- Retain or rewrite App tests for pure BUILD sealing, domain intent, journey contract and no-widening behavior.
- Record the integration scenarios being moved to Core A04 (real Host bridge, K load, permit, network fixture, materialization, restart, cancellation, S4 selection).
- A04 must re-establish those runtime integration tests under the Core composition root.

T09 LineageLedger remains dormant policy with no new production caller. Do not activate it, delete it or make it a second route authority in this Task. Keep its current storage compatibility until A04/Host migration; no SQLite or multi-process claim.

## Required architecture tests

Add package-boundary tests that:
- scan App source (excluding tests/fixtures if needed) and fail on any Host package or Host deep-source import;
- verify the public App root no longer exports runtime assemblers or physical adapters;
- preserve the current domain-owned public symbols needed by existing consumers.

## Required gates

1. Re-read exact WIP HEAD/tree and this Task Pack before mutation.
2. Publish and read back the Builder's own accepted ADS DISPATCH_CLAIMED for this exact Task and 15-path write set.
3. Node 24 syntax preflight and changed-file Prettier before CI.
4. Focused App contract, seal and journey tests.
5. pnpm run typecheck and pnpm run ci:verify.
6. Local Docker Woodpecker exact-SHA SUCCESS.
7. Independent Exact-SHA review PASS.

## Stop conditions

- Any need to change Product/L1, L2, K/S/B/C identifiers, sealed module bytes/hashes, operation IDs, confirmation semantics or user-visible download behavior.
- Any need to modify Host, Contracts, Core, package manifests, lockfile, CI or apps.
- Any need to break a current Core deep import before A04 is ready.
- Any write outside the exact 15-path set, stale base, missing Claim or overlapping writer.

## Explicit non-authorization

No Host consumer migration, Core Runtime composition, package manifest/lockfile, SDK/vendor, Product/L2, main/version branch, release, deployment, real external download, Native Host or registry side effect.
