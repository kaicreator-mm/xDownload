# xDownload Product Documentation Index

This directory preserves the xDownload product-definition trail and its adversarial review evolution.

## Current product document

- [`product/PRD-v0.4-review-candidate.md`](product/PRD-v0.4-review-candidate.md) — current Review Candidate.
  - Contract-hardening revision after v0.3 Fresh Independent Adversarial Review.
  - Does not expand product scope.
  - Adds deterministic contracts for RequestFulfillmentStatus, SelectionAcquisitionStatus, CoverageTarget, Evidence Claim Types, Budget Domains, Support Slice Contract, and Confirmation Protocol.
  - Product Freeze: NO.
  - Architecture Freeze: NO.

## Review baseline

- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
  - Bound to v0.2 exact HEAD `7007e0db2933163ddd09531769db6b866cb6b805`.
  - Verdict: NEEDS_REVISION.
  - Findings: P0 × 3 / P1 × 7 / P2 × 2.

- v0.3 Fresh Independent Adversarial Review
  - Introduced remaining contract-hardening requirements N01–N08.
  - v0.4 closes these through explicit product contracts.

## Historical / provenance documents

- `DISCUSSION_RECORD_2026-10-01.md`
- `product/PRD-v0.0-pre-review.md`
- `reviews/2026-10-01-adversarial-review.md`
- `product/PRD-v0.1-draft.md`
- `product/PRD-v0.2-draft.md`
- `product/PRD-v0.3-review-candidate.md`
- `product/PRD-v0.4-review-candidate.md`

## Document lineage

```text
Discussion
   ↓
Pre-review product direction
   ↓
Adversarial review
   ↓
PRD v0.1
   ↓
Bounded collection discussion
   ↓
PRD v0.2
   ↓
Fresh Independent Review
   ↓
PRD v0.3 Review Candidate
   ↓
Fresh Independent Review
   ↓
PRD v0.4 Review Candidate
```

## Current product hierarchy

```text
Targeted resource acquisition

+

Explicit bounded collection acquisition

+

Human-assisted when necessary

+

Template-first deterministic execution

+

Bounded AI fallback
```

xDownload remains a download tool, not a general crawler. Discovery and navigation are admitted only for an identifiable target Collection with explicit membership semantics, scope, and stopping conditions.

## Freeze state

- PRD v0.4 Review Candidate: GENERATED
- Product Freeze: NO
- Architecture Freeze: NO
- L2 eligibility: NO
- Next stage: Fresh Independent Product Freeze Re-Review against v0.4 exact SHA.
