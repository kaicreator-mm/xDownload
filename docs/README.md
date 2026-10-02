# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: ACTIVE / checkpointed in [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: ACTIVE
- Formal L1 Product Evidence: COMPLETE / checkpointed
- Product Freeze: NO
- Architecture Freeze: NO
- L2 eligibility: NO
- Task DAG: NOT STARTED
- Implementation: NOT STARTED

The PRD document version is not the product release version and is not itself a lifecycle state.

## Current Stage 1 evidence

- [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md) — formal ADS L1 Product Evidence using the pinned `prompts/L1_PRODUCT_EVIDENCE.md` structure. Recommendation: **PROCEED WITH NARROWING + REFRAME**.
  - Basic transport, browser sniffing and AI/MCP control are already represented by strong existing products.
  - xDownload's product thesis should focus on targeted resource acquisition, explicit bounded collections, Human-in-the-loop when necessary, validation, Template-first execution and bounded AI-on-gap.
  - Product value, AI increment, local knowledge compounding and shared knowledge remain separate unproven hypotheses/gates.
  - Economic benefit remains `NOT_MEASURED`.

## Current product subject

- [`product/PRD-v0.4-review-candidate.md`](product/PRD-v0.4-review-candidate.md) — latest committed PRD candidate currently reviewed as `NEEDS_REVISION`.
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md) — durable independent review evidence bound to exact reviewed HEAD `a349b06cfb28c6d33a97241349a76ddb97b7d95b`; verdict `NEEDS_REVISION`, `PRODUCT_FREEZE_ELIGIBLE = NO`.

## Stage 1 required next artifacts

Per the pinned ADS Development Workflow, xDownload must complete before Product Freeze:

1. formal current L1 Product Evidence — **COMPLETE**;
2. a successor PRD/Scope candidate incorporating the L1 evidence and durable review closure;
3. explicit problem, user behavior/business rules, scope/non-goals, release blockers, required gates and acceptance criteria;
4. current exact-subject independent adversarial Product Review PASS, required by project override;
5. Product/Scope Freeze checkpoint on the selected initial product version branch.

No L2 Architecture work starts before that Freeze checkpoint.

## Review/provenance history

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md)
- [`product/PRD-v0.0-pre-review.md`](product/PRD-v0.0-pre-review.md)
- [`reviews/2026-10-01-adversarial-review.md`](reviews/2026-10-01-adversarial-review.md)
- [`product/PRD-v0.1-draft.md`](product/PRD-v0.1-draft.md)
- [`product/PRD-v0.2-draft.md`](product/PRD-v0.2-draft.md)
- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.3-review-candidate.md`](product/PRD-v0.3-review-candidate.md)
- [`product/PRD-v0.4-review-candidate.md`](product/PRD-v0.4-review-candidate.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md)

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

This is product content under Stage 1 review, not Frozen authority yet.
