# T016 Implementation Map — exact base `4166b51841709bd74cedf1dd89cfcf8f373c38a1`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Exact-base package inventory (observed)

`packages/` contains 14 packages; `apps/` contains 3:

| Package | Origin task | Role on this base |
| --- | --- | --- |
| `packages/toolchain-smoke`, `packages/toolchain-smoke-core` | T001 | toolchain smoke only |
| `packages/domain-contracts` | T002 (+T007) | canonical vocabulary: scope/snapshot/contract/budget/evidence/result/ports/decode/coverage-accounting/result-projector |
| `packages/version-validation` | T003 | validation harness/corpora/gate instrumentation |
| `packages/core-seam` | T004 | command/query authority boundary |
| `packages/persistence-ledger` | T005 | single-writer durable ledger, recovery |
| `packages/core-scheduler` | T006 | control/lifecycle budgets/cancellation |
| `packages/direct-acquisition` | T008 | S1/S3 direct HTTP/file adapter |
| `packages/hls-vod-adapter` | T009 | S4 HLS VOD adapter |
| `packages/browser-observation` | T010 | untrusted-input gate, provenance-bound observation, handoff, sink redaction |
| `packages/browser-auth-broker` | T010 | Native Messaging broker, `allowed_origins`, expiring scoped capabilities, secret zone |
| `packages/discovery-recipe` | T011 | recipe engine, bounded discovery, identity accounting, continuation admission/successor, confirmation workflow |
| `packages/ai-proposal` | T012 | bounded AI proposal adapter (T016-forbidden to integrate) |
| `packages/core-runtime` | T015 | THE composition root: Core Control Runtime |
| `apps/browser-extension`, `apps/cli`, `apps/desktop` | T013/T014 existing | product surfaces (T016-forbidden beyond bounded real-browser fixture consumption) |

## Existing repository seams and T016 use

