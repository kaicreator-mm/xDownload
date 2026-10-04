# T012 Implementation Map — exact base `f5ac137f94438a591fd6781c5b758be6c375233a`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T012 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies; still **no runtime dependencies** | Modify only if narrowly necessary for the T012 package/test wiring. Do not add provider SDKs or broaden scripts into product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T012 adapter code belongs under the already-existing `packages/*` seam. `apps/*` is outside T012. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T012 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T012 schema/policy/redaction/fallback/malicious-proposal tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T012 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002+T007 merged canonical vocabulary: contract/scope/snapshot/budget/evidence/result types; `decode.ts` (`rejectUnknownFields`, `rejectRawSecretFields`, `RAW_SECRET_FIELD_NAMES`), `version.ts` (`decodeSchemaIdentity`, `DOMAIN_CONTRACTS_SCHEMA_ID`/`_VERSION`), `diagnostics.ts` (`DomainValidationResult`, `ok`/`fail`/`andThen`), evidence vocabulary (`ClaimType`, `CertaintyClass`, `IndependenceFromDiscovery = 'DISCOVERY_DERIVED' \| 'INDEPENDENT'`, `EvidenceDomain`), KnowledgeRecord (`KnowledgeKind`) | The only scope/evidence/result authority. T012 consumes this vocabulary; it must not modify it to admit proposals. Proposal provenance/evidence must type as discovery-derived suggestion within these existing types. |
| `packages/discovery-recipe/` | T011 merged declarative Recipe engine: `decodeRecipeDefinition(value: unknown)` — the fail-closed Recipe decoder (`schemaIdentity`, `recipeId`, `applicabilityScope`, `matcher` (`allOf` of `equals`/`contains`/`exists`), `parameterSchema`, `allowedCapabilities` via `decodeCapabilityList`, `evidenceRules` with `certaintyCeiling` + `independenceFromDiscovery` fixed `DISCOVERY_DERIVED`, `validationRequirements`, `failureConditions`, `deterministicFallback` `ASK_USER`\|`ABORT`); `matchRecipe`, `authorizeCapability`, `planRecipeExecution`, `recipeEvidenceRecord`; `CAPABILITY_KINDS`/`isPassiveCapability` | **The proposal target schema.** T012 proposal payloads must decode through this decoder unmodified; the deterministic acceptance policy composes it with contract/snapshot scope validation. Do not fork, relax or re-implement the Recipe schema. |
| `packages/browser-observation/` | T010 merged observation boundary including `sinkRedaction.ts`: `redactForSink` (key-based containment of `RAW_SECRET_FIELD_NAMES` at any nesting depth + value-based wholesale replacement of registered sentinel-bearing strings), `REDACTED_MARKER`, `registerSinkScrubSentinel`/`clearSinkScrubSentinels`; observation/provenance/handoff types | The model-input redaction precedent (L2 §6.4: redact secrets at model/Recipe boundaries; PRD §29/C21). T012 redacts before anything reaches a provider request; sentinel registration is the sanctioned audit/test mechanic. |
| `packages/browser-auth-broker/` | T010 merged broker/secret zone: `broker.ts`, `secretZone.ts`, `capability.ts`, `allowedOrigins.ts`, `brokerChannel.ts` | Raw session secrets remain in the broker/browser secret zone; L2 ownership table forbids ordinary Core persistence/LLM/Recipe/log export. T012 must never import or request raw secret material. |
| `packages/core-seam/` | T004 merged command/query seam: `envelope.ts`, `peer.ts` (peer identity, `SURFACE_KINDS`), `bounds.ts`, `diagnostics.ts` (`SeamResult`), `transport-loopback.ts` | Pattern reference for the T012 Core-side adapter port/diagnostics. Surface wiring (who calls the adapter) stays T017; T012 builds no surface. |
| `packages/core-scheduler/` | T006 merged budget/scheduler/cancellation machinery: `budgets.ts` (`BudgetDomain`, `BudgetAction`, `decodeDurableBudgetProfile`), `machine.ts`, `store.ts` | PRD §15.1 bills "model calls for discovery/adaptation" under DiscoveryBudget; §15.3 folds configured model cost/calls into GlobalSafetyBudget. T012 may represent model-call facts; no private budget writer and no scheduler modification. |
| `packages/persistence-ledger/`, `packages/direct-acquisition/`, `packages/toolchain-smoke*/` | T005/T008 merged ledger and direct HTTP transfer; T001 smoke packages | Reference only. T012 adds no transfer/ledger behavior; proposals are not transfer instructions. |
| `apps/browser-extension/` | T010 surface package | Outside T012. No extension changes; AI surface integration is T017. |
| `.agent/execution/T001…T011/` | prior JIT packs, evidence only | `.agent/execution/T012/` follows the same rule: guidance/evidence only; never product content; not implementation source. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics | Read-only authority: §5.1 Minimum Necessary Intelligence ladder, §15 budgets, §23 Template/Recipe Contract, §24 Knowledge Promotion, §29 Security/Authorization Boundary, §30 Failure Taxonomy, §35 C01–C34, gates G1/G2. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: ADR-007 (declarative Recipe interpreter), ADR-008 (AI is proposal-only and cannot grant authority), §6.4 redaction at logs/evidence/model/Recipe/Core-durable boundaries, data-ownership/trust table (raw session secrets row). |
| `docs/implementation/v0.1.0/task-packs/T012_ai-proposal-adapter.md` | frozen T012 WHAT blob `358fc1dfcbb0a056f09063a5ba1bee10182515e1` | Read-only task authority. |

