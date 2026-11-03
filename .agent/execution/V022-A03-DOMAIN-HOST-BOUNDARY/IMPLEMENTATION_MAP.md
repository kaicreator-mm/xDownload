# Implementation Map — A03 exact base a3e1b22c200ef11a942dacc953e2bfecdc3db03c

This is a read-only map and does not widen the Task Pack.

| Path | Current role | Bounded change |
|---|---|---|
| packages/download-domain-host/src/direct/direct-acquisition-bridge.ts | Physical Direct C handler | Replace App contract validation with neutral A01 Direct DTO; preserve all effect gates. |
| packages/download-domain-host/src/direct/direct-acquisition-bridge.test.ts | Direct bridge integration tests | Add/adjust neutral DTO and zero-effect refusal assertions. |
| packages/download-domain-host/src/direct/target-ref-registry.ts | Host target registry | Replace App token import with neutral Contracts. |
| packages/download-domain-host/src/direct/index.ts | Direct Host stable barrel | Export only Host-owned registry/bridge APIs required by package consumers. |
| packages/download-domain-host/src/media/media-acquisition-bridge.ts | S3/S4 HLS physical bridge | Use A01B S3 DTO and A01 S4 DTO; remove App validators and preserve HLS engine semantics. |
| packages/download-domain-host/src/media/media-permit.ts | Media permit schema/validation | Source shared patterns from neutral Contracts without changing permit ABI. |
| packages/download-domain-host/src/media/media-acquisition-bridge.test.ts | Media Host tests | Add S3/S4 binding, refusal-before-effects, digest recomputation and freshness tests. |
| packages/download-domain-host/src/storage/file-cas-doc-store.ts | New Host SDK V10DocStore adapter | Move physical implementation semantics from App; no SDK manifest change. |
| packages/download-domain-host/src/storage/file-cas-doc-store.test.ts | New store tests | CAS, atomicity, restart, conflict and malformed document behavior. |
| packages/download-domain-host/src/storage/index.ts | New storage barrel | Export Host storage adapter only. |
| packages/download-domain-host/src/migration/plain-file-lineage-store.ts | New dormant T09 physical adapter | Move plain-file adapter behavior; no App import/caller. |
| packages/download-domain-host/src/migration/plain-file-lineage-store.test.ts | New migration store tests | Schema/revision, typed error, atomic persistence behavior. |
| packages/download-domain-host/src/migration/index.ts | New migration barrel | Export Host physical adapter; do not wire production caller. |
| packages/download-domain-host/src/package-boundary.test.ts | New boundary test | Assert no Host→App source dependency, including side-effect/dynamic/CommonJS forms. |

## Read-only dependencies

- A01 Direct/S4 contracts and A01B S3 DTO are already integrated at the exact base.
- App source compatibility remains until A04; do not edit it in A03.
- Core continues using transitional App deep paths until A04; do not edit Core.
- Both App/Host package manifests and root lockfile are A04's sole write set.
