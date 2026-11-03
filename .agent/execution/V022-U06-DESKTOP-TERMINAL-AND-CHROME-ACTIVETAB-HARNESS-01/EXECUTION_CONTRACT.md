# Execution Contract — v022-U06-DESKTOP-TERMINAL-AND-CHROME-ACTIVETAB-HARNESS-01

## Identity and baseline

- Task: xDownload #332; parent evidence gap #326.
- Task Pack blob: `8c6ece8e0cf8f6389a97dc47bda5c5811a9bce9d`.
- WIP integration target: `wip/v0.2.2-ui-rebuild-r0`.
- Exact expected base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`.
- Base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`.
- Task branch: `task/v0.2.2-u06-terminal-activetab-harness`.
- Exact write set: harness-core.ts, electron-shell-smoke.mjs, new chrome-toolbar-active-tab.mjs only.
- Pinned ADS: v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`.

## Execution authority

Owner policy #305 comment 6586392596 authorizes an actual Local Agent as `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` for bounded implementation. The pinned v4.18.0 dispatch schema supports this route.

This Execution Pack is current preparation, not a Builder Claim. The actual Local Agent must re-read GitHub and publish its own accepted schema-conforming `DISPATCH_CLAIMED` before source mutation. Never represent a Web executor as Local.

## Desktop harness contract

- Preserve existing default behavior: ACTIVE, no terminal injection.
- Add explicit fixture selection: ACTIVE / COMPLETE / FAILED / CANCELLED.
- COMPLETE and FAILED must be injected only after actual Desktop submit admission, through the same real Core Seam, with schema-valid dimensions and ACCEPTED response.
- CANCELLED must result from the actual renderer Cancel action.
- Use isolated per-run Electron user-data directories, unique evidence and deterministic cleanup.
- Capture raw Core six-dimension terminal projection and actual renderer DOM/status/filter counts separately.
- For single-resource COMPLETE, preserve coverage=NOT_APPLICABLE and report the renderer's current “ended · not completed” presentation; no renderer change or fake VERIFIED_COMPLETE.
- Prove zero real downloads and zero Native Host calls.

## Browser harness contract

- New self-contained Node 24 driver; explicit denial-only control and positive grant modes.
- Fresh temporary Chrome profile and loopback synthetic page in both modes.
- Control mode may open direct popup URL only to establish the no-activeTab denial control.
- Grant mode must click the actual extension action in the visible Chrome toolbar through Windows UI Automation/native mouse input. Check unlocked interactive desktop first.
- Locked/inaccessible desktop or failed genuine toolbar click => dedicated NOT_RUN exit status and exact evidence. Never fallback to direct URL, CDP popup API or chrome.action.openPopup.
- Instrument Worker message kinds/counts and chrome.permissions.request count before popup scripts execute.
- Tab/mode switching must add zero Worker messages and zero permission requests.
- Positive claim is only toolbar popup + activeTab + initial synthetic page scan. No S2/S5/S6 Host/Core, Native Host or download claim.

## Validation and review

1. Re-read exact base, Task Pack, Execution Pack and Claim.
2. Node24 syntax checks and changed-file Prettier before CI.
3. Execute all four Desktop fixture modes on Windows; exact raw projection + DOM evidence.
4. Execute Browser denial control. Execute grant only when interactive desktop is unlocked; else preserve NOT_RUN.
5. Typecheck, focused smoke tests, one aggregate `pnpm run ci:verify`.
6. Local Docker Woodpecker exact candidate SHA; record build ID, pipeline, backend and exit codes.
7. Independent Exact-SHA review required.

No production source, manifest, permissions, Host/Core, IPC, renderer, packaging, lockfile, CI config, main/version branch, release/deployment or real-download side effect is allowed.
