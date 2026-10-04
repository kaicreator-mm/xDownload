# T007 Execution Contract — typed evidence, validation, coverage and result projection

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #26, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T007` / Issue `#26`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- JIT branch: `task/v0.1.0-t007-evidence-validation-result-projection`
- Dependency completion: `T002/#21` closed `state:done` (`CLOSED COMPLETED`), merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (PR #52)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T007_evidence-validation-result-projection.md@6f5dddfa89b8054bb1cca0e7a60bb5a194ede7be`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`

## Goal (frozen, unweakened)

Implement Core-owned typed `EvidenceLedger`, `ValidationRecord`, requested-scope `CoverageAccounting` and deterministic multidimensional `ResultProjector` for RequestFulfillment, TargetResolution, SelectionAcquisition, Coverage, StopReason and ValidationSummary.

## Owned write boundary

T007 owns the truth/evidence/result semantic layer: append-oriented typed evidence claims, validator-output records bound to their subjects, requested-scope coverage accounting, and one deterministic terminal-result projection — plus their directly necessary tests/fixtures.

T007 builds **on top of** the T002 canonical value layer in `packages/domain-contracts` (existing exact-base modules `evidence.ts`, `result.ts`, `snapshot.ts`, `scope.ts`, `budget.ts`, `ids.ts`, `decode.ts`, `diagnostics.ts`, `version.ts`, `ports.ts`, `slices.ts`). T002's vocabulary, schemas and legal-combination rules are canonical; T007 must not weaken, fork or redefine them. The Builder may extend the existing `packages/domain-contracts` package or create the minimal new `packages/*` package(s) needed, and may make narrowly necessary root workspace wiring directly required by that code and its tests.

### Forbidden scope (frozen Task Pack, restated)

Do not implement:

- a single authoritative `success` flag (PRD §16: forbidden);
- discovery self-certification — discovery inference can never be the sole validation oracle for the same semantic claim (PRD §22, L2 invariant 6);
- count-equality completeness — `VERIFIED_COMPLETE` from count equality, limits, timeout, budget exhaustion, failed next-page, pagination loop or unproven "no more found" alone (PRD §19);
- accessible-subset substitution — `RequestFulfillmentStatus` is always answered against the original immutable `requested_scope`, never the accessible subset; `AuthorizationContextRef` never redefines requested scope (PRD §16.1, §17);
- surface-specific result derivation — Desktop/Browser/CLI read projections only; per-surface status derivation remains rejected (L2 §6.7, invariant 2);
- persistence/database/scheduler/crawler/download/media/auth-broker/AI execution or Desktop/Browser/CLI product surfaces (T012–T015 lanes);
- mutation of `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T007 Task Pack.

## Required semantic outputs

1. **`EvidenceLedger`** — Core-owned, append-oriented typed claim store built on the existing canonical `EvidenceRecord` value: records retain `claim_type`, `claim_subject`, source type/identity/provenance, `independence_from_discovery`, scope, and certainty class; append-only (no rewrite/delete of accepted records; corrections are new records); queryable by claim subject/type/scope so validation and projection can consume evidence without mutation.
2. **`ValidationRecord`** — validator output bound to exact artifact/target/member/snapshot identity and validation layer (Transfer/Format/Media/Target/Membership/Coverage per PRD §22), carrying its independence basis and evidence references. Claim binding: a validation record proves exactly the claim/subject/layer it names — no cross-claim or cross-subject promotion.
3. **Requested-scope `CoverageAccounting`** — the three PRD §17 views kept distinct: requested-scope coverage (authoritative), accessible-subset accounting, and optional parent-collection coverage. Produces `CoverageEvidence` sufficient/insufficient bases (PRD §19 classes) and the §17.2 accounting tuple (requested/accounted/auth-accessible/auth-inaccessible/selected/validated counts).
4. **Deterministic `ResultProjector`** — one Core component that derives the six Frozen dimensions (PRD §16) from canonical ledger/validation/accounting facts: legal-combination enforcement (§18), empty-set handling (§18.5 verified-empty vs §18.6 unproven-empty; no vacuous acquisition success), cancellation projection per L2 §11.1 (`USER_CANCELLED` stop reason only when cancellation is why work stopped; `CANCELLED`/`PARTIAL`/`COMPLETE` acquisition per acceptance cutoff; no fabrication or erasure of fulfillment truth), the auth-limited §17.2 18/16 tuple, and PARTIAL/TRUNCATED/UNKNOWN distinctions. Deterministic: same canonical facts → same projected result.
5. **Read projections only for surfaces** — thin, non-authoritative projections of terminal results (extending the existing `TerminalResultProjection`/`projectForSurface` seam); no surface-local status recomputation.

## Required invariants / invalid states

Fail closed. The T007 layer must reject at least:

- `CoverageStatus=VERIFIED_COMPLETE` derived from any `InsufficientCoverageBasis` (count equality, max_items, page limit, timeout, budget exhaustion, failed next page, pagination loop, unproven natural end);
- `SelectionAcquisitionStatus=COMPLETE` when any selected member lacks an accepted result passing required validation (PRD §19) or when the selected set is empty (no vacuous success);
- `TargetResolutionStatus=EMPTY_UNKNOWN` with `RequestFulfillmentStatus=COMPLETE`;
- `TargetResolutionStatus=PARTIAL` with requested-scope `CoverageStatus=VERIFIED_COMPLETE` for the same CoverageTarget;
- direct single-resource results projecting collection coverage other than `NOT_APPLICABLE`;
- authorization-limited whole-collection request projected `RequestFulfillmentStatus=COMPLETE` solely because the accessible subset succeeded (§18.7/§17.2);
- inaccessible members counted as accounted coverage without independently evidenced identities/authorization status;
- discovery-derived evidence used as the sole oracle for the same semantic claim it derived;
- a `ValidationRecord` whose subject/layer/snapshot binding does not match the claim it is used to satisfy;
- user confirmation projected as QUALITY/target validation PASS (C26/C27 — confirmation proves only the shown claim; cannot waive Transfer/Format/Media validation);
- ledger mutation: rewrite, silent reorder-as-rewrite or deletion of accepted evidence records; unknown/corrupt records accepted into the authoritative ledger;
- cancellation suppressed: valid staged/validated bytes auto-accepted across the durable-cancellation cutoff, or `COMPLETE` projected solely because valid bytes exist (L2 §11.1 counterexample normalization);
- post-terminal mutation: a terminal result rewritten after it is projected (late cancellation does not retroactively rewrite terminal truth).

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- extending `packages/domain-contracts` versus a new minimal `packages/*` package, and internal file decomposition;
- internal data structures for the append-oriented ledger (in-memory semantic layer is sufficient for T007 concern; durable storage belongs to T003/T015 lanes);
- function/class/factory layout for ValidationRecord, CoverageAccounting and ResultProjector;
- test fixture/helper organization;
- narrowly necessary root workspace dependency/script/config wiring, recording any new runtime dependency's exact version/license/provenance.

These choices must not weaken or reinterpret Frozen Product/L2 semantics or T002's canonical vocabulary.

## Verification commands available on the exact base

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T007 concern Validation is separate from this prep task and must additionally execute the `TEST_MATRIX.yaml` suites and C01–C34 projection oracles on the exact implementation candidate. This JIT Prep does not run or claim that Validation. Version-level visible Validation is owned by T020–T023 on the exact T019 candidate; T007 closes at concern level only.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T007 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T007. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
