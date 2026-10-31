# T11 Implementation Map — exact base e71ff24c4d4e04e86bb7771c23309b55e4fb5a16

## Existing reusable seams

| Existing path | Reusable behavior | T11 use |
|---|---|---|
| packages/direct-acquisition/test/helpers/fixture-server.ts | controlled direct HTTP fixture server | Reuse patterns for reset/timeout/validator/redirect cases |
| packages/hls-vod-adapter/test/fixtures.ts | deterministic HLS manifest/playlist/segment fixtures | Reuse HLS topology and byte fixtures |
| packages/download-domain-host/src/direct/direct-acquisition-bridge.ts | permit, path containment, digest recheck and atomic temp+rename | Exercise read-only through tests; do not modify |
| packages/download-domain-host/src/media/media-acquisition-bridge.ts | HLS permit, origin, budget, assembly and materialization | Exercise read-only through tests; do not modify |
| packages/core-runtime/** and packages/core-seam/** | durable command/effect, replay, cancellation and owner semantics | Test through public runtime seams; no source edits |
| packages/domain-contracts/** | canonical owner/progress/evidence/result contracts | Reuse decoders and status vocabulary |

## New test-only surface

Create reusable fixtures and corpora only under tests/v0.2.1/**. Keep real loopback HTTP, real temp-filesystem, injected failure and pure-contract cases explicitly distinguished. Do not duplicate production logic or fork canonical types.

## Exact base

- version/v0.2.1 @ e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
- tree 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 predecessor #250 closed at e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
