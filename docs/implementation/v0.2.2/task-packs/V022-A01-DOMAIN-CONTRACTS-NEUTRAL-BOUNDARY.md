# Task Pack — V022-A01 Neutral Host Contracts / Dependency Boundary

> Status: proposed after A00 source audit; independent Task Pack review required. This Task Pack does not authorize source mutation until the current WIP base and accepted ADS Claim are read back.
>
> Parent tracking: xDownload #337  
> Formal Task Issue: xDownload #335  
> Upstream: DomainHarness #1465 / PR #1466 / #1392  
> Audit: docs/architecture/v0.2.2/A00_DOMAIN_PACKAGE_ARCHITECTURE_AUDIT_R1.md

## Contract

- Task ID: V022-A01-DOMAIN-CONTRACTS-NEUTRAL-BOUNDARY
- Version: v0.2.2 successor
- Integration target: wip/v0.2.2-ui-rebuild-r0 only
- Planning source baseline: 9e3ccd382311619e60b8d2a7373e8a7d34733334
- Review policy: required
- Risk: medium
- Execution profile: implementation Builder selected by current ADS admission; Local Agent may implement or repair if its own Claim authorizes it
- Validation scope: neutral C/Host contract design, schema exactness, compatibility and negative validation

## Goal

Create the narrow neutral contract surface required for Domain App and trusted Host to communicate without either package importing the other's implementation or deep source paths.

## Design boundary

The existing App Business Intent and K/S/B/C declarations remain owned by download-domain-app. Do not wholesale move the App contract package into domain-contracts.

The neutral contract package contains only the cross-boundary Host operation contract needed by both App and Host, including as justified by the source audit:

1. Host-facing direct-acquisition request DTO and exact validator.
2. Host-facing S4/media-acquisition request DTO and exact validator, including the selection facts the Host must re-check.
3. Typed EffectEnvelope and MaterializedEvidence output contracts required by both sides.
4. Opaque targetRef grammar / raw-locator negative helper where shared by App and Host.
5. Narrow shared port types only where both packages need the same type.

Keep the following in Domain App:
- Business Intent definitions and user-confirmation semantics.
- K/S/B/C declarations and operation vocabulary.
- Route-table/BUILD validation.
- Business policy and Workflow definitions.
- Domain-specific orchestration and semantic recipe.

Do not duplicate validators in App and Host. App must explicitly project validated Business Intent into the narrow Host operation DTO. Host independently validates that DTO before any physical effect.

## Allowed write set

- packages/domain-contracts/src/download-host/**
- packages/domain-contracts/src/index.ts (additive export only)
- packages/domain-contracts/test/download-host/**

No App, Host, Core Runtime, UI, package manifest, lockfile, CI, SDK, or vendored source changes in this Task. The App/Host consumers will be migrated in later independent Tasks.

## Required outcomes

1. New neutral types have exact, bounded, no-widening schemas.
2. Direct and S4/media request DTOs contain only fields required by the Host operation; no UI-only or Agent-only fields.
3. Host-side validation can reject malformed, unknown, raw-locator, path-escape, digest, and stale/invalid S4 selection inputs before I/O.
4. EffectEnvelope and MaterializedEvidence semantics remain unchanged: accepted/running are non-terminal; only typed terminal outcomes settle; evidence remains digest-backed and output-root bounded.
5. No permit, Journal, K, scheduler, registry storage, filesystem, network, or execution implementation is added to Contracts.
6. Existing App public exports and business intent semantics are not changed in this Task.
7. No new dependency is added; the package remains pure and I/O-free.

## Required tests

- Exact key acceptance and unknown-key rejection.
- Missing/invalid field rejection and bounded lengths.
- Raw URL/path rejected as targetRef.
- Output-root traversal and artifact escape rejected.
- Digest and byte-count grammar enforced.
- S4 selection tuple, rendition, expiry and digest validation fail closed.
- EffectEnvelope accepted/running cannot be interpreted as terminal success.
- MaterializedEvidence cannot widen the confirmed output root.
- Tests prove the neutral package has no imports from App, Host, Core Runtime, Node filesystem, network or DomainHarness SDK.

## Required gates

- Re-read current WIP HEAD/tree and this Task Pack before mutation.
- Publish and read back the Builder's accepted ADS DISPATCH_CLAIMED for this exact Task and write set.
- Node 24 syntax preflight and changed-file Prettier before CI.
- Focused domain-contracts tests.
- pnpm run typecheck and pnpm run ci:verify.
- Local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA review.

## Stop conditions

- Any need to move Business Intent ownership, change K/S/B/C IDs, alter Product/L2 behavior, or widen Provider/permission/IPC/network scope.
- Any attempt to move all App contracts into the neutral package.
- Any need for Contracts to import Node APIs, Host, App, Core Runtime or DomainHarness SDK.
- Any attempt to add a second validator with divergent semantics.
- Any write outside the allowed paths, stale base, missing Claim or concurrent writer.

## Explicit non-authorization

No App/Host/Core implementation, package manifest or lockfile changes; no SDK/ABI change; no v0.2.1/main mutation; no release, deployment, real external download, Windows registry or Native Host side effect.
