# Task Pack — v022-U03-SINGLE-RESOURCE-COMPLETE-STATUS-01

> **TASK_PACK_STATE:** FROZEN_BOUNDED_IMPLEMENTATION / NOT_SOURCE_CLAIM
> **Parent:** [#305](https://github.com/kaicreator-mm/xDownload/issues/305)
> **Observed by:** [#326](https://github.com/kaicreator-mm/xDownload/issues/326), comment [#6594634490](https://github.com/kaicreator-mm/xDownload/issues/326#issuecomment-6594634490)
> **Current WIP base:** `wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334`

## Task identity

- **Task ID:** `v022-U03-SINGLE-RESOURCE-COMPLETE-STATUS-01`
- **Repository:** `kaicreator-mm/xDownload`
- **Version:** `v0.2.2 UI R0`
- **Canonical lane:** U03 — Desktop renderer correctness
- **Integration / merge target:** `wip/v0.2.2-ui-rebuild-r0` only
- **Exact expected base:** `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- **Base tree:** `ba48b805697ad19c36a6eb3a5e54b6d601b36120`
- **Risk:** high / P1 user-visible status misclassification
- **Review Policy:** required
- **Agent freedom:** `F1_BOUNDED_IMPLEMENTATION`
- **Pinned ADS:** v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Defect and source evidence

The current renderer's `verifiedComplete(row)` requires `terminal.coverage === 'VERIFIED_COMPLETE'`. However the canonical domain contract explicitly requires direct single-resource results to use `coverage === 'NOT_APPLICABLE'` (PRD §18.1; `packages/domain-contracts/src/result.ts` lines 445–448 at the frozen base).

The real Electron/Core Seam probe in #326 constructed a valid single-resource terminal projection:

- `requestFulfillment=COMPLETE`
- `targetResolution=RESOLVED`
- `selectionAcquisition=COMPLETE`
- `coverage=NOT_APPLICABLE`
- `stopReason=NONE`
- `validationSummary=ALL_PASSED`

The renderer classified this valid successful result as “已结束 · 未完成” and counted it as failed. Because `isFailed`, complete counters, filters, status tag and progress label all derive from `verifiedComplete`, this misclassifies the main Desktop single-resource completion journey.

This is a presentation mapping defect. The domain contract and Core authority are correct and must not be changed.

## Smallest viable correction

Treat `coverage=NOT_APPLICABLE` as a valid coverage state for a completed direct single-resource result when the remaining authoritative terminal dimensions prove success. Preserve `VERIFIED_COMPLETE` behavior for whole-scope collection coverage.

The renderer must not infer completion from missing status, byte count, progress, count equality or UI-local state. Completion still requires:
- row present and Core lineage status TERMINAL;
- targetResolution RESOLVED;
- selectionAcquisition COMPLETE;
- requestFulfillment COMPLETE;
- validationSummary ALL_PASSED;
- coverage either VERIFIED_COMPLETE or NOT_APPLICABLE.

For a completed row with NOT_APPLICABLE coverage, display “已完成” (not “已验证完成”); detail text may retain the honest NOT_APPLICABLE coverage value.

## Exclusive allowed write set

Exactly these two paths:

1. `apps/desktop-shell/src/renderer/renderer-main.ts`
2. `apps/desktop-shell/test/ux-r0-form-schema.test.ts`

No other path is allowed. If an additional type, IPC, main-process or Core change appears necessary, stop and report a Task Pack defect.

## Required regression coverage

1. A valid single-resource COMPLETE projection with NOT_APPLICABLE coverage is classified complete, not failed; status label is “已完成”; complete counter/filter includes it.
2. A valid collection COMPLETE projection with VERIFIED_COMPLETE coverage remains complete.
3. PARTIAL, UNSATISFIED, FAILED validation, CANCELLED, absent/stale projection and terminal detail missing remain non-complete and preserve truthful failure/unknown labels.
4. No completion is inferred from missing terminal, unknown progress, byte counts, selected-member count alone or any renderer-local state.
5. Tests must exercise the predicate/label behavior, not merely assert source contains a string. Keep test setup local and do not add a new production export solely for testing.

## Validation

1. Re-read exact WIP base, Task Pack, Execution Pack and accepted Builder Claim.
2. Node 24 syntax/type preflight and changed-file Prettier before CI.
3. Focused `apps/desktop-shell/test/ux-r0-form-schema.test.ts`.
4. Typecheck and one aggregate `pnpm run ci:verify`.
5. Local Docker Woodpecker exact candidate SHA; record Build ID, pipeline, backend and exit codes.
6. Independent Exact-SHA review required.
7. Re-run the Desktop COMPLETE fixture from #326 or the new #332 smoke once available; preserve the raw six-dimensional Core projection and confirm renderer now labels it complete. Do not claim this runtime check if not executed.

## Forbidden scope

- Any file outside the two-path write set.
- Domain contract, Core, adapter, Host, DesktopManager, IPC, preload, main process, package or release changes.
- No fake progress, fabricated bytes, fabricated coverage or protocol-invalid terminal dimensions.
- No changes to #330/#331 branches, main, version/v0.2.1, release or deployment.
- No real download, Native Host, HKCU/registry or permission side effects.

## Dispatch

- One Builder only.
- An actual Local Agent may use `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` under Owner policy #305 comment #6586392596 and pinned ADS v4.18.0.
- Worker must re-read current GitHub facts and publish its own accepted `DISPATCH_CLAIMED` before source mutation.
- This Task has a disjoint write set from #322, #329 and #332 and may execute in parallel while the exact WIP base remains unchanged. If the WIP base moves, stop and request exact-base rebind.

## Closeout

Keep the Task open until the exact two-path write set, regression tests, syntax/format/typecheck, aggregate CI, Woodpecker and independent Exact-SHA review pass. Merge only to WIP after explicit Owner integration authorization. No version/main merge, release or deployment.
