# xDownload Product Documentation Index

This directory preserves the initial product-definition baseline for xDownload and its subsequent product-direction revisions.

## Current document

- [`product/PRD-v0.2-draft.md`](product/PRD-v0.2-draft.md) — current PRD draft. It keeps the download-tool-first hierarchy from v0.1 and adds **bounded collection acquisition** as a first-class product experiment: `AcquisitionIntent`, explicit scope, limited navigation, collection preview/selection, collection validation, and a formal boundary against general-purpose crawling. It is **not Product Frozen** and **not Architecture Frozen**.

## Historical / provenance documents

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md) — chronological synthesis of the initial product discussion: LLM sniffing, DownloadPlan/Recipe split, Harness framing, L1 conclusions, adversarial-review corrections, and the initial current thesis/open decisions.
- [`product/PRD-v0.0-pre-review.md`](product/PRD-v0.0-pre-review.md) — preserved pre-review product-direction/L1-derived draft. Superseded, retained for provenance.
- [`reviews/2026-10-01-adversarial-review.md`](reviews/2026-10-01-adversarial-review.md) — adversarial review that challenged the pre-review draft and drove the product-first hierarchy.
- [`product/PRD-v0.1-draft.md`](product/PRD-v0.1-draft.md) — post-adversarial-review PRD. Superseded by v0.2 after the product-boundary discussion about adopting crawler-like capabilities without becoming a general crawler.

## Document lineage

```text
Discussion
   ↓
Pre-review product direction / L1-derived draft
   ↓
Adversarial review
   ↓
PRD v0.1 Draft
   ↓
Crawler-boundary / collection-acquisition discussion
   ↓
PRD v0.2 Draft (current)
```

## Current product hierarchy

```text
Product success
= convenient, correct, reliable acquisition of user-targeted resources

Collection success
= bounded discovery reduces manual finding/clicking/organization work

Harness success
= deterministic tools + reusable knowledge + enforced scope + validation

AI success
= incremental value on knowledge gaps and semantic ambiguity

Shared Recipe success
= optional higher-level network effect
```

xDownload's current user mental model remains a **download tool**, not a crawler. Crawler-like observation/navigation capabilities are permitted only as bounded Harness Tools under an explicit AcquisitionIntent and ExplorationScope.

Cross-user Recipe sharing is not a prerequisite for basic product success.

## Freeze state

- Product Freeze: **NO**
- Architecture Freeze: **NO**
- Current next stage: Product Experiment (including Collection Corpus) + Fresh Independent PRD Review, followed by Product Freeze if the gates are satisfied.
