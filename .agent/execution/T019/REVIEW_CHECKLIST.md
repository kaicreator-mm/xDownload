# T019 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact candidate SHA/tree plus the recorded candidate manifest. This JIT Prep performs no Review.

Dominant review concerns for T019: **candidate-identity precision** (the exact identity T020–T023 bind to must be exact, complete and immutable) and **regression honesty** (every recorded suite/gate result reflects a real execution on that exact candidate; any red suite = FAIL, no waiver).

## 1. Exact identity / currentness

- [ ] The candidate is bound by exact commit SHA **and** tree SHA, never a branch name alone.
- [ ] The candidate descends from the manifest base `6e512e6e5397eae14bb1a4aa7d0722d517641b88` or an explicitly re-validated successor base.
- [ ] The candidate manifest was written only after the full visible regression run actually executed on that exact commit; identity precedes immutability, immutability precedes T020–T023 binding.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `5d2cd990b108fd5602a10b88d4fe5625011ea858` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside convergence wiring, candidate identity/version metadata artifacts, refreshed build evidence, and separately authorized bounded repairs.
- [ ] No new feature scope, new product behavior, or new adapters entered through T019.
- [ ] None of the 16 `packages/*`, `apps/` sources or Frozen docs were semantically modified to make regression green.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate convergence.
- [ ] Every bounded defect repair carries its own separate authorization reference and review outcome; no unreviewed high-blast fix was folded in.

## 3. Regression honesty (dominant review concern)

- [ ] Every recorded suite result came from a real execution on the exact candidate with command, environment and result identity recorded.
- [ ] The full denominator ran: every `packages/*/test` suite across all 16 packages, including the 8 version-validation harness suites.
- [ ] ALL visible suites are green; any red suite is recorded as candidate FAIL — no waiver, no skip, no tolerance, no post-hoc repair inside the same candidate.
- [ ] Tests, corpora, oracles and baselines did not change after product-gate results were seen (PRD C33); if they did, the run/candidate is invalidated.
- [ ] Unexecuted or partially executed suites are recorded NOT_EXECUTED, never PASS.

## 4. Gate evaluation fidelity

- [ ] The G0/G1 status board is recorded exactly as `evaluateGate`/`gateStatusBoard` emitted it on the exact candidate.
- [ ] No `NOT_RUN`/`INSUFFICIENT_EVIDENCE` gate was manually promoted to PASS; any PASS is backed by real captured evidence under the frozen `G0BaselinePlan` pre-registration rules (PRD §32.2).
- [ ] No baseline was selected after confirmation data was visible.
- [ ] G1d/G2–G4 applicability statuses are carried through without silent reinterpretation.
- [ ] Gate measurement sparseness at this stage is treated as honest, not as a defect to fix by fabrication.

## 5. Candidate identity precision (dominant review concern)

- [ ] The candidate manifest contains: commit SHA, tree SHA, producing branch, base ancestry, per-suite results, gate status snapshot, and the explicit non-claims.
- [ ] All implementation PRs (T003–T018) are merged at the candidate; none pending.
- [ ] The candidate identity is recorded once and unchanged since; any post-recording change invalidated it and triggered successor preparation instead of silent rebinding.
- [ ] T020–T023 can bind to exactly this identity without ambiguity.

## 6. Build / package evidence

- [ ] `node build/package.ts` and `node build/smoke.ts` ran on the exact candidate; refreshed `build/evidence/*.json` binds the exact candidate revision per T018 package-identity rules.
- [ ] No stale evidence from another revision was reused.
- [ ] `.agent/execution/**` (including the candidate manifest itself) entered no shipped package; the T018 package-content audit still passes.

## 7. Authority boundaries preserved

- [ ] No Candidate Freeze claim or action (T024's authority).
- [ ] No Hidden Validation run or claim (T025's authority).
- [ ] No Version Closure or Release Qualification claim (T026/T027's authority).
- [ ] No version-level visible Validation PASS claimed (T020–T023's authority).
- [ ] Task/PR PASS ≠ Candidate Freeze ≠ Version Closure ≠ Release Qualification ≠ Repository Integration is respected in all recorded statements.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes the applicable root gates (`ci:verify`) with results durably recorded.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS (if reached) is distinct from Independent Review PASS.

## 9. Scope creep / leakage

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T019.
- [ ] The candidate manifest lives in the evidence-only location and follows the declared version-artifact ownership (identity record + convergence/gate evidence, nothing more).

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules — and, for T019 specifically, re-running the full visible regression and re-recording a new candidate identity.
