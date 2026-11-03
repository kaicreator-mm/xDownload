# Task Pack — V022-A01 Domain Package / Host Architecture Cleanup

> State: proposed for independent Task Pack review. This document is not a CAS Claim, Execution Pack, or permission to mutate source. The owner has approved inserting this bounded architecture cleanup into the v0.2.2 successor flow; execution still requires current ADS admission and the Builder's own accepted DISPATCH_CLAIMED.

## Contract

- Formal Task Issue: [xDownload #335](https://github.com/kaicreator-mm/xDownload/issues/335)


- Task ID: V022-A01-DOMAIN-PACKAGE-ARCHITECTURE-CLEANUP
- Version: v0.2.2 successor (WIP only)
- Parent: xDownload #305 UI successor / adjacent architecture lane
- Integration target: wip/v0.2.2-ui-rebuild-r0
- Merge target: wip/v0.2.2-ui-rebuild-r0 only
- Baseline SHA: 9e3ccd382311619e60b8d2a7373e8a7d34733334
- Baseline Tree: ba48b805697ad19c36a6eb3a5e54b6d601b36120
- Review policy: required
- Risk: high
- Execution profile: LOCAL_BUILDER / LOCAL (actual executor identity and claim must be published by the Local Builder)
- Validation scope: package architecture, K/Host authority, existing runtime regression and exact-SHA integration

## Goal

Apply the reviewed DomainHarness #1465 / PR #1466 function/Tool and Host boundaries to the existing xDownload implementation without changing user-visible behavior or SDK semantics.

## Exact source observations

- App manifest depends on Host; Host manifest depends on App.
- App composition imports Host DirectAcquisitionBridge / CanonicalBudgetLedger and implements FileCasDocStore.
- App S4 integration imports the Host HLS bridge.
- Host Direct Bridge imports validators/types through a deep App source path.
- App root exports physical Host store and runtime assembly functions.
- K Store/Journal/Permit, Core Seam Journal, RouteLog projection and T09 LineageLedger have different stated roles; no duplicate active production writer is presumed without call-graph evidence.
- CLI query maps to Core Seam READ_JOB_PROJECTION; subscribe is a typed refusal under the current Seam contract.

## Allowed write set

- packages/download-domain-app/**
- packages/download-domain-host/**
- packages/domain-contracts/** (only for genuinely shared neutral DTO/contract moves)
- packages/core-runtime/**
- tests directly under the above packages
- docs/architecture/v0.2.2/DOMAIN_PACKAGE_AUTHORITY_MAP_R0.md
- package manifests and pnpm-lock.yaml only when required by the package graph change

No UI renderer, Browser popup, Desktop Manager, Native Host manifest, permissions, installers, main, version/v0.2.1, or DomainHarness repository files.

## Required implementation outcomes

1. Break the App↔Host package dependency cycle. App declares K/S/B/C/Intent/Schema and pure business logic; it does not import Host implementation. Host implements C/Host ports and depends on neutral contracts rather than deep App source. Core Runtime is the sole production composition root.
2. Move physical V10DocStore/CAS and PlainFileLineageStore implementations, direct/HLS bridges and production runtime assembly out of the App package. Keep LineageLedger ownership policy and its narrow store port in the Domain App/domain layer; do not move the whole policy into Host or export Host implementations from the App root.
3. Preserve the selected K/S/B/C BUILD, operation IDs, public SDK APIs, permit gate, targetRef, budget, digest, atomic materialization, cancellation and existing direct/HLS behavior.
4. Prove exactly one production K and one business Writer for each new-K lineage.
5. Produce a fact-ownership matrix for K Store/Effect Journal/Permit, Core Seam Journal, RouteLog and T09 LineageLedger. Verify actual production use; do not delete/merge stores without evidence. RouteLog OUTCOME derived from K receipt must remain a read model. Keep LineageLedger policy separate from its physical PlainFileLineageStore Host adapter. UNKNOWN is never auto-cleared.
6. Keep Core Job Projection distinct from SDK K Query/Subscription. No fake subscribe support and no private Journal/SQLite scan.
7. Keep the exact DomainHarness v0.10.3 source and vendored tarball bytes unchanged.

## Required gates

- Re-read current WIP and task branch exact SHA/tree before mutation; publish and read back one accepted CAS Claim / DISPATCH_CLAIMED.
- Node >=24 syntax and type preflight before CI.
- Changed-file Prettier.
- Focused App/Host/Core package tests, including dependency-cycle and import-boundary negatives.
- Existing direct/HLS, restart, cancellation, duplicate, budget, digest, UNKNOWN and Core Seam tests.
- pnpm install --frozen-lockfile (if lock changes), pnpm run typecheck, pnpm run ci:verify.
- Local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA review; no self-review PASS.
- Re-read integration WIP SHA and rerun validation after integration.

## Stop conditions

- Any need to alter Product/L2 behavior, SDK ABI, public permissions, IPC, Host capabilities or download features.
- Any unproven second K/Writer, ambiguous Lineage owner, unsafe replay or UNKNOWN auto-clear.
- A required lockfile/source change outside the allowed write set.
- Missing accepted Claim, stale baseline, concurrent writer, or inability to prove exact-SHA evidence.

## Explicit non-authorization

No changes to main or version/v0.2.1; no release/tag/npm publication; no deployment; no real external download; no Windows registry/Native Host side effects; no DomainHarness SDK source change.
