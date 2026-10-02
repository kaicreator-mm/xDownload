# xDownload

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `.dev-standard/VERSION`.

## Current ADS lifecycle state

```text
Stage 0 Intake/Baseline: CHECKPOINTED
Stage 1 Product/Scope: ACTIVE
Formal L1 Product Evidence: COMPLETE
Current PRD/Scope candidate: PRD v0.4.1
Initial product release target: v0.1.0
Product Freeze: NO
Architecture Freeze: NO
L2: NOT ELIGIBLE
Task DAG: NOT STARTED
Implementation: NOT STARTED
```

The PRD document revision is separate from the product release target.

## Current Stage 1 documents

- [Documentation index](docs/README.md)
- [Formal L1 Product Evidence](docs/product/L1_PRODUCT_EVIDENCE.md)
- [Current PRD v0.4.1 Review Candidate](docs/product/PRD-v0.4.1-review-candidate.md)
- [v0.3 Fresh Independent Review](docs/reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [v0.4 Claude Fresh Independent Review](docs/reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)

## Current product thesis under review

```text
Reliable targeted resource acquisition
+
Explicit bounded collections
+
Human-assisted ambiguity resolution when necessary
+
Template-first deterministic execution
+
Independent validation
+
Bounded AI fallback
```

xDownload is not a general crawler and is not an AI-first downloader. Ordinary supported downloads must remain usable when the model is unavailable.

## Next ADS action

Run a Fresh Independent Product/Scope Review against the exact current v0.4.1 subject. Only a PASS with no blocking Product findings may proceed to the Stage 1 Product/Scope Freeze checkpoint for `v0.1.0`. L2 starts only after that checkpoint.
