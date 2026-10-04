# T007 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T007 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T007 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `6f5dddfa89b8054bb1cca0e7a60bb5a194ede7be` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.
- [ ] Dependency fact remains: T002/#21 closed with merge `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the evidence/validation/coverage/result semantic layer, read projections, fixtures and directly necessary workspace/test wiring.
- [ ] No persistence/database, scheduler/concurrency engine, crawler/frontier, download/transfer/media adapter, auth-secret broker, AI runtime, or Desktop/Browser/CLI product behavior leaked into T007.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] T002 canonical vocabulary (`packages/domain-contracts` schemas/enums/legal-combination rules) is consumed, not forked or weakened.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. EvidenceLedger semantics

- [ ] The ledger is append-oriented: accepted records cannot be rewritten, deleted or silently replaced; corrections are new records.
- [ ] Every accepted record carries PRD §20 fields: claim_type, claim_subject, source_type, source_identity/provenance, independence_from_discovery, scope, confidence_or_certainty_class.
- [ ] One evidence item supports multiple claim types only with each relationship explicit.
- [ ] Malformed/unknown-schema/unknown-authoritative-enum records fail closed at admission.
- [ ] Discovery-derived records are typed `DISCOVERY_DERIVED` and cannot serve as the sole validation oracle for the same semantic claim (L2 invariant 6, PRD §22).

## 4. ValidationRecord binding

- [ ] Each validation record binds exact artifact/target/member/snapshot identity and validation layer (Transfer/Format/Media/Target/Membership/Coverage).
- [ ] A record proves exactly its named claim/subject/layer; cross-claim or cross-subject promotion rejects.
- [ ] Required validation layers are mandatory regardless of user confirmation (C27); confirmation proves only the shown claim (C26, `whatConfirmationProves` semantics preserved).
- [ ] UI/system suggestions cannot be typed as independent truth (C34).

## 5. CoverageAccounting semantics

- [ ] Requested-scope coverage, accessible-subset accounting and parent-collection coverage remain three distinct views; only requested-scope coverage is authoritative.
- [ ] `AuthorizationContextRef` never redefines requested scope nor shrinks the fulfillment reference set.
- [ ] §17.2 accounting tuple (requested/accounted/accessible/inaccessible/selected/validated counts) is representable and used by projection.
- [ ] Known inaccessible members count as accounted coverage only with independently evidenced identity/authorization status; they never count as fulfilled/acquired.
- [ ] `VERIFIED_COMPLETE` requires a §19 sufficient basis; all insufficient bases (count equality, max_items, page limit, timeout, budget exhaustion, failed next page, pagination loop, unproven natural end) are rejected as grounds.

## 6. ResultProjector semantics

- [ ] No single `success` boolean exists in canonical output; all six dimensions remain separately representable and are projected deterministically.
- [ ] Identical canonical facts always yield an identical terminal result.
- [ ] All §18.8 forbidden combinations reject with the violated rule identified; no clamping/normalization into the nearest legal status.
- [ ] Empty-set handling: §18.5 verified-empty and §18.6 unproven-empty project exactly; empty selected set is never vacuous acquisition success.
- [ ] Auth-limited 18/16 case projects the exact §17.2 tuple with requested scope intact; `COMPLETE` is unreachable while known requested members remain unfulfilled by authorization.
- [ ] PARTIAL/TRUNCATED/UNKNOWN distinctions are faithful (C02/C03/C14/C22/C23).
- [ ] Cancellation projection follows L2 §11.1: `USER_CANCELLED` only when cancellation stops remaining work; `CANCELLED`/`PARTIAL`/`COMPLETE` acquisition per the durable acceptance cutoff; staged/validated bytes cannot auto-accept across the cutoff; late cancellation never rewrites terminal truth.
- [ ] Terminal results are immutable once projected within T007 semantics.

## 7. Read projections / surface boundary

- [ ] Surfaces consume thin read projections; no per-surface status derivation exists in the T007 seam (L2 §6.7, invariant 2).
- [ ] Read projections expose no mutable handle on canonical truth.

## 8. Negative-state and oracle coverage

- [ ] Ledger admission, validator binding, accounting and projection each have negative tests (rewrite/delete, wrong-subject binding, insufficient basis, forbidden tuples, cutoff violation).
- [ ] C01–C34 each have a durable projection/behavior-level fixture/oracle mapping and executable coverage appropriate to T007 (distinct from T002's representability-level mapping).
- [ ] Tests are deterministic, local, and do not claim unexecuted browser/network/persistence/media behavior.

## 9. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T007-specific ledger/accounting/projection tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS, and both remain concern-level only — version-level visible Validation belongs to T020–T023 on the exact T019 candidate.

## 10. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T007.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 11. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
