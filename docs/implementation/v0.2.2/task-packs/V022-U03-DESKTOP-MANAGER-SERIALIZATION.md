# Task Pack — v022-U03-DESKTOP-MANAGER-SERIALIZATION-01

> **TASK_PACK_STATE:** FROZEN_PLANNING_CONTRACT / NOT_EXECUTION_PACK / NOT_SOURCE_CLAIM
> **Parent:** [#305](https://github.com/kaicreator-mm/xDownload/issues/305)
> **Defect:** [#322](https://github.com/kaicreator-mm/xDownload/issues/322)
> **Owner execution policy:** #305 comment 6586392596 — actual Local Agent may act as LOCAL_BUILDER under the pinned ADS v4.18.0 schema.
> **ADS feedback:** [#1354 OBS-17](https://github.com/kaicreator-mm/ai-development-standard/issues/1354)

## Task identity and authority

- **Task ID:** `v022-U03-DESKTOP-MANAGER-SERIALIZATION-01`
- **Repository:** `kaicreator-mm/xDownload`
- **Version:** `v0.2.2 UI R0`
- **Canonical lane:** U03 — Desktop renderer correctness/hardening
- **Integration target:** `wip/v0.2.2-ui-rebuild-r0`
- **Merge target:** `wip/v0.2.2-ui-rebuild-r0` only
- **Baseline:** `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- **Risk:** high (P1 wrong-lineage command hazard)
- **Review policy:** required; independent Exact-SHA review
- **Agent freedom:** `F1_BOUNDED_IMPLEMENTATION`
- **L3 requirement:** not-required; no Product/L2/Core/Host capability change.

## Problem and smallest viable correction

The shared `DesktopUiAdapter` uses ambient `currentAggregateId`. `DesktopManager.list()` and user controls independently await `attachAggregate()`, then read or mutate that ambient adapter state. A slow list poll can therefore interleave with Cancel/Retry and retarget a command to another lineage. The defect is source-confirmed at the frozen baseline; packaged Windows wrong-lineage reproduction is NOT_RUN and must not be claimed.

Prefer a manager-boundary FIFO operation gate as the minimal two-file fix. Do not add a second adapter/Core and do not modify `apps/desktop/src/adapter.ts` or renderer code.

## Exclusive allowed write set

Exactly these two paths:

1. `apps/desktop-shell/src/main/manager.ts`
2. `apps/desktop-shell/test/manager.test.ts`

No other path may change. A demonstrated need to touch any other path is a Task Pack defect and requires a separate Owner-approved amendment before writing.

## Implementation requirements

1. Serialize every `DesktopManager` operation that touches the shared adapter: `previewAdd`, `confirmAdd`, `discardPreview`, `list`, `cancelJob`, `retryJob`, and `revealJob`.
2. Use one bounded FIFO gate. Release the next waiter in `finally`; a rejected/throwing adapter operation must not poison the queue.
3. Make public `list()` single-flight/coalesced while one list is pending, so slow 2-second renderer polls do not accumulate an unbounded stale queue.
4. Refactor a private `listUnlocked()` (or equivalent) for use by already-serialized operations. `actionDocument()` and `discardPreview()` must not re-enter the public queue or deadlock.
5. Keep `chooseDestination()` outside the gate because it does not touch the adapter. Keep synchronous read-only introspection methods unchanged unless tests demonstrate a race.
6. Preserve the existing one-adapter/one-Core model, adapter request identity, typed refusals, Core diagnostics, retry eligibility, fresh-projection reveal gate, destination behavior and session-only job registry.
7. If the manager-only gate cannot protect all shared-adapter operations, stop and report the exact out-of-scope call site; do not silently edit the adapter or renderer.

## Required regression matrix

- Deferred two-lineage list poll A→B with Cancel A requested while B is pending: calls do not interleave and the emitted control remains bound to A.
- Repeat the same forced interleaving for Retry A.
- Two concurrent public list requests coalesce to one in-flight list operation.
- Each returned row uses the projection for its own lineage; no cross-bound row.
- A throwing/rejected adapter operation releases the gate and a later operation completes.
- Existing add/confirm/discard/cancel/retry/reveal/disconnect tests remain green.

Use a deterministic fake adapter with deferred projection responses and explicit recorded target lineage. Tests must prove the ordering and target, not merely assert that a mutex helper exists.

## Required validation and evidence

1. Re-read exact base, Task Pack, Execution Pack and current Claim before source mutation.
2. Node 24 syntax/type preflight and changed-file Prettier before CI.
3. Run focused `apps/desktop-shell/test/manager.test.ts`.
4. Run typecheck and one aggregate `pnpm run ci:verify`; do not repeat the full suite unnecessarily.
5. Run the local Docker Woodpecker pipeline on the exact PR HEAD after syntax preflight; record actual Build ID, URL, exit codes and logs.
6. Independent Exact-SHA Review is required; report P0/P1/P2 and PASS/BLOCK.
7. Packaged Windows runtime wrong-lineage reproduction remains NOT_RUN unless actually executed; deterministic regression tests do not become a runtime reproduction.

## Forbidden scope

- No files outside the two-path write set.
- No changes to `apps/desktop/src/adapter.ts`, renderer, preload, IPC contract, Core, Host, manifest, packaging or CI configuration.
- No second adapter/Core, new persistence, durable history, product capability expansion or fabricated status/progress.
- No changes to `main` or `version/v0.2.1`; no release, deployment or production promotion.
- No real downloads, Native Host registration, HKCU/registry changes or permission changes.

## Dispatch and ownership

- One Builder only. The Owner permits an actual Local Agent to use `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` under pinned ADS v4.18.0; the worker must publish its own accepted `DISPATCH_CLAIMED`.
- Web/Local interaction is GitHub-only. No chat-only claim/result and no Inbox.
- Builder source work is not independent Review. Required exact-SHA review must use a distinct logical operator context.

## Closeout

Keep #322 open until the PR contains exactly the two allowed paths, exact-HEAD syntax/format/tests/CI/Woodpecker pass, independent Exact-SHA Review passes, and the runtime reproduction status is explicitly PASS or NOT_RUN. Merge only into the WIP integration branch after all required gates; do not merge to version/main.
