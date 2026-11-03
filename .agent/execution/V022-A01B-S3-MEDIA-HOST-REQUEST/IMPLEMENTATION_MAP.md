# Implementation Map — exact base 5880731aa84601373c028e45f2ec0380e521686f

This is a read-only map; it does not widen the Task Pack.

| Path | Responsibility | Bounded change |
|---|---|---|
| packages/domain-contracts/src/download-host/index.ts | A01 neutral public index | Additive export of the S3 media request module only. |
| packages/domain-contracts/src/download-host/direct-request.ts | A01 Direct Host DTO | Read-only reference; preserve acquisition.acquire binding. |
| packages/domain-contracts/src/download-host/s4-request.ts | A01 S4 Host DTO | Read-only reference; preserve media.acquire + S4 selection binding. |
| packages/domain-contracts/src/download-host/target-ref.ts | Shared opaque targetRef grammar | Reuse existing validator and raw-locator negative. |
| packages/domain-contracts/src/download-host/fields.ts | Shared bounded field/digest/time helpers | Reuse exact helpers; do not weaken. |
| packages/domain-contracts/src/download-host/paths.ts | Output-root/path grammar | Reuse exact path validators. |
| packages/domain-contracts/src/download-host/records.ts | Plain-record/exact-key helpers | Reuse fail-closed snapshot and exact-key checks. |
| packages/download-domain-app/src/contracts/intent.ts | Existing S3 Business Intent | Read-only schema source; no App writes. |
| packages/download-domain-host/src/media/media-acquisition-bridge.ts | Current Host S3 consumer | Read-only evidence only; A03 owns consumer migration. |

## Exact writable paths

- packages/domain-contracts/src/download-host/s3-media-request.ts
- packages/domain-contracts/src/download-host/index.ts (additive export only)
- packages/domain-contracts/test/download-host/s3-media-request.test.ts

No App, Host, Core, package manifest, lockfile, CI, SDK or vendor path is writable.
