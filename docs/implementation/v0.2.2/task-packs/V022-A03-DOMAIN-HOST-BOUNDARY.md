# Task Pack — V022-A03 Domain Host Boundary

> Status: bounded source Task; A01B #340 is integrated into WIP via PR #343; ready for a fresh Local Builder Claim.
>
> Parent tracking: xDownload #337  
> Formal Task Issue: xDownload #342  
> Dependencies: A01 #335 and A01B #340  
> Planning baseline: planning/v0.2.2-domain-package-architecture-r0  
> Audit baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Current WIP after A01B integration: a3e1b22c200ef11a942dacc953e2bfecdc3db03c (tree 0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7)  
> Rebind complete: A01B #340 merged as PR #343; use only the exact WIP SHA/tree above for this dispatch.

## Contract

- Task ID: V022-A03-DOMAIN-HOST-BOUNDARY
- Version: v0.2.2 successor
- Integration target: wip/v0.2.2-ui-rebuild-r0 only
- Depends on: A01 and A01B
- Review policy: required
- Risk: medium
- Pinned ADS standard: 2c395c55569fe2edf3f4135f12d3d069e526d0b7 (v4.18.0)
- Execution profile: LOCAL_BUILDER / LOCAL
- Validation scope: Host source dependency boundary, neutral DTO validation, physical adapter behavior

## Goal

Remove all Host source imports from download-domain-app. Consume only neutral A01/A01B contracts at App/Host boundaries. Move physical SDK document-store and dormant T09 plain-file adapters behind Host-owned implementations. Preserve all permit, targetRef, budget, digest, atomic materialization, cancellation and durability semantics.

The package manifest cycle remains until A04, which is the sole writer for both package manifests and pnpm-lock.yaml. Do not edit manifests here.

## Exact allowed write set

1. packages/download-domain-host/src/direct/direct-acquisition-bridge.ts
2. packages/download-domain-host/src/direct/direct-acquisition-bridge.test.ts
3. packages/download-domain-host/src/direct/target-ref-registry.ts
4. packages/download-domain-host/src/direct/index.ts
5. packages/download-domain-host/src/media/media-acquisition-bridge.ts
6. packages/download-domain-host/src/media/media-permit.ts
7. packages/download-domain-host/src/media/media-acquisition-bridge.test.ts
8. packages/download-domain-host/src/storage/file-cas-doc-store.ts (new)
9. packages/download-domain-host/src/storage/file-cas-doc-store.test.ts (new)
10. packages/download-domain-host/src/storage/index.ts (new)
11. packages/download-domain-host/src/migration/plain-file-lineage-store.ts (new)
12. packages/download-domain-host/src/migration/plain-file-lineage-store.test.ts (new)
13. packages/download-domain-host/src/migration/index.ts (new)
14. packages/download-domain-host/src/package-boundary.test.ts (new)

No other file.

## Required changes

### Direct Host lane

- Replace imports from App contracts with A01 neutral exports.
- Validate the request from unknown through validateDirectHostAcquisitionRequest before permit, registry, network or filesystem effects.
- Target registry uses A01 neutral REFERENCE_TOKEN_PATTERN / isRawLocatorShape / validateOpaqueTargetRef.
- Host direct tests import MaterializedEvidence validators from neutral Contracts, never App.

### S3 media Host lane

- Replace App ConfirmedDownloadIntent validation with A01B validateS3MediaHostAcquisitionRequest.
- Pin allowedOperation to media.acquire and slice to S3; no generic operation reuse.
- Preserve the current targetRef registry, manifest/segment origin scope, permit binding, budget, digest and atomic materialization behavior.

### S4 media Host lane

- Replace App S4 validator import with A01 validateS4HostAcquisitionRequest.
- Keep S4 selection facts closed and exact; no default rendition.
- Recompute the S4 selection tuple digest inside Host from the freshly fetched master facts. The digest algorithm must remain byte-identical to the App's current s4HlsSelectionTupleDigest and have a cross-check regression test.
- Preserve expiry/freshness, selection-to-manifest/rendition binding, permit and origin checks before any segment request.
- EffectEnvelope and MaterializedEvidence normalization/validation come from neutral Contracts.

### Media permit

- Replace INTENT_FIELD_PATTERN and REFERENCE_TOKEN_PATTERN imports from App with neutral A01 exports.
- Keep permit schema, operation binding and origin/budget validation unchanged.

### Physical stores

- Move FileCasDocStore behavior from App's composition/runtime.ts to Host storage. Preserve the SDK V10DocStore semantics, exact CAS conditions, atomic temp+rename persistence and restart behavior. Do not add a second store or alter document schema.
- Host package currently does not declare a direct DomainHarness contracts dependency and package.json is forbidden here. Do not add a transitive import that relies on accidental node_modules hoisting. Use a narrowly scoped structural interface in the Host adapter if needed; A04 must prove assignability against the public SDK V10DocStore type at the Core composition call site.
- Move PlainFileLineageStore physical file I/O behind Host migration. Keep the App LineageStore policy port structurally compatible without importing App. Preserve schema/revision checks and typed error codes. This T09 adapter remains dormant: do not add a Core caller or make it a second route authority.
- Do not claim multi-process CAS or add SQLite/native drivers.

### Package boundary

Add a test that scans Host source and fails on imports from @xdownload/download-domain-app or any relative path into packages/download-domain-app. Host must depend only on neutral Contracts and its existing Host/engine dependencies.

## Required gates

1. Re-read current WIP HEAD/tree and verify it still equals `a3e1b22c200ef11a942dacc953e2bfecdc3db03c` / `0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7`; if moved, rebind before Claim.
2. Publish and read back the Builder's own accepted ADS DISPATCH_CLAIMED for this exact Task and 14-path write set.
3. Node 24 syntax preflight and changed-file Prettier before CI.
4. Focused Direct, S3 media, S4 media, store and migration tests.
5. Host package tests, pnpm run typecheck and pnpm run ci:verify.
6. Local Docker Woodpecker exact-SHA SUCCESS.
7. Independent Exact-SHA review PASS.

## Stop conditions

- A01B #340 integration is absent from the exact base or the neutral S3 DTO does not match the existing S3 intent.
- Any need to change App, Contracts, Core, package manifests, lockfile, CI or apps.
- Any change to Product/L1, L2, K/S/B/C identifiers, operation IDs, permission, user confirmation, download protocol or external-effect semantics.
- Any second K, Journal, Scheduler, transfer engine, SQLite driver or multi-process CAS claim.
- Any write outside the exact 14-path set, stale base, missing Claim or concurrent writer.

## Explicit non-authorization

No App or Core mutation, no package manifest/lockfile/CI/SDK/vendor change, no T09 activation, no main/version branch, no release/deployment, no real external download, Native Host or registry side effect.
