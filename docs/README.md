# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: checkpointed in [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: ACTIVE
- Formal L1 Product Evidence: COMPLETE / checkpointed
- Current PRD/Scope candidate: `PRD-v0.4.1-review-candidate.md`
- Product Freeze: NO
- Architecture Freeze: NO
- L2 eligibility: NO
- Task DAG: NOT STARTED
- Implementation: NOT STARTED

The PRD document revision is not the product release version. The initial product release target selected by the current candidate is `xDownload v0.1.0`.

## Current Stage 1 evidence

- [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md) — formal ADS L1 Product Evidence. Recommendation: **PROCEED WITH NARROWING + REFRAME**.
  - Basic transport, browser sniffing and AI/MCP control already exist in strong products.
  - xDownload focuses on targeted resource acquisition, explicit bounded collections, Human-in-the-loop when necessary, validation, Template-first execution and bounded AI-on-gap.
  - Product value, AI increment, local knowledge compounding and shared knowledge remain separate hypotheses/gates.
  - Economic benefit remains `NOT_MEASURED`.

## Current Product/Scope review subject

- [`product/PRD-v0.4.1-review-candidate.md`](product/PRD-v0.4.1-review-candidate.md) — current complete, self-contained ADS Stage 1 Product/Scope Review Candidate.
  - supersedes v0.3/v0.4 as the current PRD subject;
  - initial product release target: `v0.1.0`;
  - includes complete AcquisitionContract, Collection admission, Scope Grammar, SelectionSnapshot, Budget domains and precedence, multi-dimensional Result Model, CoverageTarget, typed Evidence/User Confirmation, UI/CLI contracts, concrete S1–S6 release support slices, Product Gates, C01–C34, Critical Journeys, release blockers and finding closure matrices.

## Durable review evidence

- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)

The latest completed review is v0.4 at exact HEAD `a349b06cfb28c6d33a97241349a76ddb97b7d95b`, verdict `NEEDS_REVISION`, `PRODUCT_FREEZE_ELIGIBLE = NO`. v0.4.1 is the successor subject and has not yet been independently reviewed.

## Stage 1 required next actions

Per the pinned ADS Development Workflow:

1. Formal L1 Product Evidence — **COMPLETE**.
2. Successor PRD/Scope candidate — **COMPLETE: v0.4.1 Review Candidate**.
3. Fresh Independent Product/Scope Review on the current exact v0.4.1 subject — **NOT RUN**.
4. If and only if the required review returns PASS with no blocking Product findings, create the Stage 1 Product/Scope Freeze checkpoint for release target `v0.1.0`.
5. Only after that checkpoint, begin L2 Architecture Evidence.

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
