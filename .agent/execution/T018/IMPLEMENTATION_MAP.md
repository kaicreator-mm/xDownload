# T018 Implementation Map — exact base `888ce342b1d170ab4a217e0fff418cd8b0a0a712`

This map records seams that exist on the exact integration base (tree `0dcb9b9b4c0013e2e1d8ac3a410439fb9cebb900`). It does not freeze a new Product/L2 packaging stack or authorize platform claims; per Frozen L2 §6.9/ADR-012/U9 the concrete desktop shell, IPC transport, packaging stack and OS/browser release matrix remain replaceable until downstream evidence, and platform qualification belongs to T023 on the T019 candidate.

## Existing repository seams

| Exact current path | Exact-base fact | T018 use / constraint |
| --- | --- | --- |
| `package.json` (root) | private ESM workspace; `engines.node 24.21.0`, `pnpm@12.8.1`; scripts are only `format:check` / `lint` / `typecheck` / `test:unit` / `ci:verify` — **no build/package script exists** | Add build/package scripts and build config here only as directly necessary. `ci:verify` must stay green. |
| `pnpm-workspace.yaml` | admits `packages/*` + `apps/*`; `onlyBuiltDependencies: [esbuild]` (T001-era build-script approval; esbuild is lockfile-present but not a direct product dependency) | A new packaging toolchain whose install scripts need execution requires explicit `onlyBuiltDependencies` admission with recorded package/version/license/provenance. |
| `pnpm-lock.yaml` | authoritative dependency lock | Production builds install from `pnpm install --frozen-lockfile`; never bypass or edit the lock. |
| `tsconfig.json` | strict TS, `noEmit: true`, `moduleResolution: bundler`, `allowImportingTsExtensions` — typechecking only, **no emit configuration exists** | The production build must compile/bundle outside tsc-emit or add narrowly scoped emit config; TS-source exports (below) are the reason packaging cannot just "publish" the workspace. |
| All 16 `packages/*` | every package is `"private": true`, version `0.0.0`, `exports: "./src/index.ts"` (TypeScript source) | Consumed as-is by the bundler. Names: `domain-contracts`, `version-validation`, `core-seam`, `core-scheduler`, `persistence-ledger`, `core-runtime`, `direct-acquisition`, `hls-vod-adapter`, `browser-observation`, `browser-auth-broker`, `browser-collection-workflow`, `discovery-recipe`, `ai-proposal`, `converged-runtime`, plus T001 `toolchain-smoke` / `toolchain-smoke-core`. Do not un-private, re-version or semantically modify consumed packages in T018. |
| `packages/persistence-ledger` | durable ledger uses `node:sqlite` (`DatabaseSync`, Node built-in) | No native npm module to compile, but the shipped/bundled runtime must be Node ≥ its sqlite availability (base pins Node 24.21.0). Runtime prerequisite must be stated or shipped honestly. |
| `packages/core-runtime` | T015 authoritative Core runtime composition (scheduler + seam + persistence + acquisition + HLS) | The "Core reachability" acceptance item means the packaged surfaces reach this runtime through `core-seam` — not that T018 re-composes it. |
| `apps/cli` (`@xdownload/cli`) | T013 CLI; entry is `src/main.ts` run via `node apps/cli/src/main.ts`; **no `bin` field, no shebang, no production entry** | Wire the production CLI entry/artifact for the selected tuple(s). CLI must not depend on Desktop UI lifetime (L2 §6.9). |
| `apps/desktop` (`@xdownload/desktop-ui`) | T014 desktop presentation/interaction adapter over `core-seam`; pure TS adapter — **no concrete desktop shell/runtime (Electron/Tauri/…) exists** | Per U9/ADR-012 the shell is replaceable and NOT selected by this map. Desktop packaging is limited to whatever shell T018 actually installs/wires/builds; if none, that tuple is recorded NOT_PROVEN — no installer claim is invented. |
| `apps/browser-extension` (`@xdownload/browser-extension`) | MV3 `manifest.json` v0.1.0 referencing `background.service-worker.js` at package root, `type: module`; sources are TS (`src/background/service-worker.ts`, `src/content/observer.ts`, `src/core-consumer.ts`); **no bundler exists — the referenced service-worker file is not emitted, so the extension is not loadable as-is** | The production build must emit exactly the manifest-referenced file layout (bundle TS → `background.service-worker.js` etc.). Package version/content rules must keep manifest identity truthful. |
| Native-host registration | **no native-host registration manifest/config exists anywhere in the tree**; Linux Native Messaging registration is proven only inside the Research Demo #8 harness, not as production packaging | T018 creates the platform-specific registration wiring for the selected tuple(s) only. `allowed_origins` remains a separate platform-enforced boundary (Frozen L2 invariant 14); no unrestricted fallback IPC. Unselected platforms stay NOT_PROVEN. |
| `.gitignore` | already excludes `dist/`, `out/`, `*.tsbuildinfo` | Build/package outputs stay untracked; audits/smokes run over emitted output, not committed binaries. |
| `.agent/execution/` (all tasks), `docs/`, `packages/toolchain-smoke*`, `apps/*/test/**`, `packages/*/test/**` | development execution material and tests | Must be **excluded** from every shipped package; the package-content audit proves this. `package_excluded: true` in this pack's manifest. |
| `vitest.config.ts` / `eslint.config.js` | gates discover `packages/*/test` + `apps/*/test`; root lint authority | Packaging additions must not break discovery/gates; audit tooling should fit the existing node test runner where it is test-shaped. |

