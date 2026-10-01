# xDownload

xDownload is an intelligent download tool whose internal implementation thesis is a **Download Domain Harness**.

The user-facing goal is to make it easier to **discover, select, acquire, validate, and organize** network resources the user can access. xDownload is not designed as a general-purpose crawler or as a fully autonomous AI agent.

Its current product strategy is:

- **Template-first** for the common, bounded download patterns;
- **Human-in-the-loop when useful**, rather than treating user confirmation as failure;
- **LLM-on-gap** for template adaptation and limited semantic ambiguity;
- crawler-like observation/navigation only for an explicit target Collection with a provable or user-declared membership relationship.

## Current product baseline

- [Documentation index](docs/README.md)
- [Current PRD v0.3 Review Candidate](docs/product/PRD-v0.3-review-candidate.md)
- [v0.2 Fresh Independent Adversarial Review](docs/reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [Previous PRD v0.2 Draft](docs/product/PRD-v0.2-draft.md)
- [Previous PRD v0.1 Draft](docs/product/PRD-v0.1-draft.md)
- [Discussion record](docs/DISCUSSION_RECORD_2026-10-01.md)

## Current product direction

```text
Single resource acquisition
+
Current-page smart discovery
+
Explicit bounded collection acquisition
+
AUTO / ASSISTED / MANUAL_SELECTION
+
Template-first execution
+
Bounded AI fallback
```

Collection admission requires an identifiable target, a membership relationship, understandable scope, a hard stop, and no arbitrary discovery frontier. Boundedness alone is not sufficient to make a task an xDownload Collection task.

## Current status

- PRD v0.3 Review Candidate: **GENERATED**
- Product Freeze: **NO**
- Architecture Freeze: **NO**
- L2 eligibility: **NO**
- Next stage: Fresh Independent Product Re-Review of the exact v0.3 SHA against the v0.2 review findings and C01–C22 counterexamples.

The repository is intended to evolve as a monorepo once implementation begins; the module layout in product documents remains a product-boundary hypothesis until L2 Architecture Freeze.
