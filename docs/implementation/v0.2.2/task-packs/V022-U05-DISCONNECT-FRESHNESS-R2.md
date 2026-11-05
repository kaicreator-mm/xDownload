# Task Pack R2 — U05 Desktop stale projection / disconnect freshness

> TASK_PACK_STATE: INDEPENDENT_REVIEW_REQUIRED
> Task: #367
> Parent: #310
> Related legacy bug: #318
> Task ID: `V022-U05-DISCONNECT-FRESHNESS-02`
> Version: xDownload v0.2.2
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`
> WIP integration target: `wip/v0.2.2-ui-rebuild-r0`

## 1. Why this task exists

The real packaged Windows U05 acceptance recorded on parent #310 comment #6650505743 proves the positive S1 flow, actual bytes+SHA-256, restart recovery, replay idempotency and install/user isolation. It still returned FAIL / NOT_COUNTED:

After a successful completed row, Core was stopped while Desktop remained open. The next manager refresh correctly returned a typed refusal, but the renderer simultaneously displayed `Core 已连接`, a completed count of 1 and the cached row as unqualified `已完成`.

Frozen Product blob `d4edc5d477c14cdb30cc29b31c15a98237232ae9`, §2.4 requires a transport disconnect or failed projection read not to render a stale successful task.

This task is a bounded implementation repair inside the already frozen U05 Product/L2 scope. No Product/L2 amendment is needed.

### R2 exact-base rebind

The independent Core Seam recovery task #370 / PR #372 has now passed fresh Exact-SHA R2 review (P0/P1/P2=0) and has been squash-integrated into the WIP branch. R2 rebinds only the implementation base to the resulting WIP HEAD `a578600f76fba15df8714f4b1913ae189c9d4606` / tree `6dc17bfb805c6666fc60f78d5081ea28572016d2`. The four-path source scope and acceptance remain unchanged. The post-integration packaged Windows test must prove the same-client Core recovery and renderer stale-state recovery together.

## 2. Current-source diagnosis and relation to #318

Exact inspected WIP base after Core reconnect dependency integration:
- HEAD: `a578600f76fba15df8714f4b1913ae189c9d4606`
- Tree: `6dc17bfb805c6666fc60f78d5081ea28572016d2`
- Dependency: #370 / PR #372, Exact-SHA R2 PASS and merged by squash into this WIP at the above HEAD.
- Exact-SHA Woodpecker #51 / Build 21337: SUCCESS on the dependency implementation SHA `2bf54631076c1903a4af5abd868aff45f0f99cac`.
- Product blob: `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
- L2 blob: `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
- U05 R1 DAG blob: `0048b5b4f6df2b2bad30a93f55450311b304a8bc`

Current `DesktopManager.list()` already sends a fresh read-only `LIST_S1_JOB_PROJECTIONS` query on every refresh, even when the index is empty. On Core disconnect it returns a typed refusal. The defect is downstream: `applyList()` and the embedded-action-list refusal preserve both old rows and old `CONNECTED` state without marking that snapshot stale; the renderer then presents old terminal facts/counts as current and leaves row controls enabled.

Issue #318 was diagnosed against an earlier manager implementation where the empty-list path did not query Core. Its old proposed extra `CoreConnection.probeOnce()` call is unnecessary on this WIP: the durable-index read is already the fresh liveness/read operation. This task explicitly covers both empty and populated indexes through the same failed-index-read freshness path. Do not add a new ping, query, protocol or second liveness authority.

## 3. Required behavior

Introduce a renderer snapshot freshness state:
- `unavailable`: no successful Core index has been read in this renderer session.
- `fresh`: the latest Core index read succeeded.
- `stale`: a later index read was refused, disconnected or malformed after a successful snapshot.

On a stale transition:
1. Preserve last-known rows and index counters; never replace a failed read with a fake empty success.
2. Clear the displayed live connection word. The UI must not say `Core 已连接`; it must explicitly say the Core/index is currently unavailable and the displayed rows are only the last successful snapshot.
3. Qualify every cached row status, progress, detail and count as last-known. A cached terminal may not be shown as an unqualified current `已完成`.
4. Remove the green/current-complete visual treatment from stale rows.
5. Disable Core-authority-dependent row controls (cancel/retry) until a fresh successful index read.
6. A later successful index read sets freshness to `fresh`, restores the current connection state, replaces cached projections/counters with the new Core response and re-enables only controls allowed by the new Core projection.
7. Initial unconfigured/refused/malformed state remains `unavailable`; no empty-state or zero-count success is fabricated.
8. Apply the same stale transition when an action response contains a refused embedded list.

## 4. Exact baseline and exclusive write set

Repository: `kaicreator-mm/xDownload`

- Source/base branch: `wip/v0.2.2-ui-rebuild-r0`
- Exact base HEAD: `a578600f76fba15df8714f4b1913ae189c9d4606`
- Exact base Tree: `6dc17bfb805c6666fc60f78d5081ea28572016d2`
- Frozen Product: `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
- Frozen L2: `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
- Frozen U05 DAG: `0048b5b4f6df2b2bad30a93f55450311b304a8bc`

Exact four-path write set:
1. `apps/desktop-shell/src/renderer/manager-state.ts`
2. `apps/desktop-shell/src/renderer/renderer-main.ts`
3. `apps/desktop-shell/test/manager-view.test.ts`
4. `apps/desktop-shell/test/manager.test.ts`

The last path adds a real seam regression for a successful empty index followed by Core loss. Existing manager code already issues the fresh index read, so no production manager change is required.

Forbidden: `core-connection.ts`, `manager.ts`, IPC/preload/shell contract, HTML/CSS, Core Seam/Runtime, Host, CLI, DomainHarness, SDK, manifests/lockfile, any other path, Product/L2, new K, new query, new protocol or authority.

## 5. Required regressions

- Fresh populated list → typed index refusal: freshness becomes stale; last-known rows remain; connection is no longer CONNECTED; all cached row status/progress/detail/counts are visibly last-known; complete rows lose the current-success visual treatment; cancel/retry disabled.
- Fresh empty index → stop Core → next `manager.list()` performs a fresh query and returns a typed disconnect refusal; renderer never reports CONNECTED or a successful empty-state.
- First-load refusal: unavailable, no rows/counts represented as a successful empty index.
- Embedded action-list refusal after a successful snapshot: same stale transition.
- Successful recovery after stale: freshness returns to fresh and the newly returned Core projections/counters replace the cached snapshot.
- Preserve all existing add/retry/cancel, Core projection truth, same-install/same-user identity, 0/199/200/201 paging, no fake progress/ETA, no destination/reveal, IPC and security tests.

## 6. Claim, validation and review

- Source branch: `task/v0.2.2-u05-disconnect-freshness-r2`
- Execution branch: `execution/v0.2.2-u05-disconnect-freshness-r2`
- Execution manifest: `.agent/execution/V022-U05-DISCONNECT-FRESHNESS-02/MANIFEST.yaml`
- Required generation-2 CAS `DISPATCH_CLAIMED`, bound to this R2 Task Pack, execution manifest, exact post-#370 base/tree and four-path write set, must be read back before any source mutation.
- Builder owns implementation, repair and local validation in one continuous delivery; no standalone LOCAL_VALIDATION task.
- Node v24 syntax and changed-file Prettier before CI.
- Focused `manager-view.test.ts` and `manager.test.ts`, typecheck, aggregate `pnpm run ci:verify`, `tools/task-check.sh`, exact-SHA local Docker Woodpecker SUCCESS.
- Re-run the isolated packaged Windows sequence: successful localhost S1 fixture; stop Core while Desktop remains open; verify stale banner, last-known qualification, no CONNECTED, no active row controls; restart Core; verify fresh index response replaces the stale snapshot and current controls are restored only from Core facts.
- Independent Exact-SHA source review after final candidate. Any review repair remains inside these four paths, then all SHA-bound gates rerun.

## 7. Boundaries and closure

No main/version/v0.2.1, tag, release, deployment, Native Host/registry, real external download, production installation or external network bytes.

Close #367 only when exact-SHA source review, all automated gates and packaged Windows disconnect/recovery acceptance pass. Parent #310 and U05 root remain OPEN until #367 and the parent acceptance gates are complete.
