# xDownload Documentation Index

This index separates frozen authority, version execution state, and planning candidates. When an embedded status in a reviewed historical candidate conflicts with its freeze receipt, the exact freeze receipt governs the lifecycle transition.

ADS pin: `kaicreator-mm/ai-development-standard@4.18.0` — revision `2c395c55569fe2edf3f4135f12d3d069e526d0b7` (see [`/.dev-standard/VERSION`](../.dev-standard/VERSION)).

## Current version state

| Version | State | Authority |
|---|---|---|
| **v0.1.0** | Product, L2 and Task DAG are frozen; the 28-task DAG is historical immutable authority. Final release qualification/integration is not inferred complete; open gates remain under Issues #41 and #43–#47. | [Stage 1 Product Freeze](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md) · [Stage 2 L2 Freeze](planning/STAGE2_ARCHITECTURE_FREEZE.md) · [Stage 2.4 DAG Freeze](planning/STAGE2_TASK_DAG_FREEZE.md) · [v0.1 DAG](implementation/v0.1.0/TASK_DAG.md) |
| **v0.2.0** | Component/workspace-level release qualification READY and integrated into `main` at `c29af4a4b89123997d03d5566ebe09ba83855fb0`. This is not a complete installed end-user release. | [Product scope](planning/v0.2.0/PRODUCT_R0.md) · [L2](architecture/v0.2.0/L2_R0.md) · [DAG](implementation/v0.2.0/TASK_DAG_R0.md) · [scope amendment](planning/v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md) · [closure](release/v0.2.0/closure/CLOSURE_R1.md) · [RQ](release/v0.2.0/rq/RELEASE_QUALIFICATION_R1.md) |
| **v0.2.1** | Product/L2/DAG candidate planning under Issue #248. Not frozen; no source implementation Claim is granted. | [Product candidate](planning/v0.2.1/PRODUCT_R0.md) · [L2 candidate](../docs/architecture/v0.2.1/L2_R0.md) · [DAG candidate](implementation/v0.2.1/TASK_DAG_R0.md) · [Task Packs](implementation/v0.2.1/TASK_PACKS_R0.md) |

## Frozen v0.1.0 lifecycle authority

- Stage 0 Intake/Baseline: [checkpoint](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: [freeze receipt](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md); frozen source contract [PRD v0.4.2](product/PRD-v0.4.2-review-candidate.md)
- Stage 2 L2: [freeze receipt](planning/STAGE2_ARCHITECTURE_FREEZE.md); the frozen L2 blob is bound by that receipt even though the L2 evidence file retains its historical candidate marker
- Stage 2.4 Task DAG: [freeze receipt](planning/STAGE2_TASK_DAG_FREEZE.md); the frozen DAG and Task Pack index are bound by exact blobs in that receipt
- Freeze records do not themselves prove executable product validation, release closure, or release qualification.

## v0.2.0 component-level release facts

- Frozen Task DAG: T01–T22, all terminal.
- Candidate Freeze R2: PASS under the approved component-level scope amendment.
- Hidden Validation: PASS, 48 cases, 0 escaped.
- Version Closure: COMPLETE for the frozen component-level candidate.
- Release Qualification: READY for claims CL-1–CL-4; main integration permitted under the stated conditions.
- Main integration: [PR #247](https://github.com/kaicreator-mm/xDownload/pull/247), merge commit `c29af4a4b89123997d03d5566ebe09ba83855fb0`.
- Items explicitly outside the v0.2.0 claims and tracked in [Issue #242](https://github.com/kaicreator-mm/xDownload/issues/242): installed CLI entry path/CF-1, browser-extension v0.2 cutover and installed Chromium proof, S4 HLS VOD as a claimed journey, release-SHA-bound installed baselines, and real human G0/G1 sessions.
- DomainHarness v0.10.3 remains a Git-source/build consumption path; npm publication was not authorized.

## v0.2.1 planning

- Planning owner/intake: [Issue #248](https://github.com/kaicreator-mm/xDownload/issues/248)
- Preserved deferral ledger: [Issue #242](https://github.com/kaicreator-mm/xDownload/issues/242)
- Product candidate: [`planning/v0.2.1/PRODUCT_R0.md`](planning/v0.2.1/PRODUCT_R0.md)
- L2 candidate: [`architecture/v0.2.1/L2_R0.md`](../docs/architecture/v0.2.1/L2_R0.md)
- DAG candidate: [`implementation/v0.2.1/TASK_DAG_R0.md`](implementation/v0.2.1/TASK_DAG_R0.md)
- Task Pack candidate: [`implementation/v0.2.1/TASK_PACKS_R0.md`](implementation/v0.2.1/TASK_PACKS_R0.md)

Required next gates: independent exact-SHA Product/L2/DAG review; explicit owner freeze; native Task Issue/dependency materialization; accepted JIT Claim before implementation writes; installed-path validation; hidden validation; version closure; independent RQ; qualified integration.

## Workspace and contribution conventions

- Monorepo: pnpm workspaces; Node.js `24.21.0`, pnpm `12.8.1`.
- User documentation should be Chinese-first; Agent/developer contracts should be English-first.
- Use the current pinned ADS revision. Do not edit frozen Product/L2/DAG bytes in place; use an authorized successor/amendment with a new exact-SHA review and freeze record.
