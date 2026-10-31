# T06 Implementation Map — exact base e71ff24c4d4e04e86bb7771c23309b55e4fb5a16

## Existing code

| Path | Existing responsibility | T06 rule |
|---|---|---|
| packages/download-domain-app/src/integrations/s3-media.ts | K sealed media composition and S3 media journey | Reuse K/SDK/permit pattern; do not claim S4 from S3 path |
| packages/download-domain-app/src/integrations/index.ts | public integration exports for S2/S3/S5/S6; no S4 export currently | Add only the S4 integration export and truthful scope note |
| packages/download-domain-host/src/media/media-acquisition-bridge.ts | permit-gated HLS execution and file materialization through existing engine | Extend bounded S4 entry semantics only; no second engine |
| packages/download-domain-host/src/media/media-permit.ts | exact-key permit binding to operation/request/lineage/origins/budget | Reuse and preserve exact binding |
| packages/hls-vod-adapter/src/pipeline-async.ts | existing HLS acquisition pipeline | Reuse |
| packages/hls-vod-adapter/src/pinned-host-composition.ts | pinned HTTPS manifest/segment ports and selected plan binding | Reuse; no generic fetcher |
| packages/core-runtime/src/s4-selected-hls.ts | existing Core S4 preview/execute reference | Read-only reference; not a second K authority |
| packages/core-seam/src/s4-seam12-payload.ts | existing closed S4 wire payload grammar | Read-only reference; no edits allowed |

## Current gap

The Domain App integration index exports S3 media, S2, S5 and S6 but no S4 K journey. The Host bridge already uses the HLS engine, but its generic intent contract is S1/S3; S4 must not be falsely represented as S3. Use a bounded S4-specific internal request/selection contract under the T06 write set, or stop for L2 routing if that cannot be done safely.

## Exact base

- version/v0.2.1 @ e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
- tree 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 predecessor #250 closed at e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
