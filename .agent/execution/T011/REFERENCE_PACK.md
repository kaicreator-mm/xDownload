# T011 L3 Reference Pack — declarative Recipe engine, bounded discovery, collection semantics

Task: `T011` / Issue `#30`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a new runtime dependency, extend the capability vocabulary, or redefine discovery semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

T011 acceptance is fixture-driven by definition ("Fixtures cover continuation_scope=NONE, declared batch/page/natural-end bounds, successor contract/snapshot, page loops/failures, member detail/CDN provenance, identity-not-count completeness, crawler rejection and batch/manual confirmation"). Build small structured page/collection fixtures — plain data emulating DOM/metadata/network observation shapes — so each declared-bounds and loop/failure case has a stable oracle identity. T003 owns the shared validation corpora; T011 concern tests use package-local fixtures only.

**Patterns to emulate:**

- `test.each` / table-driven fixtures for continuation forms: NONE, batch(n), page-range(a..b), natural-end, each with its exact expected stop/status tuple;
- step-sequence tests for declared-bounds continuation: a scripted member/page feed with injected failures, loops and budget stops;
- successor-admission tests asserting new contract/snapshot identity and original immutability;
- capability-vocabulary tests: every legal capability decodes and plans; every forbidden expression (shell/JS/fs/cookie-export/host-scan/recursive) fails closed;
- identity-set assertions (set equality on member identities), never count-only completeness;
- confirmation-workflow tests proving selection claims are typed separately from validation evidence;
- fixture mapping for every applicable C01-C34 collection oracle in `TEST_MATRIX.yaml`.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`.

License fact: `vitest@4.1.11` is MIT-licensed at tag `v4.1.11`. It is already selected by T001; T011 does not introduce it.

### 1.2 Deterministic orchestration without I/O

The T011 engine should be testable as pure decision logic: canonical contract/snapshot/budget/evidence values in → bounded next-action/stop/tuple out. Keep all I/O behind narrow port functions so fixture tests never need browser/network:

- discovery stepping consumes a provided observation/member feed, not a live page;
- budget state is passed in as canonical `BudgetRemaining`-shaped values (the durable ledger is T006);
- time, if needed for declared bounds, is injected.

## 2. Contract / interface references

### 2.1 The T002 canonical layer is the interface

Consume `@xdownload/domain-contracts` rather than re-modeling:

- `decodeAcquisitionContract` / `admitCollectionContract` — the only admission gate; T011 dispatches nothing that failed admission (frontier rejection already lives here — do not bypass or duplicate it);
- `ContinuationScope`/`decodeContinuationScope`/`validateScopeContinuationPair` — the exact frozen continuation grammar (NONE, declared batch/page-range/natural-end);
- `buildSnapshot` / `validateSnapshotSemantics` / `assertSnapshotImmutable` / `planRetryOfFailedMembers` / `deriveSuccessorSnapshot` — frozen membership, retry domain, successor identity;
- `decodeBudgetProfile` / `budgetRemaining` / `canStartNewDiscoveryWork` / `canTransferAfterDiscoveryExhaustion` — budget stop decisions as pure predicates;
- `EvidenceRecord` / `assertNoDiscoverySelfCertification` — discovery output typed as DISCOVERY_DERIVED, never independent truth;
- `TerminalResult` / `validateTerminalResult` — §10.2/§17/§18 exact tuples; T011 supplies inputs, never per-surface projections;
- `DomainGateway` — the adapter-facing seam to bind workflow logic to.

The frozen L2 blob is `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` (read-only). Its §6.6 `RecipeDefinition`/execution pipeline is the interface shape for the recipe engine:

```text
RecipeDefinition: recipe_id/schema_version, applicability_scope, matcher,
parameter schema, allowed_capabilities[], extraction/evidence rules,
validation requirements, failure conditions, deterministic fallback

