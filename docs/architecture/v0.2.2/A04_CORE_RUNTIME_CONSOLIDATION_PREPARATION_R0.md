# A04 Core Runtime Consolidation — Preparation R0

> Preparation note only. This is not a frozen Task Pack, Builder Claim, or source-dispatch authorization.
>
> Planning branch: planning/v0.2.2-domain-package-architecture-r0  
> Parent: xDownload #337  
> Source-audit baseline: wip/v0.2.2-ui-rebuild-r0@5880731aa84601373c028e45f2ec0380e521686f  
> Dispatch gate: A02 #341 and A03 #342 must both be integrated and their exact WIP SHAs re-read. A04 must then freeze its exact source write set and execution pack against the new base.

## Current predecessor status (2026-11-04)

- A02 #341 / PR #344: candidate `330efd081a89e443d79fa27064109c4c40d17b16`; all 11 App blobs are unchanged from the original candidate; Node 24/Prettier/focused 29/29/typecheck and Docker Woodpecker #20 PASS. Current Exact-SHA review BLOCKS (P0=0/P1=1/P2=3): the 25 S2/S5/S6 runtime journey cases and their `slice-journey-testkit.ts` still depend on the now-throwing `assembleDownloadRuntime()` relocation sentinel and are not re-established under Core. See #341 comment 6613064965. Do not merge A02 alone to WIP.
- A03 #342 / PR #345: candidate `deec3d6272ee9d4329838058098f051f6dfa3492` / tree `fd34b655135b46e1e35cd294e0b3e10ecd601ec4`; 13 paths within the frozen 14-path Host write set; syntax/Prettier/focused 40/40/typecheck and Docker Woodpecker #21 PASS. The current independent Exact-SHA review is **BLOCK (P0=0/P1=1/P2=1)**: `HostDocWriteCondition` uses `kind: 'replace'`, while SDK `V10DocStore` requires `kind: 'cas'`; the real Core call-site assignability probe fails TS2322. See PR #345 comment 6618475331. A bounded repair within the existing storage implementation/test write set and fresh Exact-SHA review are required before staging.
- Both PRs still target WIP `wip/v0.2.2-ui-rebuild-r0@a3e1b22c200ef11a942dacc953e2bfecdc3db03c`; neither is merged. The separate staging branch `staging/v0.2.2-a04-domain-package-integration` is prepared but remains empty at current WIP base `4d2148b80976532cecfaddc111c7fdc94980a289`. A04 is not dispatch-ready: repair and independently pass A03 first; then admit the reviewed A03 commit to staging, retain A02 only as an unmerged input with its P1 explicitly open, and freeze the A04 Task Pack against the resulting exact staging HEAD. Do not create a WIP state that drops the 25 S2/S5/S6 cases.

## 1. Purpose

A04 is the single integration writer after App and Host source boundaries are independently complete. It makes Core Runtime the only production composition root, consumes stable App/Host package entrypoints, removes the reciprocal App↔Host workspace dependency, and preserves the existing Core Seam / K / RouteLog authority model.

A04 owns the only edits to:
- packages/download-domain-app/package.json
- packages/download-domain-host/package.json
- pnpm-lock.yaml

These manifests and the lockfile must change together because Woodpecker runs `pnpm install --frozen-lockfile` before verification.

## 2. Current source inventory (read-only; baseline 5880731)

### Core composition root

`packages/core-runtime/src/domain-app-route.ts` currently:
- imports App S4 seal, S4 bridge pin and S4 pin-counter types through deep paths;
- imports App S4 intent validator through a deep path;
- imports App `InMemoryMediaTargetRegistry` and `FileCasDocStore` physical adapters through deep paths;
- imports Host `acquireSelectedHlsVod` through a deep path;
- imports EffectEnvelope / materialized-evidence helpers from the App contracts deep path;
- constructs one registry, one S4 Host bridge, one pin lease, one FileCasDocStore and performs one SDK `load(sealS4HlsComposition(), ...)`.

