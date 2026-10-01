# xDownload Product Documentation Index

This directory preserves the initial product-definition baseline for xDownload and its subsequent product-direction revisions.

## Current product document

- [`product/PRD-v0.3-review-candidate.md`](product/PRD-v0.3-review-candidate.md) — current **Review Candidate**. It revises v0.2 against the Fresh Independent Adversarial Review and adds a判定able acquisition contract: explicit target/membership, SelectionSnapshot, lifecycle budget, AcquisitionStatus/CoverageStatus separation, independent semantic evidence, Support Slices, confirmation protocol, Template-first execution, and first-class Human-in-the-loop modes (`AUTO / ASSISTED / MANUAL_SELECTION`). It is **not Product Frozen** and **not Architecture Frozen**.

## Current review baseline

- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md) — Fresh Independent Adversarial Product Review bound to PR #1 exact HEAD `7007e0db2933163ddd09531769db6b866cb6b805`. Verdict: **NEEDS_REVISION**. Findings: **P0 × 3 / P1 × 7 / P2 × 2**, plus the G0–G4 false-positive/false-negative matrix and 22 required counterexamples.

## Historical / provenance documents

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md) — initial discussion synthesis.
- [`product/PRD-v0.0-pre-review.md`](product/PRD-v0.0-pre-review.md) — pre-review historical product-direction/L1-derived draft.
- [`reviews/2026-10-01-adversarial-review.md`](reviews/2026-10-01-adversarial-review.md) — first adversarial review that drove the product-first hierarchy.
- [`product/PRD-v0.1-draft.md`](product/PRD-v0.1-draft.md) — post-first-review PRD.
- [`product/PRD-v0.2-draft.md`](product/PRD-v0.2-draft.md) — bounded-collection PRD reviewed by the 2026-10-02 Fresh Independent Adversarial Review; superseded as current candidate by v0.3.

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
NEEDS_REVISION
   ↓
PRD v0.3 Review Candidate (current)
```

## Current product hierarchy

```text
Product success
= convenient, correct, reliable targeted resource acquisition

Collection success
= explicit target + provable membership + bounded traversal + truthful coverage

Interaction strategy
= automate when reliable; ask the user when confirmation materially resolves ambiguity

Harness success
= Template-first deterministic execution + enforced scope + independent validation

AI success
= incremental value on knowledge gaps / template adaptation

Shared Recipe success
= optional higher-level network effect
```

xDownload remains a **download tool**, not a general crawler. Crawler-like observation/navigation is admitted only for an identifiable target Collection with a provable or user-declared membership relation; boundedness alone is not sufficient.

## Freeze state

- PRD v0.3 Review Candidate: **GENERATED**
- Product Freeze: **NO**
- Architecture Freeze: **NO**
- L2 eligibility: **NO**
- Next stage: freeze the v0.3 exact SHA as the review target, then run a Fresh Independent Product Re-Review against F01–F12 and C01–C22. Product Freeze requires a later independent `PASS` with `PRODUCT_FREEZE_ELIGIBLE = YES`.
