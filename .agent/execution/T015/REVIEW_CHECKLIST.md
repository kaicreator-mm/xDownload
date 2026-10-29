# T015 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

Review emphasis for this task is **integration blast radius**: T015 is the merge point of six merged critical-path packages. The dominant failure modes are not local bugs but authority duplication (double authority), semantics drift during composition, and forbidden-lane leakage. Review accordingly.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T015 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T015 JIT branch/base (`4d40a2a1c389f6de4f3ce916c113fe4055f5e197`) or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `d176b357b7278b229091ee2e3d624b0ff691802d` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`; freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061` unchanged.

## 2. Single-writer / no double-authority (critical emphasis)

- [ ] Exactly one `AuthoritativeLedgerWriter` (persistence-ledger) exists in the composed runtime; no other code path writes durable lifecycle/budget/artifact state.
- [ ] Budget consumption occurs only through the scheduler's single authoritative mutation path / canonical `TransferBudgetLedgerPort`; no glue-local ledger, no re-minted consumption tokens.
- [ ] Cancellation and acceptance follow `acceptanceCutoff`/ADR-013 semantics only; no surface-local or glue-local precedence, no acceptance reopening outside explicit retry/resume.
- [ ] Terminal results are produced only by the domain-contracts result-projector; no runtime/surface-local projection fork; seam READ_PROJECTION agrees with internal projection.
- [ ] Read caches/temp state never become authority.

## 3. Composition without semantics drift (critical emphasis)

- [ ] All consumed packages (`domain-contracts`, `core-seam`, `core-scheduler`, `persistence-ledger`, `direct-acquisition`, `hls-vod-adapter`, and T003/T010/T011 packages) are consumed as-is: diff shows no semantic modification, export removal, or invariant weakening of upstream sources.
- [ ] Forbidden result tuples, legal-combination rules, identity/locator separation, evidence independence and budget-domain distinctions survive composition unchanged.
- [ ] Glue decides only composition facts (order, injection, transport binding, test locations) — never statuses, acceptance/cancellation outcomes, budget truths, membership identity or validation verdicts.
- [ ] Restart/reopen derives from durable truth only; restart does not replenish budgets, mutate snapshots, re-enumerate membership or mint successor identity.
- [ ] Duplicate submit is idempotent; no second effect lineage can arise from replays or concurrency.
- [ ] Any new dependency is an F1 choice with exact package/version/license/provenance recorded and no implied new Product/L2 authority.

## 4. Scope fidelity / forbidden lanes

- [ ] No T016 leakage: no browser→broker→Core workflow integration, no S2/S5/S6 collection orchestration, no real-browser fixtures; browser-observation/auth-broker/discovery-recipe referenced (if at all) as port types only.
- [ ] No T017 leakage: no Desktop/CLI/AI surface work; `apps/*` untouched (beyond pre-existing state).
- [ ] No packaging/platform/daemonization claims; on-demand launch remains the sanctioned pattern.
- [ ] Frozen docs untouched: `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json`, all task packs.
- [ ] Write set confined to the minimal new integration package(s) under `packages/*`, narrowly necessary root wiring, and package-local focused integration tests.

## 5. End-to-end semantics proven by tests

- [ ] Focused integration proves command→schedule→transfer/media→validate→persist→project for direct (S1/S3) and HLS (S4) candidates.
- [ ] Process restart composes RecoveryService + scheduler reopen + journal replay; crash-window artifacts (staged/partial bytes, post-budget-reservation pre-dispatch) project truthfully.
- [ ] Duplicate command, cancellation cutoff matrix, budget exhaustion (three domains, precedence), and projection suites pass deterministically and offline.
- [ ] Missing/corrupt artifact bytes never yield acceptance/success; AcceptanceValidation is fed by the adapters' validate chains.
- [ ] Applicable C-oracles (TEST_MATRIX list) have durable runtime-level mappings; no oracle weakened to fit glue.

## 6. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates (`pnpm ci:verify`).
- [ ] T015-focused integration suites execute on the exact candidate with durable result identity.
- [ ] Tooling unavailability is reported NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 7. Scope creep / downstream protection

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] Nothing in T015 forecloses T016/T017: required port surfaces are documented, not hardcoded against future lanes.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence; T015 closes with Core integration evidence only.

## 8. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules. Given `risk:critical`, reviewers must treat any double-authority or semantics-drift finding as P0.