The current Core route already acts as the one-K production composition root. A04 relocates dependencies and imports; it must not introduce another K, bridge authority, journal or scheduler.

### Reciprocal package dependency

At the audit baseline:
- `packages/download-domain-app/package.json` depends on `@xdownload/download-domain-host`.
- `packages/download-domain-host/package.json` depends on `@xdownload/download-domain-app`.
- Core Runtime already depends on both packages.

A04 removes the reciprocal App↔Host workspace dependencies after all source imports are removed. Host depends on neutral Contracts and its physical engine/SDK dependencies only. Core Runtime is the composition root and may depend on App + Host.

### Transitional App compatibility to retire after A03

A02 intentionally left these deep-path compatibility surfaces so the current Core route remains operational during the intermediate WIP state:
- `packages/download-domain-app/src/composition/runtime.ts`: FileCasDocStore and direct runtime/pin compatibility declarations; `assembleDownloadRuntime` is a relocation sentinel.
- `packages/download-domain-app/src/integrations/media-registry.ts`: `InMemoryMediaTargetRegistry` remains an App-owned transitional S3/S4 media registry. A03 moves the Direct `InMemoryTargetRefRegistry` into Host, but does **not** move this media registry. A04 must move the media registry behind a Host-owned adapter and expose it only through the Host stable package entrypoint.
- `packages/download-domain-app/src/integrations/s4-hls-vod.ts`: S4 bridge pin registration and transitional runtime/pin types.
- `packages/download-domain-app/src/integrations/s3-media.ts`: transitional physical runtime/pin types.
- `packages/download-domain-app/src/migration/lineage-store.ts` and `migration/index.ts`: PlainFileLineageStore compatibility; A03 adds the Host-owned physical implementation.
- The App package's legacy deep exports map includes `./src/contracts/index.ts`; A04 must inspect all workspace consumers before removing or retaining that compatibility export.

A04 removes or narrows these App physical/Host-runtime compatibility implementations only after Core consumes A03 Host-owned adapters and all consumers/tests are re-pointed.

## 3. Intended package boundaries

- Domain App: public domain declarations, Business Intents, pure rules, sealed BUILD producers, Workflow/journey contracts. No Host package dependency, Host runtime assembly, physical store or physical target registry.
- Domain Host: physical Direct/S3/S4 bridge handlers, Direct `InMemoryTargetRefRegistry`, S3/S4 media target registry, SDK document-store adapter, dormant T09 plain-file adapter. No App source import or App package dependency.
- Domain Contracts: pure neutral DTOs, exact validators, output evidence and narrow ports; no App/Host/Core, Node I/O, network or SDK imports.
- Core Runtime: only production composition root; injects Host adapters, loads exactly one selected K, and owns orchestration around the Core Seam and RouteLog.
- Core Seam / RouteLog / K Journal / K Permit / T09 LineageLedger retain distinct authority. Do not move RouteLog ownership to T09 and do not auto-clear UNKNOWN.

Use package roots / stable subpath exports rather than `src/**` deep imports. A04 should add only the stable Host exports needed by Core and keep the App root as the domain-only facade.

## 4. Integration coverage that A04 must re-establish

A02 moved runtime integration tests out of App so the App package can become domain-only. The source test files contain the authoritative relocation lists:

### S2 / S5 / S6 — P1 migration gate from A02 Exact-SHA review

The current A02 candidate leaves a test-only runtime helper and three node:test suites under the App package. They still call the now-throwing assembleDownloadRuntime() relocation sentinel. The suites are excluded from the current ci:verify Vitest include, so the green aggregate CI does not detect the break. The independent review recorded this as P1 in #341 comment 6613064965.

Preserve and re-establish all 25 existing cases under Core before integrating A02:

