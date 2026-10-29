# T012 L3 Reference Pack — bounded AI proposal adapter

Task: `T012` / Issue `#31`  
Bound base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a model provider or SDK and does not redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner and in-repo precedents

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

T011 left the closest in-repo precedents — study them before writing anything:

- `packages/discovery-recipe/test/oracles-t011.test.ts` — how C-oracle mappings are made durable and executable;
- `packages/discovery-recipe/test/recipe-engine.test.ts` and `fixtures.ts` — decoder-driven positive/negative table fixtures;
- `packages/discovery-recipe/test/discovery-bounds.test.ts` — how bounded-behavior rejection is tested.

**Patterns to emulate:**

- table-driven malicious-proposal corpus: one stable identity per attack class (scope mutation, authority grant, shell/JS, secret embedding, self-certification, unknown-field smuggling, oversize);
- decode proposals from `unknown` input through the real `decodeRecipeDefinition`, never from pre-typed objects;
- offline/fake provider doubles: outage, timeout, garbage bytes, hostile valid-schema payload, oversized payload;
- sentinel-based redaction audits using `registerSinkScrubSentinel`/`redactForSink` mechanics over model input, proposal payload and provider response;
- parity tests running the identical policy with provider present, absent, and failing (C19);
- fresh construction per case; equality by identity, never count-only.

