# T007 L3 Reference Pack — typed evidence, validation, coverage and result projection

Task: `T007` / Issue `#26`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not redefine public semantics, fork the T002 canonical vocabulary, or preselect new dependencies.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`. The T002 merge already provides `packages/domain-contracts/test/*` including `oracles-c01-c34.test.ts`, `evidence.test.ts` and `result-combinations.test.ts` — read them first for established fixture/helper style (`test/helpers.ts`), then write T007 tests at the **projection/behavior** level (what the ledger/accounting/projector compute and reject), not merely what values represent.

**Patterns to emulate:**

- deterministic projector tests: build a canonical fact set (evidence records + validation records + coverage accounting), project, assert the exact six-dimension tuple; assert re-projection of identical facts yields deep-equal output;
- table-driven legal tuples for §18.1–§18.7 shapes and forbidden tuples for §18.8, each with a stable oracle identity naming the violated rule;
- cancellation-matrix tests transcribed row-by-row from L2 §11.1 "Cancel timing matrix" plus the counterexample-normalization case (valid staged bytes + cancel-before-acceptance must project `CANCELLED`-family truth, never `COMPLETE`);
- the §17.2 18/16 tuple as one exact fixture, including its required accounting counts and the degraded variants when inaccessible members lack independent evidence;
- append-only ledger tests: append → attempted rewrite/delete/replace → expect typed rejection and unchanged accepted record set;
- validator-binding negative tests: use a validation record against a non-matching subject/layer/snapshot → reject;
- one fixture/oracle mapping for every Product counterexample C01–C34 at T007 semantics (distinct identities from the T002 representability oracles, e.g. `t007_oracle` in `TEST_MATRIX.yaml`).

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11` (MIT; already selected by T001 — T007 does not introduce it).

### 1.2 Determinism invariants without new test dependencies

High-ROI deterministic invariant families using existing Vitest only:

- permuting append order of independent evidence records never changes the projected terminal result;
- count changes without identity-set changes never change coverage to `VERIFIED_COMPLETE`;
- adding a passing validation record for one member never promotes another member's outcome;
- cancellation fact added after terminal projection leaves the terminal result unchanged;
- AuthorizationContextRef changes never change requested-scope accounting.

## 2. Contract / interface references

### 2.1 Exact-base canonical values to consume (do not fork)

- `packages/domain-contracts/src/evidence.ts` — `EvidenceRecord`, `ClaimType`, `EvidenceSourceType`, `IndependenceFromDiscovery`, `CertaintyClass`, `ValidationLayer`, `ClaimSubject`, `EvidenceScope`, `ExecutionContextIdentity`, `ConfirmationType`/`ConfirmationOutcome`, `whatConfirmationProves`, `canServeAsIndependentValidationOracle`, `assertNoDiscoverySelfCertification`, `KnowledgeRef` rules.
- `packages/domain-contracts/src/result.ts` — `TerminalResult` six dimensions, `ValidationSummary`, `SufficientCoverageBasis`/`InsufficientCoverageBasis`/`CoverageEvidence` (PRD §19 classes already typed), `SelectedMemberValidationOutcome`, `TerminalResultContext`, `decodeTerminalResult`/`validateTerminalResult`/`buildTerminalResult`.
- `packages/domain-contracts/src/ports.ts` — `DomainGateway.appendEvidence` (decode-only today: the ledger gap), `projectTerminalResult` (validates a caller-supplied result: the derivation gap), `TerminalResultProjection`/`projectForSurface` (thin read projection seam).
- `ids.ts`, `decode.ts`, `diagnostics.ts`, `version.ts` for identity, decode and typed-diagnostic conventions.

T007's new semantic layer should compose these: ledger admits via existing decode paths; projection consumes `CoverageEvidence` and validation outcomes and emits `TerminalResult`; read projections extend `TerminalResultProjection`.

### 2.2 Frozen Product/L2 sections that are the specification

| Concern | Frozen authority |
| --- | --- |
| Six result dimensions + enums + AUTH_REQUIRED vs AUTH_FAILED | PRD §16 (incl. §16.5) |
| CoverageTarget, three views, §17.2 18/16 tuple + accounting + user-visible explanation | PRD §17 |
| Legal combinations §18.1–§18.7, forbidden §18.8 | PRD §18 |
| Completeness contract (sufficient vs insufficient bases; inaccessible-member rule) | PRD §19 |
| Evidence claim model fields + claim types | PRD §20 |
| Confirmation claim types and their exact proof limits | PRD §21 |
| Validation layers; discovery cannot self-certify | PRD §22 |
| EvidenceLedger/ValidationRecord/CoverageAccounting/ResultProjector ownership; per-surface derivation rejected | L2 §6.7, D4, ADR-009 |
| Typed evidence + discovery-cannot-self-certify invariants | L2 invariants 5–6 |
| Cancellation/reconciliation/acceptance precedence; cancel timing matrix; status projection for cancellation | L2 §11.1, invariant 20 |
| Canonical authority in Core; thin surfaces | L2 invariants 1–2 |
| Counterexample corpus | PRD §35 (C01–C34) |

### 2.3 TypeScript modeling notes

Exact compiler on the base: `typescript@5.9.3` (Apache-2.0; already selected by T001), strict mode with `noUncheckedIndexedAccess`. Use discriminated unions for validation outcomes, coverage bases and cancellation timing classes; keep exhaustive handling over closed status sets. Static types remain erased at runtime: ledger admission and any externally supplied facts must pass through the existing runtime decode paths — never treat a cast as validation.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Append-only ledger

Model the ledger as an ordered, immutable sequence of accepted records plus queries. Accepted records are never mutated; supersession/correction is a new record referencing the old. Admission = existing decode + independence/scope checks; queries are pure reads. Keep durable storage out (T003/T015 lanes) — T007 needs the semantics, not a database.

### 3.2 Validation records with exact binding

Each record carries: validated subject identity (artifact/target/member), snapshot/contract refs, layer, outcome, and the evidence references it consumed (with their independence status). Provide a single `satisfies(claim)`-style gate that rejects when subject, layer or snapshot do not match, so projection cannot accidentally consume a mis-bound record.

### 3.3 Accounting before projection

Order the pipeline as facts → accounting → projection: `CoverageAccounting` first computes requested/accounted/accessible/inaccessible/selected/validated identity sets (never bare counts) and classifies coverage evidence; `ResultProjector` then deterministically maps accounting + validation outcomes + cancellation/stop facts onto the six dimensions. Projection contains no discovery of its own facts.

### 3.4 Cancellation as a projection input, not an afterthought

Represent the L2 §11.1 timing classes explicitly (cancellation vs durable acceptance order per lineage) and derive acquisition status/stop reason from that order plus acceptance facts. The required counterexample normalization (staged-valid bytes + cancel-before-acceptance) should be a first-class fixture.

### 3.5 Fail closed

Every rejection returns typed diagnostics (reuse `diagnostics.ts` conventions) identifying the violated frozen rule — never a normalized "nearest legal" status.

## 4. Failure handling patterns

- Unknown/malformed record at ledger admission → typed rejection before entry; preserve diagnostics without secret leakage.
- Mis-bound validation record → reject at the binding gate, not silently at projection.
- Insufficient coverage basis offered as `VERIFIED_COMPLETE` grounds → reject; projector refuses to emit, it does not downgrade silently.
- Forbidden status tuple → reject with rule identity; no clamping.
- Cancellation cutoff violation attempt → reject auto-acceptance; bytes remain unaccepted/quarantined evidence.
- Contradiction/uncertainty → `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` / `EXECUTION_PACK_INVALID` / `VALIDATION_NOT_EXECUTED` per `FAILURE_MATRIX.yaml`.

## 5. Examples / docs mapping to T007 acceptance

| Acceptance concern (Frozen Task Pack) | Reference pattern | Required T007 proof |
| --- | --- | --- |
| C01–C34 + status-combination tests | PRD §35/§18 + `TEST_MATRIX.yaml` oracles | every counterexample has a projection/behavior-level executable oracle |
| Empty-set handling | PRD §18.5/§18.6 | verified-empty vs unproven-empty tuples; no vacuous acquisition success |
| Cancellation projection | L2 §11.1 + invariant 20 | timing-matrix row coverage; cutoff cannot be crossed by valid bytes; terminal truth immutable |
| Auth-limited 18/16 tuple | PRD §17.2 | exact tuple + accounting counts + degraded variants |
| Partial/truncated/unknown distinctions | PRD §16/§18, C02/C03/C14/C22/C23 | faithful projection with truthful stop reasons |
| Independent validator claim binding | PRD §20–§22, L2 invariants 5–6 | mis-binding rejects; discovery never self-certifies; confirmation limits hold |
| Reject self-certification/count-only/empty-set false success | Issue #26 Validation scope | negative suites in `TEST_MATRIX.yaml` all executable |

## 6. Dependency/version/license facts

### Already pinned and recommended for T007 use

| Package | Exact version on bound base | License | T007 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict semantic-layer modeling, exhaustive discriminants |
| `vitest` | `4.1.11` | MIT | executable ledger/accounting/projection/oracle tests |

Sources: root `package.json` on exact base; upstream exact-tag license files.

### New runtime dependency

**None is recommended or pinned by this Reference Pack.** The T007 semantic layer should be implementable with the existing devDependencies. If the Builder adds one under F1, record exact package/version/license/provenance and demonstrate it does not become de facto Product/Architecture authority.

## 7. Do / Don't

### Do

- consume T002 canonical values and decode/diagnostic conventions;
- keep append-only and immutability semantics structural, not conventional;
- derive projection from accounting; never let projection discover facts;
- test every §18.8 forbidden combination and every §19 insufficient basis;
- transcribe the L2 cancel timing matrix into executable cases;
- preserve C01–C34 expected tuples exactly;
- keep read projections thin and non-authoritative.

### Don't

- don't fork or weaken `domain-contracts` schemas/enums/rules;
- don't implement persistence, scheduling, network/media, browser or UI code;
- don't count when identity correspondence is required;
- don't let confirmation waive required validation;
- don't normalize invalid tuples into success;
- don't let surfaces recompute status;
- don't add a dependency merely because it is popular;
- don't copy substantial external source into this repository.

## 8. Reuse / license risk

Low if external material is interface/design reference only. No spec text needs copying; the Frozen PRD/L2 in-repo are the specification.

## 9. Validation boundary

This Reference Pack does not prove T007. The later Builder produces an exact candidate; T007 concern Validation must execute the ledger/accounting/projection matrix on that exact candidate; Fresh Independent Review is separately required (`review:required`, `risk:high`). Concern PASS never implies version-level visible Validation, which is owned by T020–T023 on the exact T019 candidate.
