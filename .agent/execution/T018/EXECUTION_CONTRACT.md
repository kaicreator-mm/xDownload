# T018 Execution Contract — packaging and platform integration

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #37, the Frozen Task Pack (`T018_packaging-platform-integration.md@742ea7b6008d2b1327dbcea6450872b09cd853a5`), Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T018` / Issue `#37`
- Integration base: `version/v0.1.0@888ce342b1d170ab4a217e0fff418cd8b0a0a712` (the T017 merge, which is the current integration base after T003–T017 + the #72 T010 hardening merges; base tree `0dcb9b9b4c0013e2e1d8ac3a410439fb9cebb900`)
- JIT branch: `task/v0.1.0-t018-packaging-platform`
- Dependency completion: `T017/#36` closed, merge commit `888ce342b1d170ab4a217e0fff418cd8b0a0a712` (= the integration base itself)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T018_packaging-platform-integration.md@742ea7b6008d2b1327dbcea6450872b09cd853a5`
- Agent freedom: `F2_ENGINEERING_DISCRETION`
- Review: `required`; risk: `high` (frozen; not recalculated — Issue #37 body and Frozen Task Pack both pin `review:required` / `risk:high`)
- L3: `required`
- Executor: Local Builder on real platform Build Host(s) for the actually selected tuple(s)

## Goal of the task (frozen, unchanged)

Create production build/package integration for the actually selected v0.1.0 runtime/shell/browser tuple(s), including Desktop/CLI/Core artifacts, extension/native-host registration, package layout and exclusion of development Execution Pack material.

## Owned write boundary

T018 owns production build/packaging/install wiring, platform-specific native-host registration and package manifest/content rules, exactly as the Frozen Task Pack states. Concretely, on this exact base that means:

1. A production build pipeline that turns the TS-source workspace (every package/app currently exports `./src/index.ts` with `noEmit` typechecking only) into runnable, shippable artifacts for the tuple(s) actually selected: CLI entry/artifact, Desktop artifact for whichever shell is actually wired, and a loadable browser-extension package matching `apps/browser-extension/manifest.json` (which references `background.service-worker.js` that no current build step emits).
2. Package layout and manifest/content rules: per-artifact content definitions, production dependency closure, and hard exclusion of development execution material (`.agent/execution/**`, frozen docs, `packages/toolchain-smoke*`, test fixtures, dev-only tooling).
3. Platform-specific native-host registration wiring (registration manifests/config generation) for the selected tuple(s) only, preserving Native Messaging `allowed_origins` as a separate platform-enforced boundary (Frozen L2 invariant 14).
4. Package-content audit tooling plus a durable support/NOT_PROVEN matrix: what was built/smoked on which real host tuple, and everything else explicitly NOT_PROVEN.
5. Package identities: each artifact carries name/version/source-revision/toolchain/content-hash identity.

### Packaging honesty rule (binding for this task)

Packaging claims must not imply platform qualification. Frozen L2 §6.9/ADR-012/A10 leave the OS/browser release matrix, desktop shell, installer/updater mechanism and cross-platform registration **not frozen and not proven**; platform qualification is owned by downstream Validation (T023) on the exact T019 candidate. A platform blocker is BLOCKED, never an invented PASS. No updater/signing claim unless actually configured AND validated on a real host. Close with real package identities and claimed tuples only.

### Forbidden scope

Do not implement, claim or weaken:

- **T019 candidate-preparation scope**: freezing the release-candidate identity, cutting the T019 candidate, or executing version-level visible Validation (owned by T020–T023 on the exact T019 candidate). T018 produces concern-level packaging evidence only.
- **Frozen-doc mutation**: do not modify `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T018 Task Pack to ease packaging.
- **Consumed-package semantic modification**: all 16 `packages/*` (including `converged-runtime`) and the app sources are consumed as-is. Build/packaging config may reference them; it may not change their semantics, authority or exports' meaning.
- **Unqualified platform promises**: no broad OS/browser support claims from research evidence (Chromium 144/Linux in Research Demo #8 stays a research tuple, not a release claim).
- **Silent security weakening for packaging**: no bypassing Native Messaging `allowed_origins`, no loosening seam authorization/peer bounds, no bundling raw reusable credentials, no disabling validation to make a package build.
- **`.agent/execution` leakage**: no development Execution Pack material in any shipped package.
- **Updater/signing claims**: none unless actually configured and validated on the real Build Host.

## Required outputs

1. Production build pipeline wiring for the selected tuple(s), executable from a clean lockfile install (`pnpm install --frozen-lockfile`) with recorded, pinned toolchain versions.
2. Shippable artifacts for the selected tuple(s): CLI (production entry — today the CLI only runs as `node apps/cli/src/main.ts` with no `bin`), Desktop (only for a shell actually wired and built — if no concrete desktop shell is installed by this task, the desktop output is exactly that and no installer is claimed), extension package matching its MV3 manifest, and the packaged/bundled Core runtime reachable from those surfaces.
3. Native-host registration wiring for the selected platform tuple(s), with `allowed_origins` intact and honest degradation when registration is absent/failed.
4. Package-content audit output proving the exclusion rules and the production dependency closure, per artifact.
5. A durable support/NOT_PROVEN matrix (data, not prose-only) covering every tuple: built/smoked vs NOT_PROVEN vs BLOCKED.
6. Package identities (source revision, toolchain versions, content hashes) recorded for every produced artifact.

## F2 engineering choices left open

The Builder chooses, inside the frozen semantics:

- the concrete bundler/compiler and packaging stack, desktop shell (if any is installed for wiring), CLI distribution form (bundle, single-executable, runtime-prerequisite package), and native-host registration implementation mechanics — all subject to recorded provenance;
- build output layout under git-ignored `dist/`/`out/`;
- audit tooling form (script, test, or both) provided it is executable and durable;
- which tuple(s) are actually selected and built, provided every other tuple lands in the support/NOT_PROVEN matrix rather than in a claim.

These choices must not weaken Frozen Product/L2 semantics, must stay reproducible from the pinned lockfile/toolchain, and must be recorded with exact package/version/license.

## Verification commands available on the exact base

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

These root gates must remain green after packaging wiring. T018 concern Validation is separate from this prep task and must additionally execute the production package/build smoke, clean install/launch, native-host registration and package-content audit on the exact implementation candidate, on real Build Host(s), per `TEST_MATRIX.yaml`. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T018 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust boundaries (e.g., packaging can only be made to work by bypassing `allowed_origins` or seam authorization).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules. A missing/unavailable toolchain or Build Host is `state:blocked` with durable evidence — a platform blocker is BLOCKED, not an invented PASS.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5. Do not rewrite it as part of T018. Current durable execution facts are the materialization terminal, the Issue DAG, T017 closeout (#36 merged as `888ce342b1d170ab4a217e0fff418cd8b0a0a712` = this base) and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
