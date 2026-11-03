# Implementation Map — exact base 5880731aa84601373c028e45f2ec0380e521686f

This is a read-only map; it does not widen the Task Pack.

| Path | Current responsibility | Bounded change |
|---|---|---|
| packages/download-domain-app/src/index.ts | Public Domain App root | Curate exports; remove Host/runtime/physical adapter leakage. |
| packages/download-domain-app/src/composition/runtime.ts | Direct K BUILD plus current Host runtime assembly and FileCasDocStore | Remove Host imports/assembly exports; keep the transitional deep FileCasDocStore and pure BUILD needed by current Core. |
| packages/download-domain-app/src/integrations/index.ts | Integration export barrel | Stop exposing Host runtime assembly/pin implementations through public root. |
| packages/download-domain-app/src/integrations/media-registry.ts | Media targetRef registry | Replace Host helper import with A01 neutral targetRef grammar. |
| packages/download-domain-app/src/integrations/s3-media.ts | S3 media K BUILD and Host assembly | Remove Host import and unused production assembly; preserve domain journey/BUILD contract. |
| packages/download-domain-app/src/integrations/s4-hls-vod.ts | S4 K BUILD, Host pin seam and runtime assembly | Remove Host import and unused runtime assembly; preserve current Core-required seal and ABI seam until A04. |
| packages/download-domain-app/src/migration/index.ts | T09 policy/store barrel | Stop exporting the physical PlainFileLineageStore; keep policy and port types. |
| packages/core-runtime/src/domain-app-route.ts | Current deep-import consumer | Read-only reference; no Core write. |
| packages/domain-contracts/src/download-host/index.ts | A01 neutral contracts | Read-only reference. |

## Exact writable paths

See the exact 11-path write set in Task Pack #341. No Core, Host, Contracts, package manifest, lockfile, CI, SDK or vendor path is writable.