Primary reference: Vitest at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11` (MIT; already selected by T001 — T012 does not introduce it).

### 1.2 No real provider in tests

Tests must not require network or a live model. The provider port must admit a deterministic offline/fake implementation; if a real SDK exists it stays behind the port and out of tests. Provider SDKs are never pinned by this pack.

## 2. Contract / interface references

### 2.1 The proposal target schema already exists — do not invent a second one

`decodeRecipeDefinition(value: unknown): DomainValidationResult<RecipeDefinition>` in `packages/discovery-recipe/src/recipe.ts` is the fail-closed Recipe decoder implementing Frozen PRD §23 and L2 ADR-007: `schemaIdentity`, `recipeId`, `applicabilityScope`, `matcher` (`allOf` of `equals`/`contains`/`exists`), `parameterSchema`, `allowedCapabilities` (finite `CAPABILITY_KINDS`), `evidenceRules` (`certaintyCeiling`, `independenceFromDiscovery` fixed `DISCOVERY_DERIVED`), `validationRequirements`, `failureConditions`, `deterministicFallback` (`ASK_USER`|`ABORT`). It already rejects raw-secret fields and unknown fields.

T012 proposal envelopes should therefore be thin: version identity + size bound + provenance (gap/contract/provider) + payload. All Recipe semantics live in the existing decoder and policy — the adapter adds only provenance, bounding and transport isolation.

### 2.2 Canonical decode/diagnostics conventions

Reuse `@xdownload/domain-contracts` mechanics so T012 reads like the rest of Core:

- `rejectUnknownFields`, `rejectRawSecretFields`, `RAW_SECRET_FIELD_NAMES` (`decode.ts`);
- `decodeSchemaIdentity`, `parseSemVer` (`version.ts`);
- `DomainValidationResult`, `ok`/`fail`/`diagnostic`/`andThen`/`deepFreeze` (`diagnostics.ts`);
- evidence typing: `CertaintyClass` (`SUGGESTIVE` ceiling), `IndependenceFromDiscovery` (`DISCOVERY_DERIVED`), `ClaimType`, `EvidenceDomain` (`evidence.ts`);
- `@xdownload/core-seam` `SeamResult`/envelope/diagnostics as the pattern reference for the Core-side adapter port.

### 2.3 Redaction contract

`packages/browser-observation/src/sinkRedaction.ts` defines the frozen containment semantics: key-based (`RAW_SECRET_FIELD_NAMES`, any depth) plus value-based (registered sentinels, wholesale replacement) — built for exactly the L2 §6.4 rule "redact secrets at logs/evidence/model/Recipe/Core-durable boundaries". T012 model-input construction must satisfy these semantics; reusing `redactForSink` directly or matching it with proven sentinel tests are both acceptable.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Pipeline shape

```text
redacted bounded gap/observations
→ provider port (optional, injectable; fake in tests)
→ proposal envelope decode (size cap → version → provenance binding)
→ payload decodeRecipeDefinition (unmodified)
→ deterministic Core policy (scope/capability/evidence/fallback rules over canonical vocabulary)
→ accepted proposal value (data only) OR typed rejection OR typed unavailability → deterministic fallback
```

The provider is an optional proposal source; the deterministic path never depends on it (PRD §5.1 ladder: Deterministic → Template/Recipe → Template+confirmation → LLM-assisted adaptation → bounded exploration → explicit UNKNOWN/UNSUPPORTED).

### 3.2 Proposal is data, authority lives elsewhere

Acceptance produces a proposed Recipe value with suggestion provenance. Turning it into behavior requires the exact same deterministic machinery as any human-suggested Recipe: `matchRecipe`, `authorizeCapability`, `planRecipeExecution`, contract/snapshot scope validation, user confirmation where required, typed evidence. If any proposed action cannot be expressed through those paths, it is rejected — not granted a side door (L2 ADR-008).

### 3.3 Redact before serialize

Construct model input only after redaction; never serialize raw context and strip later. Deep-redact first (`redactForSink` semantics), then bound the size, then send. Audit provider responses for sentinels before any durable use.

### 3.4 Bounded envelopes

Every external-facing T012 structure (gap envelope, proposal envelope) carries: explicit schema version, a declared maximum size enforced before deep processing, unknown-field rejection, and provenance binding. This mirrors the existing decoder discipline and makes oversized/hostile input a cheap early rejection.

## 4. Failure handling patterns

### Provider unavailability

Outage/timeout/malformed response ⇒ typed unavailability + deterministic fallback (`ASK_USER`/`ABORT` or the template path). Never retry into success, never mark partial work complete, never widen behavior. PRD §30: "Failure category must not be silently rewritten to success by retries or AI explanation."

### Hostile or invalid proposals

Oversize ⇒ early rejection. Schema/unknown-field/version violations ⇒ typed rejection preserving diagnostics. Semantic violations (scope mutation, authority grant, self-certification, secret embedding) ⇒ deterministic rejection naming the violated invariant. Never normalize an invalid proposal into a legal one.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict (incl. ADR-008 pressure) → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T012 acceptance

| Acceptance concern (Frozen Task Pack) | Reference pattern | Required T012 proof |
| --- | --- | --- |
| Malicious/oversized/invalid proposal rejection | §3.4 bounded envelopes + T011 negative-fixture style | corpus rejects every attack class deterministically |
| Secret sentinel tests | `sinkRedaction.ts` key+value containment | sentinel leakage impossible at model-input/payload/response audit boundaries |
| Provider outage/timeouts | §4 typed unavailability | truthful degradation, deterministic fallback intact |
| Deterministic fallback | PRD §5.1 ladder + `RecipeFallback ASK_USER/ABORT` | no-model path complete; model never required |
| Same policy with/without model | C19 parity | one deterministic policy either way |
| No hidden authority elevation | §3.2 data-not-authority + L2 ADR-008 | explicit tests prove unchanged authority with adapter present |
| Schema/policy rejection (Issue #31) | §2.1/§2.2 existing decoder + diagnostics | payloads decode only via `decodeRecipeDefinition`; policy rejections typed |
| Model-offline fallback (Issue #31) | §4 | outage/timeout degrade truthfully |
| Malicious proposal tests (Issue #31) | §1.1 corpus | executable negative coverage per class |

Supporting read-only authorities: PRD §5.1 (Minimum Necessary Intelligence), §15 (budgets bill model calls), §23 (Recipe contract), §24 (knowledge promotion — L1 requires no embedded credentials), §29 (security boundary: LLM gets capability facts, never raw secrets), §30 (failure taxonomy), §35 C06/C19/C20/C21/C22/C34; L2 ADR-007/ADR-008, §6.4, and the data-ownership table's raw-session-secrets row.

## 6. Dependency/version/license facts

| Package | Exact version on bound base | License | T012 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static modeling of envelope/policy types (already selected by T001) |
| `vitest` | `4.1.11` | MIT | executable schema/policy/redaction/fallback/malicious tests (already selected by T001) |

**No model provider or SDK is pinned or recommended.** The exact base has no runtime dependencies. The provider port admits injectable implementations and tests use a local offline/fake provider. If the Builder adds a runtime dependency, implementation evidence must record exact package name/version/license and primary source, and Review must check it does not become de facto Product/Architecture authority or a required capability.

## 7. Do / Don't

### Do

- decode proposals through the real `decodeRecipeDefinition` from `unknown` input;
- keep acceptance authority-free and route action through existing deterministic paths;
- redact before serialize; audit with sentinels at every T012 boundary;
- bound every envelope with explicit version + size limit + unknown-field rejection;
- degrade truthfully to deterministic path or `ASK_USER`/`ABORT`;
- prove parity and no-authority-elevation with explicit executable tests.

### Don't

- don't fork/relax the Recipe schema, capability vocabulary or canonical contract types;
- don't let proposals mutate scope, grant navigation/auth, execute shell/JS, persist/export secrets, or certify validation/coverage;
- don't require a live model or SDK anywhere — least of all in tests;
- don't let model suggestions be typed as independent truth (`SUGGESTIVE`/`DISCOVERY_DERIVED` ceiling);
- don't normalize failures into success or widen behavior when the model fails;
- don't copy provider SDK code or large external implementations into this repository.

## 8. Reuse / license risk

Risk is low if external material is used as design/testing reference only. The critical reuse here is in-repo: `decodeRecipeDefinition`, the domain-contracts decode/diagnostics helpers, and `sinkRedaction` containment semantics. Any new dependency must record exact provenance/version/license in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T012. The later Builder produces an exact candidate; T012 concern Validation must execute the schema/policy-rejection, secret-redaction, model-offline-fallback and malicious-proposal matrices on that exact candidate; Fresh Independent Review is separately required because T012 is `risk:high` and `review:required`.
