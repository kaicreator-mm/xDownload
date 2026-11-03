# Task Pack — v022-U06-DESKTOP-TERMINAL-AND-CHROME-ACTIVETAB-HARNESS-01

> **TASK_PACK_STATE:** FROZEN_BOUNDED_IMPLEMENTATION / NOT_SOURCE_CLAIM
> **Parent:** [#305](https://github.com/kaicreator-mm/xDownload/issues/305)
> **Feasibility evidence:** [#326](https://github.com/kaicreator-mm/xDownload/issues/326), comment [#6594634490](https://github.com/kaicreator-mm/xDownload/issues/326#issuecomment-6594634490)
> **Current WIP base:** `wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334`
> **Owner execution policy:** #305 comment #6586392596 — actual Local Agent may be LOCAL_BUILDER for bounded implementation under ADS v4.18.0.

## Task identity

- **Task ID:** `v022-U06-DESKTOP-TERMINAL-AND-CHROME-ACTIVETAB-HARNESS-01`
- **Repository:** `kaicreator-mm/xDownload`
- **Version:** `v0.2.2 UI R0`
- **Canonical lane:** U06 — integration and installed-surface validation harness
- **Integration / merge target:** `wip/v0.2.2-ui-rebuild-r0` only
- **Exact expected base:** `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- **Base tree:** `ba48b805697ad19c36a6eb3a5e54b6d601b36120`
- **Risk:** medium; **Review Policy:** required
- **Agent freedom:** `F1_BOUNDED_IMPLEMENTATION`
- **L3:** not-required; test-only harness work, no Product/L2/production authority change.
- **Pinned ADS:** v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Evidence-derived problem and smallest correction

Issue #326 established:

1. The existing real Electron + Core Seam test harness can construct and read back valid ACTIVE, COMPLETE, FAILED and CANCELLED projections without real downloads or production Core/Host changes.
2. The Browser denial control is executable, but the positive `activeTab` path requires a real extension-action toolbar click. The previous positive attempt was NOT_RUN because Windows was locked. A background-tab popup URL is permitted only for the explicitly labelled denial control; it is never positive evidence.
3. A valid single-resource COMPLETE projection has `coverage=NOT_APPLICABLE` and the current renderer displays “ended · not completed”. The harness must record this honest behavior; it must not fabricate `VERIFIED_COMPLETE` or assert a completed label.

This Task persists the already-proven Desktop fixture capability and adds a reusable isolated Chrome toolbar-action driver. It does not claim the locked-desktop positive path has already passed.

## Exclusive allowed write set

Exactly these three paths:

1. `apps/desktop-shell/test/smoke/harness-core.ts`
2. `apps/desktop-shell/test/smoke/electron-shell-smoke.mjs`
3. `apps/browser-extension/test/chrome-toolbar-active-tab.mjs` (new)

No fourth path is allowed. In particular, do not modify `build-shell.mjs` (the existing build already bundles `harness-core.ts` to ignored `dist/smoke`), `manifest.json`, Browser worker/popup code, production Core/Host, renderer or CI configuration.

## Implementation requirements

### A. Desktop deterministic Core fixtures

1. Add an explicit test-only `--fixture=ACTIVE|COMPLETE|FAILED|CANCELLED` option to `harness-core.ts`; omitted option preserves the existing ACTIVE/no-terminal behavior.
2. Use the existing real `createCoreSeamServer` and loopback transport. Do not add a mock Core, second adapter, byte channel or production code path.
3. ACTIVE: do not inject a terminal result.
4. COMPLETE / FAILED: after the real Desktop preview/confirm flow is admitted, inject a schema-valid `PROJECT_TERMINAL_RESULT` for the exact submitted lineage through the same seam and require the Core response to be ACCEPTED.
5. CANCELLED: exercise the actual Desktop Cancel control path; do not fabricate a CANCELLED terminal result.
6. Extend `electron-shell-smoke.mjs` to run each fixture with a fresh isolated Electron user-data directory, unique output evidence, deterministic cleanup and bounded timeouts.
7. For every run, read back both (a) raw Core projection fields and all six terminal dimensions when present and (b) the actual renderer DOM/status/filter counts. Keep raw protocol truth and UI presentation as separate evidence.
8. For single-resource COMPLETE, assert the valid Core dimensions and record the current “ended · not completed” renderer label as a known limitation. Do not change renderer code or use an invalid coverage dimension to force a visual PASS.
9. Prove zero real downloads and zero Native Host calls. Use only a loopback/test-only fixture; no external byte request.

### B. Browser genuine toolbar-action activeTab driver

1. Add a self-contained Node 24 `.mjs` driver with explicit `--mode=control|grant`, Chrome executable, unpacked extension directory and evidence output arguments.
2. Each mode uses a fresh temporary Chrome profile and local loopback HTTP fixture page containing harmless synthetic attachment links. Never use a persistent user Chrome profile.
3. `control` is a denial-only control: it may open the popup URL directly in a background tab, must label the result as `DENIAL_CONTROL_ONLY`, and must show that no `activeTab` grant was obtained.
4. `grant` must open the popup by a genuine user click on the extension action in the visible Chrome toolbar, using the available Windows UI Automation/native mouse path. Pin the unpacked extension through the visible UI if necessary. Record the actual toolbar click evidence and browser version.
5. Before attempting a positive click, check that the interactive Windows desktop is unlocked and input-capable. If locked, inaccessible or the extension action cannot be clicked, return a dedicated NOT_RUN exit status and record the exact blocker. Do not fall back to direct popup navigation, CDP popup APIs or `chrome.action.openPopup()`.
6. In both modes, instrument the service worker before popup scripts execute; record Worker message kinds/counts and `chrome.permissions.request` counts. Preserve the zero-side-effect assertion for mere mode/tab switching.
7. Positive acceptance is limited to genuine toolbar-action popup opening, temporary `activeTab` authority, successful initial page scan and truthful rendered synthetic rows. Do not claim full S2/S5/S6 Host/Core execution, Native Host registration or real downloads.
8. Grant mode must prove that no persistent host permission or manifest change was introduced. No permission request is required to manufacture an `activeTab` grant; the user gesture is the authority source.

## Required validation

1. Re-read exact WIP HEAD, Task Pack, Execution Pack and accepted Builder Claim before source mutation.
2. Node 24 syntax checks for both changed `.mjs/.ts` files and changed-file Prettier before CI.
3. Typecheck and focused Desktop smoke fixture tests/commands.
4. Run Desktop four-fixture smoke on an unlocked Windows desktop; record exact per-fixture exit code, Core projection, DOM state, screenshot/log and cleanup.
5. Run Browser denial control in isolated profile.
6. Run Browser grant mode only on an unlocked interactive Windows desktop. If unavailable, preserve `NOT_RUN` with a dedicated exit status; never count it as PASS.
7. Run one aggregate `pnpm run ci:verify` after syntax preflight.
8. Run local Docker Woodpecker on the exact candidate SHA and record Build ID, pipeline, backend, logs and exit codes.
9. Independent Exact-SHA review required. Review must inspect exact changed paths and verify no permission/production-surface changes.
10. Installed Browser activeTab positive evidence is PASS only if the real toolbar click and page scan actually ran. Host/Core S2/S5/S6 journeys remain separately NOT_RUN unless separately authorized and executed.

## Forbidden scope

- Any file outside the exact three-path write set.
- `apps/desktop-shell/src/renderer/**`, `apps/desktop-shell/src/main/**`, production Core, adapter or Host.
- Browser `manifest.json`, service worker, popup source, permissions or message contracts.
- `build-shell.mjs`, package scripts, lockfile and CI/Woodpecker configuration.
- `main`, `version/v0.2.1`, release, deployment or production promotion.
- Native Host registration, HKCU/registry, real downloads, external byte requests or persistent Chrome profile mutation.
- Claiming positive toolbar authorization from direct popup URL, `chrome.action.openPopup()`, CDP-only launch, UIA enumeration or a locked desktop.
- Claiming “completed” UI label for single-resource COMPLETE by using invalid Core projection dimensions.

## Dispatch and ownership

- One Builder only.
- Owner permits an actual Local Agent to act as `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` under pinned ADS v4.18.0. This is truthful only for an actual local source executor.
- Builder must publish its own accepted schema-conforming `DISPATCH_CLAIMED` before source mutation.
- #322 and #329 have disjoint source write sets and may execute in parallel with this Task; if the WIP base moves before claim or implementation, stop and request exact-base rebind rather than writing on a stale base.
- Web/Local handoff is GitHub-only: Issue, PR, exact SHA/tree and durable event. No Inbox or chat-only completion receipt.

## Closeout

Keep the Task open until the exact three-path write set, syntax/format/typecheck, Desktop fixtures, Browser denial control, eligible Browser grant run (PASS or honestly NOT_RUN), aggregate CI, Woodpecker and independent Exact-SHA review are recorded. Merge only into the WIP integration branch after all required gates and explicit Owner integration authorization. No version/main merge, release or deployment.
