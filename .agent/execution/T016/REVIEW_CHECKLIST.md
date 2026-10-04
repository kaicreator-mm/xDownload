# T016 Review Checklist

Policy: `review:required`  
Risk: `risk:critical`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

Blast-radius emphasis: this is a workflow-integration task across the authorization boundary. A defect here does not stay local — a leaked capability, a substituted target, a drifted snapshot or an inferred continuation propagates silently into acquisition and terminal truth. Review must therefore trace authority end-to-end through the composed flow, not only inspect modules in isolation.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T016 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T016 JIT branch/base (`4166b51841709bd74cedf1dd89cfcf8f373c38a1`) or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `39e1e87c1126e3c7bf93d4e84d234fcc92cf0dc9` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.
- [ ] Dependency facts (T010/#29 `f5ac137f`, T011/#30 `35d322c4`, T015/#34 `4166b5184170`) still hold on the candidate base.

## 2. Scope / authority fidelity

- [ ] Changes stay inside workflow-integration composition, orchestration glue and focused fixture/real-browser tests under `packages/*`.
- [ ] No consumed package (`domain-contracts`, `core-seam`, `core-scheduler`, `persistence-ledger`, `direct-acquisition`, `hls-vod-adapter`, `browser-observation`, `browser-auth-broker`, `discovery-recipe`, `core-runtime`, `version-validation`, `ai-proposal`) was semantically modified to solve an integration problem; any diff there must be provably non-semantic or absent.
- [ ] No T017 scope leaked: no `apps/*` product feature work, no `ai-proposal` convergence, no cross-surface shared runtime (bounded real-browser test wiring in `apps/browser-extension` is the only tolerated touch, and it must be test wiring).
- [ ] Frozen PRD/L2/Task Pack/DAG/index were not modified to accommodate implementation.
- [ ] Glue defines no new canonical status/evidence/identity vocabulary; `@xdownload/domain-contracts` remains the only source.
- [ ] Any new runtime dependency (e.g. browser driver/fixture framework) is an F1 choice with exact package/version/license/provenance recorded and no new Product/L2 authority implied.

## 3. Authorization boundaries hold through the composed flow

- [ ] Every acquisition in the composed flow is bound to a live broker capability whose exact (origin, target, contract, snapshot, provenance, partition, scope) binding matches the running contract/snapshot (`bindingsExactMatch` semantics) — verified at the flow level, not just unit level.
- [ ] Capability expiry/revocation mid-flow surfaces truthfully (AUTH_REQUIRED/AUTH_FAILED-influenced partials); no silent re-issue, no extension, no skip-and-continue absorption.
- [ ] Strict `allowed_origins` with no fallback transport is preserved end-to-end; no wildcard origin, no secondary transport, no transport introduced by glue.
- [ ] Only opaque `AuthorizationContextRef` crosses lanes; no raw cookie/token/signed-URL/credential material appears in flow state, fixtures, logs or test output; exit-sink redaction holds at every new seam.
- [ ] Authorization accessibility never rewrites requested scope; the C10 shape (accessible subset → PARTIAL, scope unchanged) is provable through the composed flow.
- [ ] The scope-leak test: for each lane (observation / discovery / collection / acquisition), enumerate what authority it gains and show it ends where the Frozen L2 boundary says it ends.

## 4. No lane leakage between observation / discovery / collection / acquisition

- [ ] Browser lane: observation records stay `EVIDENCE_INPUT_ONLY`; the lane never owns transfer lifecycle, progress authority or terminal truth; the untrusted-input gate and sink redaction are intact at every crossing.
- [ ] Discovery lane: follows only declared recipe edges and confirmed snapshot membership; no URL frontier, no crawl-until-empty, no generic pagination; typed rejections preserved.
- [ ] Collection lane: S5 default `continuation_scope=NONE` holds; continuation-loaded members are excluded without confirmed continuation; S6 stays within declared collection/member-detail edges with finite/natural-end closure.
- [ ] Acquisition lane: runs only through `@xdownload/core-runtime` lineage flow with canonical budget ports; no browser-owned or glue-owned transfer path exists; no private budget ledger.
- [ ] No cross-lane promotion: observation cannot self-certify validation claims; discovery suggestions cannot become independent truth; selection/confirmation proves selection only.

## 5. Snapshot / continuation integrity through composition

- [ ] Contract/snapshot identity is immutable through retry, resume, restart and redirect handling.
- [ ] `admitContinuationRequest`/`assertContinuationWithinFrozenScope`/`deriveContinuationSuccessor` are the only continuation path; budget exhaustion or runtime state never implies continuation (C23/C28 shapes hold).
- [ ] Successor expansion creates successor contract/snapshot identity; the original remains immutable historical authority (C11 shape).
- [ ] `detectFrozenMembershipDrift` semantics survive composition; count equality never hides replacement (C12 retry domain holds).
- [ ] Restart through `@xdownload/core-runtime` reopen inherits remaining budgets and frozen snapshots with no re-enumeration or replenishment.

## 6. Provenance / identity / result truth

- [ ] Provenance-bound redirect/CDN transitions preserve logical target identity; unrelated redirects reject without silent substitution (C29 shape end-to-end).
- [ ] Locator changes are recorded as provenance facts without mutating contract/snapshot identity.
- [ ] All terminal results are multidimensional and projected only through the T007 layer via `@xdownload/core-runtime`; no glue-local success boolean or status.
- [ ] TRUNCATED/UNKNOWN/PARTIAL truths (C02/C03/C14/C23/C24/C25 shapes) project exactly as the frozen PRD tuples; no synthesized completeness.
- [ ] VERIFIED_COMPLETE appears only with identity/membership closure evidence (C04 shape).

## 7. Negative-state and oracle coverage

- [ ] All `TEST_MATRIX.yaml` required suites have executable coverage on the exact candidate: s2-explicit-attachment-handoff, provenance-redirects, s5-current-page-collection, s6-explicit-collection, continuation-rules, auth-expiry-and-inaccessible-members, partial-truncated-unknown-truth.
- [ ] Each applicable C-oracle (C02–C29 subset listed in TEST_MATRIX) has a composed-flow fixture/oracle mapping.
- [ ] Every `negative_coverage` case has a durable executable rejection test, especially: continuation-inferred-from-budget, wildcard/fallback transport, raw-secret crossing, observation-as-truth, expired-capability reuse, snapshot drift, glue-local vocabulary.
- [ ] Real-browser suites that could not execute are durably recorded NOT_EXECUTED with environment evidence; fixture PASS was not substituted for real-browser PASS.
- [ ] Tests are deterministic where claimed and do not claim unexecuted network/external-service behavior.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates (`pnpm ci:verify`).
- [ ] T016-specific flow tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI/browser unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T016.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence; version-level visible Validation stays with T020–T023 on the exact T019 candidate.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction — with particular weight on Section 3/4: any path where authorization or lane authority leaks through the composed flow is a P0 by default given `risk:critical`. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
