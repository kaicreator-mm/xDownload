# xDownload Stage 0 — Intake / Baseline

Status: ACTIVE

Authority: pinned `kaicreator-mm/ai-development-standard` from `.dev-standard/VERSION`.

## Scope

Establish the initial xDownload product definition and reach a truthful Stage 1 PRD/Scope Freeze checkpoint before any L2 Architecture work.

## Repository

- Repository: `kaicreator-mm/xDownload`
- Default branch: `main`
- Current Stage 1 working branch: `docs/product-baseline-2026-10-01`
- Baseline before ADS adoption: `a349b06cfb28c6d33a97241349a76ddb97b7d95b`
- Current checkpoint at creation of this Stage 0 record: `1bdea82bdb3e725d14ed0154305f746e8b9dcfd4`

## Target version / task

- Product release target version: `UNRESOLVED`
- PRD document version is not the product release version.
- Product release target MUST be selected before creating the Stage 1 Version Branch checkpoint.

## Integration Mode

- Selected mode: `Version Branch Mode`
- Integration branch pattern: `version/vX.Y.Z`
- Current docs branch is temporary planning/evidence work and is not the future implementation integration branch.

## Existing Product State

Durable artifacts include:

- product discussion/provenance records;
- PRD v0.0, v0.1, v0.2, v0.3, v0.4 review candidates/drafts;
- earlier adversarial review evidence;
- v0.4 Claude Fresh Independent Adversarial Review bound to exact HEAD `a349b06cfb28c6d33a97241349a76ddb97b7d95b` with `NEEDS_REVISION` / `PRODUCT_FREEZE_ELIGIBLE = NO`.

## Stage 1 Gaps

Before PRD/Scope Freeze, xDownload MUST complete the ADS Stage 1 requirements:

1. Formal L1 Product Evidence using the pinned `prompts/L1_PRODUCT_EVIDENCE.md` output structure, including current sources and counter-evidence.
2. A current PRD/Scope candidate that incorporates the durable product findings and review closure.
3. Explicit product problem, user behavior/business rules, scope/non-goals, release blockers, required gates and acceptance criteria.
4. Required independent adversarial product review on the current exact PRD subject, because `.dev-standard/PROJECT_OVERRIDES.md` makes this a Stage 1 requirement.
5. Resolution of all blocking product-review findings; unresolved non-blocking findings must be explicitly dispositioned.
6. Selection of the initial product release target version and creation of the corresponding `version/vX.Y.Z` Stage 1 checkpoint branch/commit.

## Known Blockers

- Formal L1 Product Evidence artifact is not yet present as a dedicated current Stage 1 artifact.
- Initial product release target version is not yet selected.
- Current PRD v0.4 review subject is `NEEDS_REVISION`; Product Freeze is forbidden.
- L2 Architecture, Task DAG and implementation are forbidden until Stage 1 PRD/Scope Freeze is complete.

## Required Evidence

Stage 1 closeout must leave durable GitHub evidence for:

- L1 Product Evidence;
- final PRD/Scope candidate;
- current exact-subject independent Product Review PASS;
- PRD/Scope Freeze decision/checkpoint;
- explicit downstream authority for required gates and acceptance criteria.

## Acceptance

Stage 0 is complete when the project has an immutable ADS pin, project overrides, durable Stage 0 facts, and a clear truthful route into Stage 1 without implying Product Freeze, Architecture Freeze, Validation PASS or Release readiness.
