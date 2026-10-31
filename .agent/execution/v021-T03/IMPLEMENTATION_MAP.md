# T03 Implementation Map — exact base e71ff24c4d4e04e86bb7771c23309b55e4fb5a16

## Existing code

| Path | Existing responsibility | T03 rule |
|---|---|---|
| packages/direct-acquisition/src/direct-http-adapter.ts | single-target HTTP acquisition, redirect/refresher policy, cancellation, stream reads and terminal projection | Improve only transfer/retry/resume behavior; preserve canonical outcome |
| packages/direct-acquisition/src/identity.ts | strong/weak ETag, range response classification, resume decisions | Strong validator only; changed identity cannot append |
| packages/direct-acquisition/src/integrity.ts | transfer/format/target/media validation | Preserve fail-closed validation |
| packages/direct-acquisition/src/port.ts | request, partial state, ledger port and typed outcome | Reuse public types; no second ledger |
| packages/direct-acquisition/test/** | controlled HTTP fixtures and current retry/resume/redirect/integrity tests | Add focused tests only in this package |
| packages/download-domain-host/src/direct/direct-acquisition-bridge.ts | artifact path validation and atomic temp+rename materialization | Read-only; Host owns file effects and is outside T03 write set |

## Known boundaries

The direct adapter is byte-oriented and does not own file writes. Disk-full, path traversal, collision and atomic finalization are Host materialization concerns. T03 may strengthen the transfer state contract but must not move filesystem authority into the adapter. T11 may provide cross-layer fixture evidence under its own write set.

## Exact base

- Integration branch: version/v0.2.1
- Base SHA: e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
- Base tree: 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 predecessor merge: e71ff24c4d4e04e86bb7771c23309b55e4fb5a16