- Source helper to retire from App: packages/download-domain-app/src/integrations/slice-journey-testkit.ts.
- S2 source suite: packages/download-domain-app/src/integrations/s2-discovery.test.ts (7 cases).
- S5 source suite: packages/download-domain-app/src/integrations/s5-collection.test.ts (9 cases).
- S6 source suite: packages/download-domain-app/src/integrations/s6-navigation.test.ts (9 cases).
- Candidate Core destinations (not yet frozen): packages/core-runtime/test/slice-journey-testkit.ts, s2-discovery-journey.test.ts, s5-collection-journey.test.ts, and s6-navigation-journey.test.ts.

The replacement testkit must compose through the real Core Runtime / Core Seam route, not call the App relocation sentinel or assemble K independently. Preserve the existing localhost HTTP fixtures, deterministic payload/digest checks, 4-way zero-effect deltas (fixture requests, bridge/route counters, durable journal rows, K permit docs), restart/replay and positive/negative journey assertions. Convert the moved cases to the Core test runner already included in ci:verify (Vitest), or prove an explicit aggregate CI command runs them; never leave them as unexecuted source-colocated node:test files.

A04 must remove the obsolete App helper/suites only in the same integration candidate that adds and runs their Core equivalents. Do not merge A02 alone to WIP and temporarily lose these 25 cases. The exact Core helper/test paths and any Core production call-site changes remain to be frozen in the A04 Task Pack after the current candidate imports and SDK/Core APIs are re-read.

### Direct lane — from composition-runtime.test.ts
1. Real intent → K permit → Host Direct bridge → existing DirectHttpAdapter → digest-backed materialized file; truthful terminal query/subscription and single-triple evidence.
2. Exactly one K permit / one journal row; replay adds none.
3. Duplicate messageId idempotency with zero second effects.
4. Mid-flight AbortSignal propagation; no file, honest non-completion, explicit resend under a fresh identity.
5. Stop/reopen durability and idempotent replay.
6. Digest mismatch refuses materialization and records truthful failure.
7. T01 widened intent / raw-locator targetRef refusal before effects, backed by bridge counters, fixture socket and durable-store evidence.

### S3 media lane — from s3-media.test.ts
1. Real master → playlist → segments through the existing HLS engine under one K permit; digest-backed materialization; one durable permit; exact fixture hit accounting (1 master + 1 playlist + 3 segments).
2. Pre-send refusals for foreign operation, foreign slice, widened intent and missing sealed profile fields, each with zero fixture hits / pin calls / durable effects.
3. Admitted-dispatch truthful failures with zero network for unknown targetRef and sealed B profile guard.
4. Digest-anchor mismatch behind engine acceptance; tampered run must not overwrite prior completed artifact.

### S4 HLS lane — from s4-hls-vod.test.ts
1. Unknown targetRef refusal through K/Host, typed refusal, zero media effects and empty output root.
2. Live-fixture topology refusals: unclosed live playlist, AES-128 protected media, duplicate variants; verify exact hit accounting.
3. Positive ffmpeg-generated HLS VOD materialization with digest anchor, byte-for-byte integrity, segment/playlist hit accounting and permit-bound terminal evidence.
4. Second live bridge registration refused without displacing the current holder; successful re-acquire after stop.
5. Single externally built K with S4 contribution and one stubbed Host pin, verified against typed registry refusal.

Existing Core tests under `packages/core-runtime/test/**` already cover route behavior, duplicate commands, process restart, selected media/HLS, cancellation and projections. A04 must reconcile the lists above against those tests and add only missing coverage; do not duplicate test infrastructure or silently drop a scenario.

## 5. Required A04 implementation gates

1. Re-read exact A02/A03 candidate SHAs, all review findings and current WIP HEAD/tree. A02 is P1-blocked and must not be merged alone.
2. Build a staging integration candidate from the exact A02 and A03 commits (or an equivalent no-WIP-intermediate sequence) so A04 can migrate the 25 S2/S5/S6 cases before any A02 WIP integration. A03 may be integrated separately only after its independent Exact-SHA review and existing conditional Owner authorization.
3. Freeze the exact A04 write set against that staging base. Expected owners include Core composition root and integration tests, App transitional compatibility and obsolete App test helper/suites, Host stable exports, both package manifests, and root pnpm-lock.yaml. Do not use broad globs as the write set.
3. Migrate Core imports to stable package entrypoints:
   - App domain BUILD / journey symbols from `@xdownload/download-domain-app`;
   - Host bridges / Direct and media registries / stores from stable `@xdownload/download-domain-host` entrypoints;
   - neutral envelope/evidence/targetRef helpers from `@xdownload/domain-contracts`.
