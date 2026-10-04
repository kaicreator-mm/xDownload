# T012 Execution Contract — bounded AI proposal adapter

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #31, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T012` / Issue `#31`
- Integration base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`
- Base tree: `e9acfb8020befa669a87f074a6789f754d9ca81e`
- JIT branch: `task/v0.1.0-t012-ai-proposal-adapter`
- Dependency completion: `T007/#26` closed, merge commit `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`; `T011/#30` closed, merge commit `35d322c4a9897ebd1f4ae2cb5fc1d267af68d3ec`
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T012_ai-proposal-adapter.md@358fc1dfcbb0a056f09063a5ba1bee10182515e1` @ freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`

## Goal

Implement the optional model-provider adapter that receives only redacted bounded knowledge gaps/observations and returns schema-constrained Recipe proposals validated by deterministic Core policy — without granting scope/navigation/secret/validation authority.

## Owned write boundary

T012 owns only the AI proposal/redaction boundary: provider abstraction, redaction, proposal schema, proposal validation/rejection and no-model fallback, plus directly necessary fixtures, negative fixtures and concern tests.

The exact base already contains merged packages `domain-contracts` (T002+T007 canonical vocabulary, evidence/validation/result projection), `discovery-recipe` (T011 declarative Recipe schema/decoder/engine), `core-seam` (T004), `persistence-ledger` (T005), `core-scheduler` (T006), `direct-acquisition` (T008), `browser-observation` and `browser-auth-broker` (T010), plus `apps/browser-extension`. No AI/model/proposal package or vocabulary exists anywhere yet. The Builder may create the minimal new package(s) under the existing `packages/*` workspace seam needed to satisfy T012, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

### Forbidden scope

Do not implement or redesign:

- Desktop, Browser Integration or CLI surfaces (surface+AI convergence wiring belongs to T017);
- modification of the frozen canonical vocabulary in `@xdownload/domain-contracts` or of the `@xdownload/discovery-recipe` Recipe schema/decoder to admit proposals more easily;
- scheduler/budget machinery, persistence/ledger, transfer/media adapters, auth broker internals;
- real model-provider network integration as a required runtime path, or any provider SDK dependency as a required capability;
- AI authority beyond proposals: no mutation of confirmed scope, no navigation/auth grant, no shell/JS execution, no secret persistence/export, no validation/coverage self-certification, and no making the model required for deterministic/template-supported ordinary tasks;
- packaging/release/platform qualification;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T012 Task Pack to make implementation easier.

## Required semantic outputs

1. **Provider abstraction (optional)** — a provider-agnostic model port with injectable implementations; the deterministic product path must be complete and correct with the provider absent, unreachable or misbehaving. Provider identity/version must be recorded where proposals are traced.
2. **Redaction boundary (model input)** — model input may be built only from redacted bounded knowledge gaps/observations and capability facts. Every value crossing toward model input must pass redaction equivalent to the T010 exit-sink rules: key-based containment of `RAW_SECRET_FIELD_NAMES` at any nesting depth plus value-based sentinel containment, so secret material smuggled into non-secret-named fields cannot leak either (PRD §29: LLM may receive capability facts but must not require raw secrets; L2 §6.4: redact secrets at model boundaries).
3. **Proposal schema** — a proposal envelope that carries provenance/traceability (which gap/observation, which contract context, which provider) and a payload that must decode as a `RecipeDefinition` through the **unmodified** `decodeRecipeDefinition` of `@xdownload/discovery-recipe` — the proposal target schema. Proposals invent no authority fields; unknown fields fail closed; a bounded size limit rejects oversized proposals before policy evaluation.
4. **Deterministic proposal validation/rejection policy** — the same Core policy runs with or without a model and rejects at least: payload that does not decode as a RecipeDefinition; capability lists outside the finite `CAPABILITY_KINDS` vocabulary or misusing active vs passive capability rules; evidence rules violating the `SUGGESTIVE` discovery ceiling or the fixed `DISCOVERY_DERIVED` independence; fallback kinds other than `ASK_USER`/`ABORT`; any scope-mutating, navigation/auth-granting, shell/JS-executing, secret-embedding or validation-certifying content; malformed/oversized/unknown-version envelopes. Rejection is deterministic: same proposal + same gap + same contract context yields the same accept/reject.
5. **No-model fallback** — provider outage, timeout, or malformed/unusable response must degrade truthfully: fall back to the deterministic/template path or `ASK_USER`/`ABORT`, surfaced as typed unavailability/unknown — never silently as success, and never by widening behavior (Task Pack: "Model unreliability must degrade truthfully, not widen behavior").
6. **Proposal evidence typing** — model output provenance is at best `SUGGESTIVE` discovery-derived suggestion; it can never be typed as independent validation truth, cannot self-certify coverage/validation, and acceptance of a proposal creates no authority by itself (C34, C19).

## Authority non-leakage rule

A proposal is data, never authority. An accepted proposal never grants scope, navigation, authorization, secret access or validation/coverage authority. Anything actionable in a proposal must flow through the existing deterministic paths — Recipe decode, capability authorization, contract/snapshot scope validation, user confirmation and typed evidence — exactly as if a human had suggested the same Recipe. No hidden authority elevation may exist anywhere in the adapter path.

## Required invariants / invalid states

Fail closed when the model, its transport, or proposal data is malformed, oversized, unsupported or hostile. The adapter/policy layer must reject at least:

- proposals whose payload is not decodable as a current-version RecipeDefinition;
- proposals introducing unknown or authority-changing fields;
- capability vocabulary violations (unknown kinds; active-capability plans detached from confirmed scope/continuation authority);
- proposals that reference, embed or require raw secrets, cookies, tokens, passwords or signed URLs as durable reusable rules;
- proposals attempting shell/JS execution, arbitrary filesystem access, host scanning or recursive arbitrary navigation;
- proposals claiming validation, coverage or independence beyond discovery-derived suggestion;
- oversized payloads exceeding the declared bounded limit;
- model unavailability being presented as task success, or model failure being explained into success (PRD §30: failure category must not be silently rewritten to success by retries or AI explanation);
- the model becoming a required dependency of deterministic/template-supported ordinary tasks (PRD §5.1 Minimum Necessary Intelligence ladder).

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal file decomposition under `packages/*`;
- provider port shape and the offline/fake provider used by tests (tests must not require real network/model access);
- proposal envelope field layout, provided provenance, payload, size bound and version identity are explicit;
- whether the adapter surface reuses `@xdownload/core-seam` envelope/diagnostic conventions (recommended pattern reference; surface wiring remains T017);
- redaction implementation reuse (`@xdownload/browser-observation` `redactForSink`) versus an equivalent local implementation, provided containment strength is not weakened and is proven by sentinel tests;
- whether model calls are represented as budget-billable facts (PRD §15.1/§15.3 treat model calls for discovery/adaptation as billable) — representation only; no private budget writer and no scheduler changes.

These choices must not weaken or reinterpret the required outputs/invariants.

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

T012 concern Validation is separate from this prep task and must additionally prove the T012 schema/policy-rejection, secret-redaction, model-offline-fallback and malicious-proposal matrices on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T012 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (including ADR-008: AI is proposal-only and cannot grant authority).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5. Do not rewrite it as part of T012. Current durable execution facts are the materialization terminal, Issue DAG, T007/T011 closeouts and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
