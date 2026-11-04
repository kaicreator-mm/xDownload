# Task Pack — V022-U05-DESKTOP-ADAPTER-S1-DIRECT

> TASK_PACK_STATE: OWNER_SCOPE_FROZEN / TASK_PACK_REVIEW_REQUIRED / BUILDER_CLAIM_REQUIRED
> Task: #352
> Parent: #310
> Product/L2 Freeze: `docs/architecture/v0.2.2/U05_PRODUCT_L2_FREEZE_RECORD_R0.md`
> Product blob: `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob: `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Initial WIP base: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
> Initial WIP tree: `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Expose the already-installed Core S1 direct-acquisition path and the read-only S1 job-index query through the Desktop adapter. Use the CLI S1 sequence as a source reference; do not implement transfer in Desktop.

## Exact write set

- `apps/desktop/src/adapter.ts`
- `apps/desktop/src/commands.ts`
- `apps/desktop/src/manager-documents.ts`
- `apps/desktop/test/core-authority.test.ts`
- `apps/desktop/test/manager-documents.test.ts`
- `apps/desktop/test/s1-direct-acquisition.test.ts` (new)

No other path is permitted. Do not edit CLI, Core Seam, Core Runtime, shell, Host, package manifests, lockfile or CI.

## Required behavior

1. Preserve the existing `SUBMIT_CONTRACT` and Core-produced confirmation flow.
2. After the same Desktop interaction confirms the single-resource contract, send `EXECUTE_S1_DIRECT_ACQUISITION` using the accepted aggregate, canonical snapshot/member/artifact IDs and existing S1 delivery payload contract.
3. Default `declaredRedirectHosts` to the selected URL's own host only, matching the CLI default. Do not widen redirects or add optional digest/content-type/total-byte form fields.
4. Preserve request identity for retries/reconnect of the same logical command; do not create a second idempotency or durable store.
5. Treat command acceptance as admission only. Read `READ_PROJECTION` for current and terminal facts.
6. Add a typed adapter method for `LIST_S1_JOB_PROJECTIONS`; strictly validate the response envelope, item projections, aggregate bindings, `totalCount`, `truncated` and 200-item bound.
7. Expose a typed S1 manager-row projection from Core facts only. Do not expose a guessed output path, destination, progress, ETA or terminal success.

## Required tests

- Valid URL → preview/confirm → exact S1 command sequence and accepted aggregate binding.
- Invalid URL, denied confirmation or rejected command causes no transfer effect.
- Redirect host is URL host only; optional delivery fields remain absent.
- Acceptance does not become completion; status comes from Core projection.
- Index response schema/bounds/binding checks and typed rejection/disconnect.
- Retry/reconnect reuses the same logical request identity; duplicate execution converges.
- Existing cancel/retry behavior and all prior Desktop adapter tests remain intact.

## Required gates

- Independently review this Task Pack before dispatch.
- Re-read current WIP HEAD/tree; if moved, rebind the pack before Claim.
- Local Builder publishes its own accepted ADS `DISPATCH_CLAIMED` for #352 and this exact write set.
- Node 24 syntax and changed-file Prettier before focused tests; then typecheck, `pnpm run ci:verify`, local Docker Woodpecker.
- Independent Exact-SHA source review after implementation.

## Forbidden

- No new HTTP client, downloader, K, scheduler, journal, ledger, artifact store or transfer engine.
- No changes to CLI, Core Seam, Core Runtime, Host, shell, package manifests or lockfile.
- No per-download outputRoot/destination picker/reveal, progress/ETA/path fabrication, S2–S6 expansion or real external download.
- No main/version, release, deployment, Native Host or registry side effect.
- No WIP merge without separate Owner authorization.