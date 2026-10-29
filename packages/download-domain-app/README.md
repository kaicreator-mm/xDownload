# @xdownload/download-domain-app

xDownload v0.2 Domain App: the sealed K/S/B declarations and composition for
download, plus the deterministic semantic lane, the single-authority lineage
ledger and the S2–S6/media journey integrations. The SDK underneath is the
vendored DomainHarness v0.10.3 Git-source candidate (`vendor/sdk/`, bytes
identical to the #183 PoC evidence; resolved through the workspace overrides
in `pnpm-workspace.yaml`, never from a registry). Private workspace package.

## Public surface (T13 facade)

- `@xdownload/download-domain-app` → `src/index.ts`: the aggregated public
  API of the six merged lane faces. Each lane's own index stays the
  authority for its surface; the facade only re-exports, it adds nothing:
  - T01 contracts — `src/contracts/index.ts` (frozen K/B/C intent +
    operation vocabulary, no-widening validation);
  - T03 business — `src/business/composition.ts` (sealed BUILD producer over
    the #183 payload bytes, `confirmDownloadRequest` admission);
  - T11 composition — `src/composition/{runtime,journey}.ts` (one
    authoritative direct K→C runtime, `FileCasDocStore`,
    `submitConfirmedDownload`);
  - T05 semantic — `src/semantic/index.ts` (deterministic no-LLM
    recipe/selection, bounded advisory);
  - T09 migration — `src/migration/index.ts` (single-authority lineage
    ledger + plain-file store);
  - T12 integrations — `src/integrations/index.ts` (S2–S6 + media
    convergence under K).
- The legacy deep specifier `@xdownload/download-domain-app/src/contracts/index.ts`
  stays admitted through the exports map for consumers whose manifests are
  outside the T13 write set (the T04 host bridge and the apps/cli adapter
  import it today).

The host side of the C/Host integration ships from
`@xdownload/download-domain-host` (`./direct`, `./media`,
`./media/permit`); the app journeys reach the real bridges through the
`DIRECT_BRIDGE_PIN` / `MEDIA_BRIDGE_PIN` globalThis seams, which is why the
app facade exports journeys and compositions while the bridge classes live
in the host package.

## T13 normalization ledger (Issue #213)

Every P3 normalization input recorded by the v0.2 lane reviews (#201–#212),
with its T13 disposition. Evidence commands are listed under "Packaging
evidence" below.

| Input (review finding) | T13 disposition |
| --- | --- |
| T03 `V02T03-R1-P3-01`: sealed payload bytes under `src/business/payloads/dist/` committed past the `dist/` convention; "T13 packaging must preserve byte identity" | DISCHARGED. `sha256sum -c SHA256SUMS` passes in the workspace AND inside the extracted packed tarball (EXIT=0 both); the sealed `*.mjs` payloads ship verbatim in the tarball (`files: ["src"]`). |
| T04 `V02T04-R1-P3-01`: host direct bridge deep-imports `../../../direct-acquisition/src/index.ts`; host manifest was outside the lane write set; "T13 normalizes to workspace dependency" | DISCHARGED. The host manifest now declares `@xdownload/direct-acquisition`, `@xdownload/hls-vod-adapter`, `@xdownload/domain-contracts` (all `workspace:*`); `@xdownload/download-domain-app` moved dev→prod dependency (the bridge imports app contracts at runtime). The relative import text itself stays untouched (lane src is outside the T13 write set); the declared dependency provides the canonical specifier for future consumers. |
| T05 `V02T05-R1-P3-01`: confirmation vocabulary declared locally with source citation (`discovery-recipe` not in the Domain App dependency graph) | DECIDED — keep the local declaration; do NOT add `@xdownload/discovery-recipe` in v0.2. The semantic lane is deterministic no-LLM and its only justification for the vocabulary is the cited source; adding the dependency would widen the dependency graph without any consumption face in the frozen DAG. |
| T06 `V02T06-R1-P3-01`: media bridge relative cross-package imports; "T13 normalization list" | DISCHARGED — same normalization as T04 (host manifest now declares both engines as `workspace:*` dependencies). The loopback-fixture opt-in stays production-default-false in the lane source. |
| T07 `V02T07-R1-P3-01`: `apps/cli` structural mirror of the public DomainApp interface; "T13 must validate the mirror against the vendored SDK types at join" | PARTIAL — recorded, not enforced. `apps/**` is a forbidden path for T13, so no mirror-equivalence check was added. Join evidence at compile level: root `tsc --noEmit` (EXIT=0) covers `apps/cli` and the vendored SDK types, so the mirror compiles against the same SDK the facade compiles against; structural (name-by-name) equivalence is NOT enforced by `tsc` and remains NOT_PROVEN — carried input for the CLI lane. |
| T08 `V02T08-R1-P3-01`: `apps/browser-extension` relative cross-package source import; "T13 must normalize to a workspace dependency" | NOT_DONE — write-set boundary. `apps/**` is forbidden for T13, so the browser extension keeps its relative import (it keeps working in-repo). Recorded as carried input for the next lane holding apps manifest authority. |
| T09 `V02T09-R1-P3-01`: SQLite driver unavailable workspace-wide (honest `HOST_STORE_DRIVER_UNAVAILABLE` probe); "driver addition is T13 manifest authority" | DECIDED — v0.2.0 does NOT introduce a native SQLite driver. Rationale: (a) the shipped durable store is `PlainFileLineageStore` with its documented single-process durability boundary; (b) a native driver would add a native-build + install-script toolchain into a freeze whose only admitted install script is esbuild (`pnpm-workspace.yaml` `allowBuilds`), and no frozen lane owns a SQLite-backed store integration; (c) T09 acceptance explicitly tiered the real-SQLite leg NOT_PROVEN. The `HOST_STORE_DRIVER_UNAVAILABLE` probe behavior stays. |
| T10 `V02T10-R1-P3-01`: `tests/domain-app/helpers/contracts.ts` single relative-path seam; "T13 exports-facade normalization list" | PARTIAL — the canonical face now exists (`@xdownload/download-domain-app` facade); the test helper keeps its relative seam (`tests/` is outside the T13 write set). Facade adoption in tests is a follow-up for the test lanes. |
| T11 `V02T11-R1-P3-01`: globalThis pin seam (PoC pattern); file-CAS single-process store; "production SQLite and export wiring are T13 scope" | Export wiring DISCHARGED (facade + both manifests' exports maps). SQLite DECIDED-no (see T09). `FileCasDocStore` keeps its documented single-process boundary, unchanged. The `DIRECT_BRIDGE_PIN` seam stays the production wiring contract: the trusted host pins the real T04 bridge; the journey reads it. |
| T12 `V02T12-R1-P3-01`: media bridge pin + derived media permit; "production wiring normalization and export surface are T13 scope" | Export surface DISCHARGED (media face inside the facade via `src/integrations/index.ts`; host face via the host manifest's `./media` + `./media/permit`). Wiring: `MEDIA_BRIDGE_PIN` stays the seam — the host media bridge instance is pinned through globalThis and the media journey refuses closed when it is absent. |
| T13 finding (pack smoke): `src/composition/runtime.ts`, `src/integrations/{media-registry,s3-media}.ts` import host sources via sibling-relative paths (`../../../download-domain-host/src/...`, runtime values) | RECORDED — P2, structural. The declared manifests now tell the truth (app declares `@xdownload/download-domain-host`, host declares the app: a source-level cycle, warned by pnpm like the two pre-existing workspace cycles). Fixing the import text to package specifiers requires rewriting lane sources — outside the T13 write set. Consequence: the packed app tarball INSTALLS cleanly anywhere, but standalone EXECUTION requires the workspace sibling geometry (see tiering below). |
| T13 finding (pack smoke): packed artifacts are raw `.ts` sources; Node 24 refuses type-stripping under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, also with `--experimental-transform-types`) | RECORDED — same class as every sibling workspace package and the vendored SDK tarballs (TS-source artifacts). Standalone consumers consume them through a TS toolchain (bundler/tsc/tsx), which is exactly the proven path below; raw `node <entry>` standalone execution is NOT_PROVEN by design of the artifact class. |

## Packaging evidence (T13, actual commands and EXIT)

Workspace (repo root `xd-v02-t13-builder`, pnpm 12.8.1 / node 24.21.0,
Windows x64):

- `pnpm install --offline` → EXIT=0 (lockfile regenerated; importer diff only
  for the two packages; new workspace links visible under both packages'
  `node_modules/@xdownload/`; pnpm reports the explicit app↔host workspace
  cycle alongside the two pre-existing ones).
- `pnpm exec tsc --noEmit` → EXIT=0 (facade + full repo).
- `pnpm pack` (app) → EXIT=0, tarball = full `src/` tree (47 files) +
  `package.json`; both exports-declared entries present (`src/index.ts`,
  `src/contracts/index.ts`); no `vendor/`, no `node_modules`.
- `pnpm pack` (host) → EXIT=0; all three exports-declared targets present
  (`src/direct/index.ts`, `src/media/media-acquisition-bridge.ts`,
  `src/media/media-permit.ts`).
- `sha256sum -c packages/download-domain-app/vendor/sdk/SHA256SUMS.txt` →
  EXIT=0 (4/4 OK — the selected v0.10.3 SDK tarballs are byte-identical to
  the #183 receipts: build `c04c5ee2…`, contracts `859c55e1…`, host-node
  `3a0a1139…`, microkernel `cd716f08…`).
- `sha256sum -c src/business/payloads/SHA256SUMS` (workspace and extracted
  tarball copy) → EXIT=0 both (3/3 OK — sealed payload bytes preserved).

Clean install (fresh consumer directory outside the workspace, pinned
`pnpm@12.8.1`, `--offline`):

- `pnpm install` of `file:` app tarball with the SAME sealed SDK overrides
  the workspace uses (plus dir overrides for the workspace-source engine
  packages) → EXIT=0. Exactly one `.pnpm` entry per dependency — no
  duplicate package root; the consumer lockfile records the same integrity
  hashes for the SDK tarballs as the workspace lockfile.
- Raw `node smoke.mjs` (dynamic-import the installed facade) → EXIT=1,
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — structural Node refusal
  for raw TS under `node_modules` (ledger row above), NOT a resolution
  failure: Node resolved the exports map to `src/index.ts` before refusing.
- Bundler-tier smoke (esbuild 0.25.12 — the repo's own TS consumption
  mechanism — bundling the entry from the clean-install tree, which resolves
  both packages strictly through the new exports maps) → BUNDLE EXIT=0, then
  `node smoke.bundle.mjs` → EXIT=0, SMOKE PASS 12/12, including the REAL
  sealed composition: `buildDownloadDomainApp()` over the installed bytes
  re-seals and enforces the #183 manifest identity
  (`app:xdownload-download-domain-t03` / `xdownload-v02-t03-v1`, 4 modules).
  The bundle run stages the sealed `.mjs` bytes beside the bundle because
  `readSealedText` reads them at runtime relative to the module location
  (bundling changes that location; the in-workspace import needs no staging).

In-workspace resolution (the consumption face every lane actually uses;
works because workspace symlinks realpath outside `node_modules`):

- `node --input-type=module -e "import('@xdownload/download-domain-app')"`
  from `packages/download-domain-app` → EXIT=0, and
  `buildDownloadDomainApp()` seals for real (no staging).
- The three host subpaths (`./direct`, `./media`, `./media/permit`) resolve
  from `packages/download-domain-host` and export
  `DirectAcquisitionBridge` / `acquireMediaViaHls` /
  `validateMediaAcquisitionPermit` → EXIT=0.
- esbuild bundling through BOTH exports maps in the real workspace geometry
  → BUNDLE EXIT=0, run 7/7 PASS.

## Honest tiering summary

- PROVEN: manifests + lockfile coherent; both tarballs pack with complete,
  exports-satisfying content; sealed SDK/payload byte identity; clean
  install with no duplicate package root; exports-map consumption via the
  TS toolchain in and out of the workspace; real sealed composition over
  installed bytes.
- NOT_PROVEN (structural, recorded in the ledger): raw-`node` standalone
  execution of the packed raw-TS artifacts; standalone execution of the app
  tarball without the workspace sibling geometry (sibling-relative host
  imports — lane sources, outside the T13 write set); out-of-workspace
  install of the host tarball without override mirrors (`workspace:*`
  specifiers are workspace-protocol by design).
