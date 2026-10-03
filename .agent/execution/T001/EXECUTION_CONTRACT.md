# T001 Execution Contract — repository/toolchain bootstrap + CI activation

## Authority and binding

This Execution Contract is JIT execution guidance for Issue #20 / Task `T001` on exact integration base `version/v0.1.0@40bc80abc16012a42cb396a1aa3b6a6752daf061` (tree `2766b482c23c7c78a4b2b4e451277e91ded11097`). It is subordinate to Frozen Product, Frozen Architecture, the Frozen Task DAG, the Frozen T001 Task Pack, and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

It does not authorize Product/L2 changes, feature implementation, Validation PASS, Review PASS, merge, or any release claim.

## Exact-base facts discovered during JIT prep

1. The exact base is still a planning/docs checkpoint; no production workspace/package topology exists yet.
2. No root package manifest, package-manager lockfile, production runtime selection, workspace definition, or active CI workflow is present on the exact base.
3. `.dev-standard/PROJECT_OVERRIDES.md` explicitly assigns establishment of the production monorepo/toolchain and CI profile to T001 after materialization/JIT admission.
4. Frozen L2 intentionally keeps framework, concrete runtime/IPC, packaging stack, and broader platform matrix replaceable until downstream evidence requires a choice. T001 therefore may make bounded engineering/toolchain choices but must not turn them into Product or Architecture authority.
5. T001 has no dependency completion identities; native `blocked_by` is empty.

## Owned write set

T001 may modify only repository/workspace/toolchain/build/CI/bootstrap configuration and directly necessary smoke tests/documentation, including a minimal monorepo skeleton needed to prove tooling works.

Typical allowed seams include:

- root workspace/package metadata and package-manager lockfile;
- package/workspace topology needed for a bootstrap smoke package;
- runtime/toolchain version declarations;
- formatter/linter/typecheck/unit-test configuration;
- minimal smoke tests that prove the workspace/toolchain, not product behavior;
- `.github/workflows/` minimal CI;
- bootstrap/tooling documentation and exact command documentation;
- package/build exclusion needed to keep `.agent/execution/` out of shipped artifacts.

## Forbidden scope

Do not:

- modify Frozen Product, Frozen L2, Frozen Task DAG, Task Pack index, or T001 Task Pack semantics;
- implement downloader, browser, persistence, scheduler, AI, CLI product behavior, desktop product behavior, media handling, or other later Task concerns;
- claim Windows/macOS/Linux/browser/runtime support beyond what was actually exercised;
- create a general crawler/runtime architecture decision;
- change public Product contracts or validation ownership;
- weaken `review:required` or `risk:high`;
- treat CI availability as equivalent to successful CI execution.

## Execution-level toolchain guidance

The recommended reference baseline for this exact-base bootstrap is a Node.js/TypeScript monorepo with pnpm. This is an Execution Pack HOW choice, not Product/L2 authority.

- Runtime line: Node.js 24 LTS. The Builder MUST pin one exact Node 24 patch in repository-visible version metadata and CI.
- Package manager: pnpm 12.x. The Builder SHOULD use the researched `v12.8.1` baseline unless a concrete incompatibility is found; the selected exact version MUST be pinned through repository package-manager metadata and lockfile.
- Language/typecheck: TypeScript. The Builder chooses the exact compatible compiler version under F2 and pins it.
- Format/lint/unit implementation remains F2. Prettier/ESLint/Vitest are acceptable reference choices; equivalents are allowed only if they preserve the durable gate interface below and do not broaden scope.
- CI provider for T001: GitHub Actions, because GitHub is the repository execution authority. Do not infer that later release qualification is GitHub-hosted-runner-only.

If the Builder needs a materially different runtime/package-manager family because the Frozen Architecture or the immediate monorepo seams cannot be implemented safely with this guidance, stop before broad implementation and report `EXECUTION_PACK_INVALID` with evidence so the pack can be regenerated/rebound. Do not silently redesign the execution contract.

## Durable root command contract

