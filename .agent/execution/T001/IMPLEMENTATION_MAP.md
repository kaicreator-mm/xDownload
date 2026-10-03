# T001 Exact-Base Implementation Map

Bound base: `version/v0.1.0@40bc80abc16012a42cb396a1aa3b6a6752daf061` / tree `2766b482c23c7c78a4b2b4e451277e91ded11097`.

This map identifies repository seams only. It does not implement T001 and does not authorize Product/L2 changes.

## Existing authority paths — read, do not semantically mutate

| Path | Exact-base identity / role | T001 treatment |
|---|---|---|
| `.dev-standard/VERSION` | pins ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d` | read-only authority |
| `.dev-standard/PROJECT_OVERRIDES.md` | project execution/CI/runtime profile; currently records toolchain/CI as not established | update only if T001 closeout needs factual implementation-profile recording and only without changing Frozen Product/L2; otherwise leave unchanged |
| `AGENTS.md` | repository agent rules | read-only unless a directly necessary tooling command note is explicitly justified; no lifecycle rewrite |
| `docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md` | Frozen Product authority | forbidden |
| `docs/planning/STAGE2_ARCHITECTURE_FREEZE.md` | Frozen Architecture authority | forbidden |
| `docs/planning/STAGE2_TASK_DAG_FREEZE.md` | Frozen Task DAG authority | forbidden |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | forbidden semantic mutation |
| `docs/implementation/v0.1.0/TASK_DAG.md` | blob `232e561c2b350a60085c6d13d6030b759295c7cf` | forbidden |
| `docs/implementation/v0.1.0/TASK_PACKS.json` | blob `586e765d7bf1777d7fadded9b0e78041acfd3666` | forbidden |
| `docs/implementation/v0.1.0/task-packs/T001_repository-toolchain-ci-bootstrap.md` | blob `86d68d7a1fa51fe7ca88c9fa6959538ea0eb92a4` | forbidden; WHAT authority |
| `.agent/execution/T001/` | this exact-base JIT pack | durable execution evidence; do not rewrite base identity during implementation |

## Exact-base absent seams T001 is expected to establish

The exact base contains no production workspace/toolchain/CI files. The Builder may create the following seams inside T001's owned boundary:

| Seam | Expected responsibility | Constraints |
|---|---|---|
| root package manifest | private monorepo root, pinned package-manager metadata, durable root scripts | no Product feature behavior |
| `pnpm-lock.yaml` | deterministic dependency graph | committed; frozen install must succeed |
| `pnpm-workspace.yaml` or current pnpm-equivalent workspace declaration | monorepo package discovery | keep topology minimal; do not pre-implement later Task modules |
| runtime version metadata | exact Node 24 patch selected by Builder | repository-visible and matched by CI |
| TypeScript config seam | root typecheck baseline and optional project references | architecture-neutral; no public-domain contract invention |
| formatter config | read-only `format:check` support | deterministic |
| lint config | `lint` support | minimal, maintainable rules; no unrelated mass rewrite |
| unit runner config | `test:unit` support | smoke/toolchain truth only |
| minimal workspace smoke package(s) | prove workspace resolution/typecheck/test wiring | must not implement downloader/browser/persistence/AI/domain features |
| `.github/workflows/` | exact-candidate minimal CI | frozen install + `pnpm ci:verify`; no false PASS |
| tooling/bootstrap docs | exact versions, commands, limitations | facts only, no unsupported platform promises |
| package exclusion seam | keep `.agent/execution/` out of shipped artifacts | may be a durable note if no package artifact exists yet; T018/T023 remain downstream owners |

## Recommended shape, not frozen architecture

A simple root pnpm workspace with future-facing `packages/` and `apps/` discovery is compatible with the monorepo goal, but T001 MUST create only the minimum concrete packages needed to prove the toolchain. Names of later Product modules belong to their owning Tasks; do not stub feature implementations just to populate folders.

If a bootstrap smoke package is used, give it an explicitly non-product name and keep its code trivial enough that Review can distinguish toolchain proof from feature implementation.

## Durable command seam

The root manifest must expose exactly these gate entrypoints required by the Execution Contract:

```text
format:check
lint
typecheck
test:unit
ci:verify
```

The expected invocations are:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

## Cross-task boundaries

- T002 owns canonical domain contracts; T001 must not define them.
- T003 owns validation harness/corpora beyond tooling smoke; T001 must not absorb it.
- T013/T014 own CLI/Desktop feature adapters; T001 may only establish neutral workspace seams they can later use.
- T018/T023 own packaging/platform integration/qualification; T001 may only ensure its own `.agent/execution/` evidence is excludable and avoid claiming package qualification.
- T020–T027 own later validation/release gates; T001 does not satisfy them.

## Stop conditions

Stop and escalate rather than extending this map if implementation requires a Frozen Product/L2 change, a new public contract, a feature module, a broad platform promise, or a materially different runtime/toolchain family that invalidates the pack's command/CI guidance.
