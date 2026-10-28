# xDownload v0.2 — Source-first Scaffold (SF) specification / monorepo overlay R0

STATUS=STRUCTURAL_PLAN_READY; SOURCE_SCAFFOLD_NOT_ACCEPTED
OWNER=#188
SOURCE_WRITE_AUTHORIZATION=NO
PRODUCT_FREEZE=NO
L2_FREEZE=NO
SDK=v0.10.3-only (frozen ABI; actual package candidate SHA/hash at first build)
ISSUE_DEPENDENCIES=NOT_MATERIALIZED

## What is already a real scaffold

The immutable inspected v0.1 snapshot already includes a working pnpm monorepo with root package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig, ESLint, Vitest, apps/cli and apps/browser-extension, packages/domain-contracts/core-runtime/core-scheduler/persistence-ledger/direct-acquisition/hls-vod-adapter. Reuse those *real source files*; do not regenerate the root workspace or replace lockfile. Actual final v0.1 release commit must be re-read before starting v0.2 integration.

The following is a bounded **overlay blueprint** only. Paths marked NEW are not asserted to exist; even though the spec contains directory/file names, it is NOT an accepted source-first SF. ADS 4.18 Stage 2.4A requires Frozen Product/L2, separate planning-source admission, true current Claim and independent review for material source before protected source files can be created.

## Proposed target layout (source paths are anchors, not current source)

```text
xDownload/                                 # EXISTING pnpm Git monorepo
├── apps/
│   ├── cli/                               # EXISTING; task T07 owns v0.2 adapter
│   └── browser-extension/                 # EXISTING; task T08 owns v0.2 adapter
├── packages/
│   ├── domain-contracts/                  # EXISTING canonical product DTO; T01 additive only if proven necessary
│   ├── direct-acquisition/                # EXISTING transport engine; READ-ONLY reuse
│   ├── hls-vod-adapter/                    # EXISTING; READ-ONLY reuse
│   ├── discovery-recipe/                  # EXISTING; READ-ONLY reuse
│   ├── ai-proposal/                       # EXISTING; READ-ONLY reuse
│   ├── core-runtime/                      # EXISTING v0.1 authority; READ-ONLY until T09 migration plan
│   ├── core-scheduler/                    # EXISTING; no second mutable writer
│   ├── persistence-ledger/                # EXISTING; old lineage authority only
│   ├── download-domain-app/               # NEW selected Domain App authoring
│   │   ├── package.json                   # T02 creates; T13 later finalizes (sequential writers)
│   │   ├── src/
│   │   │   ├── contracts/                  # T01 typed intent/operation schema
│   │   │   ├── business/                   # T03 K-governed B policy
│   │   │   ├── semantic/                   # T05 recipe/advisory S
│   │   │   ├── migration/                  # T09 lineage authority decision
│   │   │   ├── composition/                # T11 S1 direct application join
│   │   │   ├── integrations/               # T12 non-direct convergence
│   │   │   └── index.ts                    # T13 exclusive public facade export
│   │   └── README.md                       # T13 packaged behavior, not fake release
│   └── download-domain-host/              # NEW Host/C adapter
│       ├── package.json                   # T02 creates; T13 later finalizes (sequential writers)
│       └── src/
│           ├── direct/                     # T04 trusted C/Host, no new transport
│           └── media/                      # T06 optional HLS C/Host
├── tests/
│   └── domain-app/                         # T10 fixtures and tests; validation state NOT_RUN
├── build/                                  # EXISTING; T13 single central-writer changes
├── .dev-standard/                          # v0.2 effective pin/overrides after adoption review
└── docs/
    ├── planning/v0.2.0/
    ├── architecture/v0.2.0/
    └── implementation/v0.2.0/
```

Never import DomainHarness BUILD into Microkernel/runtime. Trusted producer seals K/S/B/C from **selected, built, packed v0.10.3** public modules; runtime imports only Microkernel/Contracts and the selected package. Node24 required. Filesystem and network are Host-only; raw bytes stay outside K.

## Scaffold content contract (what local agent should create only after admission)

