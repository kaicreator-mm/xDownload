# T010 Review Checklist

Policy: `review:required`  
Risk: `risk:critical` — this is the browser/security/auth boundary task; authorization semantics get explicit emphasis below.  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T010 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T010 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `6a8505d2001009cd64ca63b80ecb97d51ec9a71f` @ checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside extension observation/handoff, native host/broker, auth capability issue/use/revoke and browser-specific task tests, plus directly necessary workspace/test wiring.
- [ ] No persistence/recovery, scheduler, transfer/media, Recipe interpreter, AI adapter or Desktop/CLI implementation leaked into T010.
- [ ] No Core runtime/convergence implementation (T015/T016 own it); the broker exposes a seam, not the integrated runtime.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/runtime/version/license/provenance recorded (including the native-host runtime).

## 3. Authorization semantics (critical emphasis)

- [ ] Authorization is referenced only by opaque `AuthorizationContextRef` from `packages/domain-contracts`; no local redefinition/fork of the identity.
- [ ] Every privileged auth use binds exact origin, target, contract, snapshot and observation provenance, plus partition context where browser state is partition-aware.
- [ ] Cross-origin, cross-contract, cross-snapshot, wrong-provenance and wrong-partition use fails closed — verified by executable tests, not assertions.
- [ ] Capability lifecycle is `issue`/`use`/`revoke` with real expiry; expired/revoked capability use yields truthful `AUTH_REQUIRED`/`AUTH_FAILED`.
- [ ] Expiry/revocation never triggers automatic re-issue, scope/target widening, or success conversion; re-issue only via an explicit authorized decision path.
- [ ] `AuthorizationContextRef`/accessibility never redefines, enlarges or shrinks confirmed `requested_scope` (PRD §17/R02; C10).
- [ ] Capability rebinding to a changed tuple is impossible in place; successor identity requires a new issue decision.

## 4. Native Messaging / browser boundary

- [ ] Native Messaging `allowed_origins` is configured and remains the separate platform-enforced boundary for the tested tuple.
- [ ] No fallback path from rejected Native Messaging to any unrestricted local IPC exists — including in error/recovery code paths.
- [ ] All page/content-script and native messages pass schema and size bounds before any privilege; oversized/malformed/unknown-authoritative-field input fails closed.
- [ ] Content-script input cannot invoke privileged native/auth actions without the gate; least host/API permissions (optional permissions where practical).
- [ ] Extension manifest and host registration match the declared tuple and do not request more authority than the owned boundary needs.

## 5. Secret containment

- [ ] Raw reusable cookie/token/password/session/signed-URL material remains inside the browser/broker secret zone for the tested flow.
- [ ] Tested sinks (Core-durable state, logs, evidence, Recipe data, model input) contain no raw secret sentinel material — audited by executable tests.
- [ ] Diagnostics/error paths never leak secrets.
- [ ] No production credential-vault claim is made; vault/platform gaps remain explicit limitations.

## 6. Observation / provenance semantics

- [ ] Observations carry tab/frame/origin/request provenance and are evidence inputs, never direct authority.
- [ ] Provenance-bound redirect/CDN transitions retain binding (C29) while unrelated redirect substitution fails closed.
- [ ] No observation is self-certifying; acceptance remains a Core-side decision downstream.
- [ ] Requested-scope coverage semantics stay truthful under auth limitation (accessible-subset accounting is separate from requested-scope coverage).

## 7. Real-tuple honesty and negative coverage

- [ ] At least one applicable real browser/native-host tuple executed the positive and negative suites; the exact tuple identity is durably recorded.
- [ ] No Firefox/Safari, Windows/macOS registration/packaging, extension-store or arbitrary-site claim is implied by Chromium/Linux evidence.
- [ ] Origin/partition/binding misuse, expiry, oversized-message, `allowed_origins` and secret-sink negatives all have executable coverage (see `TEST_MATRIX.yaml`, oracles C10/C21/C24/C29).
- [ ] Tests are deterministic where unit-level and explicitly identified where they require the real tuple; no simulated tuple stands in for a real one.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T010-specific browser/broker/auth tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI/real-browser unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T010; production packaging/registration belongs to T018/T023.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
