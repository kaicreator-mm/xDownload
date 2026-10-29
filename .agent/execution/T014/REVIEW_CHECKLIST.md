# T014 Review Checklist

Policy: `review:recommended` (frozen in Issue #33; not recalculated)  
Risk: `risk:medium` (frozen; not recalculated)  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T014 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T014 JIT branch/base or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `848be622d379f55dc3f42c8dc10e53d0826fe177` unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.
- [ ] Dependency facts remain T004/#23 `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2` and T007/#26 `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside the Desktop presentation surface, non-authoritative interaction state, Core client wiring abstractions and UI tests, plus directly necessary workspace/test wiring.
- [ ] No scheduler/budget-ledger, persistence, discovery/Recipe engine, transfer/media, browser extension/broker or packaging implementation leaked into T014.
- [ ] Frozen PRD/L2/Task Pack were not modified to accommodate implementation.
- [ ] No UI-owned contract/snapshot/budget/result truth and no per-surface status derivation exist; all status/result display is read from `@xdownload/core-seam` projections.
- [ ] Any new UI framework/renderer/test-harness dependency is an F2 implementation choice only, with exact package/version/license/provenance recorded.

## 3. Projection consumption / thin-surface boundary

- [ ] Commands/queries are submitted as idempotent seam envelopes with a `DESKTOP_UI` peer identity; no direct reads/writes of `packages/persistence-ledger`, scheduler internals or transfer adapters.
- [ ] `ContractProjectionView`/`SnapshotProjectionView`/`LineageProjectionView` and `ProjectedTerminalResult` are rendered verbatim; no semantic re-derivation UI-side.
- [ ] Malformed/unparseable projection data fails closed to an explicit degraded state rather than being reinterpreted.
- [ ] UI interaction state is clearly separated from confirmed/authoritative values and is never persisted as durable truth.

## 4. Immutable scope / successor routing

- [ ] Confirmed `requested_scope`, continuation scope and coverage target render immutable; no interaction path edits them in place.
- [ ] "Load more"/"Refresh"/"Continue"/expansion interactions route successor-identity commands and leave the original confirmed display unchanged.
- [ ] Budget/authorization context cannot alter displayed requested scope.
- [ ] Simple single-resource tasks are not forced through collection preview.

## 5. Selection / confirmation flow fidelity

- [ ] Confirmation-plan levels render exactly as produced by the Core-side workflow: one scope-level confirmation → one batch/group confirmation → at most the bounded material-item count → manual selection UI.
- [ ] No per-item interrogation where one batch/manual surface resolves the same ambiguity (C30).
- [ ] Confirmation is presented as proving selection only; quality/membership truth is never implied (C26/C27/C34).
- [ ] Prior/partial selection is never offered as reusable authority without distinct validated provenance (C31).
- [ ] No raw reusable secrets are collected or stored in UI state; authorization context stays opaque.

## 6. Status explanation / result truth

- [ ] No single `success` boolean drives the result display.
- [ ] Request Fulfillment, Target Resolution, Selection Acquisition, Coverage, Stop Reason and Validation Summary are separately displayed from the projection.
- [ ] PARTIAL/UNKNOWN/TRUNCATED/UNSATISFIED and unsupported/out-of-scope render truthfully rather than being silently approximated (C02/C10/C14/C15/C23/C24).
- [ ] Confirmation never causes failed/incomplete required validation to display as complete (C27).
- [ ] Cancellation/retry outcomes come from Core transition projections; no surface-local precedence or timeout-cancel exists (C12/C13).

## 7. Core-disconnect behavior

- [ ] Seam unavailability produces an explicit degraded/disconnected state with no fabricated progress/status/completion.
- [ ] Reconnect/re-entry restores UI state from Core projections only; no UI-local durable truth survives disconnect.
- [ ] Disconnect tests exercise the seam loopback failure path deterministically (no real sockets/shell required).

## 8. Negative-state and oracle coverage

- [ ] C02/C05/C08/C09/C10/C11/C12/C13/C14/C15/C16/C23/C24/C26/C27/C30/C31/C34 each have a durable presentation-level fixture/oracle mapping and executable coverage appropriate to T014.
- [ ] The negative coverage list in `TEST_MATRIX.yaml` (surface-authority leak, silent scope/selection change, per-item burden, UI-derived status, stale projection, disconnect fabrication, local precedence, expansion-without-successor, suggestion-as-truth, secret capture) is covered by failing tests before fixes, not only by construction.
- [ ] Tests are deterministic, local and claim no unexecuted browser/network/persistence/media behavior.

## 9. Toolchain / gate evidence

- [ ] Exact candidate passes applicable root format/lint/typecheck/unit gates.
- [ ] T014-specific component/interaction tests execute on the exact candidate and their result identity is durable.
- [ ] Tooling/CI unavailability is reported as NOT_EXECUTED/BLOCKED, never converted to PASS.
- [ ] Concern Validation PASS, if any, is distinct from Review disposition; version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.

## 10. Scope creep / packaging

- [ ] `.agent/execution/` remains evidence only and is not treated as product source.
- [ ] No desktop framework/OS/installer/updater support claim, release claim or Candidate Freeze/Version Closure/Release Qualification inference is introduced by T014.
- [ ] Closeout evidence is UI tests, not release UX claims.

## 11. Review disposition

Review is `recommended`, not `required`: a recommended Review should still resolve any P0/P1 finding against the exact candidate and any higher-authority contradiction before merge; findings found without a Review remain attributable to the absence of Review, not evidence of PASS. Any bounded repair creates a new exact subject requiring successor Validation/Review consideration per ADS currentness rules.
