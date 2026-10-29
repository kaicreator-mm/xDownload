# T008 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T008 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T008 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `8e4135d31bf495915f98586ff958415a467e4d52` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.
- [ ] Dependency precondition T002 (`#21`, merged at `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) is not regressed by the candidate.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the S1/S3 direct acquisition boundary: the direct HTTP/file adapter, its transfer/retry/integrity semantics, controlled protocol fixtures and directly necessary workspace/test wiring.
- [ ] No HLS/segment-manifest transfer, browser handoff (S2), collection discovery/enumeration (S5/S6), persistence/recovery ledger, scheduler, Desktop/CLI/UI, auth-secret broker, AI runtime or packaging implementation leaked into T008.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] The adapter consumes `packages/domain-contracts` canonical vocabulary and creates no competing domain truth or private success semantics.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Identity / locator semantics

- [ ] Stable logical target identity is kept separate from volatile locator/redirect/CDN/signed-URL values (ADR-011).
- [ ] Provenance-bound redirects and signed-locator refresh preserve logical identity only with binding evidence.
- [ ] Unrelated locator change/substitution fails closed; no target substitution because a locator changed.
- [ ] Redirect following never enlarges requested scope or membership.

## 4. Resume / retry / integrity semantics

- [ ] Partial bytes are preserved/appended only when representation identity is sufficiently validated (strong validator/`If-Range`); otherwise safe restart occurs.
- [ ] Validator change is detected and never appended across.
- [ ] Retry/restart remains in the same logical target/effect lineage and cannot create new/replacement targets (C12).
- [ ] Truncated, corrupt or wrong-target bytes cannot be projected as accepted/COMPLETE; transfer alone does not make an artifact accepted.
- [ ] Applicable validation layers (Transfer/Format/Target, Media for S3) gate acceptance; confirmation cannot waive validation (C27).

## 5. Budget / authorization boundaries

- [ ] Transfer requests and bytes (including retries) count against TransferBudget; GlobalSafetyBudget precedence is honored.
- [ ] Retry/restart inherits remaining budget; no replenishment semantics.
- [ ] Budget is consumed through the authoritative canonical seam; no private adapter ledger.
- [ ] Signed-URL credentials/tokens/cookies are not persisted as ordinary state; authorization context remains opaque.

## 6. Protocol test discipline

- [ ] All T008 concern tests run against task-owned deterministic localhost controlled fixtures; no real third-party network dependence.
- [ ] Required suites cover strong/no validators, range support/change, safe restart, truncation, retries, redirects/signed-locator refresh, budget consumption, wrong target and corruption.
- [ ] Applicable counterexamples (C09/C12/C13/C27/C28/C29) have durable transfer-level oracle coverage.
- [ ] Negative cases (append across validator change, scope expansion through redirects, truncated/corrupt/wrong-target acceptance, budget bypass, retry lineage escape) reject with truthful typed outcomes.
- [ ] Tests are deterministic and do not claim unexecuted browser/persistence/HLS/media-assembly behavior.

## 7. Result / evidence semantics

- [ ] No single `success` boolean is introduced as canonical terminal truth; the multidimensional canonical result is preserved.
- [ ] Adapter-emitted effect/evidence/validation records carry claim subject, provenance and scope per Frozen L2 typed-evidence invariant.
- [ ] Unsupported/ambiguous identity produces truthful typed failure, not nearest-legal-status normalization.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T008-specific protocol tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T008.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
