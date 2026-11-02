# Implementation Map — exact base 9e3ccd382311619e60b8d2a7373e8a7d34733334

This is a read-only map of the base source. It does not widen the Task Pack write set.

| File | Base blob | Existing responsibility | Bounded implementation focus |
|---|---|---|---|
| `apps/desktop-shell/src/main/manager.ts` | `936cd80e24bdab19d13d3884d903670a562d11c1` | Main-process Desktop manager; shares one DesktopUiAdapter across add/list/control/reveal. | FIFO serialization of adapter-touching operations, list single-flight/coalescing, internal unlocked list helper, error-safe queue release. |
| `apps/desktop-shell/test/manager.test.ts` | `67656175d9cb2ca717d25833f6d27b4e6751ffbe` | Real seam manager tests plus reveal stubs. | Deferred fake-adapter interleaving tests for Cancel/Retry, row identity, list coalescing and queue recovery. |

## Read-only lifecycle fact

`apps/desktop-shell/src/main/main.ts` blob `0adea553ee83366914d75357795f5e9ebcc6aee1` awaits the one-time `connection.probeOnce()` before constructing DesktopManager and registering renderer IPC. The proposed manager gate covers subsequent manager operations; do not introduce a second adapter/Core.

## Known constraints

- The adapter's mutable `currentAggregateId` is shared. The manager must not let its own asynchronous adapter operations interleave.
- Preserve Core as sole status/control authority; never cache or fabricate status/progress.
- No changes to `apps/desktop/src/adapter.ts` or renderer are in this Task.