## Current absence facts that matter

At the bound base there is **no** AI/model/provider package, no proposal vocabulary anywhere (verified: no `Proposal` types in `core-seam`/`domain-contracts`), no general model-provider HTTP client (direct-acquisition is transfer-scoped), and no model-offline machinery. T012 therefore creates the minimum new adapter surface rather than wiring into an existing one. No `hls-vod`/version-validation package exists on this base either; neither is a T012 dependency.

This absence is not permission to invent later architecture. T012 stops at provider abstraction, redaction, proposal schema, deterministic validation/rejection and no-model fallback, plus their tests.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- provider port + deterministic offline/fake provider implementation for tests;
- redaction-aware model-input/gap envelope builder (bounded redacted gaps in);
- proposal envelope decode: size cap → schema/version → provenance binding → payload decode via `decodeRecipeDefinition`;
- deterministic proposal validation/rejection policy (pure functions over canonical vocabulary);
- no-model fallback resolver (deterministic path / `ASK_USER` / `ABORT` with typed unavailability);
- tests mapping to `TEST_MATRIX.yaml`, including the applicable C-oracle mappings.

Do not split by surface and do not add persistence/network/transfer implementations beyond the injectable provider port itself.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`. T012 must not require a provider SDK: the provider port admits injectable implementations and tests use a local offline/fake provider. If the Builder nonetheless adds a runtime dependency, it is an F1 choice that must record exact package/version/license/provenance and demonstrate that dependency semantics do not redefine Product/L2 authority. The JIT pack intentionally does not preselect a provider or SDK.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T012 tests should remain package-local, use no real network/model access, and cover:

- proposal decode/accept for legal Recipe payloads; deterministic policy accept/reject;
- malformed/oversized/unknown-version/unknown-field rejection;
- malicious proposals (scope mutation, authority grants, shell/JS, secret embedding, self-certification) rejecting;
- secret sentinel redaction audits at the model-input and proposal-audit boundaries (`registerSinkScrubSentinel` mechanics);
- provider outage/timeout/malformed-response fallback with truthful typed degradation;
- parity of the same policy with and without model (C19) and suggestion-never-truth provenance (C34).

No real provider call, browser, filesystem, database, media transfer or UI harness belongs in T012 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T012 branch descends from the manifest base `f5ac137f94438a591fd6781c5b758be6c375233a`;
- frozen Task Pack/ADS identities still match (`358fc1dfcbb0a056f09063a5ba1bee10182515e1`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
