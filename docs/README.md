# xDownload Product Documentation Index

xDownload follows the immutable `kaicreator-mm/ai-development-standard` revision pinned in `/.dev-standard/VERSION`.

## ADS lifecycle state

- Stage 0 Intake/Baseline: **CHECKPOINTED** — [`planning/STAGE0_INTAKE.md`](planning/STAGE0_INTAKE.md)
- Stage 1 Product/Scope: **FROZEN**
- Frozen Product/Scope authority: [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- Formal L1 Product Evidence: **COMPLETE / checkpointed** — [`product/L1_PRODUCT_EVIDENCE.md`](product/L1_PRODUCT_EVIDENCE.md)
- Stage 1 Freeze record: [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- Product release target: `v0.1.0`
- Stage 2 L2 Architecture Evidence: **ACTIVE / candidate available** — [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
- Architecture UNKNOWN disposition: **DEMO_REQUIRED**
- Required Research Demos: **Issue #7 and Issue #8 — CREATED / NOT EXECUTED by the L2 Builder**
- Architecture Freeze: **NO**
- Task DAG: **NOT STARTED**
- Implementation: **NOT STARTED**

The PRD document revision is not the product release version. The current integration/checkpoint branch is `version/v0.1.0`.

## Frozen Stage 1 authority

The Frozen Product/Scope preserves the product thesis and rules defined by the reviewed v0.4.2 PRD, including targeted resource acquisition, explicit bounded collections, Human-in-the-loop where necessary, independent validation, Template-first deterministic execution, bounded AI fallback, immutable confirmed scope/snapshot semantics, lifecycle budgets and truthful multidimensional result semantics.

Downstream Architecture or implementation work may not mutate those Product semantics for convenience. Product Review PASS is assurance evidence only; it is not executable Validation, Architecture Freeze, Version Closure or Release PASS.

## Stage 2 L2 Architecture Evidence

[`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md) is the current **candidate / NOT FROZEN** L2 artifact.

Current disposition:

```text
MATERIAL_UNKNOWNS=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_DEMO_REQUIRED=2
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
RESEARCH_DEMO_ISSUES=7,8
```

Candidate architecture centers on one local authoritative Core Control Runtime shared by thin Desktop/CLI/Browser adapters, typed Evidence and canonical result projection, declarative bounded Recipe execution, protocol-specific acquisition adapters, and a local persistence/artifact boundary. These remain Architecture candidate decisions rather than Frozen facts.

Two material UNKNOWNs require separately executed ADS Research Demos before Architecture Freeze can be considered:

- **Issue #7** — E3 real SQLite + filesystem + process-kill/restart/idempotency/budget recovery evidence.
- **Issue #8** — E3 real browser extension + native messaging + scoped authorization broker / secret-boundary evidence.

The L2 Builder created those Research Demo contracts but did **not** execute them and did not claim runtime Validation PASS.

## Next lifecycle action

The next work is driven by the Architecture UNKNOWN dispositions:

1. execute Research Demo Issue #7 in its separately dispatched real-host research environment;
2. execute Research Demo Issue #8 in its separately dispatched real-browser research environment;
3. incorporate their exact-SHA PASS/FAIL/BLOCKED evidence into the current/successor L2 candidate;
4. dispatch a **fresh independent Architecture Review** on the exact resulting L2 subject;
5. only after required evidence and review may a separate Architecture Freeze decision be considered.

No Task DAG may be generated before L2 Architecture Freeze, and no implementation is authorized by the current Stage 2 candidate.

## Durable Product/Review history

- [`DISCUSSION_RECORD_2026-10-01.md`](DISCUSSION_RECORD_2026-10-01.md)
- [`reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md)
- [`reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`](reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md)
- [`product/PRD-v0.4.2-review-candidate.md`](product/PRD-v0.4.2-review-candidate.md)
- [`planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`](planning/STAGE1_PRODUCT_SCOPE_FREEZE.md)
- [`architecture/L2_ARCHITECTURE_EVIDENCE.md`](architecture/L2_ARCHITECTURE_EVIDENCE.md)
