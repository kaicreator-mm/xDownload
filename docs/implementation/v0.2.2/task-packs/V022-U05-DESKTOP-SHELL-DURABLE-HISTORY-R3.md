# Task Pack R3 — V022-U05-T03 Desktop durable S1 history and Core-backed add flow

> TASK_PACK_STATE: REPAIR_REBASE / MINIMAL_SCOPE_RECONCILIATION / INDEPENDENT_REVIEW_REQUIRED
> Task: #353
> Parent: #310
> Previous Task Pack R2: `18e93eafd9c10cdaded8bf3521dd987857428943`
> Previous candidate: `d9ddd61c5a55ad9c0c42c4b42b41125e00631fcc` / tree `cf537e93df1e2aeab788988c6dcd6746a705e1ba`
> Repair base: `d9ddd61c5a55ad9c0c42c4b42b41125e00631fcc` / tree `cf537e93df1e2aeab788988c6dcd6746a705e1ba`
> Integration target: `wip/v0.2.2-ui-rebuild-r0` (WIP only)
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`; apply ADS #1359 Delivery-First

## Why R3 exists

R2 delivered the intended Desktop S1 workflow and passed its reported Node24, Prettier, typecheck, focused tests, aggregate `ci:verify` and exact-SHA Woodpecker Build #40. Independent Exact-SHA review of PR #365 found two source defects and one disclosed write-set deviation:

1. Adapter `lastRouted()` is cumulative over the adapter's full `sentEnvelopes` history. T03 currently interprets `confirmOutcome.routed.length > 0` as proof that the *current* preview was submitted. After a prior successful add, a rejected second contract can therefore be mistaken for a successful current submission; the manager may invoke S1 against the previously confirmed aggregate and attribute that route to the new pending lineage.
2. When no Core adapter exists, `DesktopManager.listUnlocked()` returns `ok: true`, zero rows and `totalCount: 0` despite performing no index read. The renderer shows the empty-state whenever the row count is zero, even when the connection is unconfigured or no successful index read has occurred.
3. R2's exact 14-path write set did not include `apps/desktop-shell/test/ux-r0-form-schema.test.ts`. The Builder disclosed this single test-only fixture migration because the root TypeScript gate includes the test file and the R2 contract removal otherwise leaves stale fixtures that do not compile. This R3 pack explicitly reconciles that one test-only path; it does not authorize any other path or runtime behavior expansion.

This is a bounded repair and scope reconciliation only. Product/L1, L2, Core, Host, CLI, package manifests, lockfile, S1 authority and download behavior remain unchanged.

## Exact identity and claim

- Task: `V022-U05-DESKTOP-SHELL-DURABLE-HISTORY-01`
- Task issue: #353
- R2 candidate/base for this repair: `d9ddd61c5a55ad9c0c42c4b42b41125e00631fcc` / `cf537e93df1e2aeab788988c6dcd6746a705e1ba`
- Source branch: `task/v0.2.2-u05-desktop-shell-durable-history-r2`
- Execution branch: `execution/v0.2.2-u05-desktop-shell-durable-history-r3`
- Required Claim: generation 2, bound to this Task Pack R3 blob, this Execution Pack R3 manifest and the exact repair base above.
- No source mutation before accepted generation-2 `DISPATCH_CLAIMED` is read back on Issue #353.
- Previous generation-1 delivery and its evidence remain historical; this pack does not rewrite or retroactively authorize that execution.

## Exact cumulative task write set — 15 paths

The R2 task's cumulative source scope is explicitly reconciled to these fifteen paths. No other path is permitted.

1. `apps/desktop-shell/src/main/manager.ts`
2. `apps/desktop-shell/src/main/shell-contract.ts`
3. `apps/desktop-shell/src/main/ipc.ts`
4. `apps/desktop-shell/src/main/validators.ts`
5. `apps/desktop-shell/src/main/main.ts`
6. `apps/desktop-shell/src/preload/preload.ts`
7. `apps/desktop-shell/src/renderer/manager-state.ts`
8. `apps/desktop-shell/src/renderer/renderer-main.ts`
9. `apps/desktop-shell/src/renderer/index.html`
10. `apps/desktop-shell/src/renderer/styles.css`
11. `apps/desktop-shell/test/manager.test.ts`
12. `apps/desktop-shell/test/manager-view.test.ts`
13. `apps/desktop-shell/test/security-invariants.test.ts`
14. `apps/desktop-shell/test/validators.test.ts`
15. `apps/desktop-shell/test/ux-r0-form-schema.test.ts` — one-time test-only fixture migration already disclosed in the R2 delivery; no product/runtime behavior.

The R3 repair batch is expected to touch only the subset needed for the fixes and regressions. This is not permission to rewrite all fifteen paths again.

## Required repairs

### R3-01 — bind routed commands to the current pending aggregate

- Treat `InteractionOutcome.routed` as cumulative adapter history, not a per-call delta.
- Snapshot the routed-history length immediately before `confirmScope()`; inspect only newly appended commands.
- Confirmation is successful only when the new command set contains `SUBMIT_CONTRACT` with `aggregateId === pending.lineageId`.
- Snapshot again immediately before `executeS1Direct()`; the current add is routed only when the new command set contains `EXECUTE_S1_DIRECT_ACQUISITION` with the same pending lineage ID.
- A rejected/refused second confirmation after a previous successful add MUST NOT execute S1 against the previous aggregate, claim the new lineage was routed, or clear the current pending preview.
- Preserve Core idempotency and the exact identity binding; do not infer success from a non-empty cumulative route array.

### R3-02 — no successful empty index without a Core read

- When the adapter/Core is absent, return a typed `ShellRefusal`; do not return a successful empty list or fabricate `totalCount=0`.
- A renderer empty-state is valid only after a successful `CONNECTED` Core index response with zero rows.
- On first-load unconfigured/refused state, show the connection/error state, not “no tasks”.
- If a later refresh is refused after a previous successful read, retain the last truthful rows/counters and surface the refusal; do not clear the previous list.
- Keep the Core's exact `totalCount`/`truncated` semantics unchanged.

## Required regression tests

- Complete one successful add, then submit a second preview whose `SUBMIT_CONTRACT` is rejected/refused. Assert no S1 command for the prior aggregate is newly routed, no old command is attributed to the new lineage, the new preview remains available, and the typed rejection is surfaced.
- No adapter/unconfigured Core on first list: typed refusal, no `ok:true` empty index and no invented total.
- Successful connected Core index with zero rows: the true empty-state remains visible.
- Initial unconfigured/refused list: the empty-state is hidden and the connection/error state is visible.
- A later index refusal after a successful list preserves the previous truthful rows and reports the refusal.
- Preserve all R2 combined-candidate Core admission, cross-install isolation, no-journal/disconnect, 0/199/200/201, cancel/retry, IPC security and no-destination/no-reveal regressions.
- The R2 fixture migration in `ux-r0-form-schema.test.ts` remains a test-only contract update; no unrelated UX redesign.

## Validation and evidence

The Local Builder owns implementation, repair and local validation in one continuous delivery. Do not dispatch a standalone LOCAL_VALIDATION task.

1. Re-read this Task Pack R3 blob, R3 Execution Pack manifest, current task branch HEAD/tree and the generation-2 Claim; no source edit before accepted Claim.
2. Node v24 syntax checks on every changed JS/TS file.
3. Changed-file Prettier before tests or CI.
4. Focused Desktop Shell suites, including the new second-add and unconfigured-empty-state regressions.
5. Workspace typecheck.
6. Aggregate `pnpm run ci:verify`.
7. Local Docker Woodpecker exact-SHA SUCCESS; record actual Build ID and step exit codes.
8. Independent Exact-SHA source review after the final candidate.

Every result must bind to the final candidate SHA/tree. If a source edit changes the SHA, rerun all candidate-bound gates. Do not rerun unrelated source gates for a pure environment retry.

## Forbidden

- No changes outside the fifteen paths above.
- No Core Seam/Core Runtime/CLI/Host/package manifests/lockfile changes.
- No new K, SDK upgrade, new S1 semantics or authority expansion.
- No destination picker, `outputRoot`, reveal action, guessed path, synthetic progress/ETA, S2–S6, real external download, Native Host or registry side effect.
- No main/version branch, tag, release or deployment.
- No WIP merge until independent Exact-SHA source review PASS and a separate integration decision naming the exact candidate HEAD/tree.

## Closure

R3 closes only when the current aggregate-route identity and unconfigured-index truth defects are repaired, the disclosed test-only path is reconciled in this successor pack, all exact-SHA gates pass, and independent source review passes. A successful R3 source review does not itself authorize WIP integration.
