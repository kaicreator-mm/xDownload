# Implementation Map — exact base 9e3ccd382311619e60b8d2a7373e8a7d34733334

This is a read-only map; it does not widen the Task Pack.

| Path | Base blob | Current responsibility | Bounded change |
|---|---|---|---|
| `packages/domain-contracts/src/index.ts` | `31af4e7e9bd38f2c49a0c5c6755704a0b2f3dc76` | Neutral package public exports. | Additive exports for the new Host-facing contract module only. |
| `packages/domain-contracts/src/contract.ts` | `eb49defb40557ca9189daee20f6b3e1f475226b2` | Existing shared contract/schema primitives. | Read-only reference; reuse only where semantically exact. |
| `packages/domain-contracts/src/ports.ts` | `736a54889ef3e7f0bbe62b83071bce05babf7052` | Existing narrow shared ports. | Read-only reference; do not widen unrelated ports. |
| `packages/domain-contracts/src/evidence.ts` | `f9dde413c53d07c53a1ad098c0efbb4fdadbf426` | Existing evidence types. | Read-only reference; preserve evidence semantics. |
| `packages/domain-contracts/src/result.ts` | `042d8bd9059d9d927c247e46f27642fe86ed106e` | Canonical terminal result dimensions. | Read-only reference; do not alter coverage or terminal dimensions. |
| `packages/domain-contracts/package.json` | `bb27e9e2b45184ba04ef682547b41c84c37471ff` | Existing pure package manifest. | Read-only; no dependency or manifest change. |
| `packages/download-domain-app/src/contracts/**` | baseline tree | App-owned Business Intent and contract policy. | Read-only source for projection into neutral Host DTOs; no App writes. |
| `packages/download-domain-host/src/direct/**` | baseline tree | Direct Host bridge and independent validation. | Read-only consumer context; no Host writes. |
| `packages/download-domain-host/src/media/**` | baseline tree | Media/HLS Host bridge and selection revalidation. | Read-only consumer context; no Host writes. |
| `packages/core-runtime/src/domain-app-route.ts` | baseline tree | Production composition and route consumer. | Read-only authority context; no Core writes. |

## Exact writable paths

- `packages/domain-contracts/src/download-host/**`
- `packages/domain-contracts/src/index.ts` (additive export only)
- `packages/domain-contracts/test/download-host/**`

No App, Host, Core Runtime, package manifest, lockfile, CI, SDK or vendor path is writable.
