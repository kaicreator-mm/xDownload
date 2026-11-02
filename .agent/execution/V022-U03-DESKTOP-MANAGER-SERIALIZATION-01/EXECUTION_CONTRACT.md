# Execution Contract — v022-U03-DESKTOP-MANAGER-SERIALIZATION-01

## Identity and exact baseline

- Task: xDownload #322
- Task Pack: `docs/implementation/v0.2.2/task-packs/V022-U03-DESKTOP-MANAGER-SERIALIZATION.md`, blob `fa2b4a15e2106aa562346f674fa2dbd89c36df45`
- Integration branch: `wip/v0.2.2-ui-rebuild-r0`
- Exact base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- Base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`
- Task branch: `task/v0.2.2-u03-desktop-manager-serialization`
- Allowed write set: exactly `apps/desktop-shell/src/main/manager.ts` and `apps/desktop-shell/test/manager.test.ts`.
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`.
- Pinned ADS: v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`.

## Execution authority

The Owner authorizes an actual Local Agent to act as `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` for this exact Task (#322 comment 6586419707; project policy #305 comment 6586392596). The v4.18 dispatch schema supports this profile.

This pack is READY FOR A LOCAL BUILDER CLAIM, not yet claimed. The Local Agent must re-read current GitHub facts and publish its own schema-conforming `DISPATCH_CLAIMED` before source mutation. The scheduler does not claim on behalf of the worker. Never represent a Web executor as Local.

## Required implementation shape

- One FIFO operation gate in DesktopManager for all adapter-touching public operations.
- Public list is single-flight/coalesced.
- Internal `listUnlocked()` avoids re-entering the gate from action/discard closeout.
- Release in `finally`; errors cannot poison the queue.
- `chooseDestination()` remains outside because it does not use the adapter.
- Do not add a second adapter/Core or change adapter.ts, renderer, IPC or Host.

## Required evidence

1. Exact task/base/pack/claim re-read and two-path write-set check.
2. Node 24 syntax/type preflight and changed-file Prettier before CI.
3. Focused manager test with deferred two-lineage interleavings and queue-recovery tests.
4. Typecheck and one aggregate `pnpm run ci:verify`.
5. Exact-HEAD local Docker Woodpecker Build ID/URL/result and logs.
6. Independent Exact-SHA Review PASS before WIP merge.
7. Packaged Windows wrong-lineage runtime reproduction must be explicitly PASS or NOT_RUN; unit tests are not a runtime reproduction.

No merge to version/v0.2.1 or main, no release/deployment, and no real download/registry/Native Host side effects.
