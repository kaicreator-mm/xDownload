# Task Pack R1 — V022-U05-CORE-SEAM-S1-JOB-INDEX

> TASK_PACK_STATE: OWNER_APPROVED_SCOPE / INDEPENDENT_R1_REVIEW_REQUIRED / GENERATION_2_BUILDER_CLAIM_REQUIRED
> Task: #351
> Parent: #310
> Amendment authorization: #354 comment 6623288615
> Supersedes for future mutation: R0 Task Pack blob `dc71c5f260325fca17712e90f20e0e940d0694b1`
> DAG: `docs/architecture/v0.2.2/U05_DESKTOP_S1_IMPLEMENTATION_DAG_R1.md`
> Product blob (immutable): `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob (immutable): `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Exact WIP base: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
> Exact WIP tree: `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Implement the read-only Core Seam query `LIST_S1_JOB_PROJECTIONS`, preserve schema compatibility, and admit the existing `EXECUTE_S1_DIRECT_ACQUISITION` command from exactly CLI and Desktop UI peers without changing any other authority boundary.

## Exact exclusive write set — 10 paths

1. `packages/core-seam/src/envelope.ts`
2. `packages/core-seam/src/server.ts`
3. `packages/core-seam/test/envelope-wire-compatibility.test.ts`
4. `packages/core-seam/test/projection-read-side.test.ts`
5. `packages/core-seam/test/s1-job-index.test.ts` (new)
6. `packages/core-seam/test/s3-closed-wire-admission.test.ts`
7. `packages/core-seam/test/s4-closed-wire-admission.test.ts`
8. `packages/core-seam/test/s4-seam12-payload.test.ts`
9. `packages/core-seam/test/verified-session.test.ts`
10. `packages/core-seam/test/s1-command-surface.test.ts` (new)

No other path is permitted. T01 is the only writer for Core Seam envelope/server behavior and these Core Seam tests. Do not edit `state.ts`, `peer.ts`, `projection.ts`, `index.ts`, Core Runtime, CLI, Desktop, shell, Host, package manifests, lockfile or CI.

## Required implementation contract

### A. Read-only S1 job index

1. Add `LIST_S1_JOB_PROJECTIONS` to the closed legacy query discriminant. Exact reserved subject: `core:s1-job-index`; reject any other subject and reject the new query under schema 1.3 before journal access.
2. Bump `CORE_SEAM_SCHEMA_VERSION` from 1.3.0 to 1.4.0, supported major remains 1. Preserve old 1.3 command and `READ_PROJECTION` decoding/handling. The explicit v0.2 route remains unchanged.
3. The existing per-frame `authorizePeer` remains the only Peer authorization. Do not add caller-supplied install/user filters.
4. Read accepted S1 command entries from `options.journal.replayAll()`; select only `EXECUTE_S1_DIRECT_ACQUISITION` entries whose peer `installId` and `userId` exactly match the verified query peer.
5. Deduplicate by aggregate using latest matching S1 command in durable replay order, not `issuedAt`; resolve every aggregate through `projectAggregate`.
6. If an accepted S1 entry has no current projection, fail closed with a typed diagnostic.
7. Return latest 200 unique rows in reverse durable commit order; `totalCount` is post-peer-filter/post-deduplication count and `truncated === totalCount > items.length`.
8. Query is read-only: no journal append, state mutation, new index/store/cache, path or arbitrary renderer filter.

### B. S1 command surface admission

1. For the existing `EXECUTE_S1_DIRECT_ACQUISITION` command only, admit exactly the `CLI` and `DESKTOP_UI` peer surface values.
2. Reject every other peer surface defined by the current Peer contract. Do not add a new surface value or a new command.
3. Do not rewrite `DESKTOP_UI` to `CLI`; the peer surface must remain the actual caller identity.
4. Preserve the existing per-frame `authorizePeer` invocation and all subsequent admission checks: accepted contract, aggregate/Lineage binding, canonical snapshot/member/artifact identities, redirect-host policy, budget, digest, request identity, runtime availability and fail-closed behavior.
5. Do not broaden any other command's allowed surfaces. Do not add caller-controlled bypass flags or skip authorization based on the surface allowlist.
6. The index query remains same-install/same-user scoped. A Desktop row must not expose jobs belonging to another install or user.

## Required tests

### Schema and compatibility
- New index query requires schema 1.4.0+ within supported major 1.
- Existing 1.3 command and `READ_PROJECTION` compatibility remains intact.
- Update only stale expected-current-version assertions in the four newly admitted legacy test files to 1.4.0. Preserve historical 1.0/1.1/1.2 compatibility assertions and all other security/behavior assertions.

### Index query
- Exact sentinel accepted; all other aggregate subjects rejected.
- Same install/user across authorized surfaces; exclude other install/user.
- Durable replay ordering, latest-command aggregate deduplication, empty list.
- Boundaries 199/200/201, exact `totalCount` and `truncated`.
- Missing projection/journal inconsistency fails closed.
- Restart replay over the same journal port returns the same index.

### S1 command surface
- Positive admission for CLI and DESKTOP_UI.
- Negative admission for every other defined peer surface.
- Prove per-frame `authorizePeer` still executes for both allowed surfaces.
- Invalid/unauthorized peer, contract, aggregate/Lineage or runtime conditions remain rejected for both allowed surfaces.
- Existing CLI behavior and all unrelated command-surface gates remain unchanged.

## Existing local worktree reconciliation

T01 generation-1 Builder reported an uncommitted implementation at the exact base. Preserve that work; do not reset, discard or recreate the worktree. Before further source mutation:
1. Read the new R1 Task Pack and verify the exact 10-path set.
2. Inspect the dirty worktree and confirm every changed path is within the R1 set.
3. Preserve the five-path implementation and add only the required compatibility and surface tests/changes.
4. Publish a fresh accepted generation-2 CAS `DISPATCH_CLAIMED` bound to this R1 pack, exact base/tree and exact write set.
5. If any out-of-scope path is dirty or the base differs, stop and report; do not silently clean or rebase.

## Required gates

- Independent review of this R1 Task Pack must PASS before generation-2 Claim.
- Re-read task branch and WIP; exact source base must be `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd` / `870657c54eecae9721a6b06221828a6bdfdfbb0d`, or rebind the pack/manifest before claim.
- Accepted generation-2 LOCAL_BUILDER CAS Claim before further source mutation.
- Node 24 syntax preflight and changed-file Prettier before focused tests/CI.
- Focused Core Seam tests, `pnpm run typecheck`, aggregate `pnpm run ci:verify`, local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA source review after implementation.

## Forbidden

- No mutation outside the exact 10 paths.
- No new persistence/index/store/authority/status model; no changes to journal interface.
- No changes to Product/L2, CLI, Core Runtime, Host, Desktop adapter, shell, package manifests or lockfile.
- No real external download, Native Host, registry, main/version, release, tag or deployment side effect.
- No WIP merge without separate Owner authorization naming exact candidate HEAD/tree.
