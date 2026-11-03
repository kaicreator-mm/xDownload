# Task Pack — V022-A00 Architecture Inventory & Authority Audit

> Status: read-only audit completed by Web Builder; independent review pending. This Task Pack is not a source implementation Claim and does not authorize source mutation.
>
> Parent tracking: xDownload #337  
> Audit report: docs/architecture/v0.2.2/A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md

## Contract

- Task ID: V022-A00-ARCHITECTURE-INVENTORY-AUTHORITY-AUDIT
- Version: v0.2.2 successor
- Integration target: wip/v0.2.2-ui-rebuild-r0
- Exact source baseline: 9e3ccd382311619e60b8d2a7373e8a7d34733334
- Source tree: ba48b805697ad19c36a6eb3a5e54b6d601b36120
- Review policy: required
- Risk: medium
- Execution mode: WEB_BUILDER / read-only source audit
- Validation scope: package graph, source imports, Core composition, Lineage authority and physical store ownership

## Goal

Produce an evidence-backed source inventory and authority decision record before freezing A01–A04 implementation write sets.

## Read-only scope

Inspect:
- App / Host / Contracts / Core package manifests.
- App→Host and Host→App import edges.
- Core Runtime production composition and deep source imports.
- App public root exports and all identified alternate runtime assemblers.
- RouteLog CLAIM / ATTEMPT / OUTCOME.
- K Effect Journal / Permit and Core Seam Journal boundaries.
- T09 LineageLedger and PlainFileLineageStore production call sites.
- FileCasDocStore and physical store ownership.
- Existing Node 24 and repository verification scripts.

## Allowed write set

Only:
- docs/architecture/v0.2.2/A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md
- this Task Pack and planning metadata on the architecture planning branch

No source, package manifest, lockfile, test, CI, SDK, WIP, version, or main mutation.

## Required outputs

1. Exact source baseline and evidence inventory.
2. Package manifest dependency graph.
3. App / Host import-boundary matrix.
4. Core Runtime call graph and public App export inventory.
5. K / Seam Journal / RouteLog / T09 LineageLedger authority matrix.
6. Physical store ownership and CAS proof boundaries.
7. Explicit A01–A04 decisions, unresolved items and stop conditions.

## Completion result

The audit report records:
- Confirmed App↔Host manifest cycle.
- Confirmed App→Host and Host→App deep imports.
- Core Runtime as the active Domain App composition root with deep imports.
- App root exports of physical store/runtime assembly.
- RouteLog CLAIM as current new-K route ownership fact; ATTEMPT as route history; OUTCOME derived from K receipt.
- T09 LineageLedger exported but no active Core Runtime production caller found in the inspected baseline.
- FileCasDocStore as active physical SDK V10DocStore adapter currently in App.
- Multi-process SQLite CAS remains NOT_PROVEN.

## Stop conditions

- Any proposal to change Product/L1, L2, SDK ABI, K/S/B/C IDs, permissions, IPC, Provider or network scope.
- Any unsupported assertion that RouteLog and T09 are duplicate active production writers.
- Any proposal to auto-clear UNKNOWN or claim multi-process CAS without proof.
- Any source write or change to WIP, version/v0.2.1 or main.

## Review

Independent reviewer must verify the exact baseline and evidence paths. Review is read-only. A00 completion does not itself dispatch A01–A04; each implementation Task requires its own frozen Task Pack and accepted ADS Claim.
