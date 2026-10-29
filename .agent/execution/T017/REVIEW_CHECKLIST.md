# T017 Review Checklist

Policy: `review:required`  
Risk: `risk:high` (frozen at the freeze checkpoint; not recalculated)  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

Convergence blast-radius emphasis: this task touches every product surface and the AI boundary at once. Review must concentrate on (a) the provider deadline wrapper, (b) AI proposals staying suggestive-only through the composed path, (c) surfaces staying thin, and (d) no authority elevation at any seam.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T017 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T017 JIT branch/base `5b86cd2ca3b5cc587f7bf42f4331716637081353` or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `234eb3ac308b0520e5ef022c7124d0ad622182b9` (`T017_surface-ai-integration.md`) unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Convergence blast radius — provider deadline wrapper (highest scrutiny)

- [ ] EVERY provider invocation in the composed path is wrapped by a caller-side deadline/cancellation; there is no unwrapped call site.
- [ ] Deadline expiry resolves as typed `MODEL_UNAVAILABLE`/`TIMEOUT` + deterministic fallback (`ASK_USER`/`ABORT`), never as a hang, silent skip, empty success, or exception leak.
- [ ] The deadline is charged to canonical budget semantics per Frozen PRD §15 (GlobalSafetyBudget: model cost/calls, global active elapsed time); no budget is replenished or redefined by the wrapper.
- [ ] The wrapper is deterministic under test (hung fake providers resolve within the bound in unit tests).
- [ ] `@xdownload/ai-proposal` internals are untouched: the wrapper lives at the T017 call site, honoring the T012 P2 waiver rather than patching the consumed package.

## 3. AI stays suggestive-only through the composed path

- [ ] Accepted proposals carry suggestion provenance and are consumed ONLY through the unmodified `@xdownload/discovery-recipe` decode/confirmation machinery — same machinery as human suggestions (C19).
- [ ] No model output reaches scope, membership, authorization, validation, budget or terminal-status authority; no AI-specific exception to any contract invariant exists in glue (C34).
- [ ] Proposals bind to the exact `expectedGapRef`/`expectedContractRef`; stale/mismatched proposals fail closed (C20/C31).
- [ ] Malicious/hostile proposals (unknown versions, oversized envelopes, authority-bearing unknown fields, credential-bearing payloads, scope-expanding Recipes) fail safely as typed rejections/unavailability; containment/redaction holds at the wired boundary.
- [ ] Deterministic-only mode (`provider: undefined`) remains complete and correct: identical deterministic outcomes and statuses with the provider configured and omitted (C16); no ordinary task requires the model.

## 4. Surfaces stay thin

- [ ] `apps/cli` and `apps/desktop` changes are presentation/wiring only; T013/T014 authority rules survive verbatim (no surface-local status derivation, no private durable store, no local timeout-cancel, no success boolean).
- [ ] Every surface renders SeamResponse/PROJECTION verbatim from Core; the same canonical contract yields the same response class and six-dimension projection on every surface.
- [ ] Core-disconnect renders as explicit degraded state on every surface with no fabricated status/progress; reconnect re-syncs from projections only.
- [ ] `apps/browser-extension` is consumer/verification only: no packaging/bundling (T018), no privileged-logic redesign, Native Messaging remains the only broker transport.

## 5. No authority elevation at any seam

- [ ] Per-frame peer authorization holds everywhere: no surface inherits an earlier peer's admission; identity vs authorization failures remain distinct typed rejections.
- [ ] All commands/queries from all surfaces traverse the T004 seam against the single T015 composition root; no second Core authority, no bypass transport, no per-surface command vocabulary.
- [ ] Concurrent UI/CLI clients converge: idempotent requestId replay, duplicate-allocation rejection by canonical identity (C13), one status per lineage/effect identity.
- [ ] Browser-triggered actions project identically to all surfaces; the browser lane contributes evidence and intent only.
- [ ] Scope/continuation/authorization semantics are identical across UI vs CLI; expansion/refresh/auth-change routes successor-identity commands through the seam on every surface (C08/C11).

## 6. HITL parity

- [ ] `planConfirmationWorkflow` plans render verbatim and route as idempotent Core commands from every surface; no per-item explosion of batch ambiguity (C30).
- [ ] AI-suggested candidates pass the same explicit human confirmation flow as any candidate; no glue auto-resolves an `ASK_USER` fallback (C05/C26).
- [ ] HITL choices remain explicit and attributable only through Core records.

## 7. Scope / authority fidelity

- [ ] Changes stay inside cross-surface convergence wiring, the optional minimal composition module(s) under `packages/*`, narrowly necessary workspace wiring, and focused convergence tests.
- [ ] No consumed package (`domain-contracts`, `version-validation`, `core-seam`, `core-scheduler`, `persistence-ledger`, `direct-acquisition`, `hls-vod-adapter`, `browser-observation`, `browser-auth-broker`, `discovery-recipe`, `ai-proposal`, `core-runtime`, `browser-collection-workflow`, T001 smoke) was semantically modified.
- [ ] No T018 packaging/platform/release work and no frozen-doc mutation.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 8. Evidence / gate integrity

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] The T017 convergence matrix (`TEST_MATRIX.yaml`: required suites, applicable C-oracles, negative coverage) executes on the exact candidate with durable result identity.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS; version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No packaging/platform support claim is introduced by T017.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Given the convergence blast radius, any finding against sections 2–5 (deadline wrapper, AI suggestion ceiling, thin surfaces, seam authority) is P0/P1 by default. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
