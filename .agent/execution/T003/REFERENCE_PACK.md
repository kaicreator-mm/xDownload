# T003 L3 Reference Pack — validation harness, corpora and gate instrumentation

Task: `T003` / Issue `#22`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Harness/Corpus Interfaces → Infrastructure Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not claim any gate PASS, select baselines, or redefine oracle semantics.

## 1. Frozen documents the Builder and Reviewer must read (exact paths + sections)

### 1.1 Frozen Product — `docs/product/PRD-v0.4.2-review-candidate.md`

| Section | Content T003 must encode (not implement) |
| --- | --- |
| §16 Result Model (+§16.1–16.5) | status vocabularies the oracle tuples bind to |
| §17 Coverage and Authorization Accounting (R02), §17.1/17.2 | canonical tuples referenced by C05/C10/C23/C24/C25 oracles |
| §18 Legal Status Combination Rules (+§18.1–18.8) | legal/forbidden tuples harness must be able to express |
| §19 Completeness Contract | what VERIFIED_COMPLETE requires (closure evidence, not counts) |
| §20 Evidence Claim Model | claim fields/types for exact-subject evidence capture |
| §21 User Confirmation Claims | confirmation limits (selection-only proof, no validation waiver) |
| §22 Validation Layers | Transfer/Format/Media/Target/Membership/Coverage layers; discovery-not-sole-oracle rule |
| §28 v0.1.0 Support Slice Registry | S1–S6 definitions for corpus tagging |
| §30 Failure Taxonomy | failure categories (e.g. DISCOVERY_BUDGET_EXHAUSTED) used in expected stops |
| §31 Critical Journeys | CJ-01..CJ-09 journey harness definitions |
| §32 Product Gates and Confirmation Protocols | gate result vocabulary PASS/FAIL/INSUFFICIENT_EVIDENCE |
| §32.1 Common confirmation rules | denominator/UNKNOWN/abandonment/isolation rules — normative for accounting suite |
| §32.2 G0 deterministic baseline protocol (R03) | G0BaselinePlan field list, selection steps 1–7, invalidation rule |
| G0, G1a, G1b, G1c, G1d (and G2–G4 status) | gate definitions, corpora, PASS rules, metric sets |
| §33 Experiment Corpora and Baselines | Natural/Collection/Hard/Holdout corpora + Baseline rule R03 |
| §34 Capability Ablation | A0–A4 layers for collection value attribution instrumentation |
| §35 Counterexample Corpus C01–C34 | the 34 oracle records + pre-registration preamble |
| §37 v0.1.0 Release Blockers | which gates/oracles are release-blocking context for instrumentation |

### 1.2 Frozen L2 — `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md`

| Section | Content |
| --- | --- |
| Drivers D1–D10 | authoritative semantics the harness must not contradict |
| §5.2 Resolved by executable evidence (U2/U3) | what executable evidence looked like at L2 stage; harnesses must not weaken those proofs |
| §10 Data Ownership / Trust Boundaries | harness is infrastructure, not a competing authority |
| §11 Failure / Restart / Retry semantics | restart/cancellation truth referenced by CJ-06/C13 instrumentation |
| §18 Task DAG Lane Hints — "Validation harness" row | stable input: Frozen Product counterexamples + Frozen L2; ownership: fixtures/contract/CJ harness; convergence: version validation |

### 1.3 Implementation governance

| Document | Content |
| --- | --- |
| `docs/implementation/v0.1.0/TASK_DAG.md` | T003 row; dependency note "**T003** ← `T002` — validation corpora/oracles must bind Frozen canonical identities and result semantics"; downstream `T019 ← T003` |
| `docs/implementation/v0.1.0/TASK_PACKS.json` | T003 entry: validation_scope "Harness self-tests, corpus identity/denominator checks and baseline pre-registration enforcement." |
| `docs/implementation/v0.1.0/task-packs/T003_validation-harness-corpora.md` | frozen task WHAT @ `39c205ec8ee9ccd9b6f47eeca401ec1ee76c307e` |
| Issue #22 (+ freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`) | work-item contract |
| `.dev-standard/VERSION` | pinned standard `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d` |

## 2. Tests — highest priority references

Primary exact-base test mechanism: `vitest@4.1.11` (MIT, already selected by T001), discovering `packages/*/test/**/*.test.ts`.

**Patterns to emulate:**

- table-driven oracle-corpus tests: one stable case per C-identity, asserting load + canonical binding + pre-registration metadata;
- golden/immutability tests for frozen plans: attempt mutation, assert typed rejection and unchanged frozen bytes;
- denominator truth tables: each §32.1 rule as an explicit row (UNKNOWN, out-of-scope, friction abandonment, external cancellation with/without recorded reason, repeated runs);
- decode-from-`unknown` tests for corpus/plan/oracle records so malformed harness data fails closed;
- determinism self-test: run each harness twice on identical inputs, assert byte-identical outputs;
- negative-loader tests: unknown C-identity, unknown canonical status, missing truth source, missing §32.2 plan fields.

