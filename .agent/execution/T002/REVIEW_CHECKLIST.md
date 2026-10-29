# T002 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T002 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T002 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `ca43f082a9ecf083b4ca755c2706809c5fab82f4` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside canonical domain/public contracts, pure semantic rules, compatibility/negative fixtures and directly necessary workspace/test wiring.
- [ ] No Desktop/Browser/CLI behavior, persistence, crawler/frontier, transfer/media, scheduler, auth-secret broker, AI runtime or packaging implementation leaked into T002.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Implementation does not create a competing mutable authority outside the Core-owned canonical contract layer.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Public API / schema compatibility

- [ ] Contract/schema version is explicit at decoded/public boundaries where compatibility matters.
- [ ] Known supported versions decode deterministically.
- [ ] Unknown/incompatible versions fail closed; no silent defaulting or reinterpretation.
- [ ] Unknown authority-changing fields cannot silently alter scope, identity, authorization, budget, result or validation semantics.
- [ ] Historical contract/snapshot identity is immutable; migrations/successors create explicit new identity rather than mutating history.
- [ ] TypeScript static types are not used as a substitute for runtime validation of unknown/untrusted data.

## 4. Identity and snapshot semantics

- [ ] Logical target/member/effect identities are distinguishable from volatile URL/locator/provenance values.
- [ ] Provenance-bound redirect/CDN/signed locator changes can preserve logical identity without allowing unrelated substitution.
- [ ] `requested_scope` and `continuation_scope` are immutable after confirmation.
- [ ] Retry/resume uses the original `SelectionSnapshot`; failed retries cannot add replacement/new members.
- [ ] Changed membership/profile/version or later scope expansion requires successor contract/snapshot identity.
- [ ] Count equality cannot establish membership identity/completeness.

## 5. Budget / authorization boundaries

- [ ] Discovery, Transfer and Global Safety budget domains remain semantically distinct.
- [ ] Budgets constrain execution but cannot define/enlarge/narrow requested scope.
- [ ] Retry/restart semantics do not imply budget replenishment.
- [ ] Authorization context is an opaque reference in canonical contracts; raw reusable secrets are not ordinary canonical state.
- [ ] Authorization accessibility cannot silently rewrite requested scope.

## 6. Result / evidence semantics

- [ ] No single `success` boolean is used as canonical terminal truth.
- [ ] Request Fulfillment, Target Resolution, Selection Acquisition, Coverage, Stop Reason and Validation Summary remain separately representable.
- [ ] Frozen Product forbidden status combinations are rejected.
- [ ] `SelectionAcquisitionStatus=COMPLETE` requires every selected identity to have an accepted, required-validation-passing result.
- [ ] `CoverageStatus=VERIFIED_COMPLETE` requires identity/closure evidence, not count/budget/timeout alone.
- [ ] Evidence retains claim type, claim subject, source/provenance, scope and independence semantics.
- [ ] Discovery/UI suggestion cannot self-certify the same claim as independent truth.

## 7. Negative-state and oracle coverage

- [ ] Runtime decode tests begin from `unknown`/external-shaped inputs where appropriate.
- [ ] Malformed fields, unknown enum/discriminant values and incompatible schema versions reject.
- [ ] Scope mutation, silent membership drift, locator/identity substitution and invalid result tuples reject.
- [ ] C01–C34 each have a durable contract-level fixture/oracle mapping and executable coverage appropriate to T002.
- [ ] S1–S6 are representable at the contract/type level without implementing downstream adapters.
- [ ] Tests are deterministic, local and do not claim unexecuted browser/network/persistence/media behavior.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T002-specific contract/schema tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T002.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
