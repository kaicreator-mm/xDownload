# T016 Execution Contract — browser + collection workflow integration

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #35, the Frozen Task Pack (`T016_browser-collection-integration.md@39e1e87c1126e3c7bf93d4e84d234fcc92cf0dc9`), Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T016` / Issue `#35`
- Integration base: `version/v0.1.0@4166b51841709bd74cedf1dd89cfcf8f373c38a1` (the T015 merge; base tree `365f1f29f43a095f8223cf3957c1a24baf2653d0`)
- JIT branch: `task/v0.1.0-t016-browser-collection-integration`
- Dependency completion (all CLOSED on the integration base):
  - `T010/#29` merge `f5ac137f94438a591fd6781c5b758be6c375233a` — browser observation, Native Messaging broker and scoped authorization (`@xdownload/browser-observation`, `@xdownload/browser-auth-broker`)
  - `T011/#30` merge `35d322c4a9897ebd1f4ae2cb5fc1d267af68d3ec` — recipe/discovery engine + bounded collection semantics (`@xdownload/discovery-recipe`)
  - `T015/#34` merge `4166b51841709bd74cedf1dd89cfcf8f373c38a1` — authoritative Core runtime (`@xdownload/core-runtime`)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T016_browser-collection-integration.md@39e1e87c1126e3c7bf93d4e84d234fcc92cf0dc9`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Goal of the task (frozen, unchanged)

Integrate browser observation/scoped auth and bounded Recipe/collection workflows with authoritative Core for required S2/S5/S6, preserving snapshot, authorization and no-crawler-escape semantics.

## Required outputs

The implementation must provide ONE workflow integration over the already-merged packages in which:

1. **S2 explicit-attachment handoff (browser → broker → Core).** A current-page explicit attachment/observation captured through `@xdownload/browser-observation` (`recordObservation` with `OBSERVATION_AUTHORITY_MARKER=EVIDENCE_INPUT_ONLY`, `buildObservationHandoff`, provenance-bound records) crosses into the authorization boundary via `@xdownload/browser-auth-broker` (strict `allowed_origins`, no fallback transport, expiring scoped `CapabilityBinding` bound to the exact (origin, target, contract, snapshot, provenance, partition, scope) tuple via `createAuthBroker`/`decodeCapabilityBinding`/`bindingsExactMatch`) and only then drives an authoritative Core acquisition through `@xdownload/core-runtime` (`executeDirectAcquisition`/`executeHlsAcquisition` behind the canonical budget ports). Provenance-bound redirect/CDN locator transitions (S2/C29) preserve logical target identity; unrelated redirects fail without silent target substitution.
2. **S5 current-page collection with `continuation_scope=NONE`.** The confirmed current-page membership snapshot is built with `@xdownload/discovery-recipe` bounded-discovery/identity machinery (`DiscoverySession`, identity accounting, `planConfirmationWorkflow`/`recordConfirmation`) with default `continuation_scope=NONE`; continuation-loaded members are excluded unless an explicit continuation scope was confirmed; later expansion goes only through `admitContinuationRequest`/`assertContinuationWithinFrozenScope`/`deriveContinuationSuccessor` into successor contract/snapshot identity. No arbitrary frontier, no budget-inferred continuation.
3. **S6 explicit playlist/gallery collection.** Declared `CollectionIdentity` with deterministic supported membership relation; only declared collection continuation/member-detail edges; finite or naturally terminable collections close through `selectionAcquisitionComplete`/coverage semantics; failure to close requested continuation yields truthful TRUNCATED/UNKNOWN.
4. **Authorization lifecycle truth end-to-end.** Scoped capability expiry, revocation and use are surfaced truthfully through the composed flow (`capabilityStatus`, broker issue/use/revoke projection): expired/inaccessible members surface as AUTH_REQUIRED/AUTH_FAILED or truthful PARTIAL — never silently skipped, silently re-authorized, or absorbed into a fake COMPLETE.
5. **Snapshot/continuation integrity through composition.** `detectFrozenMembershipDrift`/`planFailedMemberRetry` semantics survive the composed flow unchanged: retry operates on the original frozen snapshot members only; no member replacement/drift; contract/snapshot identity is immutable across retry/resume.
6. **Core stays authoritative; browser stays observation-only.** Canonical vocabulary comes only from `@xdownload/domain-contracts`; terminal statuses/evidence come only from the T007 typed layer through `@xdownload/core-runtime` projection; observation/handoff records remain evidence-input-only and can never self-certify validation claims. Transfer lifecycle stays Core-owned (never browser-owned); no raw reusable secrets cross the boundary (opaque `AuthorizationContextRef` only); exit-sink redaction holds.
7. **Focused end-to-end flows.** Focused fixture and real-browser flows covering S2/S5/S6, expiry, continuation rules, partial/inaccessible members and provenance redirects accompany the composition (see `TEST_MATRIX.yaml`).

The integration is one composition/orchestration layer, not a new domain layer. No domain decision may be made in glue.

## Owned write boundary

T016 owns only the cross-boundary browser→broker→Core handoff, collection workflow orchestration and focused end-to-end fixtures/real-browser tests. Concretely:

- Create the minimal new integration package(s)/composition modules under the existing `packages/*` workspace seam (naming/decomposition is an F1 choice) that compose `@xdownload/browser-observation`, `@xdownload/browser-auth-broker`, `@xdownload/discovery-recipe` and `@xdownload/core-runtime` through their public APIs as-is.
- Add narrowly necessary root workspace dependency/script/config wiring directly required by that package and its tests.
- Add package-local focused integration tests fit for the existing `vitest.config.ts` discovery seam (`packages/*/test/**/*.test.ts`), plus bounded real-browser flow fixtures (local fixture pages/drivers are an F1 choice; external service dependencies are not).

### Forbidden scope

Do not implement, integrate or claim:

- **No browser-owned transfer lifecycle**: observation/attachment hands off to Core; the browser lane never owns transfer execution, progress authority or terminal truth.
- **No unrestricted IPC / transport bypass**: broker/native-messaging stays within the T010 channel with strict `allowed_origins` and no fallback transport; no new privileged transport, no wildcard origins, no secret-bearing IPC payloads.
- **No arbitrary frontier**: S5/S6 discovery stays inside confirmed current-page/declared-collection membership edges; no URL frontier, no crawl-until-empty, no generic site pagination.
- **No continuation inferred from budget**: budget exhaustion never creates or implies continuation scope; continuation exists only as explicit confirmed scope/successor identity.
- **No silent snapshot drift**: membership identity sets are frozen at confirmation; refresh/re-enumeration requires successor identity; count equality never hides replacement.
- **No T017 scope**: no Desktop/CLI surface integration, no `apps/*` product work, no `@xdownload/ai-proposal` convergence, no cross-surface shared runtime. The privileged `apps/browser-extension` context MAY be exercised by real-browser fixtures as a consumer, but T016 does not extend or modify it beyond narrowly necessary test wiring.
- **No frozen-doc mutation**: never modify `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json`, the T016 Task Pack, or any other frozen task pack to ease integration.
- **No consumed-package semantic modification**: upstream package APIs are consumed as-is. Do not edit `packages/domain-contracts`, `packages/core-seam`, `packages/core-scheduler`, `packages/persistence-ledger`, `packages/direct-acquisition`, `packages/hls-vod-adapter`, `packages/browser-observation`, `packages/browser-auth-broker`, `packages/discovery-recipe`, `packages/core-runtime`, `packages/version-validation` or `packages/ai-proposal` to change their semantics, exports or invariants in order to solve an integration problem. A genuine API-gap blocker routes as an escalation, not a local rewrite.
- **No parallel mutable authority**: no second ledger writer, no surface-local result precedence, no private budget ledger, no terminal truth outside the T007 projector, no authorization state outside the broker.
- **No version-level Validation claims**: close with T016 concern evidence only; version-level visible Validation is owned by T020–T023 on the exact T019 candidate.

## Integration precedence rules (glue may decide order, never outcomes)

Where upstream packages leave composition open, glue may choose:

- module/package decomposition of the orchestration layer under `packages/*`;
- how observation handoff records are transported into the composed flow (in-process for fixtures; broker channel for real-browser flows);
- fixture page/driver technology for real-browser flows and their local fixture hosting;
- ordering of discovery → confirmation → snapshot → acquisition steps within the frozen semantics.

Glue may never decide: terminal statuses, authorization verdicts, capability validity, membership identity, coverage truth, continuation admission, or validation outcomes. Those are upstream-owned semantics the composition must expose verbatim.

## Successor / snapshot rule (restated for the integrator)

Any post-confirmation change that changes requested scope, adds continuation authority, materially changes authorization in a way that changes permissible acquisition, or requires re-enumeration must create successor contract/snapshot identity via the T011 continuation machinery. Retry/resume references the original frozen snapshot and operates only on already-authorized members/effects. Restart of the composed flow through `@xdownload/core-runtime` reopen semantics inherits remaining budgets and never implies re-enumeration, budget replenishment or successor identity.

## Verification commands available on the exact base

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T016 concern Validation is separate from this prep task and must additionally prove the T016 workflow/oracle matrix on the exact implementation candidate (including the real-browser flows where applicable). This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T016 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (e.g. integration is only possible by letting the browser lane own transfer truth, or by relaxing broker origin/scope binding).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T016. Current durable execution facts are the materialization terminal, the Issue DAG with native dependencies, the T010/T011/T015 closeouts and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
