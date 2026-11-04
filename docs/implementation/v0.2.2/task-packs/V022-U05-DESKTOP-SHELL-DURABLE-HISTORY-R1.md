# Task Pack R1 — V022-U05-DESKTOP-SHELL-DURABLE-HISTORY

> TASK_PACK_STATE: OWNER_APPROVED_SCOPE / DEPENDENCY_GATED / EXACT_BASE_REBIND_REQUIRED
> Task: #353
> Parent: #310
> Dependencies: #351 R1 (Core Seam index + DESKTOP_UI S1 admission), #352 R1 (Desktop adapter S1 API)
> Amendment authorization: #354 comment 6623288615
> R0 history: `V022-U05-DESKTOP-SHELL-DURABLE-HISTORY.md`
> Product blob (immutable): `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob (immutable): `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Initial reference WIP base only: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd` / tree `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Replace session-only manager enumeration with the Core-owned durable S1 index and complete the Desktop S1 add/reopen workflow using the reviewed T01 R1 query/surface gate and T02 R1 adapter.

## Exact exclusive write set — unchanged 14 paths

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

No other path is permitted. T03 remains the only shell IPC/preload/renderer writer.

## Required behavior

1. `managerRefresh` obtains S1 rows from the Core index query; the in-memory session Map is not the source of accepted-task enumeration.
2. `confirmAdd` runs existing preview/confirmation, then routes S1 execution through the Desktop adapter.
3. Reopen uses aggregate ID and fresh `READ_PROJECTION`; do not fabricate contract/scope facts for jobs created by CLI or another authorized surface.
4. Cancel/retry remain existing Core commands and Core re-decides each transition.
5. Return accurate `totalCount` and `truncated`; show visible truncation notice and do not claim complete history when truncated.
6. Remove destination picker, per-download destination field, reveal action and their IPC/preload channels. Render only `保存位置由 Core 配置管理`; no guessed path.
7. Preserve main-frame sender validation, closed channel allowlist, exact payload decoding and typed fail-closed errors.
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

- T01 R1 and T02 R1 must each complete implementation, local gates, independent Exact-SHA review and separate Owner WIP integration first.
- The combined WIP candidate must contain the reviewed T01 Core surface gate and T02 adapter. T02 mock tests are not a substitute for real Core admission.
- Immediately before dispatch, re-read WIP HEAD/tree and rebind this Task Pack to the exact commit containing both Owner-integrated dependencies; update the execution manifest and pack blob.
- Only then may the Local Builder publish its own accepted ADS `DISPATCH_CLAIMED`. No source mutation or Claim is allowed against the initial reference base.
- Node 24 syntax and changed-file Prettier before focused tests, typecheck, aggregate `pnpm run ci:verify`, local Docker Woodpecker; independent Exact-SHA review after implementation.

## Forbidden

- No changes outside the fourteen paths.
- No Core Seam/Core Runtime/CLI/Host/package manifest/lockfile changes.
- No destination picker/outputRoot/reveal, guessed path, synthetic progress/ETA, S2–S6, real external download, Native Host or registry side effect.
- No main/version, release or deployment.
- No WIP merge without separate Owner authorization naming exact candidate HEAD/tree.
