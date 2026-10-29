# T001 Review Checklist

Review policy is frozen as `review:required`; risk is `risk:high`. This checklist is for the later independent Task Review and does not constitute Review in this JIT-prep session.

## Exact subject / authority

- [ ] PR/head under review is identified by exact 40-char SHA and targets `version/v0.1.0`.
- [ ] T001 implementation originated from branch `task/v0.1.0-t001-repository-toolchain-ci-bootstrap` and the Execution Pack remains correctly bound to base `40bc80abc16012a42cb396a1aa3b6a6752daf061` or an explicitly authorized successor/rebind.
- [ ] Frozen Product, Frozen L2, Frozen Task DAG/index, and T001 Task Pack semantics are unchanged.
- [ ] No requirement in the PR is justified only by chat or hidden context; required execution facts are durable in Issue #20 / repository artifacts.

## Scope control

- [ ] Changes stay within repository/workspace/toolchain/build/CI/bootstrap configuration plus directly necessary smoke tests/docs.
- [ ] No downloader/browser/persistence/scheduler/AI/CLI/Desktop/media feature implementation is included.
- [ ] No unsupported OS/browser/runtime/platform promise is introduced.
- [ ] Tooling choices are recorded as implementation choices, not Product/L2 authority.
- [ ] No downstream Task responsibility is silently absorbed.

## Reproducible toolchain

- [ ] Exact Node version is pinned and belongs to the intended supported line.
- [ ] Exact pnpm version is pinned in repository-visible metadata.
- [ ] A single committed lockfile is present and `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] Clean install does not modify the lockfile or tracked files.
- [ ] Toolchain/package versions used by required gates are pinned through the lockfile.

## Durable command interface

- [ ] `pnpm format:check` exists, is read-only, and fails on format violations.
- [ ] `pnpm lint` exists and fails on lint violations.
- [ ] `pnpm typecheck` exists and is a truthful type gate.
- [ ] `pnpm test:unit` runs at least one deterministic tooling/workspace smoke test without claiming Product behavior.
- [ ] `pnpm ci:verify` aggregates all required subgates and fails if any one fails.
- [ ] Command names have not been weakened/renamed without an authorized pack update.

## CI truth

- [ ] GitHub Actions workflow checks out the exact candidate SHA and records `git rev-parse HEAD`.
- [ ] Workflow uses the same pinned Node/pnpm selections as local bootstrap.
- [ ] CI uses frozen lockfile installation.
- [ ] CI runs `pnpm ci:verify` without `continue-on-error` or equivalent weakening on required steps.
- [ ] Cache is only an optimization; a cache miss does not change semantics.
- [ ] Cancelled/skipped/unavailable workflow truth is not reported as PASS.
- [ ] Any cited CI PASS is bound to the current exact candidate, not a predecessor SHA.

## Failure handling

- [ ] Registry/network/runner unavailability is reported as BLOCKED/NOT_RUN rather than masked.
- [ ] Unsupported local/runtime tuple is recorded exactly.
- [ ] Required-gate failures retain actionable output and return non-zero.
- [ ] Any Task Pack, Architecture, or Execution Pack contradiction is routed using `TASK_PACK_DEFECT`, `ARCHITECTURE_CONTRADICTION`, or `EXECUTION_PACK_INVALID` rather than silently redesigned.

## Repository hygiene / packaging boundary

- [ ] Bootstrap does not commit dependency caches, `node_modules`, generated build output, or machine-local secrets.
- [ ] `.agent/execution/` remains durable repository evidence but is excluded from shipped/package artifacts when packaging exists.
- [ ] No credentials/tokens are embedded in CI configuration or smoke fixtures.
- [ ] Tooling-only smoke code is clearly distinguishable from Product implementation.

## Validation and closeout truth

- [ ] T001 concern-level Validation includes clean bootstrap, format, lint, typecheck, unit smoke, and CI run on the exact candidate.
- [ ] Review evidence and Validation evidence are distinct.
- [ ] T001/PR PASS is not described as Candidate Freeze, Version Closure, Release Qualification, or Release PASS.
- [ ] Closeout records exact toolchain/CI identities and known limitations.
