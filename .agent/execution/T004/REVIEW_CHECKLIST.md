# T004 Review Checklist

Policy: `review:required`  
Risk: `risk:high`  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T004 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T004 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `b3b6bdd6f47f0e6908222c8fe9e42dc69ad31f36` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the Core command/query server/client seam, wire compatibility, peer authentication/authorization, input validation, lifecycle-independent client behavior, and directly necessary workspace/test wiring.
- [ ] No Desktop UI, CLI adapter, browser extension/broker, persistence/recovery, scheduler, evidence/result projector, transfer/media, secret broker or AI runtime implementation leaked into T004.
- [ ] No public REST API, MCP server, SDK or remote/server mode was built (frozen PRD §6.4).
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] Implementation does not create a competing mutable authority outside the Core-owned command/query seam; all authority transitions resolve through it.
- [ ] Any new runtime dependency is an F1 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Wire compatibility / envelope versioning

- [ ] Command/query envelope carries an explicit schema identity/version at the wire boundary.
- [ ] Known supported versions decode deterministically.
- [ ] Unknown/incompatible versions fail closed; no silent defaulting or reinterpretation.
- [ ] Unknown authority-changing fields cannot silently alter command semantics, lineage or authorization.
- [ ] Envelope carries command/idempotency identity, expected/current revision, command type/payload and lineage correlation references per frozen L2 §6.3.
- [ ] Payload admission delegates to `@xdownload/domain-contracts` decoders; no second/forked decode vocabulary exists.
- [ ] TypeScript static types are not used as a substitute for runtime validation of wire data.

## 4. Idempotency / revision / duplicate semantics

- [ ] Duplicate submission of the same idempotent command identity converges to one accepted lineage and never creates a second acquisition/effect.
- [ ] Same idempotency identity with a different payload rejects; conflicting duplicates are not silently deduplicated or re-executed.
- [ ] Expected/current revision mismatch rejects with a typed diagnostic.
- [ ] Accepted commands remain authoritative across Core restart; replay does not re-execute accepted external effects (ADR-010 idempotent acceptance/reconciliation; no exactly-once claim is made).
- [ ] Late command after a terminal lineage is recorded/rejected as late; terminal truth is never rewritten (frozen L2 §11).

## 5. Peer authorization / input bounds

- [ ] Peer identity/authorization is verified per authority-affecting command/query; same-install/same-user semantics match the chosen transport.
- [ ] Unauthorized/foreign peers reject fail-closed, including on queries where authority-sensitive.
- [ ] No anonymous/unrestricted fallback transport exists alongside the authorized path; Native Messaging `allowed_origins` is not bypassed.
- [ ] Declared size/framing/depth bounds are enforced before authority transition and covered by tests, including the oversized-input rejection required by the frozen Validation scope.
- [ ] Rejection diagnostics are typed and leak no secret material; raw reusable secrets are never ordinary seam state.

## 6. Authority topology / lifecycle independence

- [ ] Desktop/CLI/Browser-shaped clients can submit commands and read projections through the seam without owning Core lifetime.
- [ ] Client submit/reconnect semantics survive Core restart; restart does not duplicate accepted commands or effects.
- [ ] All cancellation/retry commands from any surface resolve through the same Core transition with one precedence (frozen L2 §11.1 rule 7).
- [ ] Projections are read-only and Core-owned; no per-surface status derivation; no surface-owned budget/result state is creatable via commands.
- [ ] Chosen transport keeps ADR-012 replaceability; no production platform/framework/daemon-lifecycle freeze is introduced by T004.

## 7. Negative-state and oracle coverage

- [ ] Envelope/transport decode tests begin from `unknown`/external-shaped inputs, not only construction from typed objects.
- [ ] Malformed envelopes, unknown command discriminants, unsupported versions, oversized payloads and unauthorized peers reject deterministically.
- [ ] Scope-mutating commands without successor identity, snapshot-mutating commands, out-of-domain retry commands and cross-task command replay reject.
- [ ] C08/C11/C12/C13/C16/C30/C31 each have a durable seam-level fixture/oracle mapping with executable coverage appropriate to T004.
- [ ] Tests are deterministic and local; no real second machine, real browser, Desktop shell, database or network transfer harness is claimed as T004 coverage.
- [ ] Fixture inputs are immutable/fresh per case so duplicate/replay tests cannot pass through shared mutation.

## 8. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T004-specific seam tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No release/platform support claim is introduced by T004.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or Release PASS is inferred from task-level evidence.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
