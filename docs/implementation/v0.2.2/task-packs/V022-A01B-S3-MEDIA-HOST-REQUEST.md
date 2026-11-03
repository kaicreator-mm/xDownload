# Task Pack — V022-A01B S3 Media Host Request DTO

> Status: additive neutral-contract follow-up discovered during post-A01 source audit. Task Pack review and an actual Local Builder Claim are required before source mutation.
>
> Parent tracking: xDownload #337  
> Formal Task Issue: xDownload #340  
> Dependency: A01 #335 (merged to WIP)  
> Architecture audit: docs/architecture/v0.2.2/A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md

## Contract

- Task ID: V022-A01B-S3-MEDIA-HOST-REQUEST
- Version: v0.2.2 successor
- Integration target: wip/v0.2.2-ui-rebuild-r0 only
- Exact source baseline: 5880731aa84601373c028e45f2ec0380e521686f
- Review policy: required
- Risk: low
- Pinned ADS standard revision: 2c395c55569fe2edf3f4135f12d3d069e526d0b7 (v4.18.0)
- Execution profile: LOCAL_BUILDER / LOCAL
- Validation scope: neutral S3 media Host request schema, exact-key validation and no-widening

## Why this task exists

Post-A01 exact-source inspection found that Host media operation acquireMediaViaHls still imports validateConfirmedIntent from Domain App. That S3 path executes media.acquire with slice S3.

A01 correctly introduced:
- DirectHostAcquisitionRequest pinned to acquisition.acquire (S1/S3 direct lane).
- S4HostAcquisitionRequest pinned to media.acquire with an explicit selected-HLS tuple.

Neither DTO represents the S3 media lane. Reusing the direct DTO would misbind the operation; reusing the S4 DTO would falsely require S4 selection facts. This task adds the missing, narrowly pinned S3 media DTO without changing Product/L2 or the existing business intent.

## Required design

Add:
- S3MediaHostAcquisitionRequest
- validateS3MediaHostAcquisitionRequest(input: unknown)

The DTO is a bounded Host-facing projection of the existing confirmed S3 intent:
- requestId
- lineageId
- opaque targetRef
- outputRootScope
- allowedOperation pinned exactly to media.acquire
- slice pinned exactly to S3
- optional digestAnchor
- optional declaredBytes
- caller { actor, sessionRef }

Reuse A01 neutral primitives for opaque targetRef, output-root grammar, bounded fields, digest/bytes and caller validation. Exact keys only; no unknown fields; return an immutable normalized value. Do not import the Domain App ConfirmedDownloadIntent type or validator.

## Exact allowed write set

1. packages/domain-contracts/src/download-host/s3-media-request.ts (new)
2. packages/domain-contracts/src/download-host/index.ts (additive export only)
3. packages/domain-contracts/test/download-host/s3-media-request.test.ts (new)

No other file.

## Required tests

- Valid S3 media request accepted and normalized.
- allowedOperation other than media.acquire refused.
- slice other than S3 refused.
- Unknown/missing keys refused.
- Raw locator targetRef refused.
- Invalid output root, digestAnchor and declaredBytes refused.
- Invalid caller identity refused.
- Returned DTO is immutable and does not widen the input.
- Neutral package remains free of App, Host, Core, Node I/O, network and DomainHarness SDK imports.

## Required gates

1. Re-read current WIP HEAD/tree and this Task Pack before mutation.
2. Publish and read back the Builder's own accepted ADS DISPATCH_CLAIMED for this exact Task and write set.
3. Node 24 syntax preflight and changed-file Prettier before CI.
4. Focused neutral-contract tests.
5. Full domain-contracts tests, pnpm run typecheck and pnpm run ci:verify.
6. Local Docker Woodpecker exact-SHA SUCCESS.
7. Independent Exact-SHA review PASS.

## Stop conditions

- Any need to change Product/L1, L2, operation IDs, K/S/B/C ownership or user-confirmation semantics.
- Any need to import App, Host, Core, Node I/O, network or SDK into neutral Contracts.
- Any attempt to broaden the S3 request into a generic operation or to weaken the existing direct/S4 bindings.
- Any write outside the exact three-path set, stale base, missing Claim or concurrent writer.

## Explicit non-authorization

No Host consumer migration (owned by A03), App source change, Core Runtime change, package manifest, lockfile, CI, SDK or vendored source change; no v0.2.1/main mutation; no release, deployment, real external download, Native Host or registry side effect.
