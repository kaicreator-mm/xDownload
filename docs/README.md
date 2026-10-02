# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: **CHECKPOINTED** — [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: **FROZEN**
- Frozen Product/Scope authority: [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- Formal L1 Product Evidence: **COMPLETE / checkpointed** — [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md)
- Stage 1 Freeze record: [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- Product release target: `v0.1.0`
- Stage 2 L2 Architecture Evidence: **FROZEN** — [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
- Stage 2 Architecture Freeze record: [`planning/STAGE2_ARCHITECTURE_FREEZE.md`](planning/STAGE2_ARCHITECTURE_FREEZE.md)
- Architecture UNKNOWN disposition: **0 unresolved material UNKNOWNs**
- Research Demo #7: **PASS evidence consumed** — terminal `5953990637`, exact consumed HEAD `4adbe7c587920383a654e020de757e2de657c312`
- Research Demo #8: **PASS evidence consumed** — terminal `5954331493`, exact consumed Linux HEAD `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`, tree `486fb32577ac89f41276614611a7ef582ab68a15`; later Windows tuple is additive provenance only
- Architecture Re-Review #12: **PASS / Freeze Eligible YES** — terminal `5956402251`, `AR-F01=CLOSED`
- Architecture Freeze: **FROZEN**
- Stage 2.4 Task DAG: **CANDIDATE / NOT FROZEN / READY FOR FRESH INDEPENDENT REVIEW** — [`implementation/v0.1.0/TASK_DAG.md`](implementation/v0.1.0/TASK_DAG.md)
- Task Pack index: [`implementation/v0.1.0/TASK_PACKS.json`](implementation/v0.1.0/TASK_PACKS.json)
- Task Issues / native Issue Dependencies: **NOT MATERIALIZED**
- Implementation: **NOT STARTED**
- Executable production Validation: **NOT CLAIMED**

The PRD document revision is not the product release version. The current integration/checkpoint branch is `version/v0.1.0`.

## Frozen Stage 1 authority

The Frozen Product/Scope preserves the product thesis and rules defined by the reviewed v0.4.2 PRD, including targeted resource acquisition, explicit bounded collections, Human-in-the-loop where necessary, independent validation, Template-first deterministic execution, bounded AI fallback, immutable confirmed scope/snapshot semantics, lifecycle budgets and truthful multidimensional result semantics.

Downstream Architecture or implementation work may not mutate those Product semantics for convenience. Product Review PASS is assurance evidence only; it is not executable Validation, Architecture Freeze, Version Closure or Release PASS.

## Frozen Stage 2 L2 Architecture

[`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md) is the exact **FROZEN** L2 artifact bound by [`planning/STAGE2_ARCHITECTURE_FREEZE.md`](planning/STAGE2_ARCHITECTURE_FREEZE.md).

Frozen evidence disposition:

```text
MATERIAL_CONCERNS_TRACKED=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_EVIDENCE_SUFFICIENT=2
EXECUTABLE_DEMO_REQUIRED=0
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
CURRENT_UNRESOLVED_ARCHITECTURE_UNKNOWNS=0
AR_F01=CLOSED
```

The Frozen architecture centers on one local authoritative Core Control Runtime shared by thin Desktop/CLI/Browser adapters, typed Evidence and canonical result projection, declarative bounded Recipe execution, protocol-specific acquisition adapters, and a local persistence/artifact boundary.

The Frozen L2 consumes exact executable Research Demo evidence narrowly:

- **Issue #7 / U2** — PASS: real SQLite + filesystem + separate-process SIGKILL/restart + two-client concurrency supports stable snapshot/budget/effect/artifact truth for the tested Linux process-death/reopen tuple. Host power-loss durability remains NOT proven. Its cancel-vs-auto-recovery precedence item was explicitly `ADAPT`, not universally proven by the Demo.
- **Issue #8 / U3** — PASS: the exact consumed Chromium/Linux evidence at `b5fbbe1...` / tree `486fb325...` supports the scoped browser/auth seam. The later Windows/Chrome evidence at `f04092e...` is additive provenance and does not replace the consumed Linux authority.

The repaired L2 defines one Core-owned cancellation-vs-recovery/validation/acceptance/finalization precedence: durable cancellation before durable acceptance blocks automatic later acceptance; durable acceptance before cancellation is not retroactively revoked; bounded reconciliation may establish truth; only explicit retry/resume may reopen processing on the same frozen lineage and remaining budgets. Frozen Product semantics were not changed.

Research fixtures remain isolated research evidence and were not merged wholesale into the version branch.

Architecture Review PASS and this Freeze are planning/assurance checkpoints only. They do not prove production Validation, packaging/install/update readiness, Release Qualification, or Release PASS.

## Stage 2.4 Task DAG candidate

The v0.1.0 planning candidate is durable at [`implementation/v0.1.0/TASK_DAG.md`](implementation/v0.1.0/TASK_DAG.md) with per-task durable authority indexed by [`implementation/v0.1.0/TASK_PACKS.json`](implementation/v0.1.0/TASK_PACKS.json).

This planning checkpoint is **NOT FROZEN**. No Task Issues, native Issue Dependencies, implementation branches or JIT Execution Packs have been materialized, and implementation has not started. The candidate itself is `review:required` and must receive a separate Fresh Independent Task DAG Review before any Freeze/materialization step.

After a future Task DAG Freeze and Stage 2.5 materialization, GitHub Task Issues + native Issue Dependencies become the canonical live execution DAG; the frozen planning document remains planning/history only.

## Next lifecycle action

The next separately authorized action is a **Fresh Independent Task DAG Review** of the exact Stage 2.4 candidate. Task DAG Freeze, Stage 2.5 materialization and implementation remain downstream and have not been started.

## Durable Product/Review history

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md)
- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
- [`planning/STAGE2_ARCHITECTURE_FREEZE.md`](planning/STAGE2_ARCHITECTURE_FREEZE.md)
- [`implementation/v0.1.0/TASK_DAG.md`](implementation/v0.1.0/TASK_DAG.md)
- [`implementation/v0.1.0/TASK_PACKS.json`](implementation/v0.1.0/TASK_PACKS.json)
