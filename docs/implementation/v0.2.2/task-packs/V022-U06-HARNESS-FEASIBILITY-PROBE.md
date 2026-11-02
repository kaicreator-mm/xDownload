# Validation Pack — v022-U06-HARNESS-FEASIBILITY-PROBE-01

> **PACK_STATE:** FROZEN_READ_ONLY_VALIDATION_CONTRACT / NO_SOURCE_WRITE
> **Parent:** [#305](https://github.com/kaicreator-mm/xDownload/issues/305)
> **Gap:** [#326](https://github.com/kaicreator-mm/xDownload/issues/326)
> **Current candidate:** `wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334`
> **Owner execution policy:** #305 comment 6586392596; Local Agent may execute bounded LOCAL_BUILDER work, while this feasibility probe uses the existing LOCAL_VALIDATOR profile because it is strictly read-only.

## Goal

Determine whether the two remaining U06 positive journeys can be driven by a deterministic local harness without weakening the evidence standard or changing product authority:

1. Desktop packaged Electron shell: deterministic ACTIVE/COMPLETE/FAILED/CANCELLED Core terminal projections using a test-only fixture, with no real downloads and no production Core/Host changes.
2. Browser extension: genuine extension-action toolbar click in an isolated temporary Chrome profile that grants `activeTab`, alongside a denied/no-grant control path. Do not use `chrome.action.openPopup()`, direct popup URL navigation, or a background tab as a substitute for a user gesture.

## Scope — read-only feasibility only

- Repository: `kaicreator-mm/xDownload`
- Exact requested HEAD / base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- Integration branch: `wip/v0.2.2-ui-rebuild-r0`
- Role/profile: `validator / LOCAL_VALIDATOR`
- Environment: `LOCAL`
- Validation profile: `U06_HARNESS_FEASIBILITY`
- Source write set: **EMPTY**. Do not create/edit/delete files or branches. Do not run CI/Woodpecker.

## Required probe

### A. Desktop terminal fixture

Read:
- `apps/desktop-shell/test/smoke/harness-core.ts`
- `apps/desktop-shell/test/smoke/electron-shell-smoke.mjs`
- `apps/desktop-shell/test/smoke/build-shell.mjs`

Determine the minimal test-only fixture change needed to emit authoritative valid ACTIVE, COMPLETE, FAILED and CANCELLED projections through the existing seam. Verify that fixture can remain under `apps/desktop-shell/test/smoke/**` and is not included in production package payloads. Do not run real downloads.

### B. Browser toolbar-action driver

Inspect the current Browser extension package/test setup and available local automation (Chrome for Testing/Chrome, CDP, WebDriver or OS UI automation). Determine whether an actual user gesture can click the extension action and open its popup in a temporary isolated profile so `activeTab` is genuinely granted.

The probe must:
- preserve a separate no-grant/denial case;
- record the actual toolbar click mechanism and browser/version;
- count Worker messages and permission requests;
- preserve the existing tab-switching zero-side-effect assertion;
- avoid `chrome.action.openPopup()` as a substitute for user gesture;
- avoid new manifest permissions, persistent Chrome profile mutation or user-profile changes.

If infeasible, report the exact blocker and the closest honest alternative; do not claim a positive activeTab journey.

## Required result written to #326

- Exact checked-out SHA/tree and clean before/after worktree.
- Windows build, Node, pnpm, Electron, Chrome/Chrome-for-Testing versions.
- Exact commands/tools and their exit codes.
- Desktop fixture feasibility: YES/NO, minimal proposed test-only paths and expected projection method.
- Browser toolbar gesture feasibility: YES/NO, exact click mechanism and evidence plan.
- Proposed exact write set for a subsequent Builder Task (do not write it now).
- Any required owner action or platform limitation.
- `SOURCE_WRITE=NONE`, `CI=NOT_RUN`, `WOODPECKER=NOT_RUN`.

## Forbidden

- No source/test/config writes, no new files, no branch creation.
- No manifest/permission changes, Native Host, HKCU/registry, real download or production Core/Host effects.
- No GitHub Actions, no CI, no Woodpecker.
- No screenshots or logs from a non-isolated persistent user profile.
- No converting prior Attempt-08 NOT_RUN into PASS.

This probe is a prerequisite to freezing the harness implementation write set. A separate Task Pack and LOCAL_BUILDER Claim are required before any harness source change.