contract + observations → deterministic matcher → capability plan
→ policy/scope validation → bounded execution → typed evidence
→ independent validation
```

### 2.2 TypeScript discriminated unions for closed vocabularies

Exact compiler on the base: `typescript@5.9.3`, strict mode, `noUncheckedIndexedAccess` (T001-selected; Apache-2.0 at tag `v5.9.3`).

Reference: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions`.

Model capability kinds, continuation forms, membership-basis kinds and stop reasons as discriminated unions with exhaustive handling. As with T002, TypeScript types are erased at runtime: recipe data arriving from outside the package must go through `unknown → decode/validate → canonical value`. Reuse the T002 decode/diagnostics conventions (`DomainValidationResult`, typed diagnostics) for consistency.

### 2.3 Finite capability vocabulary pattern

Make illegal capabilities unrepresentable: a closed union of capability kinds, each carrying only its declared parameters (e.g. member-detail navigation carrying the member identity, declared continuation carrying the collection edge). Any recipe field proposing an action outside the union fails decode. Do not model capabilities as free-form strings/expressions with a blocklist — allowlist-only.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Admission-first, then bounded stepping

```text
admitted contract (admitCollectionContract already rejected frontiers)
→ confirmed snapshot (frozen membership basis)
→ discovery resolves/finalizes frozen target set
→ per declared continuation bound, step within exact bounds
→ stop with truthful reason/tuple; never widen
```

Discovery resolves the frozen target set; it is not the byte-transfer engine (L2 §6.5).

### 3.2 Continuation as exact-bound machine, budget as external stop

Treat each declared bound as a finite state machine over the frozen scope: batch(n) counts members; page-range walks logical root pages 1..b with 1-based anchoring (detail/iframe never increment; load-more is never a numbered page); natural-end fires only on a validated natural-end relation from the supported membership relation. Budget values arrive as canonical remaining-budget inputs: when discovery budget is gone, stop with `DISCOVERY_BUDGET_EXHAUSTED` and the exact §10.2 tuple — never convert to natural end. Never compute "how much continuation the budget affords".

### 3.3 Successor identity, not mutation

Post-confirmation expansion or re-enumeration routes through `deriveSuccessorContract`/`deriveSuccessorSnapshot`; original snapshot stays immutable. Retry uses `planRetryOfFailedMembers` domain only.

### 3.4 Provenance-bound locator transitions

Member detail-page/CDN hops are locator/provenance updates on a stable member identity (C07/C29). Keep each hop an evidence record chaining to the confirmed membership basis; an unbound/unrelated transition is a failure, not a member update.

### 3.5 Confirmation workflow as claim-typed interaction

Implement PRD §13 interaction priority (scope-level → batch/group → few material items → manual selection) as deterministic workflow decisions over candidate/snapshot state. Emit `ConfirmationType`/`ConfirmationOutcome`-typed records; a confirmation never emits validation truth for quality/membership claims (C26/C27/C34) and never skips declared validation requirements.

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Discovery/continuation failures

- failed next page / missing control / pagination loop → stop, coverage UNKNOWN-or-TRUNCATED, truthful stop reason (C03); loop detection is expected behavior, not an edge case;
- budget exhaustion → no new discovery/navigation; frozen-S downstream eligibility follows §15.4 precedence only;
- change detected after preview → successor snapshot path; never in-place drift (C11).

### Recipe failures

- unknown schema/version/capability/field that could alter authority → typed rejection;
- matcher failure/ambiguity → declared `FailureConditions`/deterministic `Fallback` path; fallback never widens scope or invents navigation;
- recipe applicability mismatch on replay → revalidate or refuse; never trust cached membership (C20).

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict (e.g. any perceived need for arbitrary scripting/navigation) → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T011 acceptance

