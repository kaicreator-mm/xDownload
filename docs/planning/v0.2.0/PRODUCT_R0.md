# xDownload v0.2.0 — Product/Scope R0 (frozen R1)

STATUS=FROZEN v0.2.0 R1 — receipt: docs/implementation/v0.2.0/FREEZE_RECEIPT_R1.md (freeze merge SHA recorded in #188 freeze receipt comment)
OWNER_ISSUE=#188
STANDARD=ADS 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
PRODUCT_RELEASE_TARGET=v0.2.0
INTEGRATION_MODE=version-branch-after-v0.1-qualified-release
PLANNING_REF=planning/v0.2-domain-app
RELEASE_GATE=NOT_RUN

## Baseline and value (Stage 0 / semantic L1)

- Source inspected: xDownload `version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2`; inherited v0.1 Product is frozen under ADS 4.0.0. The old Review Candidate file's inline historical status is not the final v0.1 freeze authority.
- Existing pnpm monorepo with `apps/cli`, `apps/browser-extension`, `packages/domain-contracts`, `packages/core-runtime`, `packages/core-scheduler`, `packages/persistence-ledger`, `packages/direct-acquisition`, `packages/hls-vod-adapter`, discovery/AI modules. The version/v0.1.0 branch is still shipping work; R0 uses an immutable *research baseline*, NOT a final release package.
- Product problem unchanged: users acquire a user-declared authorized single target/finite collection without manual extraction, false success, uncontrolled exploration or disproportionate cognitive effort. Value chain: Discover → Select → Acquire → Validate → Organize.
- v0.2 aims at reliable product evolution and Agent integration by migrating the **control plane** to one selected DomainHarness Domain App. This is an implementation/maintenance strategy, not an excuse to redefine users' intended targets.

## Accepted direction, proposed Product scope

1. Existing supported user jobs (S1 direct, S2 current-page attachment, S3 confirmed media, S4 supported HLS VOD, S5 finite current-page set and S6 bounded explicit collection) remain *parity targets* to the extent they are actually implemented and qualified in the latest v0.1 release. Do NOT assume a currently unqualified v0.1 journey is released just because a module exists. Baseline qualification inventory is an explicit v0.2 intake deliverable.
2. One user intent can be submitted, confirmed when needed, observed, cancelled/retried within budget and tracked to validated materialized files. Display ACCEPTED/RUNNING/UNKNOWN/FAILED/COMPLETED faithfully, preserving multi-dimensional evidence and no false artifact acceptance.
3. DomainHarness v0.10.3 is the target frozen Domain App contract/SDK ABI (K/S/B/C/Host and public BUILD, load/send/query/subscribe/stop). **Start planning/PoC before final publication**; final v0.10.3 package/tag pin must be requalified before distribution. No v0.10.2 fallback.
4. Existing download engines, security validation and file-transfer data plane are reused. K controls admission/effects/durable workflow authority. User-visible CLI/browser behavior evolves by adapter migration, not an arbitrary new surface or universal command gateway.
5. S handles known Recipe and bounded discovery; optional LLM advisory can propose choices but never expand scope, authorize external effects or auto-generate grants. Default deterministic route needs zero LLM.
6. Migration is gradual with per-lineage single authority: old Core may continue owning explicitly old v0.1 work, new K owns only admitted v0.2 lineages. No two concurrently authoritative writers for one lineage; no irreversible data migration until reviewed reconciliation/rollback.

## Out of scope / explicit cost controls

- No download engine rewrite, universal crawler, unsupported sites, DRM/access bypass, forced general web automation, new cloud service, new public REST API, speculative distributed scheduler, mandatory LLM or unlimited adaptive retries.
- Do not pull unresolved v0.1 security edge-case work into the new architecture without a demonstrated shared need; reuse mature OS/libs.
- Do not claim all v0.1 S1–S6 flows are production-ready without installed-path and release evidence; do not use PoC as a v0.1 release blocker.
- No blanket performance promises without measured old/new benchmark on the same host and fixture.

## Outcome-based acceptance for future v0.2

| Key | Product capability | Release-relevant acceptance |
| --- | --- | --- |
| P01 | Correct single-target acquisition | Authorized target identity remains fixed; real bytes and content validation back COMPLETED |
| P02 | Faithful state | K/journal/replay and CLI/browser reports never convert ACCEPTED or UNKNOWN into success |
| P03 | Finite selection/collection | Only declared members/approved continuation; no browsing/LLM expansion |
| P04 | Crash/cancel/recovery | No unreviewed duplicate transfer/accepted file or synthetic ACK after restart |
| P05 | User-facing parity | Each release-claimed v0.1 job has a measurable installed-path regression matrix on v0.2 |
| P06 | Offline/deterministic option | Core job works without a configured LLM Provider |
| P07 | Security / least authority | K permit, trusted Host, network/auth/path confinement and negative tests deny unauthorized effect |
| P08 | Performance / cost | Compare identical baseline tasks; document overhead, wall-clock and developer maintenance tradeoff; owner adjudicates material regression |
| P09 | Adopted SDK | Exact v0.10.3 source/build/package hashes, clean consumer, ABI and packaged-host platform proof |

## Mandatory handoff and independent gates

- Architecture-critical PoC in #183 (one K authoritative state, permit -> existing DirectHttpAdapter, durable budget/UNKNOWN, negative cases) is presently NOT_RUN. Source-only examples cannot substitute.
- Product Reviewer: fresh independent R1 on exact R0 source, existing v0.1 Product and impact; P0/P1/P2. Product authority must explicitly freeze after acceptable review; review cannot freeze itself.
- L2 Freeze requires critical UNKNOWN disposition/evidence, especially the budget-ledger and old/new migration boundary; don't freeze around unknowns.
- Future Task/PR Review policies are risk-based, but K authorization, public API, migration, persistence and cross-boundary integrations require independent review.
- v0.2 Release requires candidate and installed-path visible/hidden/closure/RQ, not reuse of old v0.1 or PoC PASS.

## Stage-0 Materiality Inventory (inspection-limited)

| Subject/path | Inspected immutable source | Observed class | Epistemic / currentness | Route |
| --- | --- | --- | --- | --- |
| `packages/direct-acquisition/src/port.ts` | version/v0.1.0 blob read 2026-10-29 | budget/data-plane input contract PRESENT | PRESENT on inspected v0.1 snapshot; future v0.2 drift UNKNOWN | L2 budget design |
| `packages/core-runtime/src/budget-bridge.ts` | version/v0.1.0 snapshot read 2026-10-29 | existing scheduler budget writer PRESENT | PRESENT for inspected snapshot, not migration-qualified | L2 migration decision |
| `packages/microkernel/src/domain-app.ts` (DomainHarness) | version/v0.10.3 snapshot read 2026-10-29 | public load/send/query/subscribe contract PRESENT | PRESENT at selected snapshot; final package UNKNOWN | PoC + RQ re-pin |
| Future v0.2 source | not created / not inspected | material classes UNKNOWN | UNKNOWN | Task/Reviewer per diff |

## Verdict at this checkpoint

PRODUCT_R0_READY_FOR_INDEPENDENT_REVIEW=YES
PRODUCT_FREEZE=NO
SDK_CANDIDATE_RELEASE=NOT_RUN
SOURCE_IMPLEMENTATION=NOT_STARTED