The resulting repository MUST make all of these commands runnable from a clean checkout using the pinned pnpm version:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

Required semantics:

- `pnpm install --frozen-lockfile`: deterministic dependency resolution from the committed lockfile; lockfile mutation is a failure.
- `pnpm format:check`: read-only formatting verification; it MUST NOT rewrite files in CI.
- `pnpm lint`: static lint gate across the bootstrapped workspace.
- `pnpm typecheck`: no-emit typecheck for the bootstrapped TypeScript workspace or an equivalently explicit type gate if a submodule legitimately requires another language.
- `pnpm test:unit`: minimal deterministic unit/smoke test proving the toolchain/workspace wiring.
- `pnpm ci:verify`: deterministic aggregate gate that executes format check, lint, typecheck, and unit smoke and exits non-zero on any failure.

The Builder MAY add more specific commands but MUST NOT rename/remove these T001 root gate entrypoints without returning `EXECUTION_PACK_INVALID` for re-preparation.

## Expected outputs

A conformant T001 candidate should contain, at minimum:

1. a production monorepo workspace root;
2. one committed exact package-manager lockfile;
3. repository-visible exact runtime and package-manager version selection;
4. root scripts implementing all durable commands above;
5. minimal formatter/linter/typecheck/unit-smoke configuration;
6. minimal workspace/package skeleton sufficient to exercise the commands without implementing product features;
7. GitHub Actions workflow that checks out the exact candidate, installs with the frozen lockfile, and runs `pnpm ci:verify`;
8. durable documentation of selected toolchain versions, commands, and known limitations;
9. explicit exclusion of `.agent/execution/` from shipped/package artifacts when packaging exists or a durable note that T018/T023 must enforce it before packaging qualification.

## CI truth requirements

- CI MUST run against the exact pushed/PR candidate SHA, not a locally substituted branch state.
- Workflow output SHOULD print `git rev-parse HEAD`, Node version, pnpm version, and the invoked gate command so later evidence can bind candidate/toolchain identity.
- Dependency caching is an optimization only. A cache miss MUST still bootstrap correctly.
- CI failure, cancellation, unavailable runner/service, or workflow-not-triggered is not PASS.
- T001 may establish only concern-level toolchain truth. It does not satisfy T020–T027 version/release gates.

## F2 choices intentionally left to the Builder

Within the boundaries above, the Builder may choose:

- exact Node 24 patch and exact compatible TypeScript/formatter/linter/test package versions;
- workspace folder names/topology for the minimal bootstrap skeleton;
- whether TypeScript project references are useful at this initial size;
- exact formatter configuration and lint rule set, provided they are bounded and deterministic;
- Vitest versus another mature deterministic unit runner, provided `pnpm test:unit` remains the durable interface;
- CI cache strategy and job decomposition;
- exact smoke-test content, provided it tests workspace/toolchain truth only;
- small supporting scripts/config files needed to make the required commands portable and reproducible.

These choices MUST be recorded in the implementation/PR closeout with exact versions and limitations. They do not become new Product/L2 authority.

## Failure and escalation

Use these fail-closed classes:

- `TASK_PACK_DEFECT`: T001's frozen WHAT/acceptance is internally incomplete or contradictory and cannot be implemented without changing Task scope.
- `ARCHITECTURE_CONTRADICTION`: required implementation would violate Frozen Product/L2 or requires an Architecture decision beyond F2.
- `EXECUTION_PACK_INVALID`: this exact-base HOW guidance is malformed, mis-bound, materially stale, or concretely incompatible with the safe implementation path.

Unavailable external CI/runner truth is a blocker/NOT_RUN condition, never a reason to fabricate PASS. Unsupported local runtime/OS assumptions must be reported with the exact failing tuple.

## Completion boundary for the future Builder

A Builder may claim T001 only in a separately dispatched execution after re-verifying Issue #20 state, active-claim absence, current integration base, branch/pack identity, and `PACK_CURRENT`. This JIT prep created no Builder claim and authorizes no implementation until that separate claim succeeds.
