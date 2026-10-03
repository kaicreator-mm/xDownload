# T001 Toolchain Record — repository/toolchain bootstrap + CI activation

Task: `T001` / Issue #20 / dispatch `xdownload-v0.1.0-T001-builder-001` (execution profile `LOCAL_BUILDER`, freedom `F2_ENGINEERING_DISCRETION`).
Bound base: `version/v0.1.0@40bc80abc16012a42cb396a1aa3b6a6752daf061`.
Execution Pack: `.agent/execution/T001/MANIFEST.yaml@20dd6b9b5dda755b3adc91077e81ffe4631b8686` (`PACK_CURRENT`).

This file records implementation facts only. It is not Product or Architecture authority and satisfies no downstream Task's gates (T002+ own domain/product seams; T018/T023 own packaging/platform qualification; T020–T027 own version/release Validation).

## Selected toolchain identities (F2 implementation choices)

| Concern | Selection | Where pinned |
| --- | --- | --- |
| Runtime line | Node.js 24 LTS, exact patch `24.21.0` (LTS `Krypton`) | `engines.node` in root `package.json`, `.nvmrc`, CI `setup-node` |
| Package manager | pnpm `12.8.1` (registry `latest` at selection time; matches the Execution Contract researched baseline) | `packageManager` field in root `package.json`; CI `pnpm/action-setup` reads it |
| Language / typecheck | TypeScript `5.9.3` (mature 5.9 line; the newly released TS 7 line was deliberately not taken) | lockfile + root devDependencies |
| Formatter | Prettier `3.9.9` (read-only `format:check`) | lockfile + root devDependencies |
| Linter | ESLint `9.39.5` + `typescript-eslint` `8.71.0` + `@eslint/js` `9.39.5` (flat config) | lockfile + root devDependencies |
| Unit runner | Vitest `4.1.11` (deterministic `vitest run`, no watch mode in gates) | lockfile + root devDependencies |
| Node type definitions | `@types/node` `24.19.1` (24.x line matching the pinned runtime) | lockfile + root devDependencies |
| CI provider | GitHub Actions, `ubuntu-latest` runner for T001 truth | `.github/workflows/ci.yml` |

## Durable root command contract

All commands run from a clean checkout with the pinned pnpm (`12.8.1`; the `packageManager` field makes any pnpm ≥10.x host auto-switch to it):

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

- `format:check` is read-only (never rewrites files).
- `typecheck` is `tsc --noEmit` over the workspace.
- `test:unit` runs Vitest once (`vitest run`), deterministic, no network, no clock dependence.
- `ci:verify` aggregates format check + lint + typecheck + unit smoke and fails non-zero if any sub-gate fails.

## Workspace topology

- `packages/toolchain-smoke-core` — pure helper functions, no dependencies.
- `packages/toolchain-smoke` — imports the core package through the pnpm `workspace:*` protocol and tests both the link and repository pin consistency (`.nvmrc` ↔ `engines.node` ↔ `packageManager`).
- `apps/*` is declared for future discovery; no app package exists yet. Later product modules belong to their owning Tasks — no product feature code is included in T001.

## Formatting/lint gate scope

`.prettierignore` excludes the frozen planning/architecture documents (`docs/`, `.agent/`, `.dev-standard/`, `AGENTS.md`, `CLAUDE.md`, `README.md`) so the read-only format gate can never demand a rewrite of frozen or authority bytes. Prettier/ESLint cover exactly the T001-owned bootstrap files. ESLint similarly ignores those directories.

## CI truth

`.github/workflows/ci.yml`:

- triggers on every branch push and on pull requests targeting `version/v0.1.0`;
- checks out the exact candidate and prints `git rev-parse HEAD`;
- installs pnpm from the repository `packageManager` field and Node from `.nvmrc` (both printed to the log);
- installs dependencies with `pnpm install --frozen-lockfile`;
- runs `pnpm ci:verify` with no `continue-on-error` on any required step.

No dependency cache is configured: every CI run exercises a cache-miss-equivalent clean install, so cache independence holds by construction. Adding a cache later must not change gate semantics.

## Known limitations / boundary statements

- Node pinning is exact (`24.21.0`). Other patches/majors are outside the supported T001 tuple; `engines` is advisory on non-enforcing hosts (no `engine-strict`), and CI is the authoritative tuple.
- T001 exercised only: the pinned CI tuple (GitHub Actions `ubuntu-latest`, Node 24.21.0, pnpm 12.8.1) and the local Windows validation tuple recorded in the Issue #20 closeout. No broader OS/platform support is claimed.
- No product behavior, no downloader/browser/persistence/scheduler/AI/CLI/Desktop code, no public product contracts, and no packaging artifacts exist after T001.
- Packaging does not exist yet, so `.agent/execution/` exclusion from shipped artifacts is deferred by durable note: **T018/T023 must enforce excluding `.agent/execution/` from any shipped/packaged artifact before packaging qualification.**
- CI availability was GitHub-Actions-dependent at validation time; a cancelled/unavailable workflow run must never be reported as PASS.
