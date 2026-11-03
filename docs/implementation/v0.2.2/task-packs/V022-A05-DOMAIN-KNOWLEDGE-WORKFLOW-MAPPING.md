# Task Pack — V022-A05 Domain Knowledge & Workflow Mapping

> Status: documentation-only Task Pack proposed after A00 source audit. It does not authorize source mutation or Product/L2 changes.
>
> Parent tracking: xDownload #337
Formal Task Issue: xDownload #339  
> A00 audit: xDownload #338  
> Upstream: DomainHarness #1465 / PR #1466 / #1392

## Contract

- Task ID: V022-A05-DOMAIN-KNOWLEDGE-WORKFLOW-MAPPING
- Version: v0.2.2 successor
- Integration target: planning/v0.2.2-domain-package-architecture-r0
- Source reference baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334
- Review policy: required
- Risk: low
- Execution profile: WEB_BUILDER / documentation
- Validation scope: traceability of Domain Knowledge, authority, schemas, Workflow definitions, Functions/Tools and validation evidence

## Goal

Create a lightweight, source-linked Domain Package map that makes the existing xDownload Domain App understandable and auditable without introducing a new runtime, DSL, package or abstraction layer.

## Allowed write set

Only:
- docs/architecture/v0.2.2/domain-package/DOMAIN_PACKAGE_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_GLOSSARY.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_AUTHORITY.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_WORKFLOW_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_FUNCTION_TOOL_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_VALIDATION_MAP.md

No source, manifest, lockfile, tests, CI, SDK, WIP, version, main, Product/L1 or L2 changes.

## Required content

1. Package map: Contracts, Domain App, Host and Core Runtime ownership.
2. Glossary: Lineage, targetRef, Permit, Effect, MaterializedEvidence, Coverage, UNKNOWN, Workflow, Business Intent, C Operation, Core Seam.
3. Authority map: K Effect Journal/Permit, Core Seam Journal, RouteLog CLAIM/ATTEMPT/OUTCOME, T09 LineageLedger, physical stores and their current active/dormant status.
4. Workflow map: direct acquisition, S4 HLS VOD, S2 discovery/attachment, S3 media, S5 current-page collection and S6 explicit collection/navigation.
5. Function/Tool map: distinguish exported functions, BUILD entrypoints, Business Intents, C Operations, K Query/Subscription, UI Journey and Agent Tools. Do not invent an Agent Tool.
6. Validation map: exact source test paths and what they prove; separate source/fixture evidence from real browser, Electron, Windows and Woodpecker evidence.

## Required discipline

- Every architectural claim links to an exact source path and, where useful, line range or commit baseline.
- Mark status honestly: FROZEN, CURRENT, DERIVED, TESTED, NOT_RUN, NOT_PROVEN or DORMANT.
- Distinguish policy from implementation, and function from tool.
- Do not treat a test fixture as a production call site.
- Do not treat an exported module as an active runtime.
- Do not treat Core route OUTCOME as K Effect Journal truth.
- Do not describe RouteLog CLAIM as merely a disposable projection.
- Do not claim multi-process CAS.
- Keep the existing DomainHarness v0.10.3 source and SDK bytes unchanged.

## Acceptance

- Six documents are internally consistent and cross-linked.
- No duplicate or contradictory authority claims.
- No new runtime or DSL is introduced.
- All source references point to the A00 exact baseline or are explicitly marked as later evidence.
- No Product/L2 scope is widened.

## Review

Independent documentation review required. This task is disjoint from A01's neutral-contract source write set and may proceed in parallel after A00 audit currentness/review.


## Documentation draft completion (2026-11-03)

The six requested documents have been created on the planning branch at exact HEAD `3b22c1cef7e1ee12e21623ab9fa207c55e660263`:

- docs/architecture/v0.2.2/domain-package/DOMAIN_PACKAGE_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_GLOSSARY.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_AUTHORITY.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_WORKFLOW_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_FUNCTION_TOOL_MAP.md
- docs/architecture/v0.2.2/domain-package/DOMAIN_VALIDATION_MAP.md

Status: documentation drafted; independent review pending. No source or Product/L2 files changed.