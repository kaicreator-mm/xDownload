# xDownload

xDownload helps users acquire and organize explicitly requested, authorized resources with deterministic-first execution, bounded discovery, truthful results, and safe recovery. It is not a general crawler or an AI-first downloader.

The repository follows the immutable ADS revision pinned in [`.dev-standard/VERSION`](.dev-standard/VERSION).

## Current project and release state

**Status checked: 2026-10-30.** Version-specific freeze records and release receipts are authoritative; lifecycle markers embedded in older candidate documents may describe the historical state when those exact bytes were reviewed.

| Line | Authoritative status | What it means |
|---|---|---|
| v0.1.0 | Frozen Product, L2 and 28-task DAG; release gates remain independently tracked | The original product contract is frozen. Do not infer final release qualification from source files or old candidate markers. Open release work includes [#41](https://github.com/kaicreator-mm/xDownload/issues/41) and [#43–#47](https://github.com/kaicreator-mm/xDownload/issues/43). |
| v0.2.0 | **Component/workspace-level release qualified and integrated** | [RQ](docs/release/v0.2.0/rq/RELEASE_QUALIFICATION_R1.md) was READY for claims CL-1–CL-4; [PR #247](https://github.com/kaicreator-mm/xDownload/pull/247) was integrated to `main` at `c29af4a4b89123997d03d5566ebe09ba83855fb0`. It is not a claim that all installed end-user surfaces are released. |
| v0.2.1 | **Planning candidate; not frozen; implementation not authorized yet** | [Planning issue #248](https://github.com/kaicreator-mm/xDownload/issues/248) and the version-scoped candidate documents define the next stabilization and user-experience milestone. Independent exact-SHA review and a separate freeze/readback are still required. |

### v0.2.0 scope boundaries

v0.2.0 delivers the Domain App composition runtime, the two workspace packages, bounded-authorization surface components, and lineage authority partition. It explicitly does **not** claim the installed CLI surface, browser-extension v0.2 cutover, S4 HLS VOD as a release journey, installed baselines bound to a release SHA, or completed human G0/G1 sessions. See the [scope amendment](docs/planning/v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md), [closure](docs/release/v0.2.0/closure/CLOSURE_R1.md), and [v0.2.1 deferral ledger](https://github.com/kaicreator-mm/xDownload/issues/242).

DomainHarness v0.10.3 is consumed from the qualified Git source/build path: source commit `061376f4a023070f215f9feffad5c24d96d503cb`, tree `099cdc831aef63befd62aaede7e7a853d1be468f`. The selected SDK tarballs built from that tag still declare package-manifest version `0.10.2-rc.0`; xDownload's filenames and workspace overrides reflect those metadata values. v0.2.0 platform evidence records 4/4 SHA-256 matches against the #183 source-build receipts. Thus `v0.10.3` identifies the Git source tag, **not** an npm-published package version. No npm publication was authorized. Keep both identities explicit; never silently rename/repack or fall back to registry bytes.

## Product principles

- Correct acquisition and truthful status are more important than maximizing automation.
- Deterministic/template execution is the default; ordinary supported downloads work without an LLM.
- User-confirmed target, scope, membership, authorization and output intent are immutable for an accepted attempt.
- Collections are finite and explicit; no arbitrary URL frontier or crawler-like expansion.
- External effects require the selected authority and trusted Host; K does not carry high-volume file bytes.
- Retries are bounded. UNKNOWN effects are reconciled, not blindly repeated.
- Security, privacy, durability and measured user effort are release requirements, not post-release polish.

## Current development workspace

The implementation uses a pnpm monorepo with Node.js `24.21.0` and pnpm `12.8.1`.

```text
pnpm install --frozen-lockfile
pnpm ci:verify
```

`pnpm ci:verify` aggregates formatting, lint, typecheck and unit tests. Passing workspace checks alone does not prove an installed product journey.

## Source-of-truth documents

- [Documentation and lifecycle index](docs/README.md)
- [Frozen Product/Scope authority](docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- [Frozen v0.1.0 L2 authority](docs/planning/STAGE2_ARCHITECTURE_FREEZE.md)
- [Frozen v0.1.0 Task DAG authority](docs/planning/STAGE2_TASK_DAG_FREEZE.md)
- [v0.2.0 component release closure](docs/release/v0.2.0/closure/CLOSURE_R1.md)
- [v0.2.1 Product candidate](docs/planning/v0.2.1/PRODUCT_R0.md)
- [v0.2.1 L2 candidate](docs/architecture/v0.2.1/L2_R0.md)
- [v0.2.1 Task DAG candidate](docs/implementation/v0.2.1/TASK_DAG_R0.md)
- [v0.2.1 Task Pack candidate](docs/implementation/v0.2.1/TASK_PACKS_R0.md)

The v0.2.1 documents are planning candidates only. They do not authorize source writes, release claims, SDK publication, or main integration until the required review, freeze and JIT admission steps are complete.
