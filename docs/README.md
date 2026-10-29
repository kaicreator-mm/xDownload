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
- Stage 2.4 Task DAG: **FROZEN** — [`implementation/v0.1.0/TASK_DAG.md`](implementation/v0.1.0/TASK_DAG.md)
- Stage 2.4 Task DAG Freeze record: [`planning/STAGE2_TASK_DAG_FREEZE.md`](planning/STAGE2_TASK_DAG_FREEZE.md)
- Task Pack index: [`implementation/v0.1.0/TASK_PACKS.json`](implementation/v0.1.0/TASK_PACKS.json)
- Frozen Task count: **28 (`T001`–`T028`)**
- Task Issues / native Issue Dependencies: **NOT MATERIALIZED**
- Stage 2.5 Execution DAG Materialization: **ELIGIBLE / NOT STARTED**
- JIT Execution Packs: **NOT GENERATED**
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

## Frozen Stage 2.4 Task DAG

The v0.1.0 planning subject is frozen by [`planning/STAGE2_TASK_DAG_FREEZE.md`](planning/STAGE2_TASK_DAG_FREEZE.md) at reviewed source HEAD `f9a9c161482254deba9ca70c52a071aa1780615f` / tree `82f92c5a84fae600278598786aa0e736f66b73c6`.

Frozen planning artifacts:

- [`implementation/v0.1.0/TASK_DAG.md`](implementation/v0.1.0/TASK_DAG.md) — reviewed blob `232e561c2b350a60085c6d13d6030b759295c7cf`
- [`implementation/v0.1.0/TASK_PACKS.json`](implementation/v0.1.0/TASK_PACKS.json) — reviewed blob `586e765d7bf1777d7fadded9b0e78041acfd3666`
- exactly 28 reviewed Task Packs, IDs `T001`–`T028`
- Fresh Independent Re-Review authority: Issue #17 comment `5961803625`, PASS / Freeze Eligible YES, `TD-R01/TD-R02/TD-R03=CLOSED`

The reviewed Task DAG, Task Pack index and all 28 Task Packs are preserved byte-for-byte by the Freeze Controller. Any embedded `CANDIDATE / NOT FROZEN` marker inside those reviewed artifacts is the pre-freeze state of the exact review subject; the separate Freeze record is the authoritative lifecycle overlay declaring those exact bytes **FROZEN**.

The frozen DAG is acyclic. Its reviewed maximum logical width is 9, and T020–T023 form a reviewed four-lane exact-candidate Validation region; actual execution concurrency may be lower due to real resource limits. Review Policy, Validation ownership, L3 disposition, risk and executor routing are frozen planning authority. Any semantic change requires an explicit Task DAG amendment / successor review-and-freeze path rather than silent editing.

No Task Issues, native Issue Dependencies, implementation branches or JIT Execution Packs have been materialized/generated, and implementation has not started. No executable Validation PASS, Candidate Freeze, Hidden Validation, Version Closure, Release Qualification or Release result is claimed by this Task DAG Freeze.

Task/PR PASS remains distinct from Candidate Freeze, Hidden Validation, Version Closure and Release Qualification. T027 retains the canonical `READY|CONDITIONAL|BLOCKED|FAIL` Release Qualification verdict set, and T028 repository integration remains admissible only after canonical `READY`.

After a separately dispatched Stage 2.5 materialization, GitHub Task Issues + native Issue Dependencies become the canonical live execution DAG; the frozen planning documents remain planning/history authority.

## Next lifecycle action

The next separately authorized action is **ADS Stage 2.5 Execution DAG Materialization** from the Frozen 28-task planning checkpoint. Stage 2.5 has not been started here; Task Issues, native Issue Dependencies, L3/JIT Execution Packs, implementation and executable Validation remain downstream.

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
- [`planning/STAGE2_TASK_DAG_FREEZE.md`](planning/STAGE2_TASK_DAG_FREEZE.md)
