# T011 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T011 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T011 JIT branch/base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `2e4a3b178bb33a41ff8e47307a3915c4a0ca872d` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside recipe schema/interpreter, bounded discovery orchestration, collection/member identity handling, continuation admission, selection/confirmation workflow logic, plus directly necessary workspace/test wiring.
- [ ] No byte-transfer, HLS/media, persistence/ledger, scheduler/budget-ledger ownership, browser integration/auth broker, AI proposal adapter, CLI/Desktop behavior or packaging leaked into T011.
- [ ] `packages/domain-contracts` semantics are consumed, not rewritten; no competing gateway/authority was forked.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Recipe / capability boundary (ADR-007, PRD §23, L2 §6.6)

- [ ] Recipe is declarative data with the frozen field set; no imperative/scripted recipe body can be decoded or executed.
- [ ] Capability vocabulary is finite, typed and auditable; unknown/undeclared capabilities fail closed at decode/plan.
- [ ] No capability can express shell execution, unrestricted JavaScript, filesystem write/export, cookie/token export, host scanning or recursive navigation.
- [ ] `scroll_current_page` is treated as a capability, never as implicit scope authority.
- [ ] Every active navigation/capability execution is traceable to the confirmed AcquisitionContract.
- [ ] Recipe replay revalidates applicability/scope/membership against current observations; cached membership cannot override current contract scope.

## 4. Continuation / snapshot semantics (PRD §10/§12)

- [ ] `continuation_scope=NONE` freezes current-page membership at confirmation; scroll/load-more/continuation-edge members stay excluded.
- [ ] Passive completion of evidence for frozen members is distinguishable from member addition.
- [ ] Post-confirmation expansion produces successor contract + successor snapshot; original snapshot remains immutable authority.
- [ ] Explicit continuation scopes honor exact declared bounds (`DECLARED_BATCH_COUNT(n)`, `DECLARED_PAGE_RANGE(a..b)`, `DECLARED_NATURAL_END` only with validated natural-end relation).
- [ ] Page-range semantics: 1-based logical collection pages anchored to the collection root; detail pages and iframe content never increment page count; load-more is never silently a numbered page.
- [ ] Resolved scope is displayed/returned for surface consumption before acquisition starts.
- [ ] Silent candidate replacement and post-confirmation membership growth are rejected.

## 5. Discovery / budget / admission boundaries (PRD §9/§14/§15; L2 D5)

- [ ] Collection admission enforces all six PRD §9 conditions; crawl/filter frontiers (C06) are rejected regardless of user declaration.
- [ ] No recursive crawler API or frontier surface exists in the capability/executable boundary.
- [ ] Continuation is never inferred, sized or extended from any budget value.
- [ ] DiscoveryBudget exhaustion stops new discovery/navigation; already-frozen selected members remain eligible downstream only under remaining TransferBudget/GlobalSafetyBudget (§15.4, C23/C28 shapes).
- [ ] Budget exhaustion produces truthful PARTIAL/TRUNCATED/DISCOVERY_BUDGET_EXHAUSTED semantics, never natural-end or user-scope-reached reinterpretation.

## 6. Identity / completeness / evidence semantics (PRD §11/§19/§20/§21/§22)

- [ ] Membership and completeness use identity correspondence; count equality, limits, timeout and budget exhaustion never establish completeness (C01/C14).
- [ ] Natural-end VERIFIED_COMPLETE requires independent identity/membership closure evidence (C04).
- [ ] Member detail/CDN transitions are provenance-bound and preserve logical member identity; unrelated substitution fails (C07/C29).
- [ ] Discovery output is DISCOVERY_DERIVED evidence; it never self-certifies membership, quality or coverage claims (C34); independent oracle requirements are preserved.
- [ ] Confirmation is recorded as selection claims only; it cannot certify target quality (C26) or waive required validation (C27).
- [ ] Task-local selection is not replayed as reusable membership authority (C31); confirmation sets apply common-denominator rules exactly (C32).

## 7. HITL / interaction semantics (PRD §13, C30)

- [ ] AUTO/ASSISTED/MANUAL_SELECTION behaviors follow frozen automation-mode rules and material-claim evidence requirements.
- [ ] Batch/manual selection surfaces can resolve what per-item interrogation would ask; per-item burden is not the default path.
- [ ] Collection preview/confirmation is invoked only where the product flow requires it; no forced unnecessary preview (C16) is introduced by workflow logic.

## 8. Negative-state and oracle coverage

- [ ] Recipe/contract/snapshot inputs are runtime-validated from `unknown` where untrusted; malformed input rejects.
- [ ] Frontier, budget-as-scope, capability-escape, snapshot-drift and false-natural-end negatives reject with typed diagnostics.
- [ ] Issue validation scope is covered: continuation NONE, declared bounds, successor snapshots, loops and frontier rejection fixtures exist and are executable.
- [ ] Applicable C01-C34 collection oracles per `TEST_MATRIX.yaml` each have durable fixture/oracle mapping; the non-primary C-cases are recorded in the boundary note rather than silently dropped.
- [ ] S5/S6 behavior matches PRD §28 slice fields; no downstream adapter implementation is claimed.
- [ ] Tests are deterministic, local (structured fixtures) and do not claim unexecuted browser/network/persistence/media behavior.

## 9. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T011-specific fixture tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS; version-level visible Validation remains owned by T020-T023 on the exact T019 candidate.

## 10. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T011.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 11. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules. New capability requiring broader authority routes to architecture review per the Frozen Task Pack.
