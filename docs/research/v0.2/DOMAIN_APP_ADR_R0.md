# xDownload v0.2 — Download Domain App ADR R0 (research only)

- Status: **PROPOSED / NOT FROZEN / NOT IMPLEMENTED**
- Issue ownership: #183 (falsifiable PoC), #184 (conditional v0.2 migration), ADS adoption #182.
- Research source snapshot: xDownload version/v0.1.0 @ 195355d03b847825ce5acf78c73e06f7386e11e2 (2026-10-29 readback). This is a research anchor, not a release qualification.
- Decision: DomainHarness for the download **control plane**; keep existing production transfer **data plane**; no v0.1 dependency or change to frozen Product/L2/Task DAG.
- Validity: none of the following claims is established until real public SDK clean-consumer + independent proof.

## Problem and principle

xDownload v0.1 already has a pnpm monorepo, reusable direct-acquisition/HLS adapters, one Core runtime authority, CoreScheduler, SQLite persistence/recovery, discovery recipes and proposal-only AI. Refactoring all of these into a second copy of Kernel abstractions would create cost and dual authority.

The hypothesis is that a DomainHarness Domain App can reuse domain rules, own semantic workflow, protect external effects and expose one canonical status. It must *not* take raw download bytes, high-frequency progress callbacks or duplicate scheduler/persistence authority into Microkernel.

## Target logical architecture

~~~mermaid
flowchart TB
  UI[CLI / Browser Integration / Desktop (future)] --> Facade[Download Domain App facade]
  Facade --> MK[DomainHarness Microkernel]
  MK --> K[K Primary: admit / durable state / permit / journal / replay / UNKNOWN]
  MK --> S[S: recipe and semantic workflow]
  S --> B[B: download intent / selection / validation policy]
  B --> C[C: declared acquisition / filesystem / observation operations]
  K -->|permit / effect identity| C
  C --> H[Trusted Node Host: SQLite / file / CAS / native ports]
  H --> ENG[Existing direct-acquisition / HLS-VOD transfer engines]
  ENG --> FS[Authorized network and output files]
~~~

This diagram is *conceptual*: actual selected public BUILD/router/Host APIs and runtime path are PoC acceptance subjects, not known executable wiring.

## Module mapping (reuse-first)

| Current xDownload module | Target | Treatment |
| --- | --- | --- |
| packages/domain-contracts | application DTO boundary | Reuse; explicit adapter only for public SDK contracts |
| packages/discovery-recipe | S/B | Reuse pure discovery, bounded continuation and confirmation |
| packages/ai-proposal | S/B + optional LLM C/Host | Proposal-only, no authority; zero-model path must work |
| packages/converged-runtime | facade / composition | Replace wiring incrementally; avoid reimplementing domain decisions |
| packages/core-scheduler | K/B | **Architecture conflict candidate**: single authority required, don't leave an independently authorizing dispatch |
| packages/persistence-ledger | K/Host | Preserve schema/durability; only one authoritative writer and unambiguous recovery |
| packages/core-runtime | legacy orchestration seam | Adapter during transition, remove after parity proven |
| packages/direct-acquisition | C + Host | Reuse intact; data-plane bytes stay outside K |
| packages/hls-vod-adapter | C + Host | Reuse intact; no new transport/FFmpeg stack |
| packages/core-seam | host/IPC | Reuse existing verified Windows pipe/security boundary |
| apps/cli, apps/browser-extension | application surfaces | Existing release behavior retained; no surface-local state authority |

**Open P1 design decision:** how to project existing business statuses/budgets, accepted artifact and effect identities into a selected K without two writers or weakening post-send UNKNOWN. Spike must decide between (A) K authoritative ownership via explicit compatibility bridge; (B) K controls only a separate new PoC lifecycle with strict no-production mixing; (C) reject migration if no safe public SDK seam. Option B can prove mechanics but **cannot** prove production migration or durability equivalence.

## Security and consistency invariants

1. Existing user-declared target, finite collection membership, authorization and output root never widen from model/recipe/browser data.
2. One authoritative business state and effect journal. K grants external Effect Permit; Host transport cannot impersonate K or auto-retry UNKNOWN.
3. All download bytes are Host/engine-owned; K gets bounded typed evidence/terminal facts, not secret cookies, raw pages or streams.
4. Duplicate intent/cancel/reopen/recovery must not emit false success or accept unauthorized duplicate artifact.
5. No direct trust transfer from existing ledger receipts, proposed LLM recipes, mock admission or UI status to K authority.
6. No new public SDK contracts or Host CAS framework for the PoC unless proved necessary and separately authorized.

## Options / rejection

- **Full rewrite:** REJECT — duplicates mature download execution/security and restarts v0.1 assurance.
- **Keep existing runtime forever:** BASELINE — lowest migration risk, must be benchmarked.
- **Domain App orchestration with existing engines:** PREFERRED *candidate*, gated on PoC safety, latency, integration cost and real SDK support.
- **Separate second stateful orchestration without authority reconciliation:** REJECT — split-brain scheduler/ledger and misleading terminal status.

## Release and planning boundary

- v0.1 version branch, PRD, L2, frozen DAG, review receipts and current release gates remain untouched. Do NOT add PoC as a v0.1 blocked_by.
- PoC may be authored/reviewed on separate research or experiment branches; its branch/source identity is NOT a v0.1 release candidate.
- v0.2 Product/L2 and safe-parallel Task DAG are future **intake**. Only advance on independent exact-SHA PoC PASS and a new version-level adoption decision.
- Adopt ADS 4.18.0 exact qualified SHA for the experiment independently of v0.1's immutable historical ADS 4.0 pin. Do not silently reinterpret historic events.
- **SDK selection policy (2026-10-29 post-release update): DomainHarness v0.10.3 Git source ONLY.** Upstream source tag `v0.10.3` now points at `main@061376f4a023070f215f9feffad5c24d96d503cb`, Git tree `099cdc831aef63befd62aaede7e7a853d1be468f`, exactly the independently reviewed candidate tree `version/v0.10.3@7d571858bd6524ffd13a7985227183dbecb2924a`. RQ is **CONDITIONAL**, P0/P1/P2=0/0/3, not blanket PASS; **npm publication is NOT authorized/done** and registries need not contain a `v0.10.3` package (source manifests may still say `0.10.2-rc.0`). For #183, build/pack SDK public packages from **this exact Git tag/tree** on Node >=24; record actual local tarball SHA256 and clean-consumer/selected K/S/B/C/Host tests, with no old-rc registry fallback or undocumented API. Existing raw public DomainApp `send` has an unresolved **pre-Journal schema validation/poisoned stable Case hazard** (upstream #1437), therefore the PoC requires a trusted pre-send no-widening gateway and an invalid→valid same-identity negative proving no poisoned journal or duplicate effect. A valid gateway does **not** establish already-poisoned journal repair, which stays BLOCKED absent separate proof. If this actual Git-source SDK/Host seam fails, report a sanitized v0.10.3 gap rather than inventing shims.

## Decision gate

Set DOMAIN_APP_POC=PASS only after real clean packed SDK selected BUILD -> load/send/query/subscribe -> K permit -> existing direct acquisition -> digest-backed file -> truthful terminal, plus relevant security/restart negatives and independent review. Otherwise keep NOT_RUN/BLOCKED and the current production architecture.
