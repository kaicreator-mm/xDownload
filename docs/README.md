# xDownload Product Documentation Index

This directory preserves the initial product-definition baseline for xDownload and its subsequent product-direction revisions.

## Current product document

- [`product/PRD-v0.2-draft.md`](product/PRD-v0.2-draft.md) — current PRD draft. It keeps the download-tool-first hierarchy from v0.1 and adds **bounded collection acquisition** as a first-class product experiment: `AcquisitionIntent`, explicit scope, limited navigation, collection preview/selection, collection validation, and a formal boundary against general-purpose crawling. It is **not Product Frozen** and **not Architecture Frozen**.

## Current review status

- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md) — Fresh Independent Adversarial Product Review bound to PR #1 exact HEAD `7007e0db2933163ddd09531769db6b866cb6b805`. Verdict: **NEEDS_REVISION**. Findings: **P0 × 3 / P1 × 7 / P2 × 2**, plus the G0–G4 false-positive/false-negative matrix and 22 required counterexamples. This review blocks Product Freeze for v0.2 but does not reject the Bounded Collection product hypothesis.

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
PRD v0.2 Draft
   ↓
Fresh Independent Adversarial Product Review
   ↓
NEEDS_REVISION → next product artifact: PRD v0.3 Draft
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
- v0.2 review verdict: **NEEDS_REVISION**
- Current next stage: revise the product contract into PRD v0.3, close F01–F10 at the requirements/experiment-design level (and constrain F11–F12 if deferred), then perform a Fresh Independent Product Re-Review on the new exact SHA. No L2 or Product Freeze before that review.
