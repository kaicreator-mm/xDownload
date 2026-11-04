# Task Pack — V022-U05-DESKTOP-SHELL-DURABLE-HISTORY

> TASK_PACK_STATE: OWNER_SCOPE_FROZEN / DEPENDENCY_GATED / EXACT_BASE_REBIND_REQUIRED
> Task: #353
> Parent: #310
> Dependencies: #351 (Core Seam index query), #352 (Desktop adapter S1 API)
> Product/L2 Freeze: `docs/architecture/v0.2.2/U05_PRODUCT_L2_FREEZE_RECORD_R0.md`
> Product blob: `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob: `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Initial reference WIP base only: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd` / tree `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Replace session-only manager enumeration with the Core-owned durable S1 index and finish the Desktop S1 add/reopen experience using the T01 query and T02 adapter.

## Exact exclusive write set

- `apps/desktop-shell/src/main/manager.ts`
- `apps/desktop-shell/src/main/shell-contract.ts`
- `apps/desktop-shell/src/main/ipc.ts`
- `apps/desktop-shell/src/main/validators.ts`
- `apps/desktop-shell/src/main/main.ts`
- `apps/desktop-shell/src/preload/preload.ts`
- `apps/desktop-shell/src/renderer/manager-state.ts`
- `apps/desktop-shell/src/renderer/renderer-main.ts`
- `apps/desktop-shell/src/renderer/index.html`
- `apps/desktop-shell/src/renderer/styles.css`
- `apps/desktop-shell/test/manager.test.ts`
- `apps/desktop-shell/test/manager-view.test.ts`
- `apps/desktop-shell/test/security-invariants.test.ts`
- `apps/desktop-shell/test/validators.test.ts`

No other path is permitted. This task is the only writer for shell IPC/preload/renderer. It must not edit `apps/desktop/**`, Core Seam, Core Runtime, CLI, Host, package manifests, lockfile or CI.

## Required behavior

1. `managerRefresh` obtains S1 rows from the Core index query; the in-memory session Map is not the source of accepted-task enumeration.
2. `confirmAdd` runs the existing preview/confirmation flow, then routes S1 execution through the Desktop adapter.
3. Reopen uses the aggregate ID and a fresh `READ_PROJECTION`; do not fabricate contract/scope facts for jobs created by CLI or another authorized surface.
4. Cancel/retry remain existing Core commands and Core re-decides each transition.
5. Return accurate `totalCount` and `truncated`; show a visible truncation notice and do not claim complete history when truncated.
6. Remove the destination picker, per-download destination field, reveal action and their IPC/preload channels. Render only `保存位置由 Core 配置管理`; no guessed path.
7. Preserve main-frame sender validation, closed channel allowlist, exact payload decoding, and typed fail-closed errors.
8. Preserve no fabricated progress, ETA, bytes, completion or artifact path.

## Required tests

- New manager instance re-enumerates existing S1 jobs; reopening a row refreshes Core projection.
- Same-install/same-user sees S1 jobs from authorized surfaces; cross-install/user remains excluded.
- Query refusal/disconnect does not render as an empty successful list.
- 0/199/200/201 list semantics and visible truncation.
- Preview → confirm → S1 command acceptance; pending state until Core projection provides terminal truth.
- Destination picker/reveal channels absent from IPC/preload; no renderer filesystem/shell authority.
- Existing cancel/retry Core outcomes remain truthful.
- Deterministic localhost fixtures only.

## Dependency and exact-base admission

- T01 and T02 must each complete source implementation, local gates, independent Exact-SHA review and separate Owner WIP integration first.
- Immediately before dispatch, re-read current WIP HEAD/tree and rebind this Task Pack to the commit containing both dependencies. Replace the initial reference base above with that exact SHA/tree and publish a new pack blob.
- Only then may the Local Builder publish its own accepted ADS `DISPATCH_CLAIMED` for #353. No source mutation or claim is allowed against the initial reference base.
- Node 24 syntax and changed-file Prettier before focused tests, typecheck, `pnpm run ci:verify`, local Docker Woodpecker; independent Exact-SHA review after implementation.

## Forbidden

- No changes outside the 14 paths.
- No Core Seam/Core Runtime/CLI/Host/package manifest/lockfile changes.
- No destination picker/outputRoot/reveal, guessed path, synthetic progress/ETA, S2–S6, real external download, Native Host or registry side effect.
- No main/version, release or deployment.
- No WIP merge without separate Owner authorization.