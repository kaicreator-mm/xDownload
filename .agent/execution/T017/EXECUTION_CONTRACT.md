# T017 Execution Contract — surface + AI convergence integration

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #36, the Frozen Task Pack (`T017_surface-ai-integration.md@234eb3ac308b0520e5ef022c7124d0ad622182b9`), Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T017` / Issue `#36`
- Integration base: `version/v0.1.0@5b86cd2ca3b5cc587f7bf42f4331716637081353` (the T016 merge, which includes the #72 T010 hardening; base tree `4f6fe02886d373613597711fb9d8cc4ba7915d7f`)
- JIT branch: `task/v0.1.0-t017-surface-ai-convergence`
- Dependency completion (all CLOSED on the integration base):
  - `T012/#31` merge `70f6ef22ce9bdd6127c82c03a61b3661a514c5ec` — bounded AI proposal adapter (`@xdownload/ai-proposal`)
  - `T013/#32` merge `4258bed923b20d472b024d1a815a206ddf65a826` — CLI adapter (`apps/cli`)
  - `T014/#33` merge `356178754a9e92ea422328f8f7332b15d906d9f0` — desktop UI adapter (`apps/desktop`)
  - `T015/#34` merge `4166b51841709bd74cedf1dd89cfcf8f373c38a1` — authoritative Core runtime (`@xdownload/core-runtime`)
  - `T016/#35` merge `5b86cd2ca3b5cc587f7bf42f4331716637081353` — browser + collection workflow (`@xdownload/browser-collection-workflow`)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T017_surface-ai-integration.md@234eb3ac308b0520e5ef022c7124d0ad622182b9` (frozen filename is `-ai-integration`, per the Issue #36 body and the freeze-checkpoint tree)
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high` (frozen; not recalculated — Issue #36 body and Frozen Task Pack both pin `risk:high`)
- L3: `required`

## Goal of the task (frozen, unchanged)

Wire Desktop, CLI and bounded AI proposal behavior to integrated Core/Browser/Collection so all surfaces share one contract/result authority and deterministic/template-supported work remains model-independent.

## Required outputs

The implementation must provide ONE converged surface/AI integration over the already-merged packages and apps, consumed as-is through their public APIs, in which:

1. **One contract/result authority across surfaces.** CLI (`apps/cli`, SurfaceKind `'CLI'`) and Desktop (`apps/desktop`, SurfaceKind `'DESKTOP_UI'`) — and the browser extension surface (`apps/browser-extension`, SurfaceKind `'BROWSER_EXTENSION'`) as a consumer — submit commands/queries and render status only through the T004 seam (`createSeamClient`, `CommandEnvelope`/`QueryEnvelope`, per-frame `PeerIdentity`/`ExpectedPeerScope` admission) against the single `@xdownload/core-runtime` composition root (T015). The same contract produces compatible UI/CLI status: identical canonical command → identical `SeamResponse` class (ACCEPTED/REJECTED/PROJECTION) and identical six-dimension terminal projection, rendered (not recomputed) per surface. No surface-local status derivation, no private store, no surface fork of Product truth.
2. **Concurrent clients converge.** Concurrent UI + CLI (and browser-triggered) clients against one Core instance converge through the seam's per-frame authorization and idempotent `requestId` replay: duplicate allocation is rejected by canonical identity (C13), interleaved control transitions (cancel/retry/resume) surface only as Core projections, and no client can observe or cause a divergent status for the same lineage/effect identity.
3. **Browser-triggered actions project identically.** A browser-triggered flow (T016 S2 attachment → scoped capability → authoritative Core acquisition) surfaces the same canonical statuses/projections to every observing surface; the extension lane contributes evidence and intent only, and its outcomes render through the same T007 projection as any other surface's view of the same lineage.
4. **Bounded AI proposal wired as an optional suggestion source.** The T012 adapter (`createAiProposalAdapter` composition: redaction → bound/audit → optional `ModelProviderPort` → containment audit → deterministic policy → accepted proposal (data, suggestion provenance) | typed rejection | `MODEL_UNAVAILABLE` + `DeterministicFallback`) is wired into the composed discovery/collection path exactly where a discovery/confirmation gap exists (`ProposalRequest.expectedGapRef`/`expectedContractRef` binding). An accepted proposal is consumed ONLY as a human-suggestion-equivalent Recipe through the unmodified `@xdownload/discovery-recipe` decode/confirmation machinery — it never routes around confirmation, never mints scope/membership authority, and never reaches behavior without the exact deterministic machinery any human suggestion passes through (C19, C34).
5. **Deterministic path stays model-independent.** With the provider omitted (`provider: undefined` — deterministic-only mode), absent, unreachable, hung, or hostile, every ordinary deterministic/template task completes with identical results and identical statuses (C16); the composed path resolves truthfully to the deterministic fallback (`ASK_USER`/`ABORT`) and never silently degrades to success, never invents members, and never makes a model a required dependency.
6. **Provider deadline bound by the caller/budget (T012 P2 waiver integration constraint).** `@xdownload/ai-proposal` deliberately enforces no internal provider deadline — the `ModelProviderPort` contract maps hung calls to `UNAVAILABLE` *by the implementation*, and the deadline authority belongs to the caller/budget per Frozen PRD §15 (GlobalSafetyBudget: "configured model cost/calls" and "global active elapsed time", highest precedence). T017, as the integrating caller, must wrap every provider invocation in the composed path with a caller-side deadline/cancellation bound charged to the canonical budget domains, so a hung or slow provider can stall at most its bounded slice: on deadline expiry the path resolves as `MODEL_UNAVAILABLE`/`TIMEOUT` → deterministic fallback, never as a hang, and never by replenishing or redefining any budget.
7. **HITL parity across surfaces.** Confirmation plans produced by the canonical `planConfirmationWorkflow` render verbatim and route answers as idempotent Core commands from every surface; AI-suggested candidates enter the same explicit human confirmation flow as any other candidate. `ASK_USER` fallbacks surface as explicit user decisions — never auto-resolved, never collapsed into per-item prompts from batch ambiguities (C30), and HITL choices remain explicit and attributable to the confirming surface only through Core records (C05, C26).
8. **Scope/authorization parity UI vs CLI.** Scope, continuation, successor identity, authorization context (opaque `AuthorizationContextRef` — no raw reusable secrets anywhere at any surface) and budget semantics are identical whether a contract is driven from UI or CLI; every expansion/refresh/auth-change routes a successor-identity command through the same seam (C11, C08); no surface admits what the other would reject.
9. **Focused cross-surface/AI convergence evidence.** Focused fixture flows covering the Issue #36 validation scope accompany the wiring (see `TEST_MATRIX.yaml`): same-contract/status parity, concurrent UI/CLI convergence, AI-offline fallback (outage/timeout/malformed/hang), malicious-proposal safety, HITL parity, browser-triggered projection identity, no surface-local authority.

The integration is one composition/wiring layer over the merged tree, not a new domain layer. No domain decision may be made in glue: statuses, verdicts, membership identity, coverage truth, continuation admission, confirmation plans, proposal acceptance and validation outcomes remain owned by the consumed packages and surface verbatim.

## Owned write boundary

T017 owns only product-surface convergence, cross-surface client behavior and AI fallback integration. Concretely:

- Convergence wiring/glue in `apps/cli` and `apps/desktop` (thin-client preservation: presentation-only changes that keep T013/T014 authority rules intact), and consumer-side wiring in `apps/browser-extension` (no packaging/bundling — T018; no privileged-logic redesign — T010 semantics stand).
- Minimal new integration composition module(s) under the existing `packages/*` workspace seam only where surface-shared convergence glue needs a home (naming/decomposition is an F1 choice). Such modules compose `@xdownload/ai-proposal`, `@xdownload/discovery-recipe`, `@xdownload/core-runtime`, `@xdownload/browser-collection-workflow` and `@xdownload/core-seam` through their public APIs as-is.
- Narrowly necessary root workspace dependency/script/config wiring directly required by that composition and its tests.
- Package-local and app-local focused convergence tests fit for the existing `vitest.config.ts` discovery seam (`packages/*/test/**/*.test.ts` and the apps' established test placement).

### Forbidden scope (frozen Task Pack + version-level routing)

Do not implement, integrate or claim:

- **No surface fork of Product truth**: no surface-local status/result derivation, no surface-owned lifecycle/progress/budget truth, no per-surface command vocabulary, no UI- or CLI-private durable state.
- **No AI authority elevation**: an accepted proposal is suggestion-provenance data only; no model output becomes scope, membership, validation, authorization or terminal-status authority; no AI path bypasses confirmation or the deterministic policy; no AI-specific exception to any contract invariant (C19/C34 hold through the composed path).
- **No model requirement for ordinary deterministic tasks**: no composed path may require a provider; deterministic-only mode must remain complete and correct; AI unavailability must never change deterministic outcomes or statuses.
- **No scope/authorization drift across UI vs CLI**: no surface admits scopes, continuations, auth contexts or budgets another would reject; no surface-local success boolean or completion rendering.
- **No unbounded provider invocation**: the caller-side deadline/budget wrap of §Required-outputs-6 is mandatory; a provider hang must resolve to typed `MODEL_UNAVAILABLE`/`TIMEOUT` fallback within its bounded slice.
- **No T018 scope**: no packaging, bundling, installers, platform adapters, release qualification or distribution work; extension bundling stays downstream.
- **No frozen-doc mutation**: never modify `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json`, the T017 Task Pack, or any other frozen task pack to ease integration.
- **No consumed-package semantic modification**: upstream packages (`packages/domain-contracts`, `packages/version-validation`, `packages/core-seam`, `packages/core-scheduler`, `packages/persistence-ledger`, `packages/direct-acquisition`, `packages/hls-vod-adapter`, `packages/browser-observation`, `packages/browser-auth-broker`, `packages/discovery-recipe`, `packages/ai-proposal`, `packages/core-runtime`, `packages/browser-collection-workflow`) and the T001 smoke packages are consumed as-is. Do not edit their semantics, exports or invariants to solve an integration problem; glue/wiring only. A genuine API-gap blocker routes as an escalation, not a local rewrite.

## F1 implementation choices left open

- Naming/decomposition of the (optional) convergence composition module(s) under `packages/*`, and whether the composition lives there or directly in the apps where only one surface needs it.
- How the provider deadline is implemented (e.g., cancellation token, race-with-timer wrapper) provided it is deterministic under test, charged to canonical budget semantics, and resolves to typed unavailability.
- Which surface instantiates the adapter configuration and how the optional provider is configured per deployment, provided deterministic-only remains a first-class mode and no secret material reaches `RedactedModelInput` beyond its boundary rules.
- Fixture/driver mechanics for cross-surface and concurrency tests (in-process loopback transports versus spawned processes are both acceptable if deterministic and local).
- Internal file organization of app-side wiring, provided T013/T014 authority rules and thin-client property survive verbatim.

These choices must not weaken or reinterpret the frozen semantics above.

## Verification commands available on the exact base

The T001 toolchain provides the durable root gates:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T017 concern Validation is separate from this prep task and must additionally prove the T017 convergence matrix (`TEST_MATRIX.yaml`) on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T017 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (including any need to give the model authority or to fork surface truth).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

This pack's implementation map records seams observed on the exact base `5b86cd2ca3b5cc587f7bf42f4331716637081353`. It grants no new authority and does not amend T012–T016 closeouts. If the Builder finds a consumed-package API gap or a normative conflict between this guidance and Frozen Product/L2, treat it as an escalation/authority contradiction rather than silently choosing one.
