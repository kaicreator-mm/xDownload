# Execution Contract — V022-A01B-S3-MEDIA-HOST-REQUEST

## Identity and baseline

- Task: xDownload #340; parent #337.
- Task Pack blob: 7c321095bd3e17bffb60814938388be735e06b09.
- Planning reference: planning/v0.2.2-domain-package-architecture-r0@c1eca11a9aa0290b59483a4290d920b4aacf590b.
- WIP integration target: wip/v0.2.2-ui-rebuild-r0.
- Exact expected base: 5880731aa84601373c028e45f2ec0380e521686f.
- Base tree: d49b4a72ef54bcc8db1f354c394d44650fbec412.
- Task branch: task/v022-a01b-s3-media-host-request.
- Exact write set:
  1. packages/domain-contracts/src/download-host/s3-media-request.ts
  2. packages/domain-contracts/src/download-host/index.ts — additive export only
  3. packages/domain-contracts/test/download-host/s3-media-request.test.ts
- Pinned ADS: v4.18.0 2c395c55569fe2edf3f4135f12d3d069e526d0b7.

## Execution authority

The Task Pack has independent review PASS. The pinned v4.18.0 schema has no WEB_BUILDER profile; ADS v4.19 PR #1358 is still Draft and is not adopted. Therefore the source mutation must be performed by an actual LOCAL_BUILDER / LOCAL executor. Never label a Web executor as Local.

This Execution Pack is preparation, not a Builder Claim. The actual Local Agent must re-read GitHub, verify the exact base and pack, and publish its own accepted schema-conforming DISPATCH_CLAIMED before source mutation.

## Goal

Add only the missing neutral S3 media Host request DTO, pinned to allowedOperation=media.acquire and slice=S3. Do not modify the existing direct or S4 DTOs, Host consumers, App or Product/L2.

## Required implementation

- Define S3MediaHostAcquisitionRequest with the existing S3 confirmed intent's Host-facing fields only.
- Implement validateS3MediaHostAcquisitionRequest(input: unknown) with exact-key/no-widening validation.
- Reuse A01 primitives for opaque targetRef, output-root, bounded IDs, digest/byte counts and caller.
- Normalize and freeze the returned DTO.
- Add positive and negative tests from Task Pack.
- Keep neutral Contracts free of App/Host/Core, Node I/O, network and DomainHarness SDK imports.

## Validation order — syntax before CI

1. Re-read current WIP ref, exact base/tree, Task Pack, this Execution Pack and accepted Claim.
2. Node 24 syntax parse/transpile check for every changed TS/JS file.
3. Changed-file Prettier check.
4. Focused S3 DTO tests.
5. Domain-contracts package tests.
6. pnpm run typecheck.
7. pnpm run ci:verify.
8. Local Docker Woodpecker exact-SHA SUCCESS; record actual Build ID, pipeline, backend, exit codes and URL.
9. Independent Exact-SHA review; do not self-review.

Do not start CI if syntax preflight fails. GitHub Actions are not used.

## Stop conditions

- WIP base moved or task branch is stale.
- Any write outside the exact three-path write set.
- Need to change Product/L1, L2, operation IDs, K/S/B/C ownership, user confirmation or business behavior.
- Need to reuse DirectHostAcquisitionRequest or S4HostAcquisitionRequest in a way that changes their operation/slice binding.
- Any App, Host, Core, Node I/O, network, SDK, manifest, lockfile or CI dependency.

## Integration boundary

Implementation and validation do not imply merge. The Owner has authorized WIP-only integration for reviewed tasks; before merge, re-read current WIP HEAD, verify exact changed paths and independent Exact-SHA review, and run the required gate at the actual integration SHA. No main/version merge, tag, release, deployment, real download, Native Host or Windows side effect.
