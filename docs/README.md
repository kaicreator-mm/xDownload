# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: **CHECKPOINTED** — [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: **FROZEN**
- Frozen Product/Scope authority: [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- Formal L1 Product Evidence: **COMPLETE / checkpointed** — [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md)
- Stage 1 Freeze record: [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- Product release target: `v0.1.0`
- Stage 2 L2 Architecture Evidence: **CANDIDATE / READY_FOR_ARCH_REVIEW / NOT FROZEN** — [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
- Architecture UNKNOWN disposition: **0 unresolved material UNKNOWNs**
- Research Demo #7: **PASS evidence consumed** — terminal `5953990637`, final research HEAD `4adbe7c587920383a654e020de757e2de657c312`
- Research Demo #8: **PASS evidence consumed** — terminal `5954331493`, final research HEAD `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`
- Architecture Freeze: **NO**
- Task DAG: **NOT STARTED**
- Implementation: **NOT STARTED**

The PRD document revision is not the product release version. The current integration/checkpoint branch is `version/v0.1.0`.

## Frozen Stage 1 authority

The Frozen Product/Scope preserves the product thesis and rules defined by the reviewed v0.4.2 PRD, including targeted resource acquisition, explicit bounded collections, Human-in-the-loop where necessary, independent validation, Template-first deterministic execution, bounded AI fallback, immutable confirmed scope/snapshot semantics, lifecycle budgets and truthful multidimensional result semantics.

Downstream Architecture or implementation work may not mutate those Product semantics for convenience. Product Review PASS is assurance evidence only; it is not executable Validation, Architecture Freeze, Version Closure or Release PASS.

## Stage 2 L2 Architecture Evidence

[`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md) is the current **candidate / READY_FOR_ARCH_REVIEW / NOT FROZEN** L2 artifact.

Current evidence disposition:

```text
MATERIAL_CONCERNS_TRACKED=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_EVIDENCE_SUFFICIENT=2
EXECUTABLE_DEMO_REQUIRED=0
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
CURRENT_UNRESOLVED_ARCHITECTURE_UNKNOWNS=0
```

Candidate architecture still centers on one local authoritative Core Control Runtime shared by thin Desktop/CLI/Browser adapters, typed Evidence and canonical result projection, declarative bounded Recipe execution, protocol-specific acquisition adapters, and a local persistence/artifact boundary. These remain Architecture candidate decisions rather than Frozen facts.

The successor L2 now consumes the exact executable Research Demo evidence instead of leaving U2/U3 as Demo-required:

- **Issue #7 / U2** — PASS: real SQLite + filesystem + separate-process SIGKILL/restart + two-client concurrency supports stable snapshot/budget/effect/artifact truth for the tested Linux process-death/reopen tuple. Host power-loss durability remains NOT proven.
- **Issue #8 / U3** — PASS: real Chromium 144 MV3 extension + `webRequest` + browser cookie/partition context + real Native Messaging host + scoped local auth broker supports opaque auth-reference/provenance binding and tested secret containment on Linux. Firefox/Safari, Windows/macOS registration/packaging, store distribution and production credential-vault behavior remain NOT proven.

Research fixtures remain isolated research evidence and were not merged wholesale into the version branch.

## Next lifecycle action

The next action is a **fresh independent Architecture Review** on the exact current L2 candidate.

Only after a current exact-subject Architecture Review and a separately authorized Architecture Freeze decision may the project generate a Task DAG. No Task DAG or production implementation is authorized by the current successor.

## Durable Product/Review history

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md)
- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
