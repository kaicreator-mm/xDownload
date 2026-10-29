# T001 L3 Reference Pack — repository/toolchain bootstrap + CI activation

Task: `T001` / Issue #20  
Exact integration base: `version/v0.1.0@40bc80abc16012a42cb396a1aa3b6a6752daf061`  
Tree: `2766b482c23c7c78a4b2b4e451277e91ded11097`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack reduces implementation uncertainty for T001. It is subordinate to Frozen Product, Frozen Architecture, the Frozen Task Pack, and `F2_ENGINEERING_DISCRETION`. Reference popularity or recency is not architecture authority. Exact toolchain versions finally selected by the Builder must be committed and recorded as implementation facts.

## 1. Selected primary/mature references

Research snapshot: `2026-10-03`.

| Reference | Researched revision/version | License / reuse posture | T001 use |
|---|---|---|---|
| Node.js | `v24.19.0` in the Node 24 LTS line | Node.js project license is permissive/MIT-style for Node-owned portions, with bundled third-party notices | Runtime/version-pinning model only. Use an exact Node 24 patch for reproducible local/CI bootstrap; this does not create a Product platform promise. |
| pnpm | `v12.8.1` | MIT | Workspace + committed lockfile + frozen installation patterns. Prefer `pnpm install --frozen-lockfile` as the deterministic bootstrap gate. |
| TypeScript | `v7.0.2` | Apache-2.0 | Compiler/typecheck and, if useful, project-reference patterns. Exact compatible compiler selection remains Builder F2. |
| ESLint | `v10.12.0` | MIT | Mature read-only static lint gate and flat-config patterns. Use only the minimal configuration required for the bootstrap workspace. |
| Vitest | `v5.0.3` | MIT | Deterministic unit/smoke runner pattern suitable for proving workspace/toolchain wiring. Equivalent mature runner is allowed within the Execution Contract. |
| `actions/checkout` | major line `v6` | MIT | Current GitHub Actions checkout pattern. Major tag is a documentation/reference identity; actual workflow dependency should follow repository security policy and record the selected immutable/action identity. |
| `actions/setup-node` | major line `v7` | MIT | Current GitHub Actions Node setup/cache pattern. Pin the repository's exact Node patch independently of the action major line. |
| GitHub Actions Node build guidance | current official GitHub documentation at research time | documentation/reference only | Workflow ordering: checkout → runtime/package-manager setup → frozen install → one durable aggregate verification command. |

### Reference-selection boundary

The references above support a low-uncertainty Node/TypeScript/pnpm bootstrap, but T001's Frozen Architecture deliberately leaves concrete implementation technology replaceable. The future Builder may make bounded compatible F2 choices. A materially different runtime/package-manager family that invalidates this pack's command/CI model must not be silently substituted; report `EXECUTION_PACK_INVALID` so JIT evidence can be regenerated.

## 2. Tests/checks to emulate

Prioritize observable behavior over copying configuration from any reference repository.

### Clean bootstrap

Emulate a fresh consumer/CI environment:

1. clean clone/worktree at the exact candidate SHA;
2. no `node_modules` and no required warm cache;
3. select the repository-pinned Node and pnpm versions;
4. run `pnpm install --frozen-lockfile`;
5. prove the lockfile and tracked tree were not rewritten.

Negative oracle: a missing/stale lockfile or manifest/lock disagreement must make the frozen install fail rather than silently regenerate dependency state.

### Format

`pnpm format:check` must be read-only. A deliberate formatting violation in an isolated negative check should return non-zero. CI must not use an auto-fix command as its format gate.

### Lint

`pnpm lint` must inspect the bootstrapped workspace and return non-zero for a representative lint error. Keep the initial rule set minimal; the test is that the gate is durable and truthful, not that T001 solves future code-style policy.

### Typecheck

`pnpm typecheck` should perform a no-emit/read-only type gate over the bootstrap workspace. A representative type error must produce non-zero status. Project references are optional if they improve workspace boundaries without creating unnecessary topology.

### Unit smoke

`pnpm test:unit` must execute at least one deterministic test that proves toolchain/workspace resolution. The test must not simulate or claim downloader/browser/domain feature behavior owned by later Tasks.

### Aggregate verification

`pnpm ci:verify` must run format check, lint, typecheck, and unit smoke and preserve non-zero status from any failed subgate. It is the single durable CI entrypoint for T001.

### CI exact candidate

A GitHub Actions run should record enough identity to prove what executed:

- exact workflow/candidate SHA;
- `git rev-parse HEAD` after checkout;
- Node version;
- pnpm version;
- frozen install;
- `pnpm ci:verify` result;
- workflow conclusion and runner tuple.

Cache-hit and cache-miss execution must have the same gate semantics. Cancellation, skipped required jobs, runner/service unavailability, or a run against a predecessor SHA are not PASS.

## 3. Durable contracts/interfaces

The following root commands are the execution interface that later Tasks/CI may rely on after T001:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T001 may add narrower package-level scripts, but these root entrypoints must remain stable for this Task candidate unless the Execution Pack is explicitly revised.

Durable repository facts expected from T001:

- exact runtime/package-manager selection in repository-visible metadata;
- one committed dependency lockfile;
- workspace discovery/configuration;
- root quality/test commands;
- one active minimal CI workflow invoking the same aggregate gate;
- recorded exact toolchain versions and limitations.

