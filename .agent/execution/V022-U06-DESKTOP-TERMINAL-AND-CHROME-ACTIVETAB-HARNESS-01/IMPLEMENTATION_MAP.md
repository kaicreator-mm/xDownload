# Implementation Map — exact base 9e3ccd382311619e60b8d2a7373e8a7d34733334

This is a read-only map; it does not widen the Task Pack.

| Path | Base blob | Current responsibility | Bounded change |
|---|---|---|---|
| `apps/desktop-shell/test/smoke/harness-core.ts` | `1ae600268a4865fd5ea9100b38a2d4e7a531f435` | Real `createCoreSeamServer` loopback server; parses host/port/install/user IDs. | Add test-only fixture selection and inject schema-valid terminal result after accepted submit; default unchanged. |
| `apps/desktop-shell/test/smoke/electron-shell-smoke.mjs` | `8a8687a17d1843c3bf75af871d82b6a48b440e4f` | Builds test shell, starts real harness and Electron, reads smoke verdict. | Run four isolated fixture modes, capture Core + DOM, unique user-data/output, cleanup and zero-side-effect evidence. |
| `apps/browser-extension/test/chrome-toolbar-active-tab.mjs` | NEW | No existing Chrome toolbar-action driver. | Self-contained Node 24 runner for denial-only control and real visible toolbar click grant path with counters and NOT_RUN guard. |

## Read-only supporting facts (not writable)

- `apps/desktop-shell/test/smoke/build-shell.mjs` blob `0121f5aa823c08be689db89ae7d139128fc0f611` already bundles harness-core.ts to ignored `dist/smoke/harness-core.cjs`; no build-shell change is needed.
- `apps/browser-extension/manifest.json` blob `98ed24c50a4a0874ea12fcb62a06d6ddfc00d8af` already declares `activeTab` and `scripting`; no manifest change is needed or allowed.
- `apps/browser-extension/src/popup/popup.js` blob `bd2d1bc391869f3dd2c1d575abb3eeea3607c9f2` scans the active tab via `chrome.scripting.executeScript`; the driver must prove the actual toolbar gesture, not use popup URL as a positive substitute.
- `apps/desktop-shell/src/renderer/renderer-main.ts` is intentionally outside scope; valid single-resource COMPLETE has coverage NOT_APPLICABLE and the current label is a separately recorded product/display boundary.