## Current absence facts that matter

At the bound base there is **no** production build pipeline, no bundler/emit step, no CLI `bin`/production entry, no desktop shell, no extension build output (the MV3 manifest currently references a file nothing generates), no native-host registration manifests, no installer/updater/signing configuration, no package audit tooling and no support/NOT_PROVEN matrix. Nothing about packaging exists yet — T018 creates the minimum production build/package integration for the actually selected tuple(s).

This absence is permission to wire packaging, not to invent platform support: Frozen L2 §6.9 explicitly lists the Windows/macOS/Linux release matrix, Chromium/Firefox/Safari release matrix, desktop shell, installer/updater mechanism and platform registration breadth as not frozen and not proven (A3/A10), and the Task Pack requires an explicit support/NOT_PROVEN matrix instead of broad promises.

## Suggested bounded decomposition — non-authoritative F2 choice

The Builder may organize the packaging wiring as one root build config plus per-app additions. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- one build pipeline definition with pinned toolchain identity (node/pnpm/bundler versions recorded per artifact);
- per-artifact package manifests/content allowlists (CLI, desktop-if-wired, extension, packaged Core closure);
- native-host registration manifest generation per selected platform, data-driven so unselected platforms emit nothing rather than assumptions;
- package-content audit executable (asserting dev-material exclusion + closure) that fails the build on violation;
- support/NOT_PROVEN matrix emitted as durable data with per-tuple status `BUILT_AND_SMOKED` / `NOT_PROVEN` / `BLOCKED(<reason>)`.

Do not implement release-candidate preparation (T019), version-level validation harnesses (T020–T023) or any platform qualification in T018.

## Expected evidence placement seam

Existing runner discovers `packages/*/test/**/*.test.ts` and `apps/*/test/**/*.test.ts`. Package-content-audit tests can live there; build/package smoke, clean install/launch and native-host registration evidence is real-host evidence recorded as structured output (commands + results + package identities), not fabricated as unit tests. Every unexecuted check stays NOT_PROVEN — never a PASS.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T018 branch descends from the manifest base `888ce342b1d170ab4a217e0fff418cd8b0a0a712`;
- frozen Task Pack/ADS identities still match (`742ea7b6008d2b1327dbcea6450872b09cd853a5`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`, freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
