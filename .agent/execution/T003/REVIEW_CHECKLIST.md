# T003 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T003 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T003 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `39c205ec8ee9ccd9b6f47eeca401ec1ee76c307e` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside version validation infrastructure: deterministic corpora/controlled fixtures, baseline-plan registration, denominator/UNKNOWN/abandonment accounting, evidence formatting, CJ/gate instrumentation and their self-tests.
- [ ] No production feature change (Desktop/Browser/CLI/persistence/crawler/transfer/media/scheduler/auth broker/AI/packaging) leaked into T003.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Task-local tests of other implementation tasks were not rewritten or re-owned by T003.
- [ ] Any new dependency is an F1 choice only, with exact package/version/license/provenance recorded.

## 3. Corpus identity / determinism

- [ ] Natural/Collection/Hard/Holdout corpora (PRD §33) have stable, immutable corpus and task-case identities.
- [ ] Corpus S1–S6 tagging matches the PRD §28 support-slice registry.
- [ ] Controlled fixtures/servers are deterministic and offline; no live-network truth dependency.
- [ ] Identity reuse with changed content is detected and rejected.

## 4. Baseline pre-registration enforcement

- [ ] G0BaselinePlan requires every PRD §32.2 field before freeze; missing fields fail closed.
- [ ] Frozen plans are immutable; no mutation path exists post-freeze.
- [ ] Selection rules are deterministic; post-exposure choice among tied baselines is structurally impossible.
- [ ] Fixed comparison sets enforce pre-registered aggregation.
- [ ] Baseline/protocol change after exposure is representable only as run invalidation with a new independent run (C33).

## 5. Denominator / accounting correctness

- [ ] Sample unit is the end-to-end Acquisition task (PRD §32.1).
- [ ] UNKNOWN stays in denominator (or becomes INSUFFICIENT_EVIDENCE only when independent truth itself is unavailable) and never counts as success.
- [ ] Friction-caused abandonment is non-success; external cancellation is excluded only with pre-recorded reason.
- [ ] Out-of-scope tasks are excluded from the primary denominator but reported separately.
- [ ] Repeated runs of the same unchanged task are not independent sample units.

## 6. Evidence exact-subject binding

- [ ] Evidence records carry claim_type, claim_subject, source identity/provenance, independence_from_discovery, scope and certainty class (PRD §20).
- [ ] Discovery/UI-suggestion provenance cannot be typed as independent truth for the same claim (PRD §22, C34).
- [ ] User confirmation proves only the shown/asked claim and cannot waive Transfer/Format/Media validation (PRD §21, C26/C27).
- [ ] Evidence formatting is deterministic and subject-exact.

## 7. C-oracle harness correctness

- [ ] All C01–C34 (PRD §35) load as oracle records with known identities; none is missing or duplicated.
- [ ] Each oracle binds expected behavior/status tuples to the canonical `@xdownload/domain-contracts` vocabulary, not forked semantics (TASK_DAG dependency note).
- [ ] Each oracle carries pre-registered expectation metadata (target, scope, expected stop, truth source) per the PRD §35 preamble.
- [ ] Records with unknown C-identities, unknown canonical statuses or self-generated truth sources fail closed.
- [ ] No oracle execution against a product is claimed; execution remains NOT_RUN in T003.

## 8. Journey / gate instrumentation discipline

- [ ] CJ-01..CJ-09 (PRD §31) each have a harness definition with pre-registered expectations and no embedded product behavior.
- [ ] G0/G1a–G1d instrumentation defines metrics and PASS-rule evaluators that consume recorded evidence only.
- [ ] Evaluators return FAIL/INSUFFICIENT_EVIDENCE on missing evidence, never PASS.
- [ ] Every gate result on the T003 candidate is NOT_RUN; no real Product gate PASS/FAIL claim exists anywhere in the diff.

## 9. Negative coverage / test proof quality

- [ ] Negative harness cases (corruption, identity reuse, tampered plans, denominator violations, truth-source violations) reject with typed diagnostics.
- [ ] Tests are deterministic, local and prove harness behavior — not mirrors of T002 contract tests; overlap only where binding is the point.
- [ ] Harness self-tests execute on the exact candidate under the existing `pnpm` gates (`format:check`, `lint`, `typecheck`, `test:unit`, `ci:verify`).
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.

## 10. Integration risk

- [ ] `@xdownload/domain-contracts` is consumed read-only; no T002-owned source modified.
- [ ] Root workspace changes are narrowly necessary wiring for the validation package.
- [ ] No competing mutable status board or result authority was created outside the harness infrastructure.

## 11. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T003.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 12. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
