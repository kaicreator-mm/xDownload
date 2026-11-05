# xDownload Domain Package Validation Map

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00: #338 · A05: #339

## Source-level test inventory

| Area | Test source | What it should protect |
|---|---|---|
| Business package | packages/download-domain-app/src/business/business.test.ts | Business policy, intent projection and workflow behavior |
| BUILD/composition | packages/download-domain-app/src/business/composition.test.ts | Sealed BUILD, module identities and declarations |
| App composition | packages/download-domain-app/src/composition/composition-runtime.test.ts | Direct runtime assembly and Host bridge binding |
| App contracts | packages/download-domain-app/src/contracts/contract.test.ts | Exact-key intent, output-root and operation contract validation |
| Semantic | packages/download-domain-app/src/semantic/semantic-*.test.ts | Deterministic recipe, finite membership, no-LLM default and advisory limits |
| S2 | packages/download-domain-app/src/integrations/s2-discovery.test.ts | Finite current-page discovery, ambiguity and explicit confirmation |
| S3 | packages/download-domain-app/src/integrations/s3-media.test.ts | Media intent, permit-bound Host bridge and evidence path |
| S4 | packages/download-domain-app/src/integrations/s4-hls-vod.test.ts | Confirmed HLS selection, tuple binding and Host integration |
| S5 | packages/download-domain-app/src/integrations/s5-collection.test.ts | Exact batch membership and all-member completion |
| S6 | packages/download-domain-app/src/integrations/s6-navigation.test.ts | Explicit finite scope and exact batch confirmation |
| Direct Host | packages/download-domain-host/src/direct/direct-acquisition-bridge.test.ts | Permit gate, targetRef, digest, path containment, cancellation and zero effects on refusal |
| Media Host | packages/download-domain-host/src/media/media-acquisition-bridge.test.ts | Permit gate, HLS-only protocol, budget and materialization |
| Core route | packages/core-runtime/test/domain-app-route.test.ts | Route ownership, claim-before-send, attempts, outcomes and restart |
| Core direct/HLS | packages/core-runtime/test/s1-direct.test.ts, s3-selected-media-flow.test.ts, s4-selected-hls-flow.test.ts | Core-to-Host direct/media integration |
| Core recovery | packages/core-runtime/test/process-restart.test.ts, duplicate-command.test.ts, cancellation-cutoff.test.ts | Restart, idempotency, duplicate and cancellation boundaries |
| Core projection | packages/core-runtime/test/projection.test.ts | Honest Core job/result projection |

## Required architecture-negative tests for A06

- App manifest and source graph must not depend on Host.
- Host manifest and source graph must not depend on App.
- Neutral Contracts must not import App, Host, Core Runtime, Node I/O, network or DomainHarness SDK.
- App public root must not export physical stores or production Host assembly.
- Core Runtime must be the only production Domain App composition root.
- One production K and one business writer per new-K Lineage.
- RouteLog CLAIM remains the route owner fact unless an explicit reviewed migration changes it.
- RouteLog OUTCOME remains derived from K receipt, not K Effect Journal truth.
- T09 LineageLedger must not become a second production owner.

## Required behavior regression

- No Permit: zero network and zero filesystem effects.
- Raw URL/path in targetRef: refusal.
- Unknown operation or malformed exact-key input: refusal.
- Output-root traversal or artifact escape: refusal.
- Digest mismatch: no materialized artifact.
- Cancellation is forwarded and not swallowed.
- Budget truth remains single.
- Accepted/running does not settle an effect.
- Crash during an in-flight effect does not fabricate RUNNING/SUCCEEDED.
- Duplicate request/CLAIM does not create a second owner.
- UNKNOWN remains UNKNOWN until explicit authorized resolution.
- Direct, S3 media and S4 HLS behavior remains compatible.
- S5/S6 completion requires exact membership and all-member settlement.

## Repository pre-CI gates

Root package.json pins Node engine 24.21.0 and defines:
- format:check — Prettier.
- lint — ESLint.
- typecheck — TypeScript.
- test:unit — Vitest.
- ci:verify — format, lint, typecheck and unit tests.

Required sequence before Woodpecker:
1. Node 24 syntax parse/transpile check for changed TS/JS.
2. Changed-file Prettier.
3. Focused tests.
4. Typecheck and ci:verify.
5. Local Docker Woodpecker exact-SHA SUCCESS.

GitHub Actions are not used.

## Evidence status

A00 was a GitHub source-level audit only. It did not run Node, tests, Electron, Chrome, Windows, Docker or Woodpecker. No runtime verification is implied by this map. Later implementation evidence must record exact SHA, actual Build ID and environment result.
