# Task Pack R2 — V022-U05-DESKTOP-SHELL-DURABLE-HISTORY

> TASK_PACK_STATE: OWNER_APPROVED_SCOPE / EXACT_BASE_REBOUND / INDEPENDENT_REVIEW_REQUIRED
> Task: #353
> Parent: #310
> Dependencies: #351 R1 and #352 R1 — independently reviewed and WIP-integrated
> Amendment authorization: #354 comment 6623288615
> R1 Task Pack: `V022-U05-DESKTOP-SHELL-DURABLE-HISTORY-R1.md` / blob `4ab4be00d10bcce44e95a0bcd8a9944c2caef706`
> Product blob (immutable): `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob (immutable): `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Exact combined WIP base: `753ae3d31e074a30d13643687502295a7a00b7e4` / tree `c9ff7c99caff02035987fc43307c14f851967458`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Dependency integration readback

T01 and T02 have each passed a fresh independent Exact-SHA source review and were squash-integrated into the exact WIP base above:

| Dependency | Reviewed candidate | Independent review | WIP integration |
|---|---|---|---|
| T01 #351 / PR #360 | `10d718c36553405b8280be0f056bac8ffd1809b7` / tree `40d0e6fbe6c553e2829540a581193d98718eb604` | PASS, review #5773699700 | squash `9664c48f84a5eed7b288726fdb945496d50a03cf` |
| T02 #352 / PR #361 | `21cc8cee5250772cce433498a412742fc8dbe72b` / tree `d2dac492039042adffdf80af8efe20f967721e84` | PASS, review #5773718547 | squash `753ae3d31e074a30d13643687502295a7a00b7e4` |

The combined WIP push pipeline #37 is pending at the time this R2 pack is authored. It MUST reach SUCCESS at exact WIP HEAD `753ae3d31e074a30d13643687502295a7a00b7e4` before T03 Builder Claim or source mutation. If WIP moves before admission, rebind again; never silently use a different base.

## Goal

Replace session-only manager enumeration with the Core-owned durable S1 index and complete the Desktop S1 add/reopen workflow using the reviewed T01 Core query/surface gate and T02 Desktop adapter.

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
- **Combined-candidate Core admission:** at least one real Core-backed Desktop-shell test must use the integrated Core Seam T01 DESKTOP_UI S1 admission and the T02 Desktop adapter. T02 Mock Transport tests remain adapter-unit evidence only and MUST NOT be substituted for this gate.

## Dependency and exact-base admission

- T01 #351 and T02 #352 are independently reviewed and squash-integrated into the exact WIP base named above.
- Verify WIP push pipeline #37 SUCCESS at that exact SHA before Builder Claim.
- The independent reviewer must PASS this R2 Task Pack before Builder Claim.
- Immediately before dispatch, re-read WIP HEAD/tree and confirm exact equality with this pack; if changed, create a new rebound Task Pack and review it.
- Only then may the Local Builder publish its own accepted ADS `DISPATCH_CLAIMED`, bound to this exact Task Pack blob and a fresh Execution Pack. No source mutation before accepted Claim.
- Node 24 syntax and changed-file Prettier before focused tests, typecheck, aggregate `pnpm run ci:verify`, local Docker Woodpecker; independent Exact-SHA review after implementation.

## Forbidden

- No changes outside the fourteen paths.
- No Core Seam/Core Runtime/CLI/Host/package manifest/lockfile changes.
- No destination picker/outputRoot/reveal, guessed path, synthetic progress/ETA, S2–S6, real external download, Native Host or registry side effect.
- No main/version, release or deployment.
- No WIP merge without the current Owner Delivery-First integration instruction naming the exact candidate HEAD/tree.
