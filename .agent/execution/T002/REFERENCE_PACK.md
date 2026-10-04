# T002 L3 Reference Pack — canonical contracts, schemas and semantic kernel

Task: `T002` / Issue `#21`  
Bound base: `version/v0.1.0@72b04774592265953671f7203d5ca0687da5b033`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a new runtime schema library or redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

Use table-driven/parameterized contract fixtures so each legal and illegal tuple has a stable oracle identity. Keep positive and negative cases adjacent. For semantic predicates, prefer explicit fixtures over snapshots of incidental implementation structure.

**Patterns to emulate:**

- `test.each` / table-driven cases for legal and forbidden status combinations;
- decode tests from `unknown` input, not only construction from already typed TypeScript objects;
- compatibility matrix tests by declared schema version;
- immutable fixture inputs and fresh construction per case so tests cannot pass through shared mutation;
- equality by logical identity sets, never count-only completeness;
- explicit rejection tests for unknown/incompatible versions and authority-changing unknown fields;
- one fixture/oracle mapping for every Product counterexample C01–C34 at the contract representation layer.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`.

License fact: `vitest@4.1.11` is MIT-licensed at tag `v4.1.11`. It is already selected by T001; T002 does not introduce it.

### 1.2 Property-style invariants without adding a property-test dependency

High-ROI invariant families can be exercised by small deterministic generated tables using existing Vitest first:

- reordering member lists does not change set identity when order is semantically irrelevant;
- replacing one member while preserving count never preserves completeness;
- retry operations cannot enlarge selected identity sets;
- budget changes cannot change requested scope identity;
- locator changes do not change logical identity unless the binding/provenance contract says target identity changed;
- decode(encode(value)) preserves canonical semantics for supported versions if an encoding surface is implemented.

Do not add a property-testing package merely for L3 convenience. A Builder may later justify one, but it is not required by this pack.

## 2. Contract / interface references

### 2.1 JSON Schema Draft 2020-12 — design reference, not mandated implementation

Primary references:

- Core: `https://json-schema.org/draft/2020-12/json-schema-core`
- Validation: `https://json-schema.org/draft/2020-12/json-schema-validation`

Use these as mature design references for explicit schema identity/versioning, required properties, enumerated/discriminated values, composition and fail-closed validation vocabulary. T002 does **not** require emitting JSON Schema and does not require a JSON Schema runtime package. If emitted, generated/hand-authored schema must remain subordinate to one canonical semantic source and its compatibility tests.

Relevant patterns:

- explicit schema/version discriminator at externally decoded boundaries;
- `oneOf`/discriminator-style conceptual modeling for mutually exclusive variants;
- reject semantically incompatible variants even when fields are structurally present;
- separate syntactic shape validation from cross-field semantic invariant validation.

### 2.2 TypeScript discriminated unions and exhaustive narrowing

Exact compiler on the base: `typescript@5.9.3`, with strict mode and `noUncheckedIndexedAccess` enabled.

Primary references:

- TypeScript Handbook narrowing/discriminated unions: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions`
- exact source tag: `https://github.com/microsoft/TypeScript/tree/v5.9.3`

License fact: `typescript@5.9.3` is Apache-2.0 licensed at tag `v5.9.3`. It is already selected by T001; T002 does not introduce it.

Use discriminants for canonical closed result/status/scope variants and exhaustive handling. However, TypeScript static types are erased at runtime: **never treat a TypeScript type assertion/cast as validation of untrusted data**. The boundary must be `unknown input → runtime decode/validation → canonical typed value`.

### 2.3 Contract identity pattern

Prefer explicit nominal/branded identifier categories (implementation technique remains F1) so the compiler/tests cannot casually substitute:

- `ContractId`
- `SnapshotId`
- `LogicalTargetId`
- `MemberId`
- `EffectId`
- `AuthorizationContextRef`
- schema/version identity

The semantic requirement is category separation, not a specific branding implementation.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Parse, then validate semantics

Recommended flow:

```text
unknown external value
→ structural/version decoder
→ canonical typed candidate
→ cross-field semantic invariant validation
→ accepted immutable/canonical value
```

Do not mix transport/source-specific interpretation into the canonical domain package. Browser/network/media/persistence adapters later translate into canonical values through ports.

### 3.2 Stable logical identity separate from locator

Model the stable resource/member/effect identity independently from delivery locators. Redirect/CDN/signed URL changes are locator/provenance facts, not automatically new targets. Tests must prove both sides:

- traceable locator change may retain identity;
- unrelated locator substitution may not inherit identity.

Do not use URL string equality as the universal identity model.

### 3.3 Immutable confirmed scope and SelectionSnapshot

Once confirmed, requested scope + continuation scope + requested/selected member identity basis are immutable. Changes that alter scope, continuation authority, authorization in a way that changes permissible acquisition, or require re-enumeration produce successor contract/snapshot identity.

For retry/resume, reference original snapshot identity and operate only on its frozen members/effects.

