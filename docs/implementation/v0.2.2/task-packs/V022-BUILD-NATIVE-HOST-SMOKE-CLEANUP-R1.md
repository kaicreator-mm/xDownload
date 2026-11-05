# V022-BUILD-NATIVE-HOST-SMOKE-CLEANUP-01 — bounded manifest ownership and cleanup

## Status and exact baseline

- Repository: `kaicreator-mm/xDownload`
- Parent / finding: Issue #316 (P1)
- Version: `v0.2.2 UI R0`
- Integration target: `wip/v0.2.2-ui-rebuild-r0`
- Exact implementation base: `39e5a9b5fdb61e2f0ee8f7d58e640861ee77baaa`
- Base tree: `6cb4dea0181870ff5045e869f517083721b496fb`
- Planning branch: `planning/v0.2.2-native-host-smoke-cleanup-r1`
- Risk: HIGH (Windows user data and HKCU registration cleanup)
- Review policy: required, fresh Exact-SHA review
- Agent freedom: F1 bounded implementation
- Dispatch profile: WEB_BUILDER bounded source implementation; local Node 24 validation may assist, but no real HKCU/registry mutation or smoke run is authorized.

## Goal

Repair the Windows Native Messaging registration smoke so it never recursively deletes the shared `%USERPROFILE%\\.xdownload\\native-host` directory, never overwrites a pre-existing xDownload manifest, and never deletes a manifest while an HKCU registration may still reference it.

The smoke must preserve the host machine's pre-existing state and report cleanup failure honestly.

## Frozen exclusive source/test write set

1. `build/native-host.ts`
2. `build/smoke.ts`
3. `build/test/install-host.test.ts`

No other path is writable. In particular, do not touch `build/install-host.ts`, installers, manifests, package configuration, CI configuration, Product/L2, or v0.2.1.

## Required implementation

### A. Manifest creation is no-clobber

- Create the user manifest directory only as needed.
- Create the exact xDownload manifest with exclusive-create semantics (`wx`); do not use an existence-check followed by an overwriting write.
- If the exact manifest already exists while the registry key is absent, refuse registration without changing its bytes.
- Preserve an existing registry entry and its manifest as-is.
- Keep the manifest path exact and support Windows profile paths containing spaces when parsing `reg query` output.

### B. Unregistration is identity-bound

- Extend the existing unregister path with an optional expected manifest path.
- When the caller supplies an expected path, delete the HKCU key only if the current registry default value still points to that exact path.
- If the key disappeared, changed, or cannot be resolved to the expected path, fail closed and do not delete another registration.
- Preserve existing callers that intentionally use the current one-argument behavior; do not change installer/uninstall product semantics beyond the bounded exact-path guard.

### C. Smoke cleanup is ownership-bound

- Before the smoke attempts registration, snapshot whether the shared manifest directory and exact xDownload manifest existed.
- If an existing registration or pre-existing xDownload manifest is found, record NOT_EXECUTED and leave both untouched.
- Only attempt unregister after this smoke has successfully created the registration.
- Put registration verification and cleanup in a `try/finally` path.
- In finally, request unregister with the exact manifest path created by this attempt, read the registry back, and delete only that exact manifest file if:
  1. the file was absent before this attempt;
  2. this attempt created it;
  3. unregister returned `unregistered`;
  4. registry read-back confirms no registration remains.
- If any condition is not proven, preserve the manifest and report FAIL/NOT_EXECUTED with the exact registry and file state.
- Never recursively remove `windowsUserManifestDir()`; never remove the shared directory, even if it is empty.
- A failed registry delete must leave the manifest in place.

## Regression requirements

Add deterministic tests in `build/test/install-host.test.ts` that do not execute `reg.exe`, do not touch HKCU, and use only a disposable temporary directory:

1. A pre-existing sibling manifest survives successful cleanup of the exact smoke-owned manifest.
2. A pre-existing xDownload manifest is not overwritten and is not deleted.
3. Failed unregister / a still-present registry reference preserves the manifest.
4. A successful cleanup removes only the exact manifest created by the smoke and leaves the directory and sibling files intact.
5. A registration path containing spaces is parsed without truncation.
6. An unregister expected-path mismatch refuses to delete the current registration (test the pure identity guard if direct registry calls cannot be injected safely).

## Validation gates

All gates must bind the final exact candidate SHA:

1. Node 24.21.0 syntax/preflight on the three changed files.
2. Changed-file Prettier.
3. Focused: `pnpm exec vitest run build/test/install-host.test.ts`.
4. `pnpm run typecheck`.
5. `pnpm run ci:verify`.
6. Local Docker Woodpecker `.woodpecker/xd-ui-r0-verify.yaml`, with an explicit `CI_COMMIT_SHA === final HEAD` assertion, build/pipeline ID, and per-step exit codes.
7. `tools/task-check.sh`: report NOT_AVAILABLE if absent; do not create it or expand the write set.

Do NOT run `pnpm run smoke`, `runNativeHostSmoke`, any HKCU registry command, real install/uninstall, Native Host registration, or cleanup during this task. The regression tests must use injected/pure filesystem helpers only. The current destructive smoke is intentionally blocked until this repair has passed source review and exact-SHA automated validation.

## Exact acceptance

- No `fs.rmSync(windowsUserManifestDir(), { recursive: true })` or equivalent shared-directory deletion remains.
- No registration attempt overwrites a pre-existing manifest.
- A failed or uncertain unregister never deletes a manifest.
- Only a smoke-owned file with absent-before provenance and confirmed registry removal may be unlinked.
- The shared directory and unrelated sibling manifests survive.
- Existing installer registration/unregistration behavior and the one-host/allowed-origins boundary remain intact.
- P0/P1/P2 = 0 at final independent source review.
- No main/version merge, release, deployment, registry operation, or real download.

## Dependencies and delivery order

- Independent of #370/#367 source write sets; it may be implemented in parallel.
- It does not unblock or authorize `pnpm run smoke` until this task's source review and exact-SHA gates pass.
- Do not merge this task into WIP until its final Exact-SHA review and validation are PASS.