These are tooling contracts only. They do not define xDownload domain/public Product contracts.

## 4. Minimal implementation patterns worth referencing

Use concepts, not wholesale repository copies.

### Workspace root

Prefer a private root package/workspace whose primary purpose is orchestration. A small pnpm workspace is sufficient. Do not create feature packages merely to anticipate later Tasks.

### Minimal smoke package

If a package is needed to exercise workspace resolution/typecheck/test wiring, keep it explicitly tooling-only and trivial. It should prove import/build/test plumbing, not xDownload behavior.

### Frozen dependency install

Commit manifests and one lockfile together. Local and CI bootstrap use the same frozen-lockfile path. Dependency cache is optional and never authoritative.

### One aggregate CI command

Keep CI thin: setup the exact environment, install deterministically, then invoke `pnpm ci:verify`. Business logic for quality gates belongs in repository scripts/configuration rather than being duplicated in workflow YAML.

### Exact-candidate observability

Print candidate/toolchain identities before the gate. This makes later Validation evidence auditable and prevents accidental reuse of a green run from another SHA.

## 5. Failure-handling patterns

- **Registry/network unavailable:** preserve the original install error and exact environment; classify external truth as BLOCKED/NOT_RUN where appropriate. Never delete/rewrite the lockfile merely to get a green run.
- **Lockfile inconsistency:** fail frozen installation; repair manifest+lockfile as one reviewable T001 change, then repeat clean bootstrap.
- **Unsupported runtime/host:** record OS/arch/Node/pnpm tuple. Do not widen Product platform claims or silently substitute unrecorded versions.
- **Required quality gate failure:** aggregate gate returns non-zero. Do not use `continue-on-error`, warning-only conversion, or excluded paths to mask required coverage.
- **CI unavailable/cancelled/skipped:** local success remains useful local evidence but does not become CI PASS.
- **Candidate SHA mismatch:** invalidate the run as exact-candidate evidence and rerun for the correct SHA.
- **Architecture/Task contradiction:** stop and route `ARCHITECTURE_CONTRADICTION` or `TASK_PACK_DEFECT`; do not use a tooling choice to redefine Frozen authority.
- **Pack/base mismatch:** stop with `EXECUTION_PACK_INVALID` / stale-pack handling; do not silently edit `base_sha`.

## 6. Do / Don't

### Do

- pin concrete versions selected by the Builder;
- keep bootstrap reproducible from a clean clone;
- make root commands short, durable, and automation-friendly;
- use the same aggregate gate locally and in CI;
- keep smoke tests deterministic and tooling-focused;
- record exact CI candidate/toolchain identity;
- keep `.agent/execution/` durable in Git while excluding it from shipped artifacts;
- report unavailable external truth explicitly.

### Don't

- copy an entire reference repository or its architecture;
- treat Node/pnpm/TypeScript choices as Frozen Product/L2 decisions;
- implement product features to make the workspace look complete;
- create unsupported OS/browser/platform promises;
- let CI regenerate lockfiles or auto-fix required checks;
- use warm cache as a prerequisite for bootstrap success;
- call a cancelled/skipped/unavailable CI run PASS;
- weaken `review:required` or downstream release/Validation gates.

## 7. Reuse/license risk

The selected code references are permissively licensed (MIT or Apache-2.0 for the cited projects/components), but this pack recommends behavioral/configuration patterns rather than copying source. If the Builder copies a non-trivial source/config fragment, preserve the applicable license/notice obligations and document provenance in the PR. GitHub Action usage through `uses:` is dependency consumption, not permission to vendor arbitrary source without its notices.

The lowest-risk path is to author project-local minimal configuration from official documented interfaces and pin dependencies through the lockfile.

## 8. Acceptance / Validation mapping

| T001 acceptance concern | Reference/evidence mapping | Required future evidence |
|---|---|---|
| Clean checkout bootstrap succeeds | pnpm workspace + frozen-lockfile install; exact Node/pnpm pinning | fresh checkout/worktree, install log, exact versions, unchanged lockfile/tree |
| Format gate runs | formatter read-only check pattern | `pnpm format:check` PASS + negative oracle/read-only proof |
| Lint gate runs | ESLint mature CLI/config pattern or compatible equivalent | `pnpm lint` PASS + representative failure oracle |
| Typecheck gate runs | TypeScript compiler/project configuration | `pnpm typecheck` PASS + representative type-error oracle |
| Unit smoke runs | Vitest deterministic smoke pattern or compatible equivalent | `pnpm test:unit` PASS with at least one tooling/workspace smoke test |
| CI executes exact task candidate | GitHub Actions checkout/setup/frozen-install pattern | workflow run identity, checkout SHA equals candidate, exact versions, `pnpm ci:verify`, successful required conclusion |
| Required commands are durable | root-script interface defined by Execution Contract | committed root scripts/docs and successful clean execution |
| No false platform/release claim | Frozen authority + explicit tuple reporting | closeout limitations; no T020–T027 claim |

## 9. Builder handoff boundary

This Reference Pack is complete for JIT admission when read together with `MANIFEST.yaml`, `EXECUTION_CONTRACT.md`, `TEST_MATRIX.yaml`, `FAILURE_MATRIX.yaml`, `IMPLEMENTATION_MAP.md`, and `REVIEW_CHECKLIST.md`. It does not claim any of the future checks have run. Builder execution begins only after a separately admitted Builder claim for Issue #20.