| Acceptance concern (Frozen Task Pack) | Authority | Required T011 proof |
| --- | --- | --- |
| `continuation_scope=NONE` | PRD §10.1 R01, §28 S5 | frozen snapshot membership; exclusion of continuation-loaded members; successor path on load-more |
| Declared batch/page/natural-end bounds | PRD §10.1/§10.2/§10.3 | exact-bound stepping; USER_SCOPE_REACHED vs DISCOVERY_BUDGET_EXHAUSTED tuples; page anchoring rules |
| Successor contract/snapshot | PRD §12; T002 snapshot API | successor identity on expansion/re-enumeration; original immutability |
| Page loops/failures | PRD §19; C03 | no natural end from failure/loop; truthful coverage |
| Member detail/CDN provenance | C07/C29; L2 ADR-011/D2 | provenance-bound locator chain; stable member identity |
| Identity-not-count completeness | PRD §11/§19; C01/C04 | identity correspondence; closure evidence for VERIFIED_COMPLETE |
| Crawler rejection | PRD §9/§14; L2 D5; C06 | admission rejects frontiers; no capability expresses one |
| Batch/manual confirmation | PRD §13/§21; C26/C27/C30/C31/C32 | interaction priority; selection-claim-only confirmations |
| S5/S6 slice behavior | PRD §28 | slice-field-conformant engine behavior without adapter implementation |

## 6. Dependency/version/license facts

### Already pinned and recommended for T011 use

| Package | Exact version on bound base | License | T011 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static modeling of closed capability/continuation/result vocabularies |
| `vitest` | `4.1.11` | MIT | executable fixture/oracle tests |
| `@xdownload/domain-contracts` | workspace package (`packages/domain-contracts`) | in-repo | canonical contract/snapshot/scope/budget/evidence/result vocabulary — consume, do not fork |

Sources: root `package.json` on exact base; upstream exact-tag license files.

### New runtime dependency

**None is recommended or pinned by this Reference Pack.** The base has no external runtime dependencies. Recipe matching and bounded discovery need no parser or framework; under F1 the Builder may justify one narrowly (e.g. a small declarative-matcher aid), but must record exact package/version/license/provenance and show it does not become de facto Product/Architecture authority. Never accept an dependency whose semantics blur the declarative-recipe boundary (e.g. a general scripting/rules engine that can express imperative actions).

## 7. Do / Don't

### Do

- keep recipe data declarative and the interpreter deterministic;
- use the T002 continuation/snapshot/successor APIs as the only scope authority;
- emit discovery output as DISCOVERY_DERIVED typed evidence with provenance;
- stop truthfully (exact tuples, exact stop reasons) on bounds, failures, loops and budget exhaustion;
- preserve logical member identity across provenance-bound locator hops;
- resolve ambiguity through PRD §13 interaction priority, batch/manual first;
- keep every navigation traceable to the confirmed contract.

### Don't

- don't implement browser/network/persistence/transfer/media/scheduler/AI/CLI/Desktop behavior;
- don't create a frontier, recrawl or host-scan path — even behind a flag or a "user asked" claim;
- don't derive continuation width or existence from budgets;
- don't mutate confirmed snapshots or replace candidates silently;
- don't claim natural end or completeness from counts, limits, timeouts, failed next pages or loops;
- don't let confirmation count as quality/membership/validation truth;
- don't embed credentials, signed URLs or identity secrets in recipe/knowledge data;
- don't extend the capability vocabulary or rewrite T002 contracts locally — escalate instead.

## 8. Reuse / license risk

Risk is low if external material is used as design/testing reference only. Do not copy substantial source from external rule-engine or crawler projects; the capability model must be authored against Frozen Product/L2, not borrowed wholesale. JSON/standards references need not be copied into product source.

## 9. Validation boundary

This Reference Pack does not prove T011. The later Builder produces an exact candidate; T011 concern Validation must execute the S5/S6 + C01-C34 collection fixture matrix on that exact candidate; Fresh Independent Review is separately required because T011 is `risk:high` and `review:required`. Version-level visible Validation is owned by T020-T023 on the exact T019 candidate.
