# xDownload Product Documentation Index

This directory preserves the initial product-definition baseline for xDownload.

## Current document

- [`product/PRD-v0.1-draft.md`](product/PRD-v0.1-draft.md) — current regenerated PRD draft after adversarial review. This is the latest product-direction document in this baseline, but it is **not Product Frozen** and **not Architecture Frozen**.

## Historical / provenance documents

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md) — chronological synthesis of the product discussion: LLM sniffing, DownloadPlan/Recipe split, Harness framing, L1 conclusions, adversarial-review corrections, current thesis and open decisions.
- [`product/PRD-v0.0-pre-review.md`](product/PRD-v0.0-pre-review.md) — preserved pre-review product-direction/L1-derived draft. Superseded, retained for provenance.
- [`reviews/2026-10-01-adversarial-review.md`](reviews/2026-10-01-adversarial-review.md) — adversarial review that challenged the pre-review draft and drove the current product hierarchy.

## Document lineage

```text
Discussion
   ↓
Pre-review product direction / L1-derived draft
   ↓
Adversarial review
   ↓
PRD v0.1 Draft
```

## Current hierarchy

The current working hierarchy is:

```text
Product success
= convenient, correct, reliable downloading

Harness success
= deterministic tools + reusable knowledge + bounded reasoning + validation

AI success
= incremental value on knowledge gaps

Shared Recipe success
= optional higher-level network effect
```

Cross-user Recipe sharing is not a prerequisite for basic product success.

## Freeze state

- Product Freeze: **NO**
- Architecture Freeze: **NO**
- Next stage in current PRD: product experiment + independent PRD review, followed by Product Freeze if gates are satisfied.
