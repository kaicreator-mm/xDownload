# T012 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T012 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T012 JIT branch/base `f5ac137f94438a591fd6781c5b758be6c375233a` or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `358fc1dfcbb0a056f09063a5ba1bee10182515e1` @ freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the AI proposal/redaction boundary: provider abstraction, redaction, proposal schema, deterministic proposal validation/rejection, no-model fallback, and directly necessary package/test wiring.
- [ ] No Desktop/Browser/CLI behavior, scheduler, persistence, transfer/media, auth-broker internals or packaging implementation leaked into T012; surface+AI wiring remains T017.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] `@xdownload/domain-contracts` vocabulary and the `@xdownload/discovery-recipe` Recipe schema/decoder were consumed, not forked, relaxed or re-implemented.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded; no provider SDK is a required capability.

## 3. No-authority-leakage (highest-priority check)

- [ ] A proposal is data, never authority: acceptance never grants scope, navigation, authorization, secret access or validation/coverage authority.
- [ ] Proposals cannot mutate confirmed `requested_scope`/`continuation_scope` or snapshot membership; scope changes still require successor contract/snapshot identity through the canonical path.
- [ ] No proposal, envelope field or provider response path can inject navigation/auth capability beyond the confirmed contract and the finite `CAPABILITY_KINDS` vocabulary with passive/active rules intact.
- [ ] No code path lets model output execute shell/JS, touch the filesystem, scan hosts or navigate recursively.
- [ ] Raw secrets stay in the broker/browser secret zone; the adapter never imports, requests, persists or exports secret material.
- [ ] Model output cannot certify validation or coverage: provenance stays at best `SUGGESTIVE`/`DISCOVERY_DERIVED`; acceptance of a proposal creates no evidence truth by itself (C34).
- [ ] There is no hidden authority elevation anywhere: same authority before/after the adapter exists (verified by explicit tests, not asserted).

## 4. Proposal schema / deterministic policy

- [ ] Proposal envelopes carry explicit version identity, bounded size limit and provenance binding to gap/contract context/provider identity.
- [ ] Payloads decode only through the unmodified `decodeRecipeDefinition`; unknown/authority-changing fields fail closed.
- [ ] Oversized proposals reject before policy evaluation.
- [ ] Policy evaluation is deterministic and pure: same proposal + gap + contract context ⇒ same decision, with or without a live model.
- [ ] Fallback kinds are limited to `ASK_USER`/`ABORT`; evidence rules keep the `SUGGESTIVE` ceiling and `DISCOVERY_DERIVED` independence.

## 5. Redaction completeness

- [ ] Model input is built only from redacted bounded gaps/observations and capability facts (PRD §29; L2 §6.4 model-boundary redaction).
- [ ] Key-based containment (`RAW_SECRET_FIELD_NAMES`) applies at any nesting depth; value-based sentinel containment catches secrets smuggled into non-secret-named fields.
- [ ] Sentinel-based audits cover the model-input boundary, the proposal payload and the provider-response audit path before any durable use.
- [ ] Redaction reuse (e.g. `redactForSink`) or local equivalent does not weaken T010 containment strength.

## 6. Model-offline degradation truthfulness

- [ ] Provider outage/timeout/malformed response resolves to typed unavailability/unknown plus deterministic-path or `ASK_USER`/`ABORT` fallback.
- [ ] Degraded runs never mark partial/failed work complete and never widen behavior (Task Pack: degrade truthfully, not widen).
- [ ] Failure categories are not rewritten into success by retries or AI explanation (PRD §30).
- [ ] Deterministic/template-supported ordinary tasks require no model dependency (PRD §5.1).

## 7. Negative-state and oracle coverage

- [ ] Tests decode proposals from `unknown`/external-shaped input, not only from typed constructions.
- [ ] Malicious-proposal corpus covers scope mutation, authority grants, shell/JS, secret embedding/signaled-URL durable rules, self-certification and unknown-field smuggling; each rejection names the violated rule.
- [ ] Oversized, malformed and unknown-version proposals reject.
- [ ] C06/C19/C20/C21/C22/C34 have durable T012-level fixture/oracle mappings with executable coverage.
- [ ] Sentinel redaction tests exist and pass; parity tests prove one policy with/without model (C19).
- [ ] Tests are deterministic, local, and make no real provider network calls.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T012-specific schema/policy/redaction/fallback/malicious tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim or G2 AI-Increment gate claim is introduced by T012.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction — in particular no authority leakage, no secret exposure and no untruthful degradation. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