| Anchor | Kind | Exact proposed file/dir | Why it exists | Owner |
| --- | --- | --- | --- | --- |
| SF-01 | DTO source | packages/download-domain-app/src/contracts/ | confirmed targetRef, lineage, bounded acquisition Operation, terminal proof DTO (no raw model URL/path authority) | T01 |
| SF-02 | Early SDK/manifest bootstrap | packages/download-domain-app/package.json; packages/download-domain-host/package.json; minimal additive root package.json and pnpm-lock.yaml when needed | Build two private workspace package roots with exact selected v0.10.3 SDK public dependencies; clean Node24 consumer/lockfile, **before** B/C/Host lanes | T02 |
| SF-03 | Business | packages/download-domain-app/src/business/ | K-governed B rules, no self-grant, zero-model path | T03 |
| SF-04 | C direct | packages/download-domain-host/src/direct/ | only selected K Permit can call existing direct acquisition via trusted Host | T04 |
| SF-05 | S | packages/download-domain-app/src/semantic/ | existing recipe+finite collection and selection | T05 |
| SF-06 | C media | packages/download-domain-host/src/media/ | existing HLS adapter port, bounded source | T06 |
| SF-07 | CLI | apps/cli/src/ (scoped new adapter files) | external user operation and real status | T07 |
| SF-08 | Browser | apps/browser-extension/src/ (scoped new adapter files) | reuses existing auth and native Host, no cookie authority transfer | T08 |
| SF-09 | Migration | packages/download-domain-app/src/migration/ | old/new lineage ownership, recovery, schema truth | T09 |
| SF-10 | Tests | tests/domain-app/ | positive/negative inputs, independent fixture/validation harness | T10 |
| SF-11 | Direct join | packages/download-domain-app/src/composition/ | single K/B/C/Host direct activation end-to-end | T11 |
| SF-12 | Other join | packages/download-domain-app/src/integrations/ | collection/media/browser integration, no new crawler | T12 |
| SF-13 | Final BUILD / package integration | packages/download-domain-app/src/index.ts, packages/download-domain-app/README.md, build/** and post-T02 updates to both package manifests/root package.json/pnpm-lock.yaml only if needed | final manifest owner, only after T02 accepted and closed; one active writer per path | T13 |

**SF-01 through SF-13 are proposed structural anchors, not active source Claims**, not accepted source Git-object anchors. If source-first Scaffold becomes accepted, the Task-side DF binding must reference its *actual* commit and material tree and check both anchor→Task and Task→anchor with native Issue identities before Freeze. Don't fabricate immutable SF hashes for nonexistent directories.

## Negative cases for admitted Scaffold source

- Old Core or Host independently grants a new-K lineage -> refuse; no second business writer.
- BUILD with two K Primaries or unselected C or undeclared import -> typed refusal.
- No K effect permit -> zero download/network; accepted receipt is not materialized artifact.
- Credential/URL/path from Recipe/LLM expands frozen user authorization -> refuse.
- Lack of trusted SDK tarball or Node24 proof -> record NOT_RUN/BLOCKED; never pretend package is final v0.10.3.
- Missing/stale Claim or native blocked_by readback -> no protected source write.
- Tooling should not install Node dependencies or invoke network merely because manifest exists.

## Bootstrap prerequisite and manifest write succession (R1 P1-01 correction)

T01 (typed contract) must precede **T02 minimal SDK/workspace bootstrap**. T02, not late T13, creates the two workspace package manifests and only necessary root dependency/lockfile deltas. Its Node24 clean-consumer acceptance is a precondition for the B/C/Host/CLI/browser source concerns T03–T09. Independent fixture Task T10 may prepare without SDK activation after T01. Once T02 is reviewed, validated, merged and its active Claim closed, T13 may later update the SAME two manifests and root dependency/lockfile paths as the final packaging writer. These writes are explicitly sequential (no two active source Claims on shared paths), and each Task must be admitted with current exact-base evidence. This blueprint does not itself give that authority.

## Minimal starting files / generation recipe (not executed)

Only after the approved planning-source or post-DAG Task Claim:
1. Use existing repository as base; `pnpm-workspace.yaml` already includes `packages/*`; do not add duplicate root workspace.
2. T02 initializes the two new package roots only after legal Task Claim; T13 may amend their package manifests later, never concurrently.  Package names: `@xdownload/download-domain-app` and `@xdownload/download-domain-host`. Set private=true and internal Node24 ESM, no published package promise.
3. Put K/S/B/C declared module source under owned paths, use actual v0.10.3 public SDK Build producer. Do not use Host-node as second Microkernel.
4. Dependencies/lockfile pins come from **real candidate SDK pack/install**, never guessed from candidate package manifest version (`0.10.2-rc.0` is still used by upstream pre-release candidate).
5. Run the actual host `pnpm run ci:verify` only after source exists; separate real Node24 SDK clean consumer and Windows installed E2E. The current scaffold spec has no executable validation.

## Planned admission and qualification sequence

Frozen Product (owner + independent review) → L2 high-impact PoC evidence + Freeze (independent) → canonical planning work item / current Builder Claim → bounded SOURCE-ONLY SF checkpoint → independent SF review if material → compare actual SF to DAG candidate → Task DAG review/freeze → Task Issue + native blocked_by materialization → local builders.

The user can still start later local implementation directly from an approved post-DAG source-Scaffold Task; until these gates have run, this document is a complete structural blueprint, not a ready-to-run package.

SOURCE_SCAFFOLD=HOLD
ROOT_EXISTING_MONOREPO=REUSE
SOURCE_CODE_GENERATED=NO
