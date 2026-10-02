# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: checkpointed in [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: ACTIVE
- Formal L1 Product Evidence: COMPLETE / checkpointed
- Current PRD/Scope candidate: `PRD-v0.4.2-review-candidate.md`
- Product Freeze: NO
- Architecture Freeze: NO
- L2 eligibility: NO
- Task DAG: NOT STARTED
- Implementation: NOT STARTED

The PRD document revision is not the product release version. The initial product release target remains `xDownload v0.1.0`.

## Current Stage 1 evidence

- [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md) — formal ADS L1 Product Evidence. Recommendation: **PROCEED WITH NARROWING + REFRAME**.
  - Basic transport, browser sniffing and AI/MCP control already exist in strong products.
  - xDownload focuses on targeted resource acquisition, explicit bounded collections, Human-in-the-loop when necessary, validation, Template-first execution and bounded AI-on-gap.
  - Product value, AI increment, local knowledge compounding and shared knowledge remain separate hypotheses/gates.
  - Economic benefit remains `NOT_MEASURED`.

## Current Product/Scope review subject

- [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md) — current complete, self-contained ADS Stage 1 Product/Scope Review Candidate.
  - supersedes v0.4.1 only as the current review subject; historical artifacts remain unchanged;
  - initial product release target: `v0.1.0`;
  - preserves the L1 thesis: targeted resource acquisition + explicit bounded collection + Human-in-the-loop + independent validation + Template-first + bounded AI-on-gap;
  - repairs Issue #2/#3 R01 by freezing `current_page` membership/continuation semantics, default `continuation_scope=NONE`, successor contract/snapshot on later scope expansion, and truthful unexhausted-continuation result behavior;
  - repairs R02 by keeping confirmed `requested_scope` immutable, separating requested / authorization-accessible / selected / acquired sets, separating parent/requested/access accounting, and freezing the canonical 18-requested / 16-accessible tuple;
  - repairs R03 by requiring a deterministic pre-registered `G0BaselinePlan` before Phase B and invalidating confirmation when baseline selection/comparison rules change after exposure;
  - retains AcquisitionContract, Collection admission, Scope Grammar, SelectionSnapshot, Budget domains/precedence, multi-dimensional Result Model, typed Evidence/User Confirmation, UI/CLI contracts, S1–S6 required support slices, G0–G4 protocols, C01–C34, Critical Journeys, release blockers and finding closure matrices.

## Durable review evidence

- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- Issue #2 terminal review comment `5950568942` — Fresh Independent Product/Scope Review of v0.4.1, result `NEEDS_REVISION`, Product Freeze eligibility `NO`; minimum blocking set R01–R03.

v0.4.2 is the successor Product/Scope subject created to repair exactly R01–R03. It has **not** been independently reviewed and does not perform Product Freeze.

## Stage 1 required next actions

Per the pinned ADS Development Workflow:

1. Formal L1 Product Evidence — **COMPLETE**.
2. v0.4.1 Fresh Independent Review — **COMPLETE / NEEDS_REVISION**.
3. R01–R03 successor Product/Scope repair — **COMPLETE AS BUILDER CANDIDATE: v0.4.2**.
4. Fresh Independent Product/Scope Review on the exact current v0.4.2 subject — **NOT RUN**.
5. If and only if that fresh review returns PASS with no blocking Product findings, separately create the Stage 1 Product/Scope Freeze checkpoint for release target `v0.1.0`.
6. Only after Product/Scope Freeze, begin L2 Architecture Evidence.

No L2 Architecture work starts before Product/Scope Freeze.

## Review/provenance history

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md)
- [`product/PRD-v0.0-pre-review.md`](product/PRD-v0.0-pre-review.md)
- [`reviews/2026-10-01-adversarial-review.md`](reviews/2026-10-01-adversarial-review.md)
- [`product/PRD-v0.1-draft.md`](product/PRD-v0.1-draft.md)
- [`product/PRD-v0.2-draft.md`](product/PRD-v0.2-draft.md)
- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.3-review-candidate.md`](product/PRD-v0.3-review-candidate.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.4-review-candidate.md`](product/PRD-v0.4-review-candidate.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md)
- [`product/PRD-v0.4.1-review-candidate.md`](product/PRD-v0.4.1-review-candidate.md)
- [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)

## Current product hierarchy under review

```text
Targeted resource acquisition
+
Explicit bounded collection acquisition
+
Human-assisted when necessary
+
Template-first deterministic execution
+
Independent validation
+
Bounded AI fallback
```

This is Stage 1 product content under review, not Frozen authority yet.