4. Move the S3/S4 `InMemoryMediaTargetRegistry` and the former App permit-derivation pin behind a Host-owned media composition adapter. Core must resolve the opaque `targetRef` through that registry **before** constructing the Host transport request; derive `manifestUri`, selected rendition, exact allowed origins and budget from the resolved record; bind the permit to the same requestId/lineageId/operation and those facts. The Host bridge currently validates the neutral DTO and permit/origin scope but does not itself resolve the media registry; A04 must not pass caller-controlled `manifestUri` as if the opaque `targetRef` had already been resolved.
5. Add A04 regressions for unknown targetRef, targetRef/manifest mismatch, mismatched S4 rendition, permit request/lineage mismatch and origin widening; every refusal must prove zero segment requests and zero file writes.
6. Prove Host FileCasDocStore structural assignability to SDK public `V10DocStore` at the actual Core `load()` call site; do not add an accidental hoisted dependency.
7. Narrow App journey input types so public journey signatures depend on a domain-facing app/send port, not physical store/registry/pin types (P2 recorded during A02 source audit).
6. Remove App compatibility physical adapters and transitional Host pins only after all Core and workspace consumers are migrated.
7. Remove reciprocal App↔Host workspace dependencies; update required stable export maps; regenerate pnpm-lock.yaml exactly once as the sole manifest/lockfile writer.
8. Strengthen the App package-boundary regression guard to cover side-effect imports and CommonJS `require()` (AST-backed if the current parser/tooling permits; no dependency/manifests outside the A04 write set).
9. Node 24 syntax preflight and changed-file Prettier before CI; focused tests, typecheck, `pnpm run ci:verify`, local Docker Woodpecker exact-SHA SUCCESS.
10. Independent Exact-SHA review PASS before WIP integration.

## 6. Stop conditions

- A02 or A03 is not integrated, or WIP HEAD moved without rebinding the pack.
- A second K, journal, permit authority, route ownership source, Scheduler, retry engine or transfer engine is introduced.
- Core Seam acceptance/replay, RouteLog claim/outcome semantics, K effect governance, restart or UNKNOWN behavior changes without an explicit reviewed migration.
- T09 becomes a second route authority or UNKNOWN is auto-cleared.
- Product/L1, L2, operation IDs, user confirmation, permission, IPC, Provider, network scope, SDK pin/bytes or external download behavior changes.
- Any package manifest / lockfile write occurs outside A04.
- Any source write exceeds the later frozen exact A04 write set.

## 7. P2s carried forward

- A01B #340: avoid coercing malformed `allowedOperation` values in a diagnostic; use a constant typed refusal path.
- A02 #341 P2-01: narrow `submitConfirmedMediaDownload` and `submitConfirmedS4HlsVod` inputs to an App-facing send port so public journey signatures do not retain physical store/registry types.
- A02 #341 P2-02: strengthen the App boundary regression guard to cover side-effect imports and CommonJS `require()`; the current candidate's four App→Host source edges are removed, but the regex does not cover those forms.
- A03 #342 P2-01: prove the Host `HostDocStore` structural port is assignable to the SDK public `V10DocStore` at the actual Core `load()` call site.
- A03 #342 P2-02: move the S3/S4 media target registry and permit-derivation pin behind Host; Core must resolve opaque targetRef to exact manifest/rendition/origin facts before calling the Host bridge. Add mismatch and zero-effect tests.

These are A04 integration gates, not authorization to widen A02/A03 write sets. Current A02/A03 candidates have Web Controller source audits; separate independent Exact-SHA review of the current candidate SHAs remains pending.