| Exact current path | Exact-base fact | T016 use / constraint |
| --- | --- | --- |
| `packages/core-runtime/src/runtime.ts` | exports `createCoreRuntime` / `reopenCoreRuntime` / `closeCoreRuntime` / `CoreRuntime` / `CoreRuntimeOptions` / `CoreRuntimeCompositionError` — the single composition root (frozen L2 §6.1 Alternative C) | T016 composes ON TOP of it: obtain the runtime, drive canonical lineages through it. Never fork or wrapper-replace its lifecycle. |
| `packages/core-runtime/src/flow.ts` | exports `registerLineage`, `resumeLineage`, `cancelLineage`, `executeDirectAcquisition`, `executeHlsAcquisition`, `projectLineageResult`, `effectIdFor`, `DirectFlowInput/Outcome`, `HlsFlowInput/Outcome`, `LineageSeed`, `LineageProjectionInput`, `CoreRuntimeFlowError`; grep-verified: zero browser/observation/broker/recipe references | The acquisition entry T016 feeds. S2/S5/S6 flows submit canonical contract/snapshot inputs here; terminal truth comes back only via `projectLineageResult`. |
| `packages/core-runtime/src/budget-bridge.ts` | exports `CoreRuntimeBudgetBridge`, `schedulerTransferBudgetPort`, `schedulerHlsTransferLedger` | Canonical budget ports the adapters consume. T016 must not create a second/private ledger; discovery-side budgets flow through the same bridge semantics. |
| `packages/core-runtime/src/durable-stores.ts` | exports `durableLayout`, `FileBackedControlFactLog`, `FileBackedSeamJournal`, `DurableStoreCorruptError` | Durable truth seam for restart-inheriting flows; reuse as-is for fixture flows that need persistence. |
| `packages/browser-observation/src/observation.ts` | exports `OBSERVATION_AUTHORITY_MARKER = 'EVIDENCE_INPUT_ONLY'`, `recordObservation`, `observationProvenanceKey`, `ObservationRecord` | The only way browser-originated facts enter the flow: as evidence-input-only observation records with provenance keys. Never promote them to validation truth. |
| `packages/browser-observation/src/handoff.ts` | exports `buildObservationHandoff`, `networkObservationEvidenceCandidate`, `ObservationHandoff`, `HandoffOptions`; `messageGate.ts`/`sinkRedaction.ts` gate untrusted input and redact exit sinks | The S2 explicit-attachment seam: untrusted page/attachment observation → gated, provenance-bound handoff into canonical vocabulary. T016 wires this handoff toward broker + Core; it must not weaken the gate or redaction. |
| `packages/browser-auth-broker/src/broker.ts` + `capability.ts` | exports `createAuthBroker`, `AuthBroker` (`issue`/`use`/`revoke` shape), `IssueRequest`, `UseRequest`; `CapabilityBinding`, `decodeCapabilityBinding`, `bindingsExactMatch`, `bindingMismatchField`, `capabilityStatus`, `allocateAuthorizationContextRef`, `Clock`/`systemClock` | Scoped-authorization authority: expiring capabilities bound to exact (origin, target, contract, snapshot, provenance, partition, scope) tuples. T016 binds acquisition to a live capability and surfaces `capabilityStatus` truthfully (expiry ≠ success, mismatch = rejection). |
| `packages/browser-auth-broker/src/allowedOrigins.ts`, `brokerChannel.ts`, `nativeFrame.ts`, `nativeHost.ts`, `secretZone.ts` | strict `allowed_origins` with no fallback transport; Native Messaging framing; stdio serving loop as only I/O; exit-sink secret containment | The only sanctioned cross-boundary transport for real-browser flows. No new transport, no wildcard origins, no raw secrets through IPC — only opaque `AuthorizationContextRef`. |
| `packages/discovery-recipe/src/discovery.ts` + `capabilities.ts` + `recipe.ts` | exports `DiscoverySessionConfig`, `DiscoverySession`, `DiscoveryStop`, `DiscoveryEvent`, `DiscoveryRejection`, `DiscoveryStepResult`, `NaturalEndRelation`; declarative recipe engine | Bounded S5/S6 discovery orchestration: only declared recipe edges, natural-end relation explicit, rejection typed. T016 drives it; it never replaces it with a crawler/frontier. |
| `packages/discovery-recipe/src/identity.ts` | collection/member identity accounting | Membership identity authority for S5/S6 snapshots; count equality is never completeness. |
| `packages/discovery-recipe/src/confirmation.ts` | exports `planConfirmationWorkflow`, `recordConfirmation`, `confirmationEvidenceRecord`, `selectionAcquisitionComplete`, `assertSelectionKnowledgeReusable`, `MAX_MATERIAL_ITEM_CONFIRMATIONS` | Selection/confirmation workflow: T016 routes user confirmation through this, preserving evidence independence (selection proves selection only). |
| `packages/discovery-recipe/src/continuation.ts` | exports `admitContinuationRequest`, `assertContinuationWithinFrozenScope`, `deriveContinuationSuccessor`, `detectFrozenMembershipDrift`, `planFailedMemberRetry`, `ContinuationRequestKind` (`LOAD_MORE`/`INCLUDE_MORE`/`CONTINUE_NEXT_PAGE`), `ContinuationSuccessorBundle` | The ONLY continuation path: S5 default `continuation_scope=NONE`; expansion → successor identity; drift detection and failed-member retry domains. T016 must not infer continuation from budget or runtime state. |
| `packages/discovery-recipe/src/slices.ts` | S5/S6 slice representations | Slice-conformant flow construction for S5/S6. |
| `packages/direct-acquisition/src/*`, `packages/hls-vod-adapter/src/*` | T008/T009 adapters (already wired into core-runtime flow) | Executed via `executeDirectAcquisition`/`executeHlsAcquisition` with canonical budget ports. S2/S5 members and S6 members acquire through these; no browser-owned transfer. |
| `packages/domain-contracts/src/*` | canonical contract/snapshot/scope/budget/evidence/result/ports vocabulary (`contract.ts`, `scope.ts`, `snapshot.ts`, `evidence.ts`, `result.ts`, `ports.ts`, `decode.ts`, …) | The only canonical vocabulary in T016 glue. No glue-local status/evidence/identity types. |
| `apps/browser-extension/` (manifest.json, src/) | privileged extension context that consumes `@xdownload/browser-observation` at the browser boundary | MAY be driven by real-browser fixtures as a consumer (manifest/host wiring for local fixture flows is bounded test wiring); T016 does not implement product features in it. |
| `vitest.config.ts` | discovers `packages/*/test/**/*.test.ts` | Focused fixture/flow tests live package-local under the new integration package's `test/`. |
| `docs/product/PRD-v0.4.2-review-candidate.md` §28 (S2/S5/S6), §29 | frozen slice contracts | Read-only authority for slice semantics and the authorization boundary. |
| `.agent/execution/T016/` | this JIT pack | Guidance/evidence only. Never ship as product content. |

## Current absence facts that matter

At the bound base, `@xdownload/core-runtime` composes command/query, scheduler, persistence, projection and the S1/S3/S4 adapters, but **no module composes the T010 browser seams or the T011 recipe/collection engine into runtime-driven flows** (grep-verified: `core-runtime/src/flow.ts` has no browser/observation/broker/recipe references). There is no browser→broker→Core workflow package, no collection orchestration package, and no real-browser fixture harness. T016 therefore creates the minimal workflow-integration surface rather than wiring into a non-existent orchestration layer.

This absence is not permission to invent T017 (surface/AI convergence) or to move domain decisions into glue.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a small split under `packages/*`. Whatever layout is chosen should keep these concerns explicit:

- S2 handoff lane: observation handoff → broker capability binding → Core `DirectFlowInput`/`HlsFlowInput` submission with provenance-bound redirect handling;
- S5/S6 collection lane: recipe-driven bounded discovery → confirmation workflow → snapshot freeze (`continuation_scope=NONE` default) → per-member acquisition through Core → coverage/selection truth;
- authorization lifecycle adapter: broker capability issue/use/revoke/expiry projected truthfully into flow states;
- successor/retry orchestration: continuation admission/successor derivation and failed-member retry domains;
- focused fixture + real-browser flow harness (local fixture pages; driver choice is F1).

Do not merge the browser lane and acquisition lane into one authority; the boundary (observation-only vs Core-owned transfer) is the point of the task.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T016 tests should remain package-local and cover the `TEST_MATRIX.yaml` suites: fixture S2/S5/S6 flows, expiry, continuation rules, partial/inaccessible members, provenance redirects, plus real-browser flows where the environment admits them. Real-browser tests that cannot execute in a given environment must be reported NOT_EXECUTED, never converted to PASS.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T016 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