Keep T003 self-tests distinct from T002's `oracles-c01-c34.test.ts` (which proves contract-level representation). T003 tests prove the **corpus/loader/registration infrastructure**; overlap is acceptable only where binding to canonical vocabulary is the point.

## 3. Harness/interface design references

### 3.1 Registry/plan identity

Follow the canonical identity discipline from `@xdownload/domain-contracts` (`ids.ts`, `version.ts`): corpus ids, task-case ids, plan ids and oracle ids are stable nominal identities; content changes require new identity, never in-place mutation. `frozen_at` in G0BaselinePlan is a registration fact, not a mutable timestamp.

### 3.2 Pre-registration as data

Model PRD §32.2's `G0BaselinePlan` exactly as a closed, validated record; every listed field required. Selection-rule determinism (default: highest Phase-A correct completion → lowest active time → lowest manual actions → lexical baseline_id tie-break) should be encoded as a total-order function so "deterministic" is testable, not prose.

### 3.3 Denominator accounting as pure functions

Implement §32.1 rules as pure classification/aggregation functions over recorded task outcomes so every rule row is unit-testable without any I/O. Preserve the non-success classes separately (failure, abandonment, UNKNOWN, out-of-scope, INSUFFICIENT_EVIDENCE) — never collapse to a single success count (C32).

### 3.4 Oracle records

One record per C01–C34 with: C-identity, scenario slug, PRD §35 expected behavior reference, expected status tuple(s) typed with canonical enums, truth-source requirement, and required support slice(s)/corpus linkage. Loader fails closed on unknown ids/statuses/missing truth source. Execution entry points may exist but must default to `NOT_RUN`.

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

- malformed corpus/plan/oracle record → typed rejection with pointer to the violated field/rule;
- mutation of frozen material → rejection + preserved original bytes;
- post-exposure protocol/baseline change → run invalidation (C33), never silent plan rewrite;
- missing/insufficient gate evidence → FAIL/INSUFFICIENT_EVIDENCE, never PASS;
- ambiguity vs Frozen Product → `ORACLE_AMBIGUITY_ROUTES_UPWARD` / `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` per Task Pack routing; tooling unavailability → `VALIDATION_NOT_EXECUTED`.

## 5. Examples / docs mapping to T003 acceptance

| Task Pack acceptance concern | Frozen reference | Required T003 proof |
| --- | --- | --- |
| corpus identity | PRD §33 + §28 | corpora load with stable identities; S1–S6 tagging correct; immutability enforced |
| pre-registration immutability | PRD §32.2 + §33 Baseline rule R03 + C33 | frozen plans tamper-proof; post-exposure change ⇒ invalidation |
| common denominator rules | PRD §32.1 + C32 | exact accounting behavior incl. UNKNOWN/abandonment/isolation |
| evidence exact-subject binding | PRD §20–§22 + C34/C26/C27 | claim fields present; no self-certification; confirmation limits |
| expected C01–C34 oracle loading | PRD §35 + TASK_DAG T003←T002 note | all 34 records load, bind canonical vocabulary, carry pre-registered expectations |
| G0/G1 runnable later but NOT_RUN | PRD §32 gates | instrumentation + evaluators exist; all results NOT_RUN on T003 candidate |
| Critical Journeys | PRD §31 | CJ-01..CJ-09 harness definitions with pre-registered expectations |

## 6. Dependency/version/license facts

Already pinned on the bound base and reused: `typescript@5.9.3` (Apache-2.0), `vitest@4.1.11` (MIT). **No new runtime dependency is recommended or pinned by this Reference Pack.** Controlled fixtures should be local/deterministic (in-process fixture servers or static fixtures); if the Builder introduces a dev/test-only dependency, record exact package/version/license/provenance in the implementation PR and keep it within F1 and Frozen Architecture.

## 7. Do / Don't

### Do

- bind every oracle/plan/corpus record to canonical identities and result semantics;
- keep all harness behavior deterministic and offline;
- encode §32.1/§32.2 rules as executable, testable pure logic;
- preserve non-success/denominator classes distinctly;
- leave every real gate result `NOT_RUN`;
- route ambiguity upward with exact PRD section references.

### Don't

- don't select or rank baselines using any post-exposure data;
- don't type UI/discovery/model output as independent truth;
- don't implement product features or other tasks' local tests;
- don't fork competing status/result vocabulary beside `@xdownload/domain-contracts`;
- don't claim, infer or foreshadow any G0/G1/C-execution PASS;
- don't mutate frozen docs, corpora identities, plans or pre-registered expectations in place.

## 8. Validation boundary

This Reference Pack does not prove T003. The later Builder produces an exact candidate; T003 concern Validation must execute the harness self-test/corpus/denominator/pre-registration matrix on that exact candidate; Fresh Independent Review is separately required because the task is `risk:high` and `review:required`. Version-level visible Validation stays with T020–T023 on the exact T019 candidate.
