# xDownload

xDownload is an intelligent download tool whose internal implementation thesis is a **Download Domain Harness**.

The user-facing goal is to make it easier to **discover, select, acquire, validate, and organize** network resources the user can access. xDownload may use crawler-like observation and limited navigation internally, but only under an explicit, bounded AcquisitionIntent; it is not intended to become a general-purpose crawler.

AI, Recipe reuse, shared knowledge, and crawler-like Tools are enhancement layers rather than substitutes for basic download quality.

## Current product baseline

- [Documentation index](docs/README.md)
- [Current PRD v0.2 Draft](docs/product/PRD-v0.2-draft.md)
- [Previous PRD v0.1 Draft](docs/product/PRD-v0.1-draft.md)
- [Discussion record](docs/DISCUSSION_RECORD_2026-10-01.md)
- [Pre-review historical draft](docs/product/PRD-v0.0-pre-review.md)
- [Adversarial review](docs/reviews/2026-10-01-adversarial-review.md)

## Current product direction

```text
Single resource download
+
Current-page smart discovery
+
Bounded collection acquisition
+
Bounded AI fallback
```

A collection acquisition must have explicit scope and stopping conditions. Unbounded site crawling, continuous monitoring, indexing, and general-purpose scraping are non-goals.

## Current status

- Product Freeze: **NO**
- Architecture Freeze: **NO**
- Current next stage: Product Experiment (including collection scenarios) + Fresh Independent PRD Review, then Product Freeze if the product gates are satisfied.

The repository is intended to evolve as a monorepo once implementation begins; the module layout in the PRD is a product-boundary hypothesis, not an architecture freeze.
