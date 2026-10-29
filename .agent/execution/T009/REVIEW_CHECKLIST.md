# T009 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T009 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T009 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `685e5f384c344872d23038525e1eefd3f1124145` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the S4 media/protocol execution boundary: HLS/media adapter, media tooling boundary and deterministic media fixtures/tests.
- [ ] No generic opaque byte path stands in for HLS correctness (L2 U6/ADR-006).
- [ ] No DRM bypass and no universal DASH/multi-audio/subtitle/separate A/V/mux/post-processing support beyond fail-closed rejection.
- [ ] No Core runtime, scheduler, persistence, direct-HTTP (T008), browser/auth, Recipe/discovery, AI, CLI/Desktop or packaging implementation leaked into T009.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Any new runtime dependency or external media tool is an F1 implementation choice only, with exact name/version/license/provenance recorded and confined behind the replaceable port.

## 3. Manifest / rendition binding semantics

- [ ] Master/media playlist parsing validates before any segment request; malformed/unknown-version/duplicate-identity input fails closed.
- [ ] Selection binds an explicit manifest/rendition identity to the frozen logical target.
- [ ] Binding is immutable after selection; rendition substitution requires successor identity, never silent update.
- [ ] Logical target identity remains distinct from manifest/segment/CDN/signed locators.

## 4. Provenance and locator rules

- [ ] Every segment/CDN locator used descends from the selected manifest/resource provenance.
- [ ] Traceable manifest-to-CDN locator transitions preserve logical target identity (C28/C29 semantics).
- [ ] Unrelated locator substitution is rejected rather than silently adopted.
- [ ] URL string equality is not used as the universal identity model.

## 5. Budget / authorization boundaries

- [ ] Manifest and segment requests are accounted against `TransferBudget` through canonical budget semantics (C28).
- [ ] DiscoveryBudget exhaustion does not block or justify transfer decisions; TransferBudget and GlobalSafetyBudget govern the frozen-target transfer.
- [ ] Budget exhaustion stops work truthfully without redefining requested scope; retry inherits remaining budget without implying replenishment.
- [ ] No signed-URL secrets, DRM key material, cookies or reusable credentials are stored as ordinary adapter state; authorization context remains an opaque reference.

## 6. Validation / acceptance semantics

- [ ] Final acceptance requires the applicable manifest/rendition/segment/format/media/target validation chain (L2 invariant 18).
- [ ] Segment-count or byte-total equality alone never establishes media validity or completeness.
- [ ] Missing/truncated/failed segments forbid acceptance; failures remain truthful on the same effect lineage.
- [ ] Unsupported encryption/DRM/track/mux/post-processing topology fails closed to truthful `UNSUPPORTED/FAILED` (PRD S4, L2 A6, C15) with no silent degradation.
- [ ] Assembly/probe evidence is typed; insufficient evidence stays `INSUFFICIENT_EVIDENCE`/`UNKNOWN` (C22) and is never post-hoc converted to success.

## 7. Canonical record normalization

- [ ] The adapter emits canonical effect/evidence/validation records through the T002 vocabulary and does not invent its own success semantics (L2 invariant 17).
- [ ] No adapter-local terminal-result projection competes with the Core-owned result truth.
- [ ] Media tooling remains behind a replaceable assembly/probe port (L2 invariant 19); the tool is not de facto architecture authority.
- [ ] Canonical records retain claim subject/provenance/scope; user confirmation is never treated as waiving media validation (C26/C27).

## 8. Negative-state and oracle coverage

- [ ] Runtime decode tests begin from `unknown`/external-shaped playlist/segment inputs where appropriate.
- [ ] Malformed fields, unknown tags/enums, unsupported playlist versions and duplicate-identity conflicts reject.
- [ ] Required suites from `TEST_MATRIX.yaml` (manifest/rendition binding, segment/media validation, missing segment, unsupported topology, provenance, budget accounting) are executable and pass.
- [ ] Applicable counterexample oracles (C09, C15, C18, C22, C26, C27, C28, C29) have durable fixture/oracle mappings.
- [ ] Tests are deterministic, local, synthetic-fixture based and claim no real network/CDN/DRM behavior.

## 9. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T009-specific tests execute on the exact candidate and their result identity is durable.
- [ ] Media tooling unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 10. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T009.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 11. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