### 3.4 Budget domains are constraints, never scope

Keep `DiscoveryBudget`, `TransferBudget`, and `GlobalSafetyBudget` type-distinct enough that semantic functions cannot accidentally use a budget as a membership/scope source. Retry/restart inherits remaining budget; this contract layer need only make illegal semantic reinterpretations rejectable/untypeable, not implement the durable budget ledger.

### 3.5 Typed result + Evidence/Validation identities

Preserve separate dimensions:

- RequestFulfillmentStatus
- TargetResolutionStatus
- SelectionAcquisitionStatus
- CoverageStatus
- StopReason
- ValidationSummary

Evidence records must preserve claim type/subject, provenance/source identity, scope and independence semantics. Discovery and UI suggestion provenance must not masquerade as independent validation truth.

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Unknown/malformed version

- unsupported schema version → typed incompatibility/rejection;
- missing version at a boundary that requires one → reject;
- never silently reinterpret unknown enum/discriminant values as a known default;
- migration, if implemented, must be explicit and tested source-version → target-version behavior, never mutation of historical identity.

### Invalid state combinations

Structural validation is insufficient. Cross-field semantic validation must reject forbidden tuples from Frozen Product §18 and C01–C34. Do not normalize invalid states into the nearest legal status.

### Unknown fields

Fields that are irrelevant extension metadata may be handled only if the chosen compatibility policy explicitly permits them. Any unknown field that could change scope, identity, authorization, budget, result or validation authority must fail closed until the version/compatibility rule recognizes it.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T002 acceptance

| Acceptance concern | Reference pattern | Required T002 proof |
| --- | --- | --- |
| Versioned contracts | JSON Schema 2020-12 design vocabulary + explicit TS discriminants | supported version parses; unknown/incompatible version rejects |
| AcquisitionContract | Frozen PRD §§8–10 | required fields + immutable scope/continuation semantics |
| SelectionSnapshot | Frozen PRD §12 | immutable membership/selection; successor rules |
| Identity vs locator | Frozen L2 D2 / invariants | stable logical identities distinct from volatile delivery locators |
| Budget domains | Frozen PRD §15 / L2 D3 | budgets distinct and cannot define scope |
| Evidence/Validation | Frozen PRD §§20–22 / L2 typed evidence invariant | provenance/claim subject/independence represented; no self-certification |
| Result identities | Frozen PRD §§16–19 | multidimensional result + forbidden-combination rejection |
| S1–S6 | Frozen PRD §28 | representation only; no adapter implementation |
| C01–C34 | Frozen PRD §35 + `TEST_MATRIX.yaml` | every counterexample has a contract-level oracle/fixture mapping |

## 6. Dependency/version/license facts

### Already pinned and recommended for T002 use

| Package | Exact version on bound base | License | T002 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static contract modeling, strict exhaustive type checking |
| `vitest` | `4.1.11` | MIT | executable contract/schema/negative tests |

Sources: root `package.json` on exact base; upstream exact-tag license files in `microsoft/TypeScript@v5.9.3` and `vitest-dev/vitest@v4.1.11`.

### New runtime validator dependency

**None is recommended or pinned by this Reference Pack.** The exact base has no runtime dependencies. Under `F1_BOUNDED_IMPLEMENTATION`, the Builder may choose a small validator library or implement bounded deterministic validators. If adding a package, the implementation evidence must record exact package name/version/license and primary source, and Review must check that the library does not become de facto Product/Architecture authority.

This keeps library popularity from becoming an architectural decision.

## 7. Do / Don't

### Do

- use runtime validation for untrusted decoded data;
- make schema/version compatibility explicit and testable;
- keep canonical values deterministic and pure;
- use exhaustive discriminants for closed status/scope/result sets;
- test semantic negative states, not only valid construction;
- map C01–C34 explicitly and preserve Product-specific expected tuples;
- keep logical IDs, locators, authorization refs and raw secrets separate;
- preserve one Core-owned semantic vocabulary consumed later by adapters.

### Don't

- don't implement Desktop/Browser/CLI/persistence/network/media/scheduler behavior;
- don't let TypeScript `as` casts stand in for runtime validation;
- don't infer completeness from counts/budget/timeout alone;
- don't make budget or auth context redefine requested scope;
- don't mutate confirmed snapshots;
- don't store raw reusable credentials as canonical public/domain fields;
- don't add a schema library solely because it is popular;
- don't copy large external implementations or licenses into this repository.

## 8. Reuse / license risk

Risk is low if external material is used as interface/testing/design reference only. Do not copy substantial source from TypeScript, Vitest or other libraries into T002. If a new dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR. JSON Schema references here are standards/design references; no spec text needs to be copied into product source.

## 9. Validation boundary

This Reference Pack does not prove T002. The later Builder produces an exact candidate; T002 concern Validation must execute the contract/schema test matrix on that exact candidate; Fresh Independent Review is separately required because the public API/schema task is `risk:critical` and `review:required`.
