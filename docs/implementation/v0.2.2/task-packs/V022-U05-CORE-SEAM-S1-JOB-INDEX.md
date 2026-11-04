# Task Pack — V022-U05-CORE-SEAM-S1-JOB-INDEX

> TASK_PACK_STATE: OWNER_SCOPE_FROZEN / TASK_PACK_REVIEW_REQUIRED / BUILDER_CLAIM_REQUIRED
> Task: #351
> Parent: #310
> Product/L2 Freeze: `docs/architecture/v0.2.2/U05_PRODUCT_L2_FREEZE_RECORD_R0.md`
> Product blob: `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob: `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Initial WIP base: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
> Initial WIP tree: `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Add one closed, read-only Core Seam query `LIST_S1_JOB_PROJECTIONS`, derived only from the existing `SeamJournal.replayAll()` and `projectAggregate` authorities.

## Exact write set

- `packages/core-seam/src/envelope.ts`
- `packages/core-seam/src/server.ts`
- `packages/core-seam/test/envelope-wire-compatibility.test.ts`
- `packages/core-seam/test/projection-read-side.test.ts`
- `packages/core-seam/test/s1-job-index.test.ts` (new)

No other path is permitted. In particular do not edit `state.ts`, `peer.ts`, `projection.ts`, `index.ts`, Core Runtime, App, Host, Desktop, shell, package manifests, lockfile or CI.

## Required implementation contract

1. Add `LIST_S1_JOB_PROJECTIONS` to the closed legacy query discriminant. The exact reserved `aggregateId` is `core:s1-job-index`; reject any other subject and reject the new discriminant under schema 1.3 before journal access.
2. Bump `CORE_SEAM_SCHEMA_VERSION` from 1.3.0 to 1.4.0, supported major remains 1. Preserve old 1.3 command and `READ_PROJECTION` decoding/handling. The explicit v0.2 route remains unchanged.
3. The existing per-frame `authorizePeer` check remains the only peer authorization. Do not add caller-supplied user/install filters.
4. Read `AcceptedCommandJournalEntry` values from `options.journal.replayAll()`. Select only `EXECUTE_S1_DIRECT_ACQUISITION` entries whose `envelope.peer.installId` and `userId` exactly match the verified query peer.
5. Deduplicate by aggregate using the most recent matching S1 command in durable replay order. Do not sort by `issuedAt`.
6. Resolve each aggregate from current seam state with `projectAggregate`; if an accepted S1 entry has no current projection, fail closed with a typed diagnostic.
7. Return latest 200 unique rows in reverse durable commit order. `totalCount` is the post-peer-filter, post-deduplication count. `truncated` MUST equal `totalCount > items.length`.
8. Query is read-only: no journal append, state mutation, new index, cache, store, path or arbitrary filter.

## Required tests

- Exact sentinel accepted; all other aggregate subjects rejected for this query.
- Schema 1.3 rejects new query while existing 1.3 command and `READ_PROJECTION` compatibility remains.
- Same install/user across CLI/Desktop/Browser authorized peers; exclude other install/user.
- Durable journal ordering, duplicate aggregate deduplication, empty index.
- Boundaries 199/200/201, totalCount and truncated exactness.
- Missing projection fails closed; restart replay over the same journal port returns the same index.

## Required gates

- Independently review this Task Pack before dispatch.
- Re-read current WIP HEAD/tree; if not exactly the initial base above, rebind and update this Task Pack before Claim.
- Local Builder must publish its own accepted ADS `DISPATCH_CLAIMED` bound to #351, current base/tree, Task Pack blob and exact write set.
- Node 24 syntax preflight and changed-file Prettier before focused tests.
- Focused Core Seam tests, `pnpm run typecheck`, `pnpm run ci:verify`, local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA source review after Builder completion.

## Forbidden

- No mutation outside the five paths.
- No new persistence or lifecycle authority; no changes to `SeamJournal` interface.
- No changes to Product/L2, CLI, Desktop adapter, shell, Core Runtime, Host, package manifests or lockfile.
- No main/version, release, deployment, real external download, Native Host or registry side effect.
- No WIP merge without separate Owner authorization.